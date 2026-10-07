"""Fetch public store metrics; write a snapshot only when both stores validate."""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen


CHROME_ID = "ibanchmlkanbhbddpejommgfhpfofifm"
FIREFOX_SLUG = "journal-conf-rank-assistant"
CHROME_URL = f"https://chromewebstore.google.com/detail/{CHROME_ID}?hl=en"
FIREFOX_URL = f"https://addons.mozilla.org/en-US/firefox/addon/{FIREFOX_SLUG}/"
FIREFOX_API = f"https://addons.mozilla.org/api/v5/addons/addon/{FIREFOX_SLUG}/"
COUNT = re.compile(r"([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)([KMB]?)(\+?) users", re.I)


class StoreText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.counts = set()

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            label = " ".join(data.split())
            if COUNT.fullmatch(label):
                self.counts.add(label)


def parse_chrome(html):
    if CHROME_ID not in html:
        raise ValueError("Chrome response does not identify the expected extension")
    parser = StoreText()
    parser.feed(html)
    if len(parser.counts) != 1:
        raise ValueError(f"Expected one public Chrome user count, found {len(parser.counts)}")
    label = parser.counts.pop()
    number, suffix, plus = COUNT.fullmatch(label).groups()
    multiplier = {"": 1, "K": 1000, "M": 1000000, "B": 1000000000}[suffix.upper()]
    count = Decimal(number.replace(",", "")) * multiplier
    if count != count.to_integral_value() or count < 0:
        raise ValueError("Invalid Chrome user count")
    return {
        "source_url": CHROME_URL,
        "users": int(count),
        "users_display": label.removesuffix(" users"),
        "approximate": bool(suffix or plus),
    }


def parse_firefox(data):
    if data.get("slug") != FIREFOX_SLUG:
        raise ValueError("Firefox response does not identify the expected extension")
    result = {"source_url": FIREFOX_URL, "api_url": FIREFOX_API}
    for field in ("average_daily_users", "weekly_downloads"):
        value = data.get(field)
        if type(value) is not int or value < 0:
            raise ValueError(f"Firefox field {field} must be a non-negative integer")
        result[field] = value
    return result


def fetch(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "PaperRank-public-store-stats/1.0"})
            with urlopen(request, timeout=30) as response:
                body = response.read(3_000_001)
                if len(body) > 3_000_000:
                    raise ValueError("Unexpectedly large store response")
                return body.decode("utf-8")
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def collect():
    chrome = parse_chrome(fetch(CHROME_URL))
    firefox = parse_firefox(json.loads(fetch(FIREFOX_API)))
    return {
        "schema_version": 1,
        "collected_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "chrome": chrome,
        "firefox": firefox,
    }


def write_snapshot(path, snapshot):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "docs" / "store-stats.json")
    args = parser.parse_args()
    try:
        snapshot = collect()
        write_snapshot(args.output, snapshot)
    except Exception as error:
        print(f"Store statistics were not updated: {error}", file=sys.stderr)
        return 1
    print(json.dumps(snapshot, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
