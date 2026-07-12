import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";

const source = fs.readFileSync("extension/background/background.js", "utf8");
const data = {};
const listeners = {};
const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
const chrome = {
  storage: {
    local: {
      get(defaults, callback) { callback({ ...(defaults || {}), ...data }); },
      set(values, callback) { Object.assign(data, values); callback?.(); }
    },
    onChanged: event("changed")
  },
  runtime: {
    id: "rank-assistant-test",
    lastError: null,
    getURL: (name) => name,
    onInstalled: event("installed"),
    onStartup: event("startup"),
    onMessage: event("message")
  },
  alarms: {
    clear(_name, callback) { callback(); },
    create() {},
    onAlarm: event("alarm")
  },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};

const latestPath = "updates/latest.json";
const bundlePath = "updates/" + JSON.parse(fs.readFileSync(latestPath, "utf8")).bundleUrl.split("/").at(-1);
const originalBundleText = fs.readFileSync(bundlePath, "utf8");
let tamperSignatureTest = false;

function responseJson(value) {
  return { ok: true, status: 200, json: async () => value };
}

const fetch = async (url) => {
  const value = String(url);
  if (value.endsWith("extension/data/build-info.json") || value === "extension/data/build-info.json") {
    const info = JSON.parse(fs.readFileSync("extension/data/build-info.json", "utf8"));
    return responseJson({ ...info, remoteVersion: "0" });
  }
  if (value.endsWith("extension/data/update-public-key.json") || value === "extension/data/update-public-key.json") {
    return responseJson(JSON.parse(fs.readFileSync("extension/data/update-public-key.json", "utf8")));
  }
  if (value.includes("catalog-shard-")) {
    return responseJson(JSON.parse(fs.readFileSync(value, "utf8")));
  }
  if (value.endsWith("updates/latest.json")) {
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    if (!tamperSignatureTest) return responseJson(latest);
    const tampered = JSON.parse(originalBundleText);
    tampered.records += 1;
    const text = JSON.stringify(tampered);
    return responseJson({
      ...latest,
      sha256: createHash("sha256").update(text).digest("hex"),
      size: Buffer.byteLength(text)
    });
  }
  if (value.includes("/updates/catalog-") && value.endsWith(".prdb")) {
    let text = originalBundleText;
    if (tamperSignatureTest) {
      const tampered = JSON.parse(text);
      tampered.records += 1;
      text = JSON.stringify(tampered);
    }
    const bytes = Uint8Array.from(Buffer.from(text));
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
  }
  if (value.includes("api.crossref.org")) {
    return responseJson({ message: {
      title: "Computer",
      publisher: "Institute of Electrical and Electronics Engineers",
      ISSN: ["0018-9162"],
      subject: ["Computer Science"]
    } });
  }
  throw new Error("Unexpected fetch: " + value);
};

vm.runInNewContext(source, {
  chrome, fetch, crypto: webcrypto, AbortController, TextEncoder, TextDecoder,
  Uint8Array, setTimeout, clearTimeout, Date, console, btoa, atob
});

function message(payload) {
  return new Promise((resolve) => {
    const asyncResult = listeners.message(payload, {}, resolve);
    assert.equal(asyncResult, true);
  });
}

const packaged = await message({ type: "rank-assistant-get-data-shard", key: "i" });
assert.equal(packaged.ok, true);
assert.equal(packaged.updated, false);
assert.ok(packaged.shard.r.some((record) => record[0] === "IEEE Access"));

const status = await message({ type: "rank-assistant-check-updates" });
assert.equal(status.state, "available");

const installed = await message({ type: "rank-assistant-install-updates" });
assert.equal(installed.state, "current");
assert.deepEqual({ ...installed.dataVersions }, { jcr: "2025", cas: "2025", ccf: "2026" });
assert.equal(data.dataUpdateInfo.encrypted, true);
assert.equal(data.dataUpdateInfo.verifiedSignature, true);
assert.ok(data["rankAssistantDataShard.i"].cipher);
assert.equal(data["rankAssistantDataShard.i"].cipher.includes("IEEE Access"), false);

const updatedShard = await message({ type: "rank-assistant-get-data-shard", key: "i" });
assert.equal(updatedShard.ok, true);
assert.equal(updatedShard.updated, true);
assert.ok(updatedShard.shard.r.some((record) => record[0] === "IEEE Access"));

const journal = await message({ type: "rank-assistant-journal-metadata", issns: ["0018-9162"], title: "Computer" });
assert.equal(journal.ok, true);
assert.equal(journal.metadata.publisher, "IEEE");
const cached = await message({ type: "rank-assistant-journal-metadata", issns: ["0018-9162"], title: "Computer" });
assert.equal(cached.cached, true);

tamperSignatureTest = true;
const rejected = await message({ type: "rank-assistant-install-updates" });
assert.equal(rejected.state, "error");
assert.match(rejected.error, /签名验证失败/);

console.log(JSON.stringify({
  update: installed.state,
  versions: installed.dataVersions,
  encrypted: data.dataUpdateInfo.encrypted,
  signatureTamperRejected: true,
  publisher: journal.metadata.publisher,
  cached: cached.cached
}));
