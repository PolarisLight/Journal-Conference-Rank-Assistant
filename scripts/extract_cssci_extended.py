#!/usr/bin/env python3
"""OCR the CSSCI extended-list PDF pages into a reviewable JSON file."""

from __future__ import annotations

import argparse
import difflib
import json
import re
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR


CATEGORIES = [
    "\u9a6c\u514b\u601d\u4e3b\u4e49\u7406\u8bba", "\u54f2\u5b66", "\u5b97\u6559\u5b66", "\u8bed\u8a00\u5b66", "\u5916\u56fd\u6587\u5b66", "\u4e2d\u56fd\u6587\u5b66",
    "\u827a\u672f\u5b66", "\u5386\u53f2\u5b66", "\u8003\u53e4\u5b66", "\u7ecf\u6d4e\u5b66", "\u7ba1\u7406\u5b66", "\u653f\u6cbb\u5b66", "\u6cd5\u5b66",
    "\u793e\u4f1a\u5b66", "\u6c11\u65cf\u5b66\u4e0e\u6587\u5316\u5b66", "\u65b0\u95fb\u5b66\u4e0e\u4f20\u64ad\u5b66", "\u6559\u80b2\u5b66", "\u4f53\u80b2\u5b66",
    "\u7edf\u8ba1\u5b66", "\u5fc3\u7406\u5b66", "\u9ad8\u6821\u5b66\u62a5", "\u7efc\u5408\u6027\u793e\u4f1a\u79d1\u5b66", "\u4eba\u6587\u7ecf\u6d4e\u5730\u7406",
    "\u81ea\u7136\u8d44\u6e90\u4e0e\u73af\u5883\u79d1\u5b66", "\u4fe1\u606f\u8d44\u6e90\u7ba1\u7406", "\u4e2d\u534e\u4f20\u7edf\u6587\u5316", "\u6c11\u4fd7\u5b66\u4e0e\u6587\u5316\u5b66",
]

PAGE_LAYOUT = {
    "page-1.png": (1, 29, 989.5, 1933.6),
    "page-2.png": (30, 68, 413.1, 1748.8),
    "page-3.png": (69, 108, 397.5, 1739.1),
    "page-4.png": (109, 148, 400.1, 1734.6),
    "page-5.png": (149, 188, 390.4, 1730.0),
    "page-6.png": (189, 228, 394.9, 1732.0),
    "page-7.png": (229, 261, 396.2, 1487.5),
}
TITLE_CORRECTIONS = {
    59: "\u56fd\u9645\u4e2d\u6587\u6559\u80b2\u5b66\u62a5",
    68: "\u676d\u5dde\u5e08\u8303\u5927\u5b66\u5b66\u62a5\uff08\u793e\u4f1a\u79d1\u5b66\u7248\uff09",
    73: "\u6cb3\u5357\u793e\u4f1a\u79d1\u5b66",
    155: "\u4e0a\u6d77\u6587\u5316",
    156: "\u4e0a\u6d77\u653f\u6cd5\u5b66\u9662\u5b66\u62a5\uff08\u6cd5\u6cbb\u8bba\u4e1b\uff09",
    159: "\u793e\u4f1a\u79d1\u5b66\u5bb6",
    176: "\u4f53\u80b2\u6587\u5316\u5bfc\u520a",
    259: "\u4e2d\u5c0f\u5b66\u7ba1\u7406",
}



def center(box):
    return sum(point[0] for point in box) / 4, sum(point[1] for point in box) / 4


def compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "").replace("?", "?").replace("?", "?")


def category_from(value: str) -> str:
    value = compact(value)
    for category in sorted(CATEGORIES, key=len, reverse=True):
        if compact(category) in value:
            return category
    return ""


def clean_title(value: str) -> str:
    value = re.sub(r"\s+", "", value or "")
    value = value.strip("?.?,:?;?'\"`~|?")
    return value


