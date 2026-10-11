import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
const { JSDOM } = await import("file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js");

const root = process.cwd();
const artifactDir = path.join(root, "artifacts/custom-indexes-20261011");
fs.mkdirSync(artifactDir, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const source = Object.fromEntries(["normalizer", "i18n", "custom-indexes"].map(name => [name, read(`extension/lib/${name}.js`)]));
const managerHtml = read("extension/custom-indexes/manager.html");
const managerScript = read("extension/custom-indexes/manager.js");
const managerCss = read("extension/custom-indexes/manager.css");
const results = [], pages = new Set();
const clone = value => structuredClone(value);
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const waitFor = async (predicate, message) => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate(), message); };
const encodeCsv = rows => "\uFEFF" + rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
const validCsv = encodeCsv([["名称", "等级", "ISSN", "别名"], ["Management Science", "我的A", "0025-1909", "管理科学;MS"]]);
const exampleIndex = (id, name = `索引 ${id}`) => ({ id, name, enabled: true, updatedAt: "2026-10-11T08:00:00Z", entries: [{ title: `Venue ${id}`, aliases: [], issns: [], level: "收录" }] });
function file(name, text, deferred) {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.byteLength, arrayBuffer: async () => { if (deferred) await deferred; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
}

async function harness(initial = {}, options = {}) {
  const dom = new JSDOM(managerHtml, { url: "https://extension.test/extension/custom-indexes/manager.html", runScripts: "outside-only", pretendToBeVisual: true });
  pages.add(dom);
  const { window } = dom;
  const shared = options.shared || { stored: clone({ customIndexes: [], language: "zh-CN", unrelated: { keep: true }, ...initial }), listeners: [], lockQueue: Promise.resolve() };
  const stored = shared.stored, listeners = shared.listeners, pageListeners = [], writes = [], downloads = [], externalRequests = [];
  const delay = callback => options.storageDelay ? setTimeout(callback, options.storageDelay) : callback();
  let getFailures = options.getFailures || 0, setFailures = 0;
  Object.assign(window, { TextDecoder, TextEncoder, structuredClone, Blob });
  window.chrome = {
    storage: {
      local: {
        get(defaults, callback) { delay(() => {
          if (getFailures > 0) { getFailures--; window.chrome.runtime.lastError = { message: "读取存储失败" }; callback(); window.chrome.runtime.lastError = null; return; }
          callback(clone({ ...defaults, ...stored }));
        });
        },
        set(values, callback) { delay(() => {
          if (setFailures > 0) { setFailures--; window.chrome.runtime.lastError = { message: "写入存储失败" }; callback?.(); window.chrome.runtime.lastError = null; return; }
          const changes = {};
          for (const [key, value] of Object.entries(values)) changes[key] = { oldValue: clone(stored[key]), newValue: clone(value) };
          Object.assign(stored, clone(values)); writes.push(clone(values)); callback?.();
          listeners.forEach(listener => listener(changes, "local"));
        });
        }
      },
      onChanged: { addListener(listener) { listeners.push(listener); pageListeners.push(listener); } }
    },
    runtime: { lastError: null, getURL: value => value }
  };
  if (!options.noLocks) Object.defineProperty(window.navigator, "locks", { value: { request(name, callback) {
    assert.equal(name, "paper-rank-custom-indexes");
    const run = shared.lockQueue.then(callback); shared.lockQueue = run.catch(() => {}); return run;
  } } });
  window.fetch = async value => {
    const address = String(value);
    if (address.startsWith("_locales/")) return { ok: true, json: async () => JSON.parse(read(address)) };
    externalRequests.push(address); throw new Error("Unexpected network request: " + address);
  };
  const blobs = new Map();
  window.URL.createObjectURL = blob => { const url = "blob:test-" + blobs.size; blobs.set(url, blob); return url; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: blobs.get(this.href) }); };
  for (const script of Object.values(source)) window.eval(script);
  window.eval(managerScript);
  if (options.storageDelay) await new Promise(resolve => setTimeout(resolve, options.storageDelay + 5));
  await tick();
  const $ = id => window.document.getElementById(id);
  async function choose(text, name = "我的目录.csv", wait = true, deferred) {
    Object.defineProperty($("csvFile"), "files", { configurable: true, value: [file(name, text, deferred)] });
    $("csvFile").dispatchEvent(new window.Event("change", { bubbles: true }));
    if (wait) await tick();
  }
  function external(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) changes[key] = { oldValue: clone(stored[key]), newValue: clone(value) };
    Object.assign(stored, clone(values)); listeners.forEach(listener => listener(changes, "local"));
  }
  async function change(id, value) {
    $(id).value = value; $(id).dispatchEvent(new window.Event(id === "indexName" ? "input" : "change", { bubbles: true }));
    if (id === "indexName") await new Promise(resolve => setTimeout(resolve, 220));
    await tick();
  }
  return { dom, window, $, stored, writes, downloads, externalRequests, choose, change, external,
    failGet() { getFailures++; }, failSet() { setFailures++; },
    async click(id) { $(id).click(); await tick(); },
    close() { assert.equal(externalRequests.length, 0, "manager must make no external network requests"); for (const listener of pageListeners) listeners.splice(listeners.indexOf(listener), 1); dom.window.close(); pages.delete(dom); }
  };
}
async function test(name, callback) {
  try { await callback(); results.push({ name, passed: true }); console.log("PASS " + name); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.error("FAIL " + name + "\n" + error.stack); }
}
async function withManager(callback, initial, options) {
  const h = await harness(initial, options); try { await callback(h); } finally { h.close(); }
}
function snapshot(h, name) {
  const copy = h.window.document.documentElement.cloneNode(true);
  copy.querySelectorAll("script").forEach(node => node.remove());
  copy.querySelectorAll('link[rel="stylesheet"]').forEach(node => node.remove());
  const style = h.window.document.createElement("style"); style.textContent = managerCss; copy.querySelector("head").append(style);
  const originalInputs = [...h.window.document.querySelectorAll("input")];
  for (const [position, input] of [...copy.querySelectorAll("input")].entries()) {
    const original = originalInputs[position];
    if (!original) continue;
    if (input.type === "checkbox") input.toggleAttribute("checked", original.checked);
    else if (input.type !== "file") input.setAttribute("value", original.value);
  }
  for (const select of copy.querySelectorAll("select")) for (const option of select.options) option.toggleAttribute("selected", option.value === h.$(select.id).value);
  fs.writeFileSync(path.join(artifactDir, name), "<!doctype html>\n" + copy.outerHTML, "utf8");
}

