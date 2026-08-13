import assert from "node:assert/strict";
import fs from "node:fs";
const { JSDOM } = await import("file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js");

const html = fs.readFileSync("extension/popup/popup.html", "utf8")
  .replace('<script src="../lib/i18n.js"></script>', "")
  .replace('<script src="popup.js"></script>', "");
const i18n = fs.readFileSync("extension/lib/i18n.js", "utf8");
const script = fs.readFileSync("extension/popup/popup.js", "utf8");
const updateFeed = JSON.parse(fs.readFileSync("extension/data/update-feed.json", "utf8"));
assert.equal(updateFeed.news[0].title, "新增新锐与当前预警");
assert.doesNotMatch(JSON.stringify(updateFeed), /\?{2,}/, "Update news must not contain encoding placeholders");
const dom = new JSDOM(html, { url: "moz-extension://test/extension/popup/popup.html", runScripts: "outside-only" });
const saved = {};
const messages = [];
dom.window.chrome = {
  storage: { local: {
    get(defaults, callback) { callback({ ...defaults, colorTheme: "light" }); },
    set(values, callback) { Object.assign(saved, values); callback?.(); }
  } },
  runtime: {
    lastError: null,
    getURL: (path) => path,
    sendMessage(message, callback) {
      messages.push(message.type);
      callback({
        state: "current", checkedAt: "2026-07-12T12:00:00Z", installedAt: "2026-07-12T12:00:00Z",
        dataVersions: { cas: "2025", jcr: "2025", ccf: "2026", xinrui: "2026", warning: "2025" }
      });
    }
  }
};
dom.window.fetch = async (value) => {
  const address = String(value);
  if (address.includes("_locales/")) {
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(address, "utf8")) };
  }
  return address.includes("build-info")
    ? { ok: true, json: async () => ({ records: 35093, cas: "2025", jcr: "2025", ccf: "2026", cssci: "2025-2026", pkuCore: "2023", ei: "2026-07-09", xinrui: "2026", warning: "2025" }) }
    : { ok: true, json: async () => ({ news: [] }) };
};
dom.window.eval(i18n);
dom.window.eval(script);
await new Promise((resolve) => setTimeout(resolve, 0));

const select = dom.window.document.getElementById("colorTheme");
assert.equal(select.value, "light");
select.value = "dark";
select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(saved.colorTheme, "dark");

const palette = dom.window.document.getElementById("colorPalette");
assert.equal(palette.value, "vivid");
palette.value = "soft";
palette.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(saved.colorPalette, "soft");
assert.equal(dom.window.document.getElementById("palettePreview").dataset.palette, "soft");

dom.window.document.getElementById("installUpdates").click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(messages.includes("rank-assistant-install-updates"));
assert.equal(dom.window.document.getElementById("cssciVersion").textContent, "2025-2026");
assert.equal(dom.window.document.getElementById("pkuVersion").textContent, "2023");
assert.equal(dom.window.document.getElementById("eiVersion").textContent, "2026-07-09");
assert.equal(dom.window.document.getElementById("xinruiVersion").textContent, "2026");
assert.equal(dom.window.document.getElementById("warningVersion").textContent, "2025");
assert.equal(dom.window.document.getElementById("showXinrui").checked, true);
assert.equal(dom.window.document.getElementById("showWarning").checked, true);
assert.equal(dom.window.document.getElementById("showUtd24").checked, true);
assert.equal(dom.window.document.getElementById("showFt50").checked, true);
assert.equal(dom.window.document.getElementById("showAbs").checked, true);
assert.equal(dom.window.document.getElementById("presetState").textContent, "全部");
assert.equal(dom.window.document.querySelector('[data-preset="all"]').getAttribute("aria-pressed"), "true");

dom.window.document.querySelector('[data-preset="computer"]').click();
assert.equal(dom.window.document.getElementById("showCcf").checked, true);
assert.equal(dom.window.document.getElementById("showCas").checked, true);
assert.equal(dom.window.document.getElementById("showJcr").checked, true);
assert.equal(dom.window.document.getElementById("showEi").checked, true);
assert.equal(dom.window.document.getElementById("showCssci").checked, false);
assert.equal(dom.window.document.getElementById("showUtd24").checked, false);
assert.equal(saved.showCcf, true);
assert.equal(saved.showCssci, false);
assert.equal(dom.window.document.getElementById("presetState").textContent, "计算机");

