#!/usr/bin/env python3
"""Merge XinRui 2026 rankings and the latest CAS warning list into the private catalog."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from merge_social_and_ei_indexes import CatalogMerger, reconcile_chinese_alias_duplicates


ROOT = Path(__file__).resolve().parents[1]
BUILD_FILE = ROOT / "build" / "journals.private.json"
INFO_FILE = ROOT / "extension" / "data" / "build-info.private.json"
SOURCE_DIR = ROOT / "sources" / "private" / "rankings"
XINRUI_YEAR = "2026"
WARNING_YEAR = "2025"


def read_rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def zone(value: str) -> str:
    match = re.search(r"([1-4])", value or "")
    return match.group(1) if match else ""


def merge_xinrui_journals(merger: CatalogMerger) -> int:
    rows = read_rows(SOURCE_DIR / "xinrui-2026.csv")
    if len(rows) - 1 != 22299:
        raise ValueError(f"XinRui 2026 journal validation failed: {len(rows) - 1} rows")
    count = 0
    for row in rows[1:]:
        if len(row) < 17 or not row[0].strip():
            continue
        title = row[0].strip()
        aliases = [value.strip() for value in row[3:5] if value.strip()]
        item = merger.get(
            title,
            aliases=aliases,
            issns=[row[6], row[7]],
            publisher=row[8].strip(),
            score=7,
        )
        item["xinrui"] = {
            "year": row[1].strip() or XINRUI_YEAR,
            "zone": zone(row[15]),
            "top": row[16].strip().casefold() == "top",
            "category": (row[14] or row[13]).strip(),
            "type": "Journal",
            "url": "",
        }
        count += 1
    return count


def merge_xinrui_conferences(merger: CatalogMerger) -> int:
    rows = read_rows(SOURCE_DIR / "xinrui-conferences-2026.csv")
    if len(rows) - 1 != 15:
        raise ValueError(f"XinRui 2026 conference validation failed: {len(rows) - 1} rows")
    count = 0
    for row in rows[1:]:
        if len(row) < 5 or not row[1].strip():
            continue
        item = merger.get(row[1].strip(), aliases=[row[0].strip()], score=8)
        item["xinrui"] = {
            "year": XINRUI_YEAR,
            "zone": zone(row[2]),
            "top": row[3].strip().casefold() == "top",
            "category": "",
            "type": "Conference",
            "url": row[4].strip(),
        }
        count += 1
    return count


def merge_warning_list(merger: CatalogMerger) -> int:
    rows = read_rows(SOURCE_DIR / "cas-warning-2025.csv")
    if len(rows) - 1 != 5:
        raise ValueError(f"CAS warning 2025 validation failed: {len(rows) - 1} rows")
    count = 0
    for row in rows[1:]:
        if len(row) < 2 or not row[0].strip():
            continue
        item = merger.get(row[0].strip(), score=12)
        item["warning"] = {
            "year": WARNING_YEAR,
            "reason": row[1].strip(),
        }
        count += 1
    return count


def main() -> None:
    records = json.loads(BUILD_FILE.read_text(encoding="utf-8"))
    merger = CatalogMerger(records)
    journal_count = merge_xinrui_journals(merger)
    conference_count = merge_xinrui_conferences(merger)
    warning_count = merge_warning_list(merger)
    records, reconciliation = reconcile_chinese_alias_duplicates(records)

    xinrui_records = [item for item in records if item.get("xinrui")]
    warning_records = [item for item in records if item.get("warning")]
    if len(xinrui_records) < journal_count:
        raise ValueError("XinRui merge lost journal records")
    if len(warning_records) != warning_count:
        raise ValueError(f"CAS warning merge validation failed: {len(warning_records)} merged records")
    if {item["warning"].get("year") for item in warning_records} != {WARNING_YEAR}:
        raise ValueError("Historical warning-list data must not be included")

    BUILD_FILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    info = json.loads(INFO_FILE.read_text(encoding="utf-8"))
    info.update({
        "records": len(records),
        "xinrui": XINRUI_YEAR,
        "warning": WARNING_YEAR,
        "xinruiRecords": len(xinrui_records),
        "warningRecords": len(warning_records),
    })
    INFO_FILE.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "records": len(records),
        "xinruiJournals": journal_count,
        "xinruiConferences": conference_count,
        "xinruiMergedRecords": len(xinrui_records),
        "warningRecords": warning_count,
        "reconciliation": reconciliation,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
