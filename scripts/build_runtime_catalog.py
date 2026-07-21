#!/usr/bin/env python3
"""Build compact and first-character-sharded browser runtime catalogs."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "build" / "journals.private.json"
DATA_DIR = ROOT / "extension" / "data"
STOP = {"the", "of", "and", "for", "in", "on", "a", "an"}


def norm(value: str) -> str:
    value = (value or "").casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).replace("_", " ").split())


def abbreviation_key(value: str) -> str:
    return " ".join(token[:4] for token in norm(value).split() if token and token not in STOP)


def shard_key(value: str) -> str:
    first = (value or "_")[0]
    if "a" <= first <= "z":
        return first
    if first.isdigit():
        return "0"
    return "other"


def compact_record(item: dict) -> list:
    ccf = item.get("ccf") or {}
    cas = item.get("cas") or {}
    jcr = item.get("jcr") or {}
    return [
        item.get("title", ""),
        ccf.get("rank", ""), ccf.get("type", ""), ccf.get("year", ""),
        cas.get("largeZone", ""), 1 if cas.get("top") else 0,
        cas.get("category", ""), cas.get("year", ""),
        jcr.get("quartile", ""), jcr.get("impactFactor", ""),
        jcr.get("category", ""), jcr.get("year", ""),
        item.get("wos", ""),
        item.get("issns", []), ccf.get("field", ""), ccf.get("url", ""),
        item.get("publisher", ""),
        (item.get("cssci") or {}).get("tier", ""),
        (item.get("cssci") or {}).get("year", ""),
        (item.get("cssci") or {}).get("category", ""),
        1 if item.get("pkuCore") else 0,
        (item.get("pkuCore") or {}).get("year", ""),
        (item.get("pkuCore") or {}).get("category", ""),
        (item.get("pkuCore") or {}).get("cn", ""),
        (item.get("ei") or {}).get("date", ""),
        (item.get("ei") or {}).get("sourceType", ""),
        (item.get("ei") or {}).get("subjects", []),
        (item.get("ei") or {}).get("status", ""),
        (item.get("xinrui") or {}).get("zone", ""),
        1 if (item.get("xinrui") or {}).get("top") else 0,
        (item.get("xinrui") or {}).get("category", ""),
        (item.get("xinrui") or {}).get("year", ""),
        (item.get("warning") or {}).get("year", ""),
        (item.get("warning") or {}).get("reason", ""),
        (item.get("xinrui") or {}).get("type", ""),
        (item.get("xinrui") or {}).get("url", ""),
    ]


def main() -> None:
    source_records = json.loads(SOURCE.read_text(encoding="utf-8"))
    records = [compact_record(item) for item in source_records]
    alias_owners: dict[str, set[int]] = defaultdict(set)
    abbreviation_owners: dict[str, set[int]] = defaultdict(set)

    for index, item in enumerate(source_records):
        for alias in [item.get("title", ""), *item.get("aliases", [])]:
            key = norm(alias)
            if not key:
                continue
            alias_owners[key].add(index)
            if " " in key:
                abbreviated = abbreviation_key(key)
                if abbreviated:
                    abbreviation_owners[abbreviated].add(index)

    aliases = {key: next(iter(owners)) for key, owners in alias_owners.items() if len(owners) == 1}
    abbreviations = {key: next(iter(owners)) for key, owners in abbreviation_owners.items() if len(owners) == 1}
    ambiguous_alias_keys = {key for key, owners in alias_owners.items() if len(owners) > 1}
    ambiguous_abbreviation_keys = {key for key, owners in abbreviation_owners.items() if len(owners) > 1}
    ambiguous_aliases = len(ambiguous_alias_keys)
    ambiguous_abbreviations = len(ambiguous_abbreviation_keys)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    full_payloads = {
        "catalog-records.private.json": records,
        "catalog-aliases.private.json": aliases,
        "catalog-abbreviations.private.json": abbreviations,
    }
    for filename, payload in full_payloads.items():
        (DATA_DIR / filename).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    for stale in DATA_DIR.glob("catalog-shard-*.private.json"):
        stale.unlink()

    shard_aliases: dict[str, dict[str, int]] = defaultdict(dict)
    shard_abbreviations: dict[str, dict[str, int]] = defaultdict(dict)
    shard_ambiguous_aliases: dict[str, set[str]] = defaultdict(set)
    shard_ambiguous_abbreviations: dict[str, set[str]] = defaultdict(set)
    shard_members: dict[str, set[int]] = defaultdict(set)

    for key, index in aliases.items():
        shard = shard_key(key)
        shard_aliases[shard][key] = index
        shard_members[shard].add(index)

    for key, index in abbreviations.items():
        shard = shard_key(key)
        shard_abbreviations[shard][key] = index
        shard_members[shard].add(index)

    shard_files = []
    total_bytes = 0

    for key in ambiguous_alias_keys:
        shard_ambiguous_aliases[shard_key(key)].add(key)

    for key in ambiguous_abbreviation_keys:
        shard_ambiguous_abbreviations[shard_key(key)].add(key)

    all_shards = set(shard_members) | set(shard_ambiguous_aliases) | set(shard_ambiguous_abbreviations)

    for shard in sorted(all_shards):
        members = sorted(shard_members[shard])
        local_index = {global_index: local for local, global_index in enumerate(members)}
        payload = {
            "r": [records[index] for index in members],
            "a": {key: local_index[index] for key, index in shard_aliases[shard].items()},
            "b": {key: local_index[index] for key, index in shard_abbreviations[shard].items()},
            "x": sorted(shard_ambiguous_aliases[shard]),
            "y": sorted(shard_ambiguous_abbreviations[shard]),
        }
        filename = f"catalog-shard-{shard}.private.json"
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / filename).write_text(encoded, encoding="utf-8")
        shard_files.append(filename)
        total_bytes += len(encoded.encode("utf-8"))
    print(
        f"Built {len(records):,} records, {len(aliases):,} aliases, "
        f"{len(abbreviations):,} abbreviations in {len(shard_files)} shards; "
        f"refused {ambiguous_aliases:,} alias and {ambiguous_abbreviations:,} abbreviation conflicts "
        f"({total_bytes / 1024:.1f} KiB total)"
    )


if __name__ == "__main__":
    main()
