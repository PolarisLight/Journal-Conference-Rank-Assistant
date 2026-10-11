#!/usr/bin/env python3
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist" / "firefox-extension"
VERSION = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))["version"]
OUTPUT = ROOT / "dist" / f"firefox-extension-v{VERSION}.zip"
with ZipFile(OUTPUT, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(path for path in SOURCE.rglob("*") if path.is_file()):
        info = ZipInfo(file.relative_to(SOURCE).as_posix(), date_time=(2026, 8, 12, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, file.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
print(f"Created {OUTPUT}")
