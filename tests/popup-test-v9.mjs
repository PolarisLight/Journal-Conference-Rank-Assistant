import assert from "node:assert/strict";
import fs from "node:fs";
const { JSDOM } = await import("file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js");

const html = fs.readFileSync("extension/popup/popup.html", "utf8").replace('<script src="popup.js"></script>', "");
const script = fs.readFileSync("extension/popup/popup.js", "utf8");
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
        dataVersions: { cas: "2025", jcr: "2025", ccf: "2026" }
      });
    }
  }
};
dom.window.fetch = async (value) => String(value).includes("build-info")
  ? { json: async () => ({ records: 23413, cas: "2025", jcr: "2025", ccf: "2026" }) }
  : { json: async () => ({ news: [] }) };
dom.window.eval(script);
await new Promise((resolve) => setTimeout(resolve, 0));

const select = dom.window.document.getElementById("colorTheme");
assert.equal(select.value, "light");
select.value = "dark";
select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
assert.equal(saved.colorTheme, "dark");

dom.window.document.getElementById("installUpdates").click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(messages.includes("rank-assistant-install-updates"));
assert.match(dom.window.document.getElementById("installUpdates").textContent, /已替换/);
console.log(JSON.stringify({ theme: saved.colorTheme, installMessage: true }));
