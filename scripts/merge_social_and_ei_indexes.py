#!/usr/bin/env python3
"""Merge CSSCI, PKU Core, and Ei Compendex sources into the private catalog."""

from __future__ import annotations

import csv
import html
import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_FILE = ROOT / "build" / "journals.private.json"
INFO_FILE = ROOT / "extension" / "data" / "build-info.private.json"
SOURCE_DIR = ROOT / "sources" / "private" / "social-sciences"
CSSCI_VERSION = "2025-2026"
PKU_VERSION = "2023"
EI_DATE = "2026-07-09"

CSSCI_CATEGORIES = {
    "\u9a6c\u514b\u601d\u4e3b\u4e49\u7406\u8bba", "\u54f2\u5b66", "\u5b97\u6559\u5b66", "\u8bed\u8a00\u5b66", "\u5916\u56fd\u6587\u5b66", "\u4e2d\u56fd\u6587\u5b66",
    "\u827a\u672f\u5b66", "\u5386\u53f2\u5b66", "\u8003\u53e4\u5b66", "\u7ecf\u6d4e\u5b66", "\u7ba1\u7406\u5b66", "\u653f\u6cbb\u5b66", "\u6cd5\u5b66",
    "\u793e\u4f1a\u5b66", "\u6c11\u65cf\u5b66\u4e0e\u6587\u5316\u5b66", "\u65b0\u95fb\u5b66\u4e0e\u4f20\u64ad\u5b66", "\u6559\u80b2\u5b66", "\u4f53\u80b2\u5b66",
    "\u7edf\u8ba1\u5b66", "\u5fc3\u7406\u5b66", "\u9ad8\u6821\u5b66\u62a5", "\u7efc\u5408\u6027\u793e\u4f1a\u79d1\u5b66", "\u4eba\u6587\u7ecf\u6d4e\u5730\u7406",
    "\u81ea\u7136\u8d44\u6e90\u4e0e\u73af\u5883\u79d1\u5b66", "\u4fe1\u606f\u8d44\u6e90\u7ba1\u7406", "\u4e2d\u534e\u4f20\u7edf\u6587\u5316", "\u6c11\u4fd7\u5b66\u4e0e\u6587\u5316\u5b66",
}


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold().replace("&", " and ")
    return " ".join("".join(char if unicodedata.category(char)[0] in {"L", "N"} else " " for char in value).split())


def clean_identifier(value: str) -> str:
    value = re.sub(r"[^0-9Xx]", "", str(value or "")).upper()
    return "" if value in {"", "-"} else value


class CatalogMerger:
    def __init__(self, records: list[dict]):
        self.records = records
        self.alias_index: dict[str, int] = {}
        self.issn_index: dict[str, int] = {}
        for index, item in enumerate(records):
            for alias in [item.get("title", ""), *item.get("aliases", [])]:
                if norm(alias):
                    self.alias_index.setdefault(norm(alias), index)
            for issn in item.get("issns", []):
                if clean_identifier(issn):
                    self.issn_index.setdefault(clean_identifier(issn), index)

    def get(self, title: str, aliases=(), issns=(), publisher="", score=4) -> dict:
        keys = [clean_identifier(value) for value in issns if clean_identifier(value)]
        index = next((self.issn_index[key] for key in keys if key in self.issn_index), None)
        names = [title, *aliases]
        if index is None:
            index = next((self.alias_index[norm(name)] for name in names if norm(name) in self.alias_index), None)
        if index is None:
            index = len(self.records)
            item = {"title": title, "aliases": [], "issns": [], "score": score}
            self.records.append(item)
        else:
            item = self.records[index]
        current_aliases = item.setdefault("aliases", [])
        known_aliases = {norm(value) for value in [item.get("title", ""), *current_aliases] if norm(value)}
        for name in names:
            if name and norm(name) not in known_aliases:
                current_aliases.append(name)
                known_aliases.add(norm(name))
        current_issns = item.setdefault("issns", [])
        for key in keys:
            if key not in current_issns:
                current_issns.append(key)
            self.issn_index.setdefault(key, index)
        for name in [item.get("title", ""), *current_aliases]:
            if norm(name):
                self.alias_index.setdefault(norm(name), index)
        if publisher and not item.get("publisher"):
            item["publisher"] = publisher
        item["score"] = max(int(item.get("score") or 0), score)
        return item


