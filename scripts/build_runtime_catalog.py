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
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


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
    ]


def main() -> None:
    source_records = json.loads(SOURCE.read_text(encoding="utf-8"))
    records = [compact_record(item) for item in source_records]
    aliases: dict[str, int] = {}
    abbreviations: dict[str, int] = {}

    for index, item in enumerate(source_records):
        for alias in item.get("aliases", []):
            key = norm(alias)
            if not key:
                continue
            current = aliases.get(key)
            if current is None or item["score"] > source_records[current]["score"]:
                aliases[key] = index
            if " " in key:
                abbreviated = abbreviation_key(key)
                current = abbreviations.get(abbreviated)
                if current is None or item["score"] > source_records[current]["score"]:
                    abbreviations[abbreviated] = index

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
    for shard in sorted(shard_members):
        members = sorted(shard_members[shard])
        local_index = {global_index: local for local, global_index in enumerate(members)}
        payload = {
            "r": [records[index] for index in members],
            "a": {key: local_index[index] for key, index in shard_aliases[shard].items()},
            "b": {key: local_index[index] for key, index in shard_abbreviations[shard].items()},
        }
        filename = f"catalog-shard-{shard}.private.json"
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        (DATA_DIR / filename).write_text(encoded, encoding="utf-8")
        shard_files.append(filename)
        total_bytes += len(encoded.encode("utf-8"))

    print(
        f"Built {len(records):,} records, {len(aliases):,} aliases, "
        f"{len(abbreviations):,} abbreviations in {len(shard_files)} shards "
        f"({total_bytes / 1024:.1f} KiB total)"
    )


if __name__ == "__main__":
    main()