dom.window.document.querySelector('[data-preset="science"]').click();
assert.equal(dom.window.document.getElementById("showCas").checked, true);
assert.equal(dom.window.document.getElementById("showJcr").checked, true);
assert.equal(dom.window.document.getElementById("showCcf").checked, false);
assert.equal(dom.window.document.getElementById("showCssci").checked, false);
assert.equal(dom.window.document.getElementById("presetState").textContent, "理工医学");

dom.window.document.querySelector('[data-preset="social"]').click();
assert.equal(dom.window.document.getElementById("showCas").checked, false);
assert.equal(dom.window.document.getElementById("showXinrui").checked, false);
assert.equal(dom.window.document.getElementById("showWarning").checked, false);
assert.equal(dom.window.document.getElementById("showTop").checked, false);
assert.equal(dom.window.document.getElementById("showJcr").checked, true);
assert.equal(dom.window.document.getElementById("showIf").checked, true);
assert.equal(dom.window.document.getElementById("showWos").checked, true);
assert.equal(dom.window.document.getElementById("showCssci").checked, true);
assert.equal(dom.window.document.getElementById("showPku").checked, true);
assert.equal(dom.window.document.getElementById("showUtd24").checked, true);
assert.equal(dom.window.document.getElementById("showFt50").checked, true);
assert.equal(dom.window.document.getElementById("showAbs").checked, true);
assert.equal(dom.window.document.getElementById("showCcf").checked, false);
assert.equal(dom.window.document.getElementById("showEi").checked, false);
assert.equal(dom.window.document.getElementById("presetState").textContent, "社科商科");

dom.window.document.querySelector('[data-preset="chinese"]').click();
assert.equal(dom.window.document.getElementById("showCssci").checked, true);
assert.equal(dom.window.document.getElementById("showPku").checked, true);
assert.equal(dom.window.document.getElementById("showEi").checked, true);
assert.equal(dom.window.document.getElementById("showUtd24").checked, false);
assert.equal(dom.window.document.getElementById("showAbs").checked, false);
assert.equal(dom.window.document.getElementById("presetState").textContent, "中文期刊");

dom.window.document.querySelector('[data-preset="all"]').click();
for (const id of ["showCcf", "showCas", "showXinrui", "showWarning", "showJcr", "showIf", "showWos", "showTop", "showCssci", "showPku", "showEi", "showUtd24", "showFt50", "showAbs"]) {
  assert.equal(dom.window.document.getElementById(id).checked, true, `${id} should be enabled by the all preset`);
}
assert.equal(dom.window.document.getElementById("presetState").textContent, "全部");

dom.window.document.querySelector('[data-preset="computer"]').click();

const cssciToggle = dom.window.document.getElementById("showCssci");
cssciToggle.checked = true;
cssciToggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(saved.showCssci, true);
assert.equal(dom.window.document.getElementById("presetState").textContent, "自定义");
assert.match(dom.window.document.getElementById("installUpdates").textContent, /已替换/);
console.log(JSON.stringify({ theme: saved.colorTheme, palette: saved.colorPalette, installMessage: true }));
assert.equal(dom.window.document.querySelector(".filter-card"), null);

const language = dom.window.document.getElementById("language");
assert.equal(language.value, "zh-CN");
language.value = "en";
language.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(saved.language, "en");
assert.equal(dom.window.document.querySelector("h1").textContent, "Journal & Conference Rank Assistant");
assert.equal(dom.window.document.querySelector('[data-preset="computer"]').textContent, "Computer science");
assert.equal(dom.window.document.getElementById("presetState").textContent, "Custom");
assert.equal(dom.window.document.getElementById("statusTitle").textContent, "Current data matches the latest baseline");
assert.equal(dom.window.RankAssistantI18n.normalize("fr"), "zh-CN", "Unsupported languages must fall back to Chinese");
dom.window.close();