def page_rows(engine, image_path: Path):
    result, _ = engine(str(image_path))
    cells = []
    for box, text, score in result or []:
        x, y = center(box)
        cells.append({"x": x, "y": y, "text": text, "score": score})

    categories = []
    for cell in cells:
        if cell["x"] < 1120:
            continue
        category = category_from(cell["text"])
        if category:
            categories.append((cell["y"], category, cell["score"]))

    rows = []
    for y, category, category_score in sorted(categories):
        title_cells = [
            cell for cell in cells
            if 475 <= cell["x"] <= 1115
            and abs(cell["y"] - y) <= 14
            and not category_from(cell["text"])
            and "????" not in cell["text"]
            and not re.fullmatch(r"[\d.]+", compact(cell["text"]))
        ]
        title_cells.sort(key=lambda cell: cell["x"])
        title = clean_title("".join(cell["text"] for cell in title_cells))
        if not title or title in {"????", "????"}:
            continue
        number_cells = [
            cell for cell in cells
            if 400 <= cell["x"] <= 475 and abs(cell["y"] - y) <= 14
        ]
        number_text = compact(number_cells[0]["text"]) if number_cells else ""
        number_match = re.search(r"\d{1,3}", number_text)
        rows.append({
            "numberOcr": int(number_match.group()) if number_match else None,
            "title": title,
            "category": category,
            "confidence": round(min([category_score] + [c["score"] for c in title_cells]), 4),
            "page": image_path.name,
            "y": round(y, 1),
        })
    return rows


def grid_page_rows(engine, image_path: Path):
    start, end, first_y, last_y = PAGE_LAYOUT[image_path.name]
    result, _ = engine(str(image_path))
    cells = []
    for box, text, score in result or []:
        x, y = center(box)
        cells.append({"x": x, "y": y, "text": text, "score": score})

    rows = []
    intervals = max(1, end - start)
    for number in range(start, end + 1):
        y = first_y + (number - start) * (last_y - first_y) / intervals
        if image_path.name == "page-2.png":
            if number <= 59:
                y = 413.1 + (number - 30) * (1407.1 - 413.1) / 29
            else:
                y = 1474.5 + (number - 60) * (1748.8 - 1474.5) / 8
        title_cells = [
            cell for cell in cells
            if 475 <= cell["x"] <= 1115
            and abs(cell["y"] - y) <= 15
            and cell["text"] not in {"\u671f\u520a\u540d\u79f0", "\u5b66\u79d1\u540d\u79f0"}
            and not re.fullmatch(r"[\d.]+", compact(cell["text"]))
        ]
        title_cells.sort(key=lambda cell: cell["x"])
        title = clean_title("".join(cell["text"] for cell in title_cells))
        for noise in ["\u5355\u4f4d\u7f16\u53f7", "\u5355\u4f4d\u7f16", "\u5355\u4f4d", "\u4f4d\u7f16", "\u4f4d\u53f7", "\u7f16\u53f7"]:
            title = title.replace(noise, "")
        title = re.sub(r"(?:038|880|039|136|36)$", "", title)

        category_candidates = []
        for cell in cells:
            if cell["x"] < 1120 or abs(cell["y"] - y) > 15 or "\u5355\u4f4d" in cell["text"]:
                continue
            exact = category_from(cell["text"])
            if exact:
                category_candidates.append((1.0, exact, cell))
                continue
            value = compact(cell["text"])
            if not value:
                continue
            similarity, category = max(
                (difflib.SequenceMatcher(None, value, compact(item)).ratio(), item)
                for item in CATEGORIES
            )
            if similarity >= 0.52:
                category_candidates.append((similarity, category, cell))
        category_candidates.sort(key=lambda item: item[0], reverse=True)
        category = category_candidates[0][1] if category_candidates else ""
        category_confidence = category_candidates[0][2]["score"] if category_candidates else 0.0

        number_cells = [cell for cell in cells if 400 <= cell["x"] <= 475 and abs(cell["y"] - y) <= 15]
        number_text = compact(number_cells[0]["text"]) if number_cells else ""
        number_match = re.search(r"\d{1,3}", number_text)
        confidence_values = [cell["score"] for cell in title_cells]
        if category_confidence:
            confidence_values.append(category_confidence)
        rows.append({
            "numberOcr": int(number_match.group()) if number_match else None,
            "title": title,
            "category": category,
            "confidence": round(min(confidence_values or [0.0]), 4),
            "page": image_path.name,
            "y": round(y, 1),
            "number": number,
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("images", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    engine = RapidOCR()
    rows = []
    for image_path in sorted(args.images.glob("page-*.png")):
        rows.extend(grid_page_rows(engine, image_path))
    for number, row in enumerate(rows, 1):
        row["number"] = number
        if number in TITLE_CORRECTIONS:
            row["title"] = TITLE_CORRECTIONS[number]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    low = [row for row in rows if row["confidence"] < 0.90]
    mismatches = [row for row in rows if row["numberOcr"] and row["numberOcr"] != row["number"]]
    print(json.dumps({"rows": len(rows), "lowConfidence": len(low), "numberMismatches": len(mismatches)}, ensure_ascii=False))
    if low:
        print(json.dumps(low, ensure_ascii=False))


if __name__ == "__main__":
    main()
