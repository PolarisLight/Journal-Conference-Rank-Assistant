import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";

const source = fs.readFileSync("extension/background/background.js", "utf8");
const data = {};
const listeners = {};
let buildInfoRemoteVersion = null;
const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
const chrome = {
  storage: {
    local: {
      get(defaults, callback) { callback({ ...(defaults || {}), ...data }); },
      set(values, callback) { Object.assign(data, values); callback?.(); },
      remove(keys, callback) { for (const key of keys) delete data[key]; callback?.(); }
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
const dblpApiFetches = [];

function responseJson(value) {
  return { ok: true, status: 200, json: async () => value };
}

const fetch = async (url) => {
  const value = String(url);
  if (value.endsWith("extension/data/build-info.json") || value === "extension/data/build-info.json") {
    const info = JSON.parse(fs.readFileSync("extension/data/build-info.json", "utf8"));
    return responseJson(buildInfoRemoteVersion === null ? info : { ...info, remoteVersion: buildInfoRemoteVersion });
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
  if (value.includes("/search/publ/api")) {
    const origin = new URL(value).origin;
    dblpApiFetches.push(origin);
    if (origin === "https://dblp.org") return { ok: false, status: 503, json: async () => ({}) };
    return responseJson({ result: { hits: { hit: [
      { info: { title: "Recovered", venue: "IEEE Access", year: "2026", url: origin + "/rec/one" } }
    ] } } });
  }  throw new Error("Unexpected fetch: " + value);
};

vm.runInNewContext(source, {
  chrome, fetch, crypto: webcrypto, AbortController, TextEncoder, TextDecoder,
  Uint8Array, setTimeout, clearTimeout, Date, URL, console, btoa, atob
});

function message(payload, sender = {}) {
  return new Promise((resolve) => {
    const asyncResult = listeners.message(payload, sender, resolve);
    assert.equal(asyncResult, true);
  });
}

const packaged = await message({ type: "rank-assistant-get-data-shard", key: "i" });
assert.equal(packaged.ok, true);
assert.equal(packaged.updated, false);
assert.ok(packaged.shard.r.some((record) => record[0] === "IEEE Access"));
const matchedVenues = await message(
  {
    type: "rank-assistant-match-dblp-venues",
    items: [
      { text: "IEEE Access 14", key: "/db/journals/access/" },
      { text: "Comput. Vis. Image Underst. 265", key: "/db/journals/cviu/" },
      { text: "J. Am. Soc. Inf. Sci. 50", key: "/db/journals/jasis/" }
    ]
  },
  { url: "https://dblp.org/search?q=test" }
);
assert.equal(matchedVenues.ok, true);
assert.equal(matchedVenues.mode, "background-batch");
assert.equal(matchedVenues.records[0][0], "IEEE Access");
assert.match(matchedVenues.records[1][0], /COMPUTER VISION AND IMAGE UNDERSTANDING/i);
assert.match(matchedVenues.records[2][0], /JOURNAL OF THE ASSOCIATION FOR INFORMATION SCIENCE AND TECHNOLOGY/i);
assert.ok(matchedVenues.shardCount <= 3, "DBLP matching should load only primary venue shards");
const matchedDenied = await message(
  { type: "rank-assistant-match-dblp-venues", items: [{ text: "IEEE Access 14" }] },
  { url: "https://example.com/" }
);
assert.equal(matchedDenied.ok, false);

const status = await message({ type: "rank-assistant-check-updates" });
assert.equal(status.state, "current");

const installed = await message({ type: "rank-assistant-install-updates" });
assert.equal(installed.state, "current");
assert.deepEqual({ ...installed.dataVersions }, { cas: "2025", jcr: "2025", ccf: "2026", cssci: "2025-2026", pkuCore: "2023", ei: "2026-07-09", xinrui: "2026", warning: "2025" });
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
const dblpRecovered = await message(
  { type: "rank-assistant-dblp-recover", query: "long tail", origin: "https://dblp.org" },
  { url: "https://dblp.org/search?q=long+tail" }
);
assert.equal(dblpRecovered.ok, true);
assert.equal(dblpRecovered.sourceOrigin, "https://dblp.dagstuhl.de");
assert.deepEqual(dblpApiFetches, ["https://dblp.org", "https://dblp.dagstuhl.de"]);
const dblpCached = await message(
  { type: "rank-assistant-dblp-recover", query: "long tail", origin: "https://dblp.org" },
  { url: "https://dblp.org/search?q=long+tail" }
);
assert.equal(dblpCached.cached, true);
assert.equal(dblpApiFetches.length, 2, "A cached DBLP query must not hit the network again");
const dblpDenied = await message(
  { type: "rank-assistant-dblp-recover", query: "long tail", origin: "https://dblp.org" },
  { url: "https://example.com/" }
);
assert.equal(dblpDenied.ok, false);

tamperSignatureTest = true;
const rejected = await message({ type: "rank-assistant-install-updates" });
assert.equal(rejected.state, "error");
assert.match(rejected.error, /签名验证失败/);

const installedDataWasEncrypted = data.dataUpdateInfo.encrypted;
tamperSignatureTest = false;
buildInfoRemoteVersion = null;
data.dataUpdateInfo = { remoteVersion: "2026.01.01", dataVersions: { cas: "2025", jcr: "2025", ccf: "2025" } };
data.updateStatus = { state: "current", dataVersions: { cas: "2025", jcr: "2025", ccf: "2025" } };
data["rankAssistantDataShard.i"] = { cipher: "stale" };
listeners.installed({ reason: "update", previousVersion: "0.10.1" });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(data.dataUpdateInfo, undefined);
assert.equal(data["rankAssistantDataShard.i"], undefined);
assert.deepEqual({ ...data.updateStatus.dataVersions }, {
  cas: "2025", jcr: "2025", ccf: "2026", cssci: "2025-2026", pkuCore: "2023", ei: "2026-07-09", xinrui: "2026", warning: "2025"
});
const migratedShard = await message({ type: "rank-assistant-get-data-shard", key: "i" });
assert.equal(migratedShard.updated, false);
assert.ok(migratedShard.shard.r.some((record) => record[0] === "IEEE Access"));
console.log(JSON.stringify({
  update: installed.state,
  versions: installed.dataVersions,
  encrypted: installedDataWasEncrypted,
  signatureTamperRejected: true,
  publisher: journal.metadata.publisher,
  cached: cached.cached
}));
