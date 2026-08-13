#!/usr/bin/env python3
"""Build Chrome, Firefox, and AMO source archives with POSIX ZIP names."""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(r"C:\Users\polaris\Documents\Codex\2026-07-12\ch\outputs")
BUILD = Path(tempfile.gettempdir()) / "journal-conf-rank-assistant-release"
STAMP = (2026, 8, 12, 0, 0, 0)


def manifest(name: str) -> dict:
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


CHROME_MANIFEST = manifest("manifest.json")
FIREFOX_MANIFEST = manifest("manifest.firefox.json")
VERSION = CHROME_MANIFEST["version"]
SUFFIX = "-" + sys.argv[1].strip("-") if len(sys.argv) > 1 and sys.argv[1].strip("-") else ""
TEST_VARIANT = sys.argv[1].strip("-") if len(sys.argv) > 1 else ""
STANDALONE_FIREFOX_TEST = TEST_VARIANT in {"ajg-standalone-test", "ajg-rg-test", "ajg-rg-search-test", "preset-test"}
if FIREFOX_MANIFEST["version"] != VERSION:
    raise SystemExit("Chrome and Firefox manifest versions differ")


def extension_files() -> list[Path]:
    roots = [ROOT / "_locales", ROOT / "extension"]
    files = [path for root in roots for path in root.rglob("*") if path.is_file()]
    forbidden = [path for path in files if path.name.endswith(".private.json")]
    if forbidden:
        files = [path for path in files if path not in forbidden]
    return sorted(files)


