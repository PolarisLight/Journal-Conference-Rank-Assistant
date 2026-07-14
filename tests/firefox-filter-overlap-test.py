#!/usr/bin/env python3
"""Verify the filter panel stays above hostile page controls in real Firefox."""

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
DEPENDENCIES = Path(os.environ.get("PAPERRANK_SELENIUM_DEPS", WORK / "seleniumdeps"))
sys.path.insert(0, str(DEPENDENCIES))

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


def main() -> None:
    os.environ["SE_CACHE_PATH"] = str(WORK / "selenium-cache")
    options = Options()
    options.add_argument("-headless")
    options.binary_location = os.environ.get("FIREFOX_BINARY") or shutil.which(
        "firefox"
    ) or r"C:\Program Files\Mozilla Firefox\firefox.exe"
    driver = webdriver.Firefox(
        service=Service(executable_path=str(GECKODRIVER)), options=options
    )
    try:
        driver.install_addon(str(XPI), temporary=True)
        driver.set_window_size(1280, 960)
        driver.get("https://dblp.org/search?q=long%20tail")

        deadline = time.time() + 30
        while time.time() < deadline:
            ready = driver.execute_script(
                "return Boolean(document.querySelector('#rank-assistant-filter-host')?.shadowRoot?.querySelector('#launcher'))"
            )
            if ready:
                break
            time.sleep(0.25)
        else:
            raise AssertionError("filter launcher was not injected on DBLP")

        driver.execute_script(
            "document.querySelector('#rank-assistant-filter-host').shadowRoot.querySelector('#launcher').click()"
        )
        time.sleep(0.5)
        result = driver.execute_script(
            """
            const host = document.querySelector('#rank-assistant-filter-host');
            const panel = host.shadowRoot.querySelector('#panel');
            const rect = panel.getBoundingClientRect();
            const blocker = document.createElement('div');
            blocker.id = 'hostile-page-control';
            blocker.style.cssText = [
              'position:fixed',
              `left:${rect.left}px`,
              `top:${rect.top}px`,
              `width:${rect.width}px`,
              `height:${rect.height}px`,
              'z-index:2147483647',
              'pointer-events:auto',
              'background:#777'
            ].join(';');
            host.parentNode.insertBefore(blocker, host);
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const top = document.elementFromPoint(x, y);
            const shadowTop = host.shadowRoot.elementFromPoint(x, y);
            const hostStyle = getComputedStyle(host);
            const panelStyle = getComputedStyle(panel);
            return {
              blockerBeforeHost: blocker.nextSibling === host,
              hostIsolation: hostStyle.isolation,
              hostZ: hostStyle.zIndex,
              panelOpen: !panel.hidden,
              panelZ: panelStyle.zIndex,
              shadowTopClass: shadowTop?.className || '',
              topId: top?.id || '',
              topTag: top?.tagName || ''
            };
            """
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        assert result["blockerBeforeHost"] is True
        assert result["panelOpen"] is True
        assert result["hostZ"] == "2147483647"
        assert result["hostIsolation"] == "isolate"
        assert result["topId"] == "rank-assistant-filter-host"
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