await test("empty state and independent import interface", () => withManager(async h => {
  assert.match(h.$("indexList").textContent, /还没有自定义索引/);
  assert.equal(h.$("importIndex").disabled, true);
  assert.equal(h.$("importTarget"), null);
  assert.match(h.window.document.body.textContent, /模板中的等级仅作填写示例/);
}));

await test("UTF-8 BOM template, illustrative levels and semicolon schema", () => withManager(async h => {
  await h.click("downloadTemplate");
  assert.equal(h.downloads[0].name, "custom-index-template.csv");
  const bytes = new Uint8Array(await h.downloads[0].blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const parsed = await h.window.RankAssistantCustomIndexes.parseFile(file("template.csv", new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)));
  assert.deepEqual(clone(parsed.headers), ["名称", "等级", "ISSN", "别名"]);
  assert.deepEqual(clone(parsed.rows), [["Management Science", "示例A", "0025-1909", "管理科学"], ["International Conference on Machine Learning", "示例B", "", "ICML"]]);
}));

await test("preview first ten of twelve rows with no write before import", () => withManager(async h => {
  await h.choose(encodeCsv([["名称", "等级", "ISSN", "别名"], ...Array.from({ length: 12 }, (_, i) => [`Test Journal ${i}`, "", "", `TJ${i}`])]));
  assert.equal(h.$("preview").hidden, false);
  assert.equal(h.$("previewTable").querySelectorAll("tbody tr").length, 10);
  assert.match(h.$("previewSummary").textContent, /文件数据行：12 · 可导入条目：12/);
  assert.equal(h.window.document.querySelectorAll("select").length, 0, "fixed format needs no manual mapping");
  assert.equal(h.$("importIndex").disabled, false); assert.equal(h.writes.length, 0);
}));

