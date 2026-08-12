#!/usr/bin/env python3
"""Build the compact ISSN-to-runtime-shard lookup used on publisher pages."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "extension" / "data"
SOURCE_DATA = ROOT / "source-data"
SOURCE_OUTPUT = ROOT / "source" / "extension" / "data" / "issn-index.js"


def inputs() -> tuple[list[Path], Path]:
    local = sorted(DATA.glob("catalog-shard-*.private.json"))
    if local:
        return local, DATA / "issn-index.js"
    submitted = sorted(SOURCE_DATA.glob("catalog-shard-*.private.json"))
    if submitted:
        return submitted, SOURCE_OUTPUT
    raise SystemExit("No plaintext catalog shards found")


files, output = inputs()
index: dict[str, list[object]] = {}
for path in files:
    shard = path.name.removeprefix("catalog-shard-").removesuffix(".private.json")
    records = json.loads(path.read_text(encoding="utf-8"))["r"]
    for offset, record in enumerate(records):
        for value in record[13] if isinstance(record[13], list) else []:
            issn = re.sub(r"[^0-9X]", "", str(value).upper())
            if len(issn) == 8:
                index[issn] = [shard, offset]

payload = json.dumps(dict(sorted(index.items())), ensure_ascii=True, separators=(",", ":"))
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(
    "/* Generated packaged ISSN lookup: ISSN -> [catalog shard, record offset]. */\n"
    f"globalThis.RankAssistantIssnIndex = Object.freeze({payload});\n",
    encoding="utf-8",
)
print(json.dumps({"entries": len(index), "output": str(output)}))