def parse_cssci_source(path: Path) -> list[dict]:
    lines = [line.replace("\f", "").strip() for line in path.read_text(encoding="utf-8").splitlines()]
    rows = []
    categories = sorted(CSSCI_CATEGORIES, key=len, reverse=True)
    for index, line in enumerate(lines):
        match = re.match(r"^(\d+)\s+(.+)$", line)
        if not match:
            continue
        number = int(match.group(1))
        remainder = match.group(2).strip()
        category = next((value for value in categories if remainder.endswith(value)), "")
        if category:
            title = remainder[: -len(category)].strip()
        elif 613 <= number <= 619:
            title = remainder
            category = "\u81ea\u7136\u8d44\u6e90\u4e0e\u73af\u5883\u79d1\u5b66"
        else:
            continue
        if title:
            rows.append({"number": number, "title": title, "category": category})
    unique = {row["number"]: row for row in rows}
    if sorted(unique) != list(range(1, 675)):
        missing = sorted(set(range(1, 675)) - set(unique))
        raise ValueError(f"CSSCI source list is incomplete: {missing}")
    return [unique[number] for number in range(1, 675)]


def table_rows(source: str) -> list[list[str]]:
    tables = re.findall(r"<table\b.*?</table>", source, flags=re.I | re.S)
    parsed = []
    for table in tables:
        rows = []
        for raw_row in re.findall(r"<tr\b.*?</tr>", table, flags=re.I | re.S):
            cells = []
            for raw_cell in re.findall(r"<t[dh]\b.*?</t[dh]>", raw_row, flags=re.I | re.S):
                text = re.sub(r"<[^>]+>", " ", raw_cell)
                cells.append(" ".join(html.unescape(text).split()))
            if cells:
                rows.append(cells)
        parsed.append(rows)
    return max(parsed, key=len)


def parse_pku_core(path: Path) -> list[dict]:
    rows = table_rows(path.read_text(encoding="utf-8"))
    records = []
    current_category = ""
    for cells in rows:
        if not cells or not re.fullmatch(r"\d+", cells[0]):
            continue
        if len(cells) >= 4:
            _, current_category, title, cn = cells[:4]
        elif len(cells) >= 3 and current_category:
            _, title, cn = cells[:3]
        else:
            continue
        records.append({"number": int(cells[0]), "title": title, "category": current_category, "cn": cn})
    if len(records) != 1987 or [row["number"] for row in records] != list(range(1, 1988)):
        raise ValueError(f"PKU Core list validation failed: {len(records)} rows")
    return records


def subjects(row: dict) -> list[str]:
    return [value for key, value in row.items() if key.startswith("Subject ") and value and value != "-"]


def merge_ei(merger: CatalogMerger) -> dict:
    serial_count = 0
    serial_path = SOURCE_DIR / "compendex-serials-2026-07.csv"
    with serial_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            title = (row.get("Source title") or "").strip()
            if not title:
                continue
            issns = [row.get("ISSN", ""), row.get("EISSN", "")]
            item = merger.get(title, issns=issns, publisher=row.get("Publisher", ""), score=5)
            item["ei"] = {"date": EI_DATE, "sourceType": row.get("Source type", ""), "subjects": subjects(row), "status": "active"}
            serial_count += 1

    nonserial_count = 0
    nonserial_path = SOURCE_DIR / "compendex-nonserials-2026-05.csv"
    with nonserial_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            title = (row.get("Source title") or "").strip()
            if not title or not re.search(r"\b(?:2023|2024|2025|2026)\b", title):
                continue
            item = merger.get(title, score=3)
            item["ei"] = {"date": "2026-05-01", "sourceType": row.get("Source type", ""), "subjects": [], "status": "listed"}
            nonserial_count += 1

    chinese_count = 0
    chinese_path = SOURCE_DIR / "compendex-chinese-serials-2026-05.csv"
    with chinese_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            chinese = (row.get("CHINESE TITLE (\u4e2d\u6587\u520a\u540d)") or "").strip()
            english = (row.get("ENGLISH/TRANSLATED TITLE (\u82f1\u6587\u520a\u540d)") or "").strip()
            transliterated = (row.get("TRANSLITERATED TITLE (\u520a\u540d\u7ffb\u8bd1)") or "").strip()
            title = english or chinese or transliterated
            if not title:
                continue
            item = merger.get(
                title,
                aliases=[value for value in [chinese, transliterated, english] if value],
                issns=[row.get("PRINT ISSN", ""), row.get("ONLINE ISSN", "")],
                score=6,
            )
            item.setdefault("ei", {"date": "2026-05-01", "sourceType": "Journal", "subjects": [], "status": "active"})
            item["ei"]["indexingStatus"] = row.get("Ei 2026 INDEXING STATUS (2026\u5e74Ei\u6536\u5f55\u72b6\u51b5)", "")
            chinese_count += 1
    return {"serials": serial_count, "nonSerials": nonserial_count, "chineseSerials": chinese_count}


def has_han(value: str) -> bool:
    return any("CJK UNIFIED IDEOGRAPH" in unicodedata.name(char, "") for char in str(value or ""))