await test("import text is inert in preview, index name and list", () => withManager(async h => {
  const title = '<img src="x" onerror="alert(1)"> Journal';
  await h.choose(encodeCsv([["名称", "等级", "ISSN", "别名"], [title, "本地", "", ""]]));
  await h.change("indexName", '<script>alert("x")</script>');
  assert.equal(h.$("previewTable").querySelector("td").textContent, title);
  assert.equal(h.$("previewTable").querySelectorAll("img,script").length, 0);
  await h.click("importIndex");
  assert.equal(h.$("indexList").querySelector("h3").textContent, '<script>alert("x")</script>');
  assert.equal(h.$("indexList").querySelectorAll("img,script").length, 0);
}));

await test("automatic header recognition and blank level", () => withManager(async h => {
  await h.choose(encodeCsv([["自定义刊名", "自定义别称"], ["Journal of Examples", "JOE"]]));
  assert.equal(h.$("importIndex").disabled, true); assert.match(h.$("diagnostics").textContent, /缺少必需的“名称”列/);
  await h.choose(encodeCsv([["名称", "别名"], ["Journal of Examples", "JOE"]]));
  await h.click("importIndex");
  assert.deepEqual(h.stored.customIndexes[0].entries[0], { title: "Journal of Examples", aliases: ["JOE"], issns: [], level: "收录" });
}));

await test("malformed, missing name, conflicting alias and spreadsheet formula block save", () => withManager(async h => {
  const failures = [
    [["名称", "等级"], ["", "A"]],
    [["名称", "等级"], ["One", "A", "extra"]],
    [["名称", "等级", "别名"], ["One", "A", "Shared"], ["Two", "B", "Shared"]],
    [["名称", "等级"], ["=SUM(1,2)", "A"]],
    [["名称", "等级"], ["One", "  +SUM(1,2)"]],
    [["名称", "等级", "别名"], ["One", "A", "Safe;@bad"]],
    [["名称", "等级"], ["\tOne", "A"]]
  ];
  for (const rows of failures) { await h.choose(encodeCsv(rows)); assert.equal(h.$("importIndex").disabled, true); assert.ok(h.$("diagnostics").querySelector(".error")); await h.click("importIndex"); }
  assert.equal(h.writes.length, 0);
}));

await test("successful imports preserve unrelated settings and same-name indexes", () => withManager(async h => {
  for (let i = 0; i < 2; i++) { await h.choose(validCsv, "同名目录.csv"); await h.click("importIndex"); }
  assert.equal(h.stored.customIndexes.length, 2); assert.equal(h.stored.customIndexes[0].name, "同名目录");
  assert.equal(new Set(h.stored.customIndexes.map(index => index.id)).size, 2);
  assert.deepEqual(h.stored.unrelated, { keep: true }); assert.ok(h.writes.every(value => Object.keys(value).join() === "customIndexes"));
  assert.equal(h.$("preview").hidden, true); assert.match(h.$("status").textContent, /索引已保存/);
}));

await test("enable state and per-index CSV roundtrip with quotes, Unicode and multiline", () => withManager(async h => {
  await h.choose(encodeCsv([["名称", "等级", "ISSN", "别名"], ['Journal of "Examples"\nNew Series', "自定优秀", "0162-8828;1939-3539", "JOE;示例刊"], ["Conference on Examples", "", "", "COE"]]));
  await h.click("importIndex");
  const enabled = h.$("indexList").querySelector('input[type="checkbox"]'); enabled.checked = false; enabled.dispatchEvent(new h.window.Event("change")); await tick();
  assert.equal(h.stored.customIndexes[0].enabled, false);
  h.$("indexList").querySelector("button.secondary").click(); await tick();
  const blob = h.downloads.at(-1).blob, data = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
  const parsed = await h.window.RankAssistantCustomIndexes.parseFile(file("export.csv", data));
  const rebuilt = h.window.RankAssistantCustomIndexes.fromTable(parsed, { name: "roundtrip", ...h.window.RankAssistantCustomIndexes.inferColumns(parsed.headers) });
  assert.deepEqual(clone(rebuilt.errors), []); assert.deepEqual(clone(rebuilt.index.entries), h.stored.customIndexes[0].entries);
}));

