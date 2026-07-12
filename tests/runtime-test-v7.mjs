import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const { JSDOM } = await import("file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js");

const root = process.argv[2] || process.cwd();
const normalizer = fs.readFileSync(path.join(root, "extension/lib/normalizer.js"), "utf8");
const contentScript = fs.readFileSync(path.join(root, "extension/content/content-v7.js"), "utf8");

function apiPayload() {
  return { result: { hits: { hit: [
    { info: { authors: { author: [{ text: "A. Author" }] }, title: "Recovered", venue: "IEEE Access", year: "2026", url: "https://dblp.org/rec/one" } }
  ] } } };
}

async function run(url, html, waitMs = 900, settingOverrides = {}, systemDark = false) {
  let apiFetches = 0;
  let catalogFetches = 0;
  const errors = [];
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = {
    runtime: {
      getURL: (name) => "moz-extension://test/" + name,
      lastError: null,
      sendMessage: (message, callback) => {
        if (message.type === "rank-assistant-get-data-shard") {
          const file = path.join(root, "extension/data", "catalog-shard-" + message.key + ".private.json");
          callback({ ok: true, shard: JSON.parse(fs.readFileSync(file, "utf8")), updated: false });
          return;
        }
        callback({
          ok: true,
          cached: false,
          metadata: { publisher: "IEEE", subjects: ["Engineering"] }
        });
      }
    },
    storage: {
      local: { get: (defaults, callback) => callback({ ...defaults, ...settingOverrides }) },
      onChanged: { addListener: () => {} }
    }
  };
  dom.window.matchMedia = () => ({
    matches: systemDark,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
  dom.window.fetch = async (value) => {
    const address = String(value);
    if (address.startsWith("moz-extension://")) {
      catalogFetches += 1;
      const file = path.join(root, "extension/data", address.split("/").at(-1));
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
    }
    apiFetches += 1;
    return { ok: true, status: 200, json: async () => apiPayload() };
  };
  dom.window.console.error = (...args) => errors.push(args.map(String).join(" "));
  dom.window.console.warn = (...args) => errors.push(args.map(String).join(" "));
  dom.window.eval(normalizer);
  dom.window.eval(contentScript);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return { dom, apiFetches, catalogFetches, errors };
}

const dblpHtml = '<section id="completesearch-publs"><div class="body"><ul class="publ-list"><li class="year">2026</li><li class="entry article"><cite class="data">A. Author: <span class="title" itemprop="name">Known paper.</span><span itemprop="isPartOf"><a id="known-venue" href="/db/journals/access/"><span itemprop="name">IEEE Access</span></a></span> 2026</cite></li><li class="entry inproceedings"><cite class="data">B. Author: <span class="title" itemprop="name">Unknown paper.</span><span itemprop="isPartOf"><a id="unknown-venue" href="/db/conf/unknown/"><span itemprop="name">Unknown Symposium</span></a></span> 2026</cite></li></ul></div></section>';
const dblp = await run("https://dblp.org/search?q=test", dblpHtml);
const doc = dblp.dom.window.document;
assert.equal(doc.documentElement.dataset.paperRankStatus, "ready", JSON.stringify({ detail: doc.documentElement.dataset.paperRankDetail, errors: dblp.errors }));
assert.equal(dblp.apiFetches, 0);
assert.equal(dblp.catalogFetches, 0);
assert.equal(doc.querySelector("li.year").dataset.paperRankProcessed, undefined, "Year separators must not be processed");

const knownTitle = doc.querySelector(".entry .title");
assert.ok(knownTitle.nextElementSibling?.classList.contains("rank-assistant-row"), "Badges must sit directly after the paper title");
const knownLabels = [...knownTitle.nextElementSibling.querySelectorAll(".rank-assistant-badge")].map((node) => node.textContent);
assert.ok(knownLabels.includes("CCF None"), JSON.stringify(knownLabels));
assert.ok(knownLabels.includes("SCI/SCIE"), JSON.stringify(knownLabels));
assert.ok(!knownLabels.some((label) => /^SCI\/SCIE Q/.test(label)), JSON.stringify(knownLabels));
assert.ok(doc.querySelector("#known-venue").nextElementSibling?.classList.contains("rank-assistant-venue-detail"), "Venue details must sit after venue");
const venueControl = doc.querySelector("#known-venue").nextElementSibling;
assert.equal(venueControl.tagName, "SPAN", "Venue detail must be non-interactive");
assert.match(venueControl.textContent, /\u671f\u520a\u8be6\u60c5/);
assert.match(venueControl.dataset.tooltip, /ISSN/);
assert.match(venueControl.dataset.tooltip, /发行商/);
assert.match(venueControl.dataset.tooltip, /主要方向/);

const unknownTitle = doc.querySelectorAll(".entry .title")[1];
assert.equal(unknownTitle.nextElementSibling.querySelector(".rank-assistant-badge").textContent, "CCF None");

assert.ok(!doc.querySelector("#unknown-venue").nextElementSibling?.classList.contains("rank-assistant-venue-detail"));

const firstBadge = doc.querySelector(".rank-assistant-badge");
assert.equal(firstBadge.tagName, "SPAN", "Badges must be non-clickable spans");
assert.equal(firstBadge.hasAttribute("aria-haspopup"), false);
assert.equal(firstBadge.hasAttribute("tabindex"), false);
assert.match(firstBadge.dataset.tooltip, /CCF/);
assert.match(firstBadge.dataset.tooltip, /\u672c\u5730 CCF \u76ee\u5f55\u672a\u5339\u914d\u5230/);
const originalRect = dblp.dom.window.HTMLElement.prototype.getBoundingClientRect;
dblp.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this === firstBadge) return { left: 300, right: 370, top: 300, bottom: 320, width: 70, height: 20 };
  if (this.id === "panel") return { left: 0, right: 300, top: 0, bottom: 120, width: 300, height: 120 };
  return originalRect.call(this);
};
firstBadge.dispatchEvent(new dblp.dom.window.MouseEvent("mouseenter", { bubbles: false }));
const overlayHost = doc.querySelector("#rank-assistant-overlay-host");
assert.ok(overlayHost?.shadowRoot, "Hover must create an isolated Shadow DOM overlay");
const overlayPanel = overlayHost.shadowRoot.querySelector("#panel");
assert.equal(overlayPanel.style.display, "block");
assert.equal(overlayPanel.style.top, "171px", "Tooltip must prefer the space above the label");
assert.match(overlayPanel.textContent, /CCF/);
assert.match(overlayHost.shadowRoot.querySelector("style").textContent, /background: #ffffff !important/);
assert.match(overlayHost.shadowRoot.querySelector("style").textContent, /data-theme="dark"/);
assert.equal(overlayHost.dataset.theme, "light", "Default theme must stay light even when system following is not selected");
firstBadge.click();
assert.equal(overlayPanel.style.display, "block", "Click must have no effect");
firstBadge.dispatchEvent(new dblp.dom.window.MouseEvent("mouseleave", { bubbles: false }));
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(overlayPanel.style.display, "none");
venueControl.dispatchEvent(new dblp.dom.window.MouseEvent("mouseenter", { bubbles: false }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(overlayPanel.textContent, /发行商：IEEE/);
assert.match(overlayPanel.textContent, /Engineering/);
venueControl.dispatchEvent(new dblp.dom.window.MouseEvent("mouseleave", { bubbles: false }));

const scholarHtml = '<div class="gs_r gs_or gs_scl"><div class="gs_ri"><h3 class="gs_rt"><a>Nature paper</a></h3><div class="gs_a">A Author - Nature, 2025 - nature.com</div></div></div>';
const scholar = await run("https://scholar.google.com/scholar?q=nature", scholarHtml);
const scholarDoc = scholar.dom.window.document;
assert.ok(scholarDoc.querySelector(".gs_rt > .rank-assistant-row"), "Scholar badges must be inside the title line");
assert.match(scholarDoc.querySelector(".gs_a .rank-assistant-venue-detail")?.textContent || "", /\u671f\u520a\u8be6\u60c5/);
const scholarLabels = [...scholarDoc.querySelectorAll(".rank-assistant-badge")].map((node) => node.textContent);
assert.ok(scholarLabels.includes("\u4e2d\u79d1\u9662 1\u533a Top"), JSON.stringify(scholarLabels));
assert.ok(!scholarLabels.includes("\u4e2d\u79d1\u9662 Top"), JSON.stringify(scholarLabels));
assert.ok(scholar.catalogFetches < 3, "Scholar should load fewer than the old three full catalog files");

const systemTheme = await run("https://scholar.google.com/scholar?q=theme", scholarHtml, 900, { colorTheme: "system" }, true);
assert.equal(systemTheme.dom.window.document.documentElement.dataset.paperRankTheme, "dark");
const forcedLight = await run("https://scholar.google.com/scholar?q=theme-light", scholarHtml, 900, { colorTheme: "light" }, true);
assert.equal(forcedLight.dom.window.document.documentElement.dataset.paperRankTheme, "light");

const conferenceHtml = '<ul class="publ-list"><li class="entry"><cite class="data">C. Author: <span class="title" itemprop="name">Conference paper.</span><span itemprop="isPartOf"><a id="conference-venue" href="/db/conf/aaai/"><span itemprop="name">AAAI Conference on Artificial Intelligence</span></a></span> 2026</cite></li></ul>';
const conference = await run("https://dblp.dagstuhl.de/search?q=aaai", conferenceHtml);
assert.equal(conference.dom.window.document.querySelector('.rank-assistant-badge[data-kind="ccf"]').textContent, "CCF A");
assert.match(conference.dom.window.document.querySelector(".rank-assistant-venue-detail").textContent, /\u4f1a\u8bae\u8be6\u60c5/);
const recoveredHtml = '<div id="completesearch-publs"><div class="body"><p>found 2405 matches</p><ul class="error"><li>service temporarily not available</li></ul></div></div>';
const recovered = await run("https://dblp.org/search?q=long+tail", recoveredHtml, 2200);
assert.equal(recovered.apiFetches, 1);
assert.equal(recovered.dom.window.document.querySelectorAll("li.entry").length, 1);
assert.ok(recovered.dom.window.document.querySelector(".rank-assistant-fallback-venue + .rank-assistant-venue-detail"));

const stressEntries = Array.from({ length: 100 }, (_, index) =>
  `<li class="entry article"><cite class="data">Author ${index}: <span class="title" itemprop="name">Paper ${index}.</span><span itemprop="isPartOf"><a href="/db/journals/access/"><span itemprop="name">IEEE Access</span></a></span> 2026</cite></li>`
).join("");
const stressStart = performance.now();
const stress = await run("https://dblp.org/search?q=stress", `<ul class="publ-list">${stressEntries}</ul>`, 1200);
const stressMs = Math.round(performance.now() - stressStart);
const stressDoc = stress.dom.window.document;
assert.equal(stress.catalogFetches, 0, "Encrypted shards should be delivered by the background runtime");
assert.equal(stressDoc.querySelectorAll(".rank-assistant-row").length, 100);
assert.equal(stressDoc.querySelectorAll("#rank-assistant-shared-tooltip").length, 0, "Tooltip DOM is lazy and singleton");
stressDoc.querySelector(".rank-assistant-badge").click();
assert.equal(stressDoc.querySelectorAll("#rank-assistant-shared-tooltip").length, 0);
console.log(JSON.stringify({
  dblp: { labels: knownLabels, controls: doc.querySelectorAll(".rank-assistant-badge, .rank-assistant-venue-detail").length, tooltips: doc.querySelectorAll("#rank-assistant-shared-tooltip").length },
  scholar: { labels: scholarLabels, catalogFetches: scholar.catalogFetches },
  recovered: { apiFetches: recovered.apiFetches, entries: recovered.dom.window.document.querySelectorAll("li.entry").length },
  stress: { entries: 100, catalogFetches: stress.catalogFetches, tooltips: stressDoc.querySelectorAll("#rank-assistant-shared-tooltip").length, elapsedMs: stressMs }
}, null, 2));
