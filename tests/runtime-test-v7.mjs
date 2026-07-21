import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const { JSDOM } = await import("file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js");

const root = process.argv[2] || process.cwd();
const normalizer = fs.readFileSync(path.join(root, "extension/lib/normalizer.js"), "utf8");
const i18n = fs.readFileSync(path.join(root, "extension/lib/i18n.js"), "utf8");
const contentScript = fs.readFileSync(path.join(root, "extension/content/content-v7.js"), "utf8");
const filterUi = fs.readFileSync(path.join(root, "extension/content/filter-ui.js"), "utf8");
const paletteCss = fs.readFileSync(path.join(root, "extension/content/palettes.css"), "utf8");
assert.match(paletteCss, /data-paper-rank-palette="soft"/);
assert.match(paletteCss, /data-paper-rank-palette="vivid"/);
assert.match(paletteCss, /data-paper-rank-palette="colorblind"/);
assert.doesNotMatch(paletteCss, /linear-gradient|radial-gradient/);

function paletteToken(palette, token) {
  const block = paletteCss.match(new RegExp(`:root\\[data-paper-rank-palette="${palette}"\\] \\{([\\s\\S]*?)\\}`));
  assert.ok(block, `Missing ${palette} palette block`);
  const value = block[1].match(new RegExp(`--paper-rank-${token}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(value, `Missing ${palette} token ${token}`);
  return value[1].toLowerCase();
}

for (const palette of ["soft", "vivid", "colorblind"]) {
  for (const tokens of [
    ["ccf-a", "ccf-b", "ccf-c"],
    ["cas-1", "cas-2", "cas-3", "cas-4"],
    ["jcr-q1", "jcr-q2", "jcr-q3", "jcr-q4"],
    ["xinrui-1", "xinrui-2", "xinrui-3", "xinrui-4"],
    ["cssci-source", "cssci-extended"]
  ]) {
    const colors = tokens.map((token) => paletteToken(palette, token));
    assert.equal(new Set(colors).size, colors.length, `${palette} must distinguish ${tokens.join(", ")}`);
  }
}

function rgb(hex) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}
function mixColor(left, right, leftShare) {
  return left.map((value, index) => value * leftShare + right[index] * (1 - leftShare));
}
function relativeLuminance(color) {
  const values = color.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}
function contrastRatio(left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const palette of ["soft", "vivid", "colorblind"]) {
  const block = paletteCss.match(new RegExp(`:root\\[data-paper-rank-palette="${palette}"\\] \\{([\\s\\S]*?)\\}`))[1];
  const colors = [...block.matchAll(/--paper-rank-[\w-]+:\s*(#[0-9a-f]{6})/gi)].map((match) => rgb(match[1]));
  const lightTint = palette === "vivid" ? 0.16 : palette === "colorblind" ? 0.12 : 0.09;
  const darkTint = palette === "vivid" ? 0.34 : palette === "colorblind" ? 0.28 : 0.22;
  for (const color of colors) {
    const lightBackground = mixColor(color, rgb("#f8fafc"), lightTint);
    const lightText = mixColor(color, rgb("#101828"), 0.72);
    const darkBackground = mixColor(color, rgb("#171b24"), darkTint);
    const darkText = mixColor(color, rgb("#f8fafc"), 0.52);
    assert.ok(contrastRatio(lightText, lightBackground) >= 4.5, `${palette} light badge contrast regressed`);
    assert.ok(contrastRatio(darkText, darkBackground) >= 4.5, `${palette} dark badge contrast regressed`);
  }
}

function apiPayload() {
  return { result: { hits: { hit: [
    { info: { authors: { author: [{ text: "A. Author" }] }, title: "Recovered", venue: "IEEE Access", year: "2026", url: "https://dblp.org/rec/one" } }
  ] } } };
}

async function run(url, html, waitMs = 900, settingOverrides = {}, systemDark = false, runOptions = {}) {
  let apiFetches = 0;
  let directApiFetches = 0;
  let backgroundRecoveryMessages = 0;
  let catalogFetches = 0;
  const storageListeners = [];
  const storageWrites = [];
  const errors = [];
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.__PAPER_RANK_DBLP_TIMEOUT_MS = 350;
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
        if (message.type === "rank-assistant-match-dblp-venues") {
          const stop = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);
          const normalize = (value) => String(value || "").normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase().replace(/\s+/g, " ");
          const abbreviation = (value) => normalize(value).split(" ").filter((token) => token && !stop.has(token))
            .map((token) => token.slice(0, 4)).join(" ");
          const venueKey = (value) => {
            try {
              const pathname = new URL(value || "", "https://dblp.org").pathname;
              const match = pathname.match(/^\/db\/([^/]+)\/([^/]+)\//);
              return match ? "/db/" + match[1] + "/" + match[2] + "/" : "";
            } catch (_) {
              return "";
            }
          };
          const keys = new Set();
          const records = message.items.map((item) => {
            const normalized = normalize(item.text);
            const key = /^[a-z]/.test(normalized) ? normalized[0] : /^\d/.test(normalized) ? "0" : "other";
            keys.add(key);
            const file = path.join(root, "extension/data", "catalog-shard-" + key + ".private.json");
            const shard = JSON.parse(fs.readFileSync(file, "utf8"));
            const linked = shard.r.find((record) => venueKey(record?.[15]) === item.key);
            if (linked) return linked;
            const words = normalized.split(" ");
            for (let size = words.length; size >= 1; size -= 1) {
              const phrase = words.slice(0, size).join(" ");
              if (Object.prototype.hasOwnProperty.call(shard.a, phrase)) return shard.r[shard.a[phrase]] || null;
              const abbreviated = abbreviation(phrase);
              if (Object.prototype.hasOwnProperty.call(shard.b, abbreviated)) return shard.r[shard.b[abbreviated]] || null;
            }
            const candidate = abbreviation(normalized).split(" ").filter(Boolean);
            for (const [stored, index] of Object.entries(shard.b)) {
              const tokens = stored.split(" ");
              if (tokens.length !== candidate.length) continue;
              if (candidate.every((token, position) => tokens[position].startsWith(token) || token.startsWith(tokens[position]))) {
                return shard.r[index] || null;
              }
            }
            return null;
          });
          const lineages = new Map();
          message.items.forEach((item, index) => {
            if (item.key && records[index]) lineages.set(item.key, records[index]);
          });
          const unified = records.map((record, index) => lineages.get(message.items[index].key) || record);
          callback({ ok: true, records: unified, shardCount: keys.size, mode: "background-batch" });
          return;
        }        if (message.type === "rank-assistant-dblp-recover") {
          apiFetches += 1;
          backgroundRecoveryMessages += 1;
          if (runOptions.backgroundRecoveryFailure) {
            callback({ ok: false, error: "All DBLP mirror endpoints are unavailable" });
          } else {
            callback({
              ok: true,
              cached: false,
              sourceOrigin: "https://dblp.dagstuhl.de",
              hits: apiPayload().result.hits.hit
            });
          }
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
      local: {
        get: (defaults, callback) => callback({ ...defaults, ...settingOverrides }),
        set(values, callback) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: settingOverrides[key], newValue: value };
            settingOverrides[key] = value;
          }
          storageWrites.push(values);
          for (const listener of storageListeners) listener(changes, "local");
          callback?.();
        }
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) }
    }
  };
  dom.window.matchMedia = () => ({
    matches: systemDark,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
  dom.window.fetch = async (value) => {
    const address = String(value);
    if (address.includes("/_locales/")) {
      const relative = address.split("moz-extension://test/")[1];
      const file = path.join(root, relative);
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
    }
    if (address.startsWith("moz-extension://")) {
      catalogFetches += 1;
      const file = path.join(root, "extension/data", address.split("/").at(-1));
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
    }
    apiFetches += 1;
    directApiFetches += 1;
    if (runOptions.directApiFailure) throw new Error("DBLP main API unavailable");
    return { ok: true, status: 200, json: async () => apiPayload() };
  };
  dom.window.console.error = (...args) => errors.push(args.map(String).join(" "));
  dom.window.console.warn = (...args) => errors.push(args.map(String).join(" "));
  dom.window.eval(normalizer);
  dom.window.eval(i18n);
  dom.window.eval(contentScript);
  dom.window.eval(filterUi);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return {
    dom, apiFetches, directApiFetches, backgroundRecoveryMessages, catalogFetches, errors, storageWrites,
    changeSettings(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: settingOverrides[key], newValue: value };
        settingOverrides[key] = value;
      }
      for (const listener of storageListeners) listener(changes, "local");
    }
  };
}

const dblpHtml = '<section id="completesearch-publs"><div class="body"><ul class="publ-list"><li class="year">2026</li><li class="entry article"><cite class="data">A. Author: <span class="title" itemprop="name">Known paper.</span><span itemprop="isPartOf"><a id="known-venue" href="/db/journals/access/"><span itemprop="name">IEEE Access</span></a></span> 2026</cite></li><li class="entry inproceedings"><cite class="data">B. Author: <span class="title" itemprop="name">Unknown paper.</span><span itemprop="isPartOf"><a id="unknown-venue" href="/db/conf/unknown/"><span itemprop="name">Unknown Symposium</span></a></span> 2026</cite></li></ul></div></section>';
const dblp = await run("https://dblp.org/search?q=test", dblpHtml);
const doc = dblp.dom.window.document;
assert.equal(doc.documentElement.dataset.paperRankStatus, "ready", JSON.stringify({ detail: doc.documentElement.dataset.paperRankDetail, errors: dblp.errors }));
assert.equal(dblp.apiFetches, 0);
assert.equal(dblp.catalogFetches, 0);
assert.equal(doc.documentElement.dataset.paperRankPalette, "vivid");
dblp.changeSettings({ colorPalette: "colorblind" });
assert.equal(doc.documentElement.dataset.paperRankPalette, "colorblind");
dblp.changeSettings({ colorPalette: "vivid" });
assert.equal(doc.querySelector("li.year").dataset.paperRankProcessed, undefined, "Year separators must not be processed");
const filterHost = doc.querySelector("#rank-assistant-filter-host");
assert.ok(filterHost?.shadowRoot, "Results pages must get an isolated floating filter");
assert.equal(filterHost.style.getPropertyValue("z-index"), "2147483647", "Filter host must stay above site controls");
assert.equal(filterHost.style.getPropertyPriority("z-index"), "important");
assert.equal(filterHost.style.getPropertyValue("isolation"), "isolate");
assert.equal(doc.documentElement.lastElementChild, filterHost, "Filter host must be painted after the page body");
assert.match(filterHost.shadowRoot.querySelector("style").textContent, /:host\{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;isolation:isolate!important/);
assert.match(filterHost.shadowRoot.querySelector("style").textContent, /#launcher\{position:fixed;z-index:3/);
assert.match(filterHost.shadowRoot.querySelector("style").textContent, /#panel\{position:fixed;z-index:2/);
const filterButton = filterHost.shadowRoot.querySelector("#launcher");
const filterPanel = filterHost.shadowRoot.querySelector("#panel");
assert.equal(filterButton.querySelector("#glyph").textContent, "筛");
assert.equal(filterPanel.hidden, true);
assert.equal(filterButton.querySelector("#guide").hidden, false, "First use must explain the floating control");
assert.ok(Number.parseFloat(filterButton.style.top) < dblp.dom.window.innerHeight * 0.5, "The default launcher belongs in the upper half of the viewport");
filterButton.getBoundingClientRect = () => {
  const left = Number.parseFloat(filterButton.style.left) || 900;
  const top = Number.parseFloat(filterButton.style.top) || 700;
  return { left, top, right: left + 52, bottom: top + 52, width: 52, height: 52 };
};
filterButton.dispatchEvent(new dblp.dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 923, clientY: 723, button: 0 }));
filterButton.dispatchEvent(new dblp.dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 600, clientY: 400, button: 0 }));
filterButton.dispatchEvent(new dblp.dom.window.MouseEvent("pointerup", { bubbles: true, clientX: 600, clientY: 400, button: 0 }));
assert.ok(dblp.storageWrites.some((value) => Number.isFinite(value.filterButtonPosition?.x)), "Dragging must persist the floating button position");
assert.ok(dblp.storageWrites.some((value) => value.filterGuideSeen === true), "First drag must dismiss the guide permanently");
assert.equal(filterButton.querySelector("#guide").hidden, true);
filterButton.click();
assert.equal(filterPanel.hidden, true, "Finishing a drag must not accidentally open the panel");
filterButton.click();
assert.equal(filterPanel.hidden, false);
doc.dispatchEvent(new dblp.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
assert.equal(filterPanel.hidden, true);

const knownTitle = doc.querySelector(".entry .title");
assert.ok(knownTitle.nextElementSibling?.classList.contains("rank-assistant-row"), "Badges must sit directly after the paper title");
const knownLabels = [...knownTitle.nextElementSibling.querySelectorAll(".rank-assistant-badge")].map((node) => node.textContent);
assert.ok(knownLabels.includes("CCF None"), JSON.stringify(knownLabels));
assert.ok(knownLabels.includes("SCI/SCIE"), JSON.stringify(knownLabels));
assert.ok(!knownLabels.some((label) => /^SCI\/SCIE Q/.test(label)), JSON.stringify(knownLabels));
assert.equal(knownTitle.nextElementSibling.querySelector('.rank-assistant-badge[data-kind="jcr"]').dataset.level, "q2");
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

const renamedJournalHtml = '<ul class="publ-list"><li class="entry article" id="aslib-current"><cite class="data">A. Author: <span class="title" itemprop="name">Current title paper.</span><span itemprop="isPartOf"><a href="/db/journals/aslib/"><span itemprop="name">Aslib J. Inf. Manag.</span></a></span> 2025</cite></li><li class="entry article" id="aslib-legacy"><cite class="data">B. Author: <span class="title" itemprop="name">Legacy title paper.</span><span itemprop="isPartOf"><a href="/db/journals/aslib/index.html#legacy"><span itemprop="name">Aslib Proc.</span></a></span> 2012</cite></li></ul>';
const renamedJournal = await run("https://dblp.org/search?q=aslib", renamedJournalHtml);
const renamedDoc = renamedJournal.dom.window.document;
const currentLabels = [...renamedDoc.querySelectorAll("#aslib-current .rank-assistant-badge")].map((node) => node.textContent);
const legacyLabels = [...renamedDoc.querySelectorAll("#aslib-legacy .rank-assistant-badge")].map((node) => node.textContent);
assert.deepEqual(legacyLabels, currentLabels, "A renamed DBLP journal lineage must use one canonical catalog record");
assert.ok(currentLabels.includes("JCR Q1"), JSON.stringify(currentLabels));
assert.ok(currentLabels.some((label) => label.includes("SSCI")), JSON.stringify(currentLabels));

const secondRenamedJournalHtml = '<ul class="publ-list"><li class="entry article" id="jasis-current"><cite class="data">A. Author: <span class="title" itemprop="name">Current JASIST paper.</span><span itemprop="isPartOf"><a href="/db/journals/jasis/jasis77.html"><span itemprop="name">J. Assoc. Inf. Sci. Technol.</span></a></span> 2025</cite></li><li class="entry article" id="jasis-legacy"><cite class="data">B. Author: <span class="title" itemprop="name">Legacy JASIST paper.</span><span itemprop="isPartOf"><a href="/db/journals/jasis/jasis50.html"><span itemprop="name">J. Am. Soc. Inf. Sci.</span></a></span> 1999</cite></li></ul>';
const secondRenamedJournal = await run("https://dblp.org/search?q=jasis", secondRenamedJournalHtml);
const secondRenamedDoc = secondRenamedJournal.dom.window.document;
const secondCurrentLabels = [...secondRenamedDoc.querySelectorAll("#jasis-current .rank-assistant-badge")].map((node) => node.textContent);
const secondLegacyLabels = [...secondRenamedDoc.querySelectorAll("#jasis-legacy .rank-assistant-badge")].map((node) => node.textContent);
assert.deepEqual(secondLegacyLabels, secondCurrentLabels, "DBLP lineage grouping must work without a journal-specific mapping");
assert.ok(secondCurrentLabels.includes("CCF B"), JSON.stringify(secondCurrentLabels));

const oldOnlyJournalHtml = '<ul class="publ-list"><li class="entry article" id="jasis-old-only"><cite class="data">B. Author: <span class="title" itemprop="name">Old-only JASIST result.</span><span itemprop="isPartOf"><a href="/db/journals/jasis/jasis50.html"><span itemprop="name">J. Am. Soc. Inf. Sci.</span></a></span> 1999</cite></li></ul>';
const oldOnlyJournal = await run("https://dblp.org/search?q=old+jasis", oldOnlyJournalHtml);
const oldOnlyLabels = [...oldOnlyJournal.dom.window.document.querySelectorAll("#jasis-old-only .rank-assistant-badge")].map((node) => node.textContent);
assert.ok(oldOnlyLabels.includes("CCF B"), "A DBLP venue URL must resolve its catalog record even when only a historical title is visible");

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
assert.equal(scholarDoc.querySelector('.rank-assistant-badge[data-kind="cas"]').dataset.level, "1");
assert.equal(scholarDoc.querySelector('.rank-assistant-badge[data-kind="jcr"]').dataset.level, "q1");
assert.ok(!scholarLabels.includes("\u4e2d\u79d1\u9662 Top"), JSON.stringify(scholarLabels));
assert.ok(scholar.catalogFetches < 3, "Scholar should load fewer than the old three full catalog files");

const scholarProfileHtml = '<table><tbody><tr class="gsc_a_tr" id="profile-paper"><td class="gsc_a_t"><a class="gsc_a_at">A highly cited profile paper</a><div class="gs_gray">A Researcher</div><div class="gs_gray">Nature 521 (7553), 436-444, 2015</div></td></tr></tbody></table>';
const scholarProfile = await run("https://scholar.google.com/citations?user=test", scholarProfileHtml, 900);
const scholarProfileDoc = scholarProfile.dom.window.document;
assert.ok(scholarProfileDoc.querySelector(".gsc_a_at + .rank-assistant-row"), "Scholar profile badges must sit after the publication title");
assert.ok([...scholarProfileDoc.querySelectorAll("#profile-paper .rank-assistant-badge")].some((node) => node.textContent === "JCR Q1"));
assert.ok(scholarProfileDoc.querySelector("#profile-paper .gs_gray:nth-of-type(2) .rank-assistant-venue-detail"), "Scholar profile venue details must sit on the publication venue line");

const natureSearchHtml = '<main><article data-test="article-listing" id="nature-result"><h3><a href="/articles/example">Nature search result</a></h3><span class="publication-title">Nature</span></article></main>';
const natureSearch = await run("https://www.nature.com/search?q=ai", natureSearchHtml, 900);
const natureSearchDoc = natureSearch.dom.window.document;
assert.ok(natureSearchDoc.querySelector("#nature-result h3 a + .rank-assistant-row"));
assert.ok([...natureSearchDoc.querySelectorAll("#nature-result .rank-assistant-badge")].some((node) => node.textContent === "中科院 1区 Top"));
assert.ok(natureSearchDoc.querySelector("#nature-result .publication-title + .rank-assistant-venue-detail"));

const scienceDirectHtml = '<main><div class="result-item" id="sd-result"><h2><a href="/science/article/pii/test">Publisher result</a></h2><div class="publication-title">Computers &amp; Electrical Engineering</div></div></main>';
const scienceDirect = await run("https://www.sciencedirect.com/search?qs=vision", scienceDirectHtml, 900);
const scienceDirectDoc = scienceDirect.dom.window.document;
assert.ok(scienceDirectDoc.querySelector("#sd-result h2 a + .rank-assistant-row"));
assert.ok([...scienceDirectDoc.querySelectorAll("#sd-result .rank-assistant-badge")].some((node) => node.textContent.startsWith("预警 ")));

const publisherArticleHtml = '<head><meta name="citation_title" content="Article page"><meta name="citation_journal_title" content="IEEE Transactions on Pattern Analysis and Machine Intelligence"></head><body><main><article id="publisher-article"><h1>Article page</h1></article></main></body>';
const publisherArticle = await run("https://ieeexplore.ieee.org/document/123", publisherArticleHtml, 900);
const publisherArticleDoc = publisherArticle.dom.window.document;
assert.ok(publisherArticleDoc.querySelector("#publisher-article h1 + .rank-assistant-row"), "Article pages must use citation_journal_title metadata");
assert.ok([...publisherArticleDoc.querySelectorAll("#publisher-article .rank-assistant-badge")].some((node) => node.textContent === "CCF A"));

const publisherHome = await run("https://www.nature.com/", "<main><h1>Nature</h1></main>", 300);
assert.equal(publisherHome.dom.window.document.querySelector("#rank-assistant-filter-host"), null, "Publisher homepages without papers must not create the filter UI");
assert.equal(publisherHome.dom.window.document.documentElement.dataset.paperRankStatus, "idle", "Publisher homepages must not keep a broad DOM observer running");

const english = await run("https://scholar.google.com/scholar?q=nature", scholarHtml, 900, { language: "en" });
const englishDoc = english.dom.window.document;
const englishFilter = englishDoc.querySelector("#rank-assistant-filter-host").shadowRoot;
assert.equal(englishFilter.querySelector("#glyph").textContent, "F");
assert.equal(englishFilter.querySelector("h2").textContent, "Filter papers");
assert.equal(englishFilter.querySelector("#launcher").getAttribute("aria-label"), "Paper filters");
const englishLabels = [...englishDoc.querySelectorAll(".rank-assistant-badge")].map((node) => node.textContent);
assert.ok(englishLabels.includes("CAS Zone 1 Top"), JSON.stringify(englishLabels));
const englishVenue = englishDoc.querySelector(".rank-assistant-venue-detail");
assert.equal(englishVenue.textContent, "Journal details");
assert.match(englishVenue.dataset.tooltip, /Publisher: Nature Publishing Group|Publisher:/);
assert.match(englishVenue.dataset.tooltip, /Primary topics:/);

english.changeSettings({ language: "fr" });
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(englishDoc.querySelector("#rank-assistant-filter-host").shadowRoot.querySelector("#glyph").textContent, "筛", "Unsupported stored languages must fall back to Chinese");

const systemTheme = await run("https://scholar.google.com/scholar?q=theme", scholarHtml, 900, { colorTheme: "system" }, true);
assert.equal(systemTheme.dom.window.document.documentElement.dataset.paperRankTheme, "dark");
assert.equal(systemTheme.dom.window.document.querySelector("#rank-assistant-filter-host").dataset.theme, "dark");
const forcedLight = await run("https://scholar.google.com/scholar?q=theme-light", scholarHtml, 900, { colorTheme: "light" }, true);
assert.equal(forcedLight.dom.window.document.documentElement.dataset.paperRankTheme, "light");
assert.equal(forcedLight.dom.window.document.querySelector("#rank-assistant-filter-host").dataset.theme, "light");

const conferenceHtml = '<ul class="publ-list"><li class="entry"><cite class="data">C. Author: <span class="title" itemprop="name">Conference paper.</span><span itemprop="isPartOf"><a id="conference-venue" href="/db/conf/acl/"><span itemprop="name">Annual Meeting of the Association for Computational Linguistics</span></a></span> 2026</cite></li></ul>';
const conference = await run("https://dblp.dagstuhl.de/search?q=aaai", conferenceHtml);
assert.equal(conference.dom.window.document.querySelector('.rank-assistant-badge[data-kind="ccf"]').textContent, "CCF A");
assert.equal(conference.dom.window.document.querySelector('.rank-assistant-badge[data-kind="ccf"]').dataset.level, "a");
assert.match(conference.dom.window.document.querySelector(".rank-assistant-venue-detail").textContent, /\u4f1a\u8bae\u8be6\u60c5/);
assert.equal(conference.dom.window.document.querySelector('.rank-assistant-badge[data-kind="xinrui"]').textContent, "\u65b0\u9510 1\u533a Top");
assert.equal(conference.dom.window.document.querySelector('.rank-assistant-badge[data-kind="xinrui"]').dataset.level, "1");

const warningHtml = '<ul class="publ-list"><li id="warned-paper" class="entry article"><cite class="data">A. Author: <span class="title" itemprop="name">Warned paper.</span><span itemprop="isPartOf"><a href="/db/journals/cee/"><span itemprop="name">COMPUTERS &amp; ELECTRICAL ENGINEERING</span></a></span> 2026</cite></li><li id="safe-paper" class="entry article"><cite class="data">B. Author: <span class="title" itemprop="name">Safe paper.</span><span itemprop="isPartOf"><a href="/db/journals/pami/"><span itemprop="name">IEEE TRANSACTIONS ON PATTERN ANALYSIS AND MACHINE INTELLIGENCE</span></a></span> 2026</cite></li></ul>';
const warningPage = await run("https://dblp.org/search?q=warning", warningHtml, 1000);
const warningDoc = warningPage.dom.window.document;
const warningLabels = [...warningDoc.querySelectorAll("#warned-paper .rank-assistant-badge")].map((node) => node.textContent);
assert.equal(warningLabels[0], "\u9884\u8b66 2025", JSON.stringify(warningLabels));
assert.ok(warningLabels.includes("\u65b0\u9510 2\u533a"), JSON.stringify(warningLabels));
assert.match(warningDoc.querySelector('#warned-paper .rank-assistant-badge[data-kind="warning"]').dataset.tooltip, /\u8bba\u6587\u5de5\u5382/);
const warningFilter = warningDoc.querySelector("#rank-assistant-filter-host").shadowRoot;
warningFilter.querySelector("#launcher").click();
const hideWarningChoice = [...warningFilter.querySelectorAll("#warning-filter .choice")].find((label) => label.textContent.includes("\u9690\u85cf\u5f53\u524d\u9884\u8b66\u671f\u520a"));
assert.ok(hideWarningChoice);
hideWarningChoice.querySelector("input").click();
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(warningDoc.querySelector("#warned-paper").classList.contains("rank-assistant-filter-hidden"), true);
assert.equal(warningDoc.querySelector("#safe-paper").classList.contains("rank-assistant-filter-hidden"), false);
assert.equal(warningFilter.querySelector("#count").textContent, "1");
hideWarningChoice.querySelector("input").click();
await new Promise((resolve) => setTimeout(resolve, 1000));
[...warningFilter.querySelectorAll("#indexes .choice")].find((label) => label.textContent === "\u65b0\u9510").querySelector("input").click();
[...warningFilter.querySelectorAll("#values .choice")].find((label) => label.textContent === "1\u533a").querySelector("input").click();
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(warningDoc.querySelector("#warned-paper").classList.contains("rank-assistant-filter-hidden"), true);
assert.equal(warningDoc.querySelector("#safe-paper").classList.contains("rank-assistant-filter-hidden"), false);

const chineseHtml = [
  '<div id="cssci-source" class="gs_r gs_or gs_scl"><div class="gs_ri"><h3 class="gs_rt"><a>社会科学论文</a></h3><div class="gs_a">作者 - 中国社会科学, 2025 - example.cn</div></div></div>',
  '<div id="cssci-extended" class="gs_r gs_or gs_scl"><div class="gs_ri"><h3 class="gs_rt"><a>教育论文</a></h3><div class="gs_a">作者 - 中小学管理, 2025 - example.cn</div></div></div>'
].join("");
const chinese = await run("https://scholar.google.com/scholar?q=cssci", chineseHtml, 1000);
const chineseDoc = chinese.dom.window.document;
const sourceLabels = [...chineseDoc.querySelectorAll("#cssci-source .rank-assistant-badge")].map((node) => node.textContent);
const extendedLabels = [...chineseDoc.querySelectorAll("#cssci-extended .rank-assistant-badge")].map((node) => node.textContent);
assert.ok(sourceLabels.includes("CSSCI 来源"), JSON.stringify(sourceLabels));
assert.ok(sourceLabels.includes("北大核心"), JSON.stringify(sourceLabels));
assert.ok(extendedLabels.includes("CSSCI 扩展"), JSON.stringify(extendedLabels));
assert.ok(extendedLabels.includes("北大核心"), JSON.stringify(extendedLabels));
assert.ok(chinese.catalogFetches <= 1, "Chinese venues should share one Unicode shard");

const chineseFilter = chineseDoc.querySelector("#rank-assistant-filter-host").shadowRoot;
chineseFilter.querySelector("#launcher").click();
[...chineseFilter.querySelectorAll("#indexes .choice")].find((label) => label.textContent === "CSSCI").querySelector("input").click();
[...chineseFilter.querySelectorAll("#values .choice")].find((label) => label.textContent === "来源").querySelector("input").click();
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(chineseDoc.querySelector("#cssci-source").classList.contains("rank-assistant-filter-hidden"), false);
assert.equal(chineseDoc.querySelector("#cssci-extended").classList.contains("rank-assistant-filter-hidden"), true);
assert.equal(chineseFilter.querySelector("#count").textContent, "1");

chinese.changeSettings({ resultFilters: { indexes: ["cssci", "pku"], values: { cssci: ["extended"], pku: ["included"] } } });
await new Promise((resolve) => setTimeout(resolve, 1000));
assert.equal(chineseDoc.querySelector("#cssci-source").classList.contains("rank-assistant-filter-hidden"), true);
assert.equal(chineseDoc.querySelector("#cssci-extended").classList.contains("rank-assistant-filter-hidden"), false);

const arxivHtml = '<ol><li class="arxiv-result"><p class="title">An arXiv paper</p><p class="comments">Comments: Accepted at AAAI Conference on Artificial Intelligence 2026</p></li></ol>';
const arxiv = await run("https://arxiv.org/search/?query=ai&searchtype=all", arxivHtml);
const arxivDoc = arxiv.dom.window.document;
assert.equal(arxivDoc.querySelector('.rank-assistant-badge[data-kind="ccf"]').textContent, "CCF A");
assert.ok(arxivDoc.querySelector(".title + .rank-assistant-row"), "arXiv badges must sit after the title");
assert.ok(arxivDoc.querySelector(".comments + .rank-assistant-venue-detail"), "arXiv venue details must sit after comments or journal reference");

const pubmedHtml = '<main><article class="full-docsum"><a class="docsum-title" href="/1/">A PubMed paper</a><span class="docsum-journal-citation">IEEE Access. 2025;13:1-8.</span></article></main>';
const pubmed = await run("https://pubmed.ncbi.nlm.nih.gov/?term=ai", pubmedHtml);
const pubmedDoc = pubmed.dom.window.document;
assert.ok(pubmedDoc.querySelector(".docsum-title + .rank-assistant-row"), "PubMed badges must sit after the title");
assert.ok([...pubmedDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "SCI/SCIE"));
assert.ok(pubmedDoc.querySelector(".docsum-journal-citation + .rank-assistant-venue-detail"));

const semanticHtml = '<div data-testid="paper-row"><a href="/paper/example">A Semantic Scholar paper</a><span class="cl-paper-venue">Nature · 2025</span></div>';
const semantic = await run("https://www.semanticscholar.org/search?q=ai", semanticHtml);
const semanticDoc = semantic.dom.window.document;
assert.ok(semanticDoc.querySelector('a[href*="/paper/"] + .rank-assistant-row'));
assert.ok([...semanticDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "JCR Q1"));
const semanticVenueHtml = [
  '<div data-testid="paper-row" id="semantic-cvpr"><a href="/paper/reltransformer">RelTransformer</a><a class="cl-paper-venue" href="/venue/Computer-Vision-and-Pattern-Recognition/123">Computer Vision and Pattern Recognition</a></div>',
  '<div data-testid="paper-row" id="semantic-ijcai"><a href="/paper/icl">ICL</a><span data-selenium-selector="paper-venue">International Joint Conference on Artificial...</span></div>',
  '<div data-testid="paper-row" id="semantic-tpami"><a href="/paper/pi">PI</a><span data-selenium-selector="paper-venue">IEEE Transactions on Pattern Analysis and Machine...</span></div>',
  '<div data-testid="paper-row" id="semantic-pr"><a href="/paper/pr">PR paper</a><span data-selenium-selector="paper-venue">Pattern Recognition</span></div>',
  '<div data-testid="paper-row" id="semantic-cvpr-short"><a href="/paper/cvpr">CVPR paper</a><span data-selenium-selector="paper-venue">CVPR</span></div>',
  '<div data-testid="paper-row" id="semantic-ambiguous"><a href="/paper/mobile">Mobile paper</a><span data-selenium-selector="paper-venue">ACM International Conference on Mobile...</span></div>',
  '<div data-testid="paper-row" id="semantic-generic"><a href="/paper/generic">Generic paper</a><span data-selenium-selector="paper-venue">Analysis of results</span></div>',
  '<div data-testid="paper-row" id="semantic-short-title-conflict"><a href="/paper/conflict">Conflict paper</a><span data-selenium-selector="paper-venue">Advances in Applied Mathematics...</span></div>'
].join("");
const semanticVenues = await run("https://www.semanticscholar.org/search?q=long-tail", semanticVenueHtml, 1100);
const semanticVenuesDoc = semanticVenues.dom.window.document;
const semanticLabels = (id) => [...semanticVenuesDoc.querySelectorAll("#" + id + " .rank-assistant-badge")].map((node) => node.textContent);
assert.ok(semanticLabels("semantic-cvpr").includes("CCF A"), JSON.stringify(semanticLabels("semantic-cvpr")));
assert.ok(!semanticLabels("semantic-cvpr").some((label) => /^(?:JCR|IF|SCI|SCIE)/.test(label)), JSON.stringify(semanticLabels("semantic-cvpr")));
assert.equal(semanticVenuesDoc.querySelector("#semantic-cvpr .rank-assistant-venue-detail").textContent, "\u4f1a\u8bae\u8be6\u60c5");
assert.ok(semanticLabels("semantic-ijcai").includes("CCF B"), JSON.stringify(semanticLabels("semantic-ijcai")));
assert.equal(semanticVenuesDoc.querySelector("#semantic-ijcai .rank-assistant-venue-detail").textContent, "\u4f1a\u8bae\u8be6\u60c5");
assert.ok(semanticLabels("semantic-tpami").includes("CCF A"), JSON.stringify(semanticLabels("semantic-tpami")));
assert.ok(semanticLabels("semantic-tpami").includes("JCR Q1"), JSON.stringify(semanticLabels("semantic-tpami")));
assert.ok(semanticLabels("semantic-tpami").includes("SCI/SCIE"), JSON.stringify(semanticLabels("semantic-tpami")));
assert.equal(semanticVenuesDoc.querySelector("#semantic-tpami .rank-assistant-venue-detail").textContent, "\u671f\u520a\u8be6\u60c5");
assert.ok(semanticLabels("semantic-pr").includes("CCF B"), JSON.stringify(semanticLabels("semantic-pr")));
assert.ok(semanticLabels("semantic-pr").includes("JCR Q1"), JSON.stringify(semanticLabels("semantic-pr")));
assert.ok(semanticLabels("semantic-cvpr-short").includes("CCF A"), JSON.stringify(semanticLabels("semantic-cvpr-short")));
assert.deepEqual(semanticLabels("semantic-ambiguous"), ["CCF None"], "Ambiguous Semantic Scholar prefixes must not guess");
assert.deepEqual(semanticLabels("semantic-generic"), ["CCF None"], "Generic Semantic Scholar phrases must not match a short journal title");

assert.deepEqual(semanticLabels("semantic-short-title-conflict"), ["CCF None"], "A truncated name that equals another full title must remain unmatched");

const safetyLabels = (doc, id) => [...doc.querySelectorAll("#" + id + " .rank-assistant-badge")].map((node) => node.textContent);
const assertOnlyNone = (doc, id) => assert.deepEqual(safetyLabels(doc, id), ["CCF None"], id + " must remain unmatched");

const scholarSafetyHtml = [
  '<div class="gs_r gs_or gs_scl" id="scholar-safe-tpami"><div class="gs_ri"><h3 class="gs_rt"><a>TPAMI paper</a></h3><div class="gs_a">A Author - IEEE Transactions on Pattern Analysis and Machine..., 2025 - ieee.org</div></div></div>',
  '<div class="gs_r gs_or gs_scl" id="scholar-safe-ambiguous"><div class="gs_ri"><h3 class="gs_rt"><a>Mobile paper</a></h3><div class="gs_a">A Author - ACM International Conference on Mobile..., 2025 - acm.org</div></div></div>',
  '<div class="gs_r gs_or gs_scl" id="scholar-safe-generic"><div class="gs_ri"><h3 class="gs_rt"><a>Generic paper</a></h3><div class="gs_a">A Author - Analysis of results, 2025 - example.org</div></div></div>'
].join("");
const scholarSafety = await run("https://scholar.google.com/scholar?q=safe", scholarSafetyHtml, 1000);
assert.ok(safetyLabels(scholarSafety.dom.window.document, "scholar-safe-tpami").includes("CCF A"));
assert.ok(safetyLabels(scholarSafety.dom.window.document, "scholar-safe-tpami").includes("JCR Q1"));
assertOnlyNone(scholarSafety.dom.window.document, "scholar-safe-ambiguous");
assertOnlyNone(scholarSafety.dom.window.document, "scholar-safe-generic");

const arxivSafetyHtml = [
  '<li class="arxiv-result" id="arxiv-safe-ijcai"><p class="title">IJCAI paper</p><p class="comments">Comments: Accepted at International Joint Conference on Artificial Intelligence 2025</p></li>',
  '<li class="arxiv-result" id="arxiv-safe-generic"><p class="title">Generic paper</p><p class="comments">Comments: Analysis of results</p></li>'
].join("");
const arxivSafety = await run("https://arxiv.org/search/?query=safe&searchtype=all", "<ol>" + arxivSafetyHtml + "</ol>", 1000);
assert.ok(safetyLabels(arxivSafety.dom.window.document, "arxiv-safe-ijcai").includes("CCF B"));
assertOnlyNone(arxivSafety.dom.window.document, "arxiv-safe-generic");

const pubmedSafetyHtml = [
  '<article class="full-docsum" id="pubmed-safe-tpami"><a class="docsum-title">TPAMI paper</a><span class="docsum-journal-citation">IEEE Trans Pattern Anal Mach Intell. 2025;1:1.</span></article>',
  '<article class="full-docsum" id="pubmed-safe-generic"><a class="docsum-title">Generic paper</a><span class="docsum-journal-citation">Analysis of results. 2025;1:1.</span></article>'
].join("");
const pubmedSafety = await run("https://pubmed.ncbi.nlm.nih.gov/?term=safe", "<main>" + pubmedSafetyHtml + "</main>", 1000);
assert.ok(safetyLabels(pubmedSafety.dom.window.document, "pubmed-safe-tpami").includes("CCF A"));
assertOnlyNone(pubmedSafety.dom.window.document, "pubmed-safe-generic");

const openAlexSafetyHtml = [
  '<article data-testid="work-result" id="openalex-safe-tpami"><a href="/works/W1">TPAMI paper</a><span data-testid="source">IEEE Transactions on Pattern Analysis and Machine...</span></article>',
  '<article data-testid="work-result" id="openalex-safe-generic"><a href="/works/W2">Generic paper</a><span data-testid="source">Analysis of results</span></article>'
].join("");
const openAlexSafety = await run("https://openalex.org/works?search=safe", openAlexSafetyHtml, 1000);
assert.ok(safetyLabels(openAlexSafety.dom.window.document, "openalex-safe-tpami").includes("CCF A"));
assertOnlyNone(openAlexSafety.dom.window.document, "openalex-safe-generic");

const cnkiSafetyHtml = '<table class="result-table-list"><tbody><tr id="cnki-safe-generic"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=safe">Generic paper</a></td><td class="source"><a>Analysis of results</a></td></tr></tbody></table>';
const cnkiSafety = await run("https://kns.cnki.net/kns8s/defaultresult/index", cnkiSafetyHtml, 1000);
assertOnlyNone(cnkiSafety.dom.window.document, "cnki-safe-generic");

const wanfangSafetyHtml = '<div class="normal-list-item" id="wanfang-safe-generic"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/safe">Generic paper</a></div><div class="source"><a>Analysis of results</a></div></div>';
const wanfangSafety = await run("https://s.wanfangdata.com.cn/paper?q=safe", wanfangSafetyHtml, 1000);
assertOnlyNone(wanfangSafety.dom.window.document, "wanfang-safe-generic");

const aminerSafetyHtml = [
  '<div class="paper-item" id="aminer-safe-tpami"><a class="title-link" href="/pub/tpami"><span class="paper-title">TPAMI paper</span></a><div class="conf-info-zone"><div class="venue-link"><a>IEEE Transactions on Pattern Analysis and Machine...</a></div></div></div>',
  '<div class="paper-item" id="aminer-safe-generic"><a class="title-link" href="/pub/generic"><span class="paper-title">Generic paper</span></a><div class="conf-info-zone"><div class="venue-link"><a>Analysis of results</a></div></div></div>'
].join("");
const aminerSafety = await run("https://www.aminer.cn/search/pub?q=safe", aminerSafetyHtml, 1000);
assert.ok(safetyLabels(aminerSafety.dom.window.document, "aminer-safe-tpami").includes("CCF A"));
assertOnlyNone(aminerSafety.dom.window.document, "aminer-safe-generic");

const baiduSafetyHtml = [
  '<div class="paper-wrap result" id="baidu-safe-tpami"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=tpami">TPAMI paper</a></h3><div class="paper-info"><span>Author</span> - <span>&#12298;IEEE Transactions on Pattern Analysis and Machine...&#12299;</span> - <span>2025</span></div></div>',
  '<div class="paper-wrap result" id="baidu-safe-generic"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=generic">Generic paper</a></h3><div class="paper-info"><span>Author</span> - <span>&#12298;Analysis of results&#12299;</span> - <span>2025</span></div></div>'
].join("");
const baiduSafety = await run("https://xueshu.baidu.com/ndscholar/browse/search?wd=safe", baiduSafetyHtml, 1000);
assert.ok(safetyLabels(baiduSafety.dom.window.document, "baidu-safe-tpami").includes("CCF A"));
assertOnlyNone(baiduSafety.dom.window.document, "baidu-safe-generic");

const publisherSafetyHtml = [
  '<div class="result-item" id="publisher-safe-tpami"><h2><a href="/science/article/pii/tpami">TPAMI paper</a></h2><div class="publication-title">IEEE Transactions on Pattern Analysis and Machine...</div></div>',
  '<div class="result-item" id="publisher-safe-generic"><h2><a href="/science/article/pii/generic">Generic paper</a></h2><div class="publication-title">Analysis of results</div></div>'
].join("");
const publisherSafety = await run("https://www.sciencedirect.com/search?qs=safe", "<main>" + publisherSafetyHtml + "</main>", 1000);
assert.ok(safetyLabels(publisherSafety.dom.window.document, "publisher-safe-tpami").includes("CCF A"));
assertOnlyNone(publisherSafety.dom.window.document, "publisher-safe-generic");
const openAlexHtml = '<article data-testid="work-result"><a href="/works/W123">An OpenAlex paper</a><span data-testid="source">Nature</span></article>';
const openAlex = await run("https://openalex.org/works?search=ai", openAlexHtml);
const openAlexDoc = openAlex.dom.window.document;
assert.ok(openAlexDoc.querySelector('a[href^="/works/"] + .rank-assistant-row'));
assert.ok([...openAlexDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "中科院 1区 Top"));
const cnkiHtml = '<table class="result-table-list"><tbody><tr id="cnki-paper"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=1">知网论文</a></td><td class="source"><a>中国社会科学</a></td></tr><tr id="cnki-merged-paper"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=2">材料论文</a></td><td class="source"><a>金属学报</a></td></tr></tbody></table>';
const cnki = await run("https://kns.cnki.net/kns8s/defaultresult/index", cnkiHtml, 1000);
const cnkiDoc = cnki.dom.window.document;
assert.ok(cnkiDoc.querySelector("td.name a + .rank-assistant-row"), "CNKI badges must sit after the paper title");
assert.ok([...cnkiDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "CSSCI 来源"));
assert.ok(cnkiDoc.querySelector("td.source a + .rank-assistant-venue-detail"));
const mergedChineseLabels = [...cnkiDoc.querySelectorAll("#cnki-merged-paper .rank-assistant-badge")].map((node) => node.textContent);
assert.ok(mergedChineseLabels.includes("北大核心"), JSON.stringify(mergedChineseLabels));
assert.ok(mergedChineseLabels.includes("EI"), JSON.stringify(mergedChineseLabels));

const wanfangHtml = '<div class="normal-list-item" id="wanfang-paper"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/example">万方论文</a></div><div class="source"><a>中国社会科学</a></div></div>';
const wanfang = await run("https://s.wanfangdata.com.cn/paper?q=test", wanfangHtml, 1000);
const wanfangDoc = wanfang.dom.window.document;
assert.ok(wanfangDoc.querySelector(".title a + .rank-assistant-row"), "Wanfang badges must sit after the paper title");
assert.ok([...wanfangDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "北大核心"));
assert.ok(wanfangDoc.querySelector(".source a + .rank-assistant-venue-detail"));
const aminerHtml = '<div class="paper-item" id="aminer-paper"><a class="title-link" href="/pub/example"><span class="paper-title">An AMiner paper</span></a><div class="conf-info-zone"><div class="venue-link"><a href="/open/journal/detail/example">IEEE Access&#65288;2021&#65289;</a></div></div></div>';
const aminer = await run("https://www.aminer.cn/search/pub?q=resnet", aminerHtml, 900);
const aminerDoc = aminer.dom.window.document;
assert.ok(aminerDoc.querySelector(".title-link + .rank-assistant-row"), "AMiner badges must sit after the paper title");
assert.ok([...aminerDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "SCI/SCIE"));
assert.ok(aminerDoc.querySelector(".conf-info-zone .rank-assistant-venue-detail"), aminerDoc.querySelector("#aminer-paper")?.outerHTML);

const baiduScholarHtml = '<div class="paper-wrap result" id="baidu-paper"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=example">A Baidu Scholar paper</a></h3><div class="paper-info"><span class="paper-type">journal</span><span>Author</span> - <span><span>&#12298;Nature&#12299;</span></span> - <span>Cited 10</span> - <span>2025</span></div></div>';
const baiduScholar = await run("https://xueshu.baidu.com/ndscholar/browse/search?wd=attention", baiduScholarHtml, 900);
const baiduScholarDoc = baiduScholar.dom.window.document;
assert.ok(baiduScholarDoc.querySelector(".paper-title a + .rank-assistant-row"), "Baidu Scholar badges must sit after the paper title");
assert.ok([...baiduScholarDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "JCR Q1"));
assert.ok(baiduScholarDoc.querySelector(".paper-info + .rank-assistant-venue-detail"));

const researchGateHtml = '<head><meta name="citation_title" content="ResearchGate article"><meta name="citation_journal_title" content="Nature"></head><body><main><article id="researchgate-article"><h1>ResearchGate article</h1></article></main></body>';
const researchGate = await run("https://www.researchgate.net/publication/123_example", researchGateHtml, 900);
const researchGateDoc = researchGate.dom.window.document;
assert.ok(researchGateDoc.querySelector("#researchgate-article h1 + .rank-assistant-row"), "ResearchGate public article metadata must be supported when exposed");
assert.ok([...researchGateDoc.querySelectorAll(".rank-assistant-badge")].some((node) => node.textContent === "JCR Q1"));

const recoveredHtml = '<div id="completesearch-publs"><div class="body"><p>found 2405 matches</p><ul class="error"><li>service temporarily not available</li></ul></div></div>';
const recovered = await run("https://dblp.org/search?q=long+tail", recoveredHtml, 2200);
assert.equal(recovered.apiFetches, 1);
assert.equal(recovered.dom.window.document.querySelectorAll("li.entry").length, 1);
assert.ok(recovered.dom.window.document.querySelector(".rank-assistant-fallback-venue + .rank-assistant-venue-detail"));
assert.match(recovered.dom.window.document.querySelector(".rank-assistant-fallback-notice").textContent, /DBLP 主站/);
assert.equal(recovered.directApiFetches, 1);
assert.equal(recovered.backgroundRecoveryMessages, 0);

const mirrorRecovered = await run("https://dblp.org/search?q=mirror", recoveredHtml, 2200, {}, false, { directApiFailure: true });
assert.equal(mirrorRecovered.apiFetches, 2);
assert.equal(mirrorRecovered.directApiFetches, 1);
assert.equal(mirrorRecovered.backgroundRecoveryMessages, 1);
assert.equal(mirrorRecovered.dom.window.document.querySelectorAll("li.entry").length, 1);
assert.match(mirrorRecovered.dom.window.document.querySelector(".rank-assistant-fallback-notice").textContent, /Dagstuhl/);

const failedRecovery = await run("https://dblp.org/search?q=failed", recoveredHtml, 900, {}, false, {
  directApiFailure: true,
  backgroundRecoveryFailure: true
});
assert.equal(failedRecovery.dom.window.document.documentElement.dataset.paperRankStatus, "api-unavailable");
assert.match(failedRecovery.dom.window.document.querySelector(".rank-assistant-fallback-error").textContent, /未能从 DBLP 官方 API 恢复/);
assert.ok(failedRecovery.dom.window.document.querySelector(".rank-assistant-fallback-retry"));
assert.equal(failedRecovery.dom.window.document.querySelector("ul.error"), null);

const stalledHtml = '<div id="completesearch-publs"><div class="body"><p>found 2405 matches</p><ul class="waiting"><li>loading...</li></ul></div></div>';
const stalled = await run("https://dblp.org/search?q=stalled", stalledHtml, 1400);
assert.equal(stalled.apiFetches, 1, "A DBLP page stuck on loading must recover after the result timeout");
assert.equal(stalled.dom.window.document.querySelectorAll("li.entry").length, 1);
assert.equal(stalled.dom.window.document.documentElement.dataset.paperRankStatus, "ready");

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
const chromeManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.firefox.json"), "utf8"));
const manifestMatches = chromeManifest.content_scripts.flatMap((entry) => entry.matches || []);
assert.deepEqual(
  firefoxManifest.content_scripts.flatMap((entry) => entry.matches || []),
  manifestMatches,
  "Chrome and Firefox must declare the same site coverage"
);
assert.equal(new Set(manifestMatches).size, manifestMatches.length, "Manifest site patterns must be unique");

function canonicalManifestUrl(pattern) {
  return pattern.replace("https://*.", "https://matrix.").replace(/\/\*$/, "/search?q=manifest-matrix");
}

function manifestFixture(url) {
  const host = new URL(url).hostname;
  if (/(^|\.)dblp\.(org|uni-trier\.de|dagstuhl\.de)$/.test(host)) {
    return '<section id="completesearch-publs"><ul class="publ-list"><li class="entry article" id="matrix-known"><cite class="data"><span class="title" itemprop="name">Known paper.</span><span itemprop="isPartOf"><a href="/db/journals/access/"><span itemprop="name">IEEE Access</span></a></span></cite></li></ul></section>';
  }
  if (host === "scholar.google.com" || host === "scholar.googleusercontent.com") {
    return '<div class="gs_r gs_or gs_scl" id="matrix-known"><div class="gs_ri"><h3 class="gs_rt"><a>Known paper</a></h3><div class="gs_a">A Author - Nature, 2025 - nature.com</div></div></div><div class="gs_r gs_or gs_scl" id="matrix-unknown"><div class="gs_ri"><h3 class="gs_rt"><a>Unknown paper</a></h3><div class="gs_a">A Author - Analysis of results, 2025 - example.org</div></div></div>';
  }
  if (host === "arxiv.org") {
    return '<ol><li class="arxiv-result" id="matrix-known"><p class="title">Known paper</p><p class="comments">Comments: Accepted at AAAI Conference on Artificial Intelligence 2026</p></li><li class="arxiv-result" id="matrix-unknown"><p class="title">Unknown paper</p><p class="comments">Comments: Analysis of results</p></li></ol>';
  }
  if (host === "pubmed.ncbi.nlm.nih.gov") {
    return '<main><article class="full-docsum" id="matrix-known"><a class="docsum-title">Known paper</a><span class="docsum-journal-citation">IEEE Access. 2025;13:1.</span></article><article class="full-docsum" id="matrix-unknown"><a class="docsum-title">Unknown paper</a><span class="docsum-journal-citation">Analysis of results. 2025;1:1.</span></article></main>';
  }
  if (host === "www.semanticscholar.org" || host === "semanticscholar.org") {
    return '<div data-testid="paper-row" id="matrix-known"><a href="/paper/known">Known paper</a><span class="cl-paper-venue">Nature</span></div><div data-testid="paper-row" id="matrix-unknown"><a href="/paper/unknown">Unknown paper</a><span class="cl-paper-venue">Analysis of results</span></div>';
  }
  if (host === "openalex.org" || host === "www.openalex.org") {
    return '<article data-testid="work-result" id="matrix-known"><a href="/works/W1">Known paper</a><span data-testid="source">Nature</span></article><article data-testid="work-result" id="matrix-unknown"><a href="/works/W2">Unknown paper</a><span data-testid="source">Analysis of results</span></article>';
  }
  if (host === "kns.cnki.net" || host === "kns8.cnki.net") {
    return '<table class="result-table-list"><tbody><tr id="matrix-known"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=known">Known paper</a></td><td class="source"><a>IEEE Access</a></td></tr><tr id="matrix-unknown"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=unknown">Unknown paper</a></td><td class="source"><a>Analysis of results</a></td></tr></tbody></table>';
  }
  if (host === "s.wanfangdata.com.cn") {
    return '<div class="normal-list-item" id="matrix-known"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/known">Known paper</a></div><div class="source"><a>IEEE Access</a></div></div><div class="normal-list-item" id="matrix-unknown"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/unknown">Unknown paper</a></div><div class="source"><a>Analysis of results</a></div></div>';
  }
  if (host === "www.aminer.cn" || host === "aminer.cn") {
    return '<div class="paper-item" id="matrix-known"><a class="title-link" href="/pub/known"><span class="paper-title">Known paper</span></a><div class="conf-info-zone"><div class="venue-link"><a>IEEE Access</a></div></div></div><div class="paper-item" id="matrix-unknown"><a class="title-link" href="/pub/unknown"><span class="paper-title">Unknown paper</span></a><div class="conf-info-zone"><div class="venue-link"><a>Analysis of results</a></div></div></div>';
  }
  if (host === "xueshu.baidu.com") {
    return '<div class="paper-wrap result" id="matrix-known"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=known">Known paper</a></h3><div class="paper-info"><span>Author</span> - <span><span>&#12298;Nature&#12299;</span></span> - <span>2025</span></div></div><div class="paper-wrap result" id="matrix-unknown"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=unknown">Unknown paper</a></h3><div class="paper-info"><span>Author</span> - <span><span>&#12298;Analysis of results&#12299;</span></span> - <span>2025</span></div></div>';
  }
  return '<main><div class="result-item" id="matrix-known"><h2><a href="/article/known">Known paper</a></h2><div class="publication-title">Nature</div></div><div class="result-item" id="matrix-unknown"><h2><a href="/article/unknown">Unknown paper</a></h2><div class="publication-title">Analysis of results</div></div></main>';
}

const manifestMatrix = [];
for (const pattern of manifestMatches) {
  const url = canonicalManifestUrl(pattern);
  const page = await run(url, manifestFixture(url), 220);
  const known = [...page.dom.window.document.querySelectorAll("#matrix-known .rank-assistant-badge")].map((node) => node.textContent);
  assert.ok(known.some((label) => label !== "CCF None"), pattern + " did not recognize a known venue");
  if (!/(^|\.)dblp\.(org|uni-trier\.de|dagstuhl\.de)$/.test(new URL(url).hostname)) {
    const unknown = [...page.dom.window.document.querySelectorAll("#matrix-unknown .rank-assistant-badge")].map((node) => node.textContent);
    assert.deepEqual(unknown, ["CCF None"], pattern + " guessed a generic non-venue phrase");
  }
  manifestMatrix.push(pattern);
}

const publisherPatterns = manifestMatches.filter((pattern) => {
  const host = new URL(canonicalManifestUrl(pattern)).hostname;
  return !/(^|\.)dblp\.(org|uni-trier\.de|dagstuhl\.de)$/.test(host)
    && !["scholar.google.com", "scholar.googleusercontent.com", "arxiv.org", "pubmed.ncbi.nlm.nih.gov", "www.semanticscholar.org", "semanticscholar.org", "openalex.org", "www.openalex.org", "kns.cnki.net", "kns8.cnki.net", "s.wanfangdata.com.cn", "www.aminer.cn", "aminer.cn", "xueshu.baidu.com"].includes(host);
});
for (const pattern of publisherPatterns) {
  const url = canonicalManifestUrl(pattern).replace("/search?q=manifest-matrix", "/article/manifest-matrix");
  const detailHtml = '<head><meta name="citation_title" content="Known article"><meta name="citation_journal_title" content="Nature"></head><body><main><article id="matrix-detail"><h1>Known article</h1></article></main></body>';
  const page = await run(url, detailHtml, 220);
  const labels = [...page.dom.window.document.querySelectorAll("#matrix-detail .rank-assistant-badge")].map((node) => node.textContent);
  assert.ok(labels.includes("JCR Q1"), pattern + " did not recognize article-detail metadata");
}
const diverseVenueCases = [
  { venue: "IEEE Transactions on Pattern Analysis and Machine Intelligence", expected: ["CCF A", "\u4e2d\u79d1\u9662 1\u533a Top", "JCR Q1", "SCI/SCIE", "EI"], kind: "journal" },
  { venue: "Pattern Recognition", expected: ["CCF B", "JCR Q1", "SCI/SCIE"], kind: "journal" },
  { venue: "Expert Systems with Applications", expected: ["CCF C", "JCR Q1", "SCI/SCIE", "EI"], kind: "journal" },
  { venue: "Journal of the ACM", expected: ["CCF A", "\u4e2d\u79d1\u9662 2\u533a", "JCR Q2", "SCI/SCIE", "EI"], kind: "journal" },
  { venue: "2D Materials", expected: ["\u4e2d\u79d1\u9662 3\u533a", "JCR Q2", "SCI/SCIE", "EI"], kind: "journal" },
  { venue: "3 Biotech", expected: ["\u4e2d\u79d1\u9662 4\u533a", "JCR Q3", "SCI/SCIE"], kind: "journal" },
  { venue: "20 Et 21-Revue D Histoire", expected: ["\u4e2d\u79d1\u9662 4\u533a", "JCR Q4", "AHCI"], kind: "journal" },
  { venue: "Academy of Management Annals", expected: ["\u4e2d\u79d1\u9662 1\u533a Top", "JCR Q1", "SSCI"], kind: "journal" },
  { venue: "IEEE/CVF Computer Vision and Pattern Recognition Conference", expected: ["CCF A"], kind: "conference" },
  { venue: "International Joint Conference on Artificial Intelligence", expected: ["CCF B"], kind: "conference" },
  { venue: "International Conference on Pattern Recognition", expected: ["CCF C"], kind: "conference" },
  { venue: "NeurIPS", expected: ["CCF A", "\u65b0\u9510 1\u533a Top"], kind: "conference" },
  { venue: "International Conference on Machine Learning", expected: ["CCF A", "\u65b0\u9510 1\u533a Top"], kind: "conference" },
  { venue: "International ACM SIGIR Conference on Research and Development in Information Retrieval", expected: ["CCF A"], kind: "conference" },
  { venue: "International Conference on Software Engineering", expected: ["CCF A", "\u65b0\u9510 1\u533a Top"], kind: "conference" },
  { venue: "\u4e2d\u56fd\u793e\u4f1a\u79d1\u5b66", expected: ["CSSCI \u6765\u6e90", "\u5317\u5927\u6838\u5fc3"], kind: "chinese" },
  { venue: "\u91d1\u5c5e\u5b66\u62a5", expected: ["\u5317\u5927\u6838\u5fc3", "EI"], kind: "chinese" },
  { venue: "\u7cfb\u7edf\u5de5\u7a0b\u7406\u8bba\u4e0e\u5b9e\u8df5", expected: ["CSSCI \u6765\u6e90", "\u5317\u5927\u6838\u5fc3", "EI"], kind: "chinese" }
];
for (let index = 0; index < diverseVenueCases.length; index += 1) {
  const testCase = diverseVenueCases[index];
  let url;
  let html;
  if (testCase.kind === "journal") {
    url = canonicalManifestUrl(publisherPatterns[index % publisherPatterns.length]);
    html = '<main><div class="result-item" id="venue-diversity"><h2><a href="/article/diversity">Diverse journal paper</a></h2><div class="publication-title">' + testCase.venue + '</div></div></main>';
  } else if (testCase.kind === "conference") {
    url = "https://www.semanticscholar.org/search?q=venue-diversity-" + index;
    html = '<div data-testid="paper-row" id="venue-diversity"><a href="/paper/diversity-' + index + '">Diverse conference paper</a><span class="cl-paper-venue">' + testCase.venue + '</span></div>';
  } else {
    url = "https://scholar.google.com/scholar?q=venue-diversity-" + index;
    html = '<div class="gs_r gs_or gs_scl" id="venue-diversity"><div class="gs_ri"><h3 class="gs_rt"><a>Diverse Chinese journal paper</a></h3><div class="gs_a">A Author - ' + testCase.venue + ', 2025 - example.cn</div></div></div>';
  }
  const page = await run(url, html, 260);
  const labels = [...page.dom.window.document.querySelectorAll("#venue-diversity .rank-assistant-badge")].map((node) => node.textContent);
  for (const expected of testCase.expected) {
    assert.ok(labels.includes(expected), testCase.venue + " missing " + expected + ": " + JSON.stringify(labels));
  }
}
console.log(JSON.stringify({
  dblp: { labels: knownLabels, controls: doc.querySelectorAll(".rank-assistant-badge, .rank-assistant-venue-detail").length, tooltips: doc.querySelectorAll("#rank-assistant-shared-tooltip").length },
  scholar: { labels: scholarLabels, catalogFetches: scholar.catalogFetches },
  recovered: { apiFetches: recovered.apiFetches, entries: recovered.dom.window.document.querySelectorAll("li.entry").length },
  stress: { entries: 100, catalogFetches: stress.catalogFetches, tooltips: stressDoc.querySelectorAll("#rank-assistant-shared-tooltip").length, elapsedMs: stressMs },
  manifestMatrix: { patterns: manifestMatrix.length, publisherSearchPages: publisherPatterns.length, publisherDetailPages: publisherPatterns.length },
  venueDiversity: { cases: diverseVenueCases.length, journals: diverseVenueCases.filter((item) => item.kind === "journal").length, conferences: diverseVenueCases.filter((item) => item.kind === "conference").length, chineseJournals: diverseVenueCases.filter((item) => item.kind === "chinese").length }
}, null, 2));