await test("external storage changes preserve unsaved name and preview", () => withManager(async h => {
  await h.choose(validCsv); await h.change("indexName", "尚未保存的编辑");
  h.external({ customIndexes: [exampleIndex("external")] }); await tick();
  assert.equal(h.$("indexName").value, "尚未保存的编辑");
  assert.equal(h.$("preview").hidden, false); assert.equal(h.$("previewTable").querySelectorAll("tbody tr").length, 1);
  await h.click("importIndex"); assert.equal(h.stored.customIndexes.length, 2); assert.equal(h.stored.customIndexes[0].id, "external");
}));

await test("delete and undo merge with a concurrent new index", () => withManager(async h => {
  const removed = exampleIndex("old"); h.external({ customIndexes: [removed] });
  h.$("indexList").querySelector("button.danger").click(); await tick();
  assert.equal(h.stored.customIndexes.length, 0); assert.equal(h.$("undoNotice").hidden, false);
  h.external({ customIndexes: [exampleIndex("concurrent")] }); await h.click("undoDelete");
  assert.deepEqual(h.stored.customIndexes.map(index => index.id), ["old", "concurrent"]); assert.equal(h.$("undoNotice").hidden, true);
}));

await test("thirty-index limit blocks import and undo without silently dropping data", () => withManager(async h => {
  h.external({ customIndexes: Array.from({ length: 30 }, (_, i) => exampleIndex("index-" + i)) });
  await h.choose(validCsv); assert.equal(h.$("importIndex").disabled, true); assert.match(h.$("targetHint").textContent, /上限/);
  h.$("indexList").querySelector("button.danger").click(); await tick();
  assert.equal(h.stored.customIndexes.length, 29); assert.equal(h.$("importIndex").disabled, false);
  await h.click("importIndex"); assert.equal(h.stored.customIndexes.length, 30);
  const before = clone(h.stored.customIndexes), writes = h.writes.length;
  await h.click("undoDelete"); assert.deepEqual(h.stored.customIndexes, before); assert.equal(h.writes.length, writes);
  assert.equal(h.$("undoNotice").hidden, false); assert.match(h.$("status").textContent, /上限/);
  h.$("indexList").querySelector("button.danger").click(); await tick();
  await h.click("undoDelete"); assert.equal(h.stored.customIndexes.length, 30); assert.equal(h.$("undoNotice").hidden, true);
}));

await test("failed reads and writes leave saved indexes and preview intact", () => withManager(async h => {
  const old = exampleIndex("protected"); h.external({ customIndexes: [old] }); await h.choose(validCsv);
  h.failGet(); await h.click("importIndex"); assert.equal(h.writes.length, 0); assert.deepEqual(h.stored.customIndexes, [old]); assert.equal(h.$("preview").hidden, false);
  h.failSet(); await h.click("importIndex"); assert.equal(h.writes.length, 0); assert.deepEqual(h.stored.customIndexes, [old]); assert.match(h.$("status").textContent, /写入存储失败/);
  await h.click("importIndex"); assert.equal(h.stored.customIndexes.length, 2);
}));

await test("initial unreadable storage cannot be overwritten by a failed mutation", () => withManager(async h => {
  assert.match(h.$("status").textContent, /读取存储失败/); await h.choose(validCsv); h.failGet(); await h.click("importIndex");
  assert.equal(h.writes.length, 0); assert.equal(h.stored.customIndexes[0].id, "protected");
}, { customIndexes: [exampleIndex("protected")] }, { getFailures: 1 }));

await test("two asynchronous manager tabs import under a shared exclusive lock", async () => {
  const shared = { stored: { customIndexes: [], language: "zh-CN", unrelated: { keep: true } }, listeners: [], lockQueue: Promise.resolve() };
  const first = await harness({}, { shared, storageDelay: 10 }), second = await harness({}, { shared, storageDelay: 10 });
  try {
    await first.choose(validCsv, "页面一.csv"); await second.choose(validCsv, "页面二.csv");
    first.$("importIndex").click(); second.$("importIndex").click();
    await waitFor(() => first.writes.length === 1 && second.writes.length === 1, "both imports must finish"); await tick();
    assert.equal(shared.stored.customIndexes.length, 2); assert.deepEqual(shared.stored.customIndexes.map(index => index.name), ["页面一", "页面二"]);
    assert.equal(new Set(shared.stored.customIndexes.map(index => index.id)).size, 2);
    assert.match(first.$("status").textContent, /索引已保存/); assert.match(second.$("status").textContent, /索引已保存/);
  } finally { first.close(); second.close(); }
});