def merge_values(current, incoming):
    if current in (None, "", [], {}):
        return incoming
    if incoming in (None, "", [], {}):
        return current
    if isinstance(current, list) and isinstance(incoming, list):
        return list(dict.fromkeys([*current, *incoming]))
    if isinstance(current, dict) and isinstance(incoming, dict):
        merged = dict(current)
        for key, value in incoming.items():
            merged[key] = merge_values(merged.get(key), value)
        return merged
    return current


def reconcile_chinese_alias_duplicates(records: list[dict]) -> tuple[list[dict], dict]:
    parents = list(range(len(records)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    owners: dict[str, list[int]] = {}
    for index, item in enumerate(records):
        for alias in [item.get("title", ""), *item.get("aliases", [])]:
            key = norm(alias).replace(" ", "")
            if key and has_han(alias):
                owners.setdefault(key, []).append(index)

    skipped_conflicts = 0
    for indexes in owners.values():
        unique = list(dict.fromkeys(indexes))
        if len(unique) < 2:
            continue
        issn_sets = [set(records[index].get("issns", [])) for index in unique]
        nonempty = [values for values in issn_sets if values]
        if len(nonempty) > 1 and not set.intersection(*nonempty):
            skipped_conflicts += 1
            continue
        for index in unique[1:]:
            union(unique[0], index)

    groups: dict[int, list[int]] = {}
    for index in range(len(records)):
        groups.setdefault(find(index), []).append(index)

    replacements: dict[int, dict] = {}
    removed = set()
    merged_groups = 0
    for indexes in groups.values():
        if len(indexes) < 2:
            continue
        merged_groups += 1
        winner = max(
            indexes,
            key=lambda index: (
                int(records[index].get("score") or 0),
                len(records[index].get("issns", [])),
                sum(bool(records[index].get(key)) for key in ("jcr", "cas", "ccf", "ei", "cssci", "pkuCore")),
                -index,
            ),
        )
        merged = dict(records[winner])
        aliases = [merged.get("title", ""), *merged.get("aliases", [])]
        for index in indexes:
            item = records[index]
            aliases.extend([item.get("title", ""), *item.get("aliases", [])])
            for key, value in item.items():
                if key in {"title", "aliases", "score"}:
                    continue
                merged[key] = merge_values(merged.get(key), value)
            merged["score"] = max(int(merged.get("score") or 0), int(item.get("score") or 0))
        merged["aliases"] = sorted(
            {value for value in aliases if value and norm(value) != norm(merged.get("title", ""))},
            key=lambda value: (-len(norm(value).split()), value),
        )
        replacements[winner] = merged
        removed.update(index for index in indexes if index != winner)

    output = [replacements.get(index, item) for index, item in enumerate(records) if index not in removed]
    return output, {
        "mergedGroups": merged_groups,
        "removedRecords": len(removed),
        "skippedIssnConflicts": skipped_conflicts,
    }


def main() -> None:
    records = json.loads(BUILD_FILE.read_text(encoding="utf-8"))
    merger = CatalogMerger(records)

    cssci_source = parse_cssci_source(SOURCE_DIR / "cssci-2025-2026-source.txt")
    for row in cssci_source:
        item = merger.get(row["title"], score=7)
        item["cssci"] = {"tier": "source", "year": CSSCI_VERSION, "category": row["category"]}

    cssci_extended = json.loads((SOURCE_DIR / "cssci-2025-2026-extended.json").read_text(encoding="utf-8"))
    if len(cssci_extended) != 261:
        raise ValueError(f"CSSCI extended list validation failed: {len(cssci_extended)} rows")
    for row in cssci_extended:
        item = merger.get(row["title"], score=6)
        item["cssci"] = {"tier": "extended", "year": CSSCI_VERSION, "category": row["category"]}

    pku_core = parse_pku_core(SOURCE_DIR / "pku-core-2023.html")
    for row in pku_core:
        item = merger.get(row["title"], score=6)
        item["pkuCore"] = {"year": PKU_VERSION, "category": row["category"], "cn": row["cn"]}

    ei_counts = merge_ei(merger)
    records, reconciliation = reconcile_chinese_alias_duplicates(records)
    BUILD_FILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    info = json.loads(INFO_FILE.read_text(encoding="utf-8"))
    info.update({"records": len(records), "cssci": CSSCI_VERSION, "pkuCore": PKU_VERSION, "ei": EI_DATE})
    INFO_FILE.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"records": len(records), "cssciSource": len(cssci_source), "cssciExtended": len(cssci_extended), "pkuCore": len(pku_core), "ei": ei_counts, "reconciliation": reconciliation}, ensure_ascii=False))


if __name__ == "__main__":
    main()
