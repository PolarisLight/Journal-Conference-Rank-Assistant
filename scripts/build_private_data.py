#!/usr/bin/env python3
"""Build the private source dataset for the rank assistant from ShowJCR CSV exports."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "sources" / "private"
OUTPUT = ROOT / "build" / "journals.private.json"
DATA_DIR = ROOT / "extension" / "data"
BUILD_INFO = ROOT / "extension" / "data" / "build-info.private.json"
CHUNK_SIZE = 4000


def norm(value: str) -> str:
    value = (value or "").casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def read_rows(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def zone(value: str) -> str:
    match = re.search(r"([1-4])", value or "")
    return match.group(1) if match else ""


def truthy_cn(value: str) -> bool:
    return (value or "").strip() in {"是", "Yes", "YES", "true", "True", "1"}


def ccf_rank(value: str) -> str:
    value = value or ""
    match = re.search(r"([ABC])", value, re.IGNORECASE)
    return match.group(1).upper() if match else ""


def ccf_venue_aliases(title: str, venue_type: str) -> list[str]:
    """Generate conservative display-name aliases for CCF venues."""
    if "\u4f1a\u8bae" not in (venue_type or ""):
        return []
    value = (title or "").strip()
    stripped = re.sub(
        r"^(?:(?:IEEE|ACM|USENIX|SIAM|AAAI|CVF)(?:\s*/\s*|\s+))+",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip()
    aliases = []
    for candidate in {value, stripped}:
        without_kind = re.sub(
            r"\s+(?:conference|symposium|workshop|meeting)\s*$",
            "",
            candidate,
            flags=re.IGNORECASE,
        ).strip()
        if len(norm(without_kind).split()) >= 4 and norm(without_kind) != norm(value):
            aliases.append(without_kind)
    return aliases


def record_score(item: dict) -> int:
    return sum([
        10 if item.get("ccf") else 0,
        6 if item.get("cas") else 0,
        5 if item.get("jcr") else 0,
        2 if item.get("wos") else 0,
    ])


def main() -> None:
    records: dict[str, dict] = {}
    issn_to_key: dict[str, str] = {}

    def obtain(title: str, issns: list[str] | None = None) -> dict:
        clean_title = (title or "").strip()
        identifiers = [re.sub(r"[^0-9Xx]", "", value).upper() for value in (issns or []) if value]
        identifiers = [value for value in identifiers if len(value) >= 8]
        key = next((issn_to_key[value] for value in identifiers if value in issn_to_key), None)
        key = key or norm(clean_title)
        if not key:
            raise ValueError("Empty journal key")
        item = records.setdefault(key, {"title": clean_title, "aliases": [], "issns": []})
        if clean_title and clean_title not in item["aliases"]:
            item["aliases"].append(clean_title)
        for identifier in identifiers:
            if identifier not in item["issns"]:
                item["issns"].append(identifier)
            issn_to_key[identifier] = key
        return item

    # JCR 2025: title, ISSN, eISSN, WoS index, IF, then category/quartile/rank groups.
    jcr_rows = read_rows(PRIVATE / "jcr-2025.csv")
    for row in jcr_rows[1:]:
        if len(row) < 7 or not row[0].strip():
            continue
        item = obtain(row[0], [row[1], row[2]])
        quartiles = []
        categories = []
        for start in range(5, len(row), 3):
            if start + 1 < len(row) and re.fullmatch(r"Q[1-4]", row[start + 1].strip(), re.IGNORECASE):
                quartiles.append(row[start + 1].strip().upper())
                categories.append(row[start].strip())
        best_quartile = min(quartiles, key=lambda value: int(re.search(r"\d", value).group())) if quartiles else ""
        best_index = quartiles.index(best_quartile) if best_quartile else 0
        item["wos"] = row[3].strip()
        item["jcr"] = {
            "year": "2025",
            "impactFactor": row[4].strip(),
            "quartile": best_quartile,
            "category": categories[best_index] if categories else "",
        }

    # CAS 2025: fixed ShowJCR export positions.
    cas_rows = read_rows(PRIVATE / "cas-2025.csv")
    for row in cas_rows[1:]:
        if len(row) < 13 or not row[0].strip():
            continue
        split_issns = re.split(r"[/;,\s]+", row[2]) if len(row) > 2 else []
        item = obtain(row[0], split_issns)
        if not item.get("wos") and len(row) > 6:
            item["wos"] = row[6].strip()
        item["cas"] = {
            "year": "2025",
            "category": row[8].strip() if len(row) > 8 else "",
            "largeZone": zone(row[9] if len(row) > 9 else ""),
            "top": truthy_cn(row[10] if len(row) > 10 else ""),
        }

    # CCF 2026: abbreviation, full name, year, publisher, DBLP URL, field, type, rank.
    ccf_rows = read_rows(PRIVATE / "ccf-2026.csv")
    for row in ccf_rows[1:]:
        if len(row) < 8 or not norm(row[1]):
            continue
        item = obtain(row[1])
        abbreviation = row[0].strip()
        if abbreviation and abbreviation not in item["aliases"]:
            item["aliases"].append(abbreviation)
        for alias in ccf_venue_aliases(row[1], row[6]):
            if alias not in item["aliases"]:
                item["aliases"].append(alias)
        if row[3].strip():
            item["publisher"] = row[3].strip()
        item["ccf"] = {
            "year": row[2].strip() or "2026",
            "rank": ccf_rank(row[7]),
            "type": row[6].strip(),
            "field": row[5].strip(),
            "url": row[4].strip(),
        }

    output_records = []
    for item in records.values():
        item["aliases"] = sorted(set(filter(None, item["aliases"])), key=lambda value: (-len(norm(value).split()), value))
        item["score"] = record_score(item)
        output_records.append(item)

    output_records.sort(key=lambda item: norm(item["title"]))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output_records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for pattern in ("journals-*.private.js", "journals-*.private.json"):
        for stale in DATA_DIR.glob(pattern):
            stale.unlink()
    chunks = []
    for index, start in enumerate(range(0, len(output_records), CHUNK_SIZE)):
        filename = f"journals-{index:02d}.private.json"
        payload = json.dumps(output_records[start : start + CHUNK_SIZE], ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / filename).write_text(
            payload,
            encoding="utf-8",
        )
        chunks.append(filename)
    BUILD_INFO.write_text(
        json.dumps(
            {
                "records": len(output_records),
                "cas": "2025",
                "jcr": "2025",
                "ccf": "2026",
                "generatedAt": "2026-07-13",
                "upstream": {
                    "repository": "hitfyd/ShowJCR",
                    "baselineSha": "c8da202c1d39373abdb5b5f936de712bb182ce0b",
                    "baselineDate": "2026-06-17T15:02:15Z",
                },
                "chunks": chunks,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Built {len(output_records):,} records in {len(chunks)} chunks -> {DATA_DIR}")


if __name__ == "__main__":
    main()
