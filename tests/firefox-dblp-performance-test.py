#!/usr/bin/env python3
"""Compare DBLP loading behavior with and without the packaged Firefox add-on."""

import json
import os
import shutil
import sys
import time
from pathlib import Path


HOME = Path.home()
WORK = Path(
    os.environ.get(
        "PAPERRANK_WORK",
        HOME / "Documents" / "Codex" / "2026-07-12" / "ch" / "work",
    )
)
sys.path.insert(0, str(Path(os.environ.get("PAPERRANK_SELENIUM_DEPS", WORK / "seleniumdeps"))))

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service


XPI = Path(
    os.environ.get(
        "PAPERRANK_XPI",
        WORK.parent / "outputs" / "INSTALL-PaperRank-Firefox-v0.11.0.xpi",
    )
)
GECKODRIVER = Path(
    os.environ.get(
        "GECKODRIVER",
        HOME / ".cache" / "selenium" / "geckodriver" / "win64" / "0.37.0" / "geckodriver.exe",
    )
)
FIREFOX = os.environ.get("FIREFOX_BINARY") or shutil.which("firefox") or r"C:\Program Files\Mozilla Firefox\firefox.exe"


def snapshot(driver, elapsed):
    return driver.execute_script(
        """
        const nav = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        return {
          elapsed: arguments[0],
          readyState: document.readyState,
          entries: document.querySelectorAll('#completesearch-publs li.entry, #completesearch-publs article.entry').length,
          status: document.documentElement.dataset.paperRankStatus || '',
          detail: document.documentElement.dataset.paperRankDetail || '',
          fallback: Boolean(document.querySelector('.rank-assistant-fallback-notice')),
          serviceError: /service temporarily not available/i.test(document.body?.innerText || ''),
          apiRequests: resources.filter((entry) => entry.name.includes('/search/publ/api')).length,
          resourceCount: resources.length,
          domContentLoaded: nav?.domContentLoadedEventEnd || 0,
          loadEventEnd: nav?.loadEventEnd || 0,
          duration: nav?.duration || 0,
          venues: arguments[0] >= 9 ? Array.from(document.querySelectorAll('#completesearch-publs li.entry, #completesearch-publs article.entry')).map((entry) => ({
            name: entry.querySelector('[itemprop="isPartOf"] a, a[href*="/db/"]')?.textContent?.trim() || '',
            href: entry.querySelector('[itemprop="isPartOf"] a, a[href*="/db/"]')?.getAttribute('href') || '',
            badges: Array.from(entry.querySelectorAll('.rank-assistant-badge')).map((badge) => badge.textContent?.trim() || '')
          })) : []
        };
        """,
        round(elapsed, 3),
    )


def run(with_addon):
    options = Options()
    options.add_argument("-headless")
    options.binary_location = FIREFOX
    driver = webdriver.Firefox(service=Service(str(GECKODRIVER)), options=options)
    try:
        if with_addon:
            driver.install_addon(str(XPI), temporary=True)
        driver.set_page_load_timeout(30)
        started = time.perf_counter()
        driver.get("https://dblp.org/search?q=long%20tail")
        checkpoints = []
        for target in (0, 2, 6, 10):
            remaining = target - (time.perf_counter() - started)
            if remaining > 0:
                time.sleep(remaining)
            checkpoints.append(snapshot(driver, time.perf_counter() - started))
        return checkpoints
    finally:
        driver.quit()


def main():
    os.environ["SE_CACHE_PATH"] = str(WORK / "selenium-cache")
    result = {"withoutAddon": run(False), "withAddon": run(True)}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