def populate(target: Path, firefox: bool) -> None:
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    selected = json.loads(json.dumps(FIREFOX_MANIFEST if firefox else CHROME_MANIFEST))
    if firefox and STANDALONE_FIREFOX_TEST:
        selected["version"] = VERSION + (".7" if TEST_VARIANT == "preset-test" else ".6")
        selected["name"] = "期刊会议等级与分区助手（功能测试版）" if TEST_VARIANT == "preset-test" else "期刊会议等级与分区助手（AJG 测试版）"
        selected["browser_specific_settings"]["gecko"]["id"] = (
            "journal-conference-rank-assistant-ajg-test@polarislight.github.io"
        )
    (target / "manifest.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for source in extension_files():
        relative = source.relative_to(ROOT)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def write_zip(source: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(path for path in source.rglob("*") if path.is_file()):
            relative = file.relative_to(source).as_posix()
            if "\\" in relative:
                raise ValueError(f"Non-POSIX archive name: {relative}")
            info = ZipInfo(relative, date_time=STAMP)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, file.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    validate_zip(output)


def central_names(raw: bytes) -> list[bytes]:
    names = []
    offset = 0
    signature = b"PK\x01\x02"
    while True:
        offset = raw.find(signature, offset)
        if offset < 0:
            return names
        if offset + 46 > len(raw):
            raise ValueError("Truncated ZIP central directory")
        name_len, extra_len, comment_len = struct.unpack_from("<HHH", raw, offset + 28)
        start = offset + 46
        names.append(raw[start : start + name_len])
        offset = start + name_len + extra_len + comment_len


def validate_zip(path: Path) -> None:
    with ZipFile(path) as archive:
        names = archive.namelist()
        if any("\\" in name for name in names):
            raise ValueError(f"Backslash entry in {path}")
        if any(name.endswith(".private.json") for name in names) and "source" not in path.name:
            raise ValueError(f"Private data in install package {path}")
        bad = archive.testzip()
        if bad:
            raise ValueError(f"Corrupt entry {bad} in {path}")
    raw_names = central_names(path.read_bytes())
    if len(raw_names) != len(names) or any(b"\\" in name for name in raw_names):
        raise ValueError(f"Raw ZIP filename validation failed for {path}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_amo_source(firefox_dir: Path, output: Path) -> None:
    source_root = BUILD / "amo-source"
    shutil.rmtree(source_root, ignore_errors=True)
    (source_root / "source").mkdir(parents=True)
    for file in sorted(path for path in firefox_dir.rglob("*") if path.is_file()):
        if file.name.endswith(".encrypted.json") or file.name == "issn-index.js":
            continue
        destination = source_root / "source" / file.relative_to(firefox_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, destination)

    data_dir = source_root / "source-data"
    data_dir.mkdir()
    ivs = {}
    for encrypted in sorted((firefox_dir / "extension" / "data").glob("catalog-shard-*.encrypted.json")):
        payload = json.loads(encrypted.read_text(encoding="utf-8"))
        shard = encrypted.name.removeprefix("catalog-shard-").removesuffix(".encrypted.json")
        plain = ROOT / "extension" / "data" / f"catalog-shard-{shard}.private.json"
        if not plain.exists():
            raise FileNotFoundError(plain)
        digest = hashlib.sha256(plain.read_bytes()).hexdigest()
        if digest != payload["sha256"]:
            raise ValueError(f"Plaintext shard digest mismatch: {shard}")
        shutil.copy2(plain, data_dir / plain.name)
        ivs[shard] = payload["iv"]
        base64.b64decode(payload["iv"], validate=True)
    if len(ivs) != 28:
        raise ValueError(f"Expected 28 data shards, got {len(ivs)}")
    (data_dir / "encryption-ivs.json").write_text(
        json.dumps(ivs, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    expected = {
        file.relative_to(firefox_dir).as_posix(): sha256(file)
        for file in sorted(path for path in firefox_dir.rglob("*") if path.is_file())
    }
    (data_dir / "expected-files.json").write_text(
        json.dumps(expected, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    scripts = source_root / "scripts"
    scripts.mkdir()
    shutil.copy2(ROOT / "scripts" / "amo_build_extension.mjs", scripts / "build-extension.mjs")
    shutil.copy2(ROOT / "scripts" / "amo_package_extension.py", scripts / "package-extension.py")
    shutil.copy2(ROOT / "scripts" / "build_issn_index.py", scripts / "build-issn-index.py")
    shutil.copy2(ROOT / "AMO_BUILD.md", source_root / "README.md")
    (source_root / "build.sh").write_text(
        '#!/usr/bin/env sh\nset -eu\ncd "$(dirname "$0")"\npython3 scripts/build-issn-index.py\nnode scripts/build-extension.mjs\npython3 scripts/package-extension.py\n',
        encoding="utf-8",
    )
    (source_root / "build.ps1").write_text(
        '$ErrorActionPreference = "Stop"\nPush-Location $PSScriptRoot\ntry {\n  python scripts/build-issn-index.py\n  node scripts/build-extension.mjs\n  python scripts/package-extension.py\n} finally {\n  Pop-Location\n}\n',
        encoding="utf-8",
    )
    write_zip(source_root, output)


OUTPUT.mkdir(parents=True, exist_ok=True)
chrome_dir = OUTPUT / f"journal-conf-rank-assistant-chrome-v{VERSION}{SUFFIX}-unpacked"
firefox_dir = OUTPUT / f"journal-conf-rank-assistant-firefox-v{VERSION}{SUFFIX}-unpacked"
populate(chrome_dir, firefox=False)
populate(firefox_dir, firefox=True)

chrome_zip = OUTPUT / f"journal-conf-rank-assistant-chrome-v{VERSION}{SUFFIX}.zip"
firefox_xpi = OUTPUT / f"journal-conf-rank-assistant-firefox-v{VERSION}{SUFFIX}.xpi"
source_zip = OUTPUT / f"journal-conf-rank-assistant-firefox-source-v{VERSION}{SUFFIX}.zip"
write_zip(chrome_dir, chrome_zip)
write_zip(firefox_dir, firefox_xpi)
build_amo_source(firefox_dir, source_zip)

checksums = OUTPUT / f"SHA256SUMS-v{VERSION}{SUFFIX}.txt"
artifacts = [chrome_zip, firefox_xpi, source_zip]
checksums.write_text("".join(f"{sha256(path)}  {path.name}\n" for path in artifacts), encoding="utf-8")
print(json.dumps({"version": VERSION, "artifacts": [str(path) for path in [*artifacts, checksums]]}, ensure_ascii=False, indent=2))