await test("concurrent toggle and delete never revive a removed index", async () => {
  const shared = { stored: { customIndexes: [exampleIndex("shared")], language: "zh-CN" }, listeners: [], lockQueue: Promise.resolve() };
  const first = await harness({}, { shared, storageDelay: 10 }), second = await harness({}, { shared, storageDelay: 10 });
  try {
    for (const deleteFirst of [false, true]) {
      first.external({ customIndexes: [exampleIndex("shared")] });
      const enabled = first.$("indexList").querySelector("input"), remove = second.$("indexList").querySelector("button.danger");
      const before = first.writes.length + second.writes.length;
      const toggle = () => { enabled.checked = false; enabled.dispatchEvent(new first.window.Event("change")); };
      if (deleteFirst) { remove.click(); toggle(); } else { toggle(); remove.click(); }
      await waitFor(() => first.writes.length + second.writes.length === before + 2, "toggle and delete must finish"); await tick();
      assert.deepEqual(shared.stored.customIndexes, []);
    }
  } finally { first.close(); second.close(); }
});

await test("an environment without Web Locks refuses every write", () => withManager(async h => {
  await h.choose(validCsv); await h.click("importIndex");
  assert.equal(h.writes.length, 0); assert.equal(h.stored.customIndexes[0].id, "protected");
  assert.match(h.$("status").textContent, /不支持安全保存/); assert.equal(h.$("preview").hidden, false);
  h.$("indexList").querySelector("button.danger").click(); await tick(); assert.equal(h.writes.length, 0);
}, { customIndexes: [exampleIndex("protected")] }, { noLocks: true }));

await test("a stale slow file cannot overwrite a newer selected file", () => withManager(async h => {
  let release; const deferred = new Promise(resolve => { release = resolve; });
  await h.choose(validCsv, "慢文件.csv", false, deferred); await h.choose(validCsv, "新文件.csv");
  assert.equal(h.$("indexName").value, "新文件"); release(); await tick(); assert.equal(h.$("indexName").value, "新文件");
}));

await test("name validation debounces, blocks stale import and clears on file or cancel", () => withManager(async h => {
  await h.choose(validCsv);
  for (const value of ["新", "新名", "新名称"]) { h.$("indexName").value = value; h.$("indexName").dispatchEvent(new h.window.Event("input")); }
  assert.equal(h.$("importIndex").disabled, true); await h.click("importIndex"); assert.equal(h.writes.length, 0);
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(h.$("importIndex").disabled, false);
  await h.click("importIndex"); assert.equal(h.stored.customIndexes[0].name, "新名称");
  await h.choose(validCsv); h.$("indexName").value = ""; h.$("indexName").dispatchEvent(new h.window.Event("input"));
  assert.equal(h.$("importIndex").disabled, true);
  await h.choose(validCsv, "新文件.csv"); await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(h.$("indexName").value, "新文件"); assert.equal(h.$("importIndex").disabled, false);
  h.$("indexName").dispatchEvent(new h.window.Event("input")); await h.click("cancelPreview"); await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(h.$("preview").hidden, true); assert.equal(h.$("importIndex").disabled, true);
}));

await test("CSV-only picker rejects JSON, and cancel clears pending preview", () => withManager(async h => {
  await h.choose('{"indexes":[]}', "backup.json"); assert.match(h.$("status").textContent, /请选择 CSV/); assert.equal(h.$("preview").hidden, true);
  await h.choose(validCsv); await h.click("cancelPreview"); assert.equal(h.$("preview").hidden, true); assert.equal(h.$("importIndex").disabled, true); assert.equal(h.writes.length, 0);
}));

await test("Chinese and English UI preserve imported raw text", () => withManager(async h => {
  await h.choose(encodeCsv([["名称", "等级", "ISSN", "别名"], ["名称", "等级", "", "别名"]]));
  h.external({ language: "en" }); await tick();
  assert.equal(h.window.document.title, "Manage custom indexes"); assert.equal(h.$("importIndex").textContent, "Import index");
  assert.deepEqual([...h.$("previewTable").querySelectorAll("td")].map(node => node.textContent), ["名称", "等级", "", "别名"]);
  h.external({ language: "zh-CN" }); await tick(); assert.equal(h.$("importIndex").textContent, "导入索引");
}));

await test("visual snapshot contains saved list and pending preview with production CSS", () => withManager(async h => {
  h.external({ customIndexes: [exampleIndex("saved-journals", "我的期刊目录"), exampleIndex("saved-conferences", "组内会议清单")] });
  await h.choose(encodeCsv([["名称", "等级", "ISSN", "别名"], ["Management Science", "示例A", "0025-1909", "管理科学"], ["International Conference on Machine Learning", "示例B", "", "ICML"], ["Pattern Recognition", "重点", "0031-3203", "模式识别"]]), "跨学科目录.csv");
  snapshot(h, "manager-preview.html");
  const rendered = new JSDOM(read("artifacts/custom-indexes-20261011/manager-preview.html"));
  assert.equal(rendered.window.document.querySelectorAll("script,link[rel=stylesheet]").length, 0);
  assert.equal(rendered.window.document.querySelectorAll(".index-row").length, 2); assert.equal(rendered.window.document.getElementById("preview").hidden, false);
  assert.equal(rendered.window.document.querySelectorAll('.index-row input[type="checkbox"][checked]').length, 2);
  assert.equal(rendered.window.document.querySelector("style").textContent, managerCss); rendered.window.close();
}));

await test("popup custom visibility stays independent of presets and opens the manager tab", async () => {
  const dom = new JSDOM(read("extension/popup/popup.html"), { url: "https://extension.test/extension/popup/popup.html", runScripts: "outside-only" }); pages.add(dom);
  const writes = [], tabs = [];
  dom.window.chrome = { storage: { local: { get(defaults, callback) { callback({ ...defaults }); }, set(value, callback) { writes.push(clone(value)); callback?.(); } } },
    runtime: { lastError: null, getURL: value => "https://extension.test/" + value, sendMessage(_message, callback) { callback({ state: "current" }); } }, tabs: { create(value) { tabs.push(value); } } };
  dom.window.fetch = async value => {
    const address = String(value).replace("https://extension.test/", "");
    return { ok: true, json: async () => address.startsWith("_locales/") ? JSON.parse(read(address)) : address.includes("build-info") ? { records: 35093 } : { news: [] } };
  };
  try {
    dom.window.eval(source.i18n); dom.window.eval(read("extension/popup/popup.js")); await tick();
    const visibility = dom.window.document.getElementById("showCustomIndexes"); assert.equal(visibility.checked, true);
    visibility.checked = false; visibility.dispatchEvent(new dom.window.Event("change")); assert.deepEqual(writes.at(-1), { showCustomIndexes: false });
    dom.window.document.querySelector('[data-preset="computer"]').click(); assert.equal(visibility.checked, false); assert.equal("showCustomIndexes" in writes.at(-1), false);
    dom.window.document.getElementById("manageCustomIndexes").click(); assert.equal(tabs.length, 1); assert.equal(tabs[0].url, "https://extension.test/extension/custom-indexes/manager.html");
  } finally { dom.window.close(); pages.delete(dom); }
});

const summary = { generatedAt: new Date().toISOString(), passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, cases: results,
  openPages: pages.size, scope: "Actual manager/popup scripts and custom-index module in JSDOM with mocked extension storage; no external network; snapshot HTML only, separate browser screenshots verify layout." };
const managerEnglish = JSON.parse(managerScript.match(/const EN = Object.freeze\((\{[\s\S]*?\})\);/)[1]);
fs.writeFileSync(path.join(artifactDir, "ui-strings.json"), JSON.stringify({ popup: ["自定义索引", "管理自定义索引", "导入自己的期刊和会议名单，用于显示标签与筛选。"], managerEnglish }, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(artifactDir, "manager-ui-results.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
const reopened = JSON.parse(read("artifacts/custom-indexes-20261011/manager-ui-results.json"));
assert.equal(reopened.cases.length, results.length); assert.equal(pages.size, 0);
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, openPages: summary.openPages }));
if (summary.failed) process.exitCode = 1;
