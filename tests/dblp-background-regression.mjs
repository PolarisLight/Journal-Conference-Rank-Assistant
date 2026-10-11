import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// Exercise the actual message handler, encrypted packaged shards, and signed
// update installation. Never substitute plaintext catalog files or a matcher.
const source = fs.readFileSync("extension/background/background.js", "utf8");
function background(options = {}) {
  const storage = {}, listeners = {}, fetches = [];
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
  const chrome = {
    runtime: { id: "dblp-encrypted-regression", lastError: null, getURL: name => name,
      onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
    storage: { local: {
      get(defaults, cb) { cb({ ...(defaults || {}), ...storage }); },
      set(values, cb) { Object.assign(storage, values); cb?.(); },
      remove(keys, cb) { keys.forEach(key => delete storage[key]); cb?.(); }
    }, onChanged: event("changed") },
    alarms: { clear(_name, cb) { cb(); }, create() {}, onAlarm: event("alarm") },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
  };
  const json = value => ({ ok: true, status: 200, json: async () => value });
  const fetch = async value => {
    const url = String(value);
    fetches.push(url);
    assert.ok(!url.includes(".private.json"), "No plaintext installation catalog may be read");
    const shard = url.match(/catalog-shard-(\w+)\.encrypted\.json$/)?.[1];
    if (shard && (options.missingPackaged === true || options.missingPackaged?.includes(shard))) return { ok: false, status: 404 };
    if (url === "extension/data/build-info.json" && options.buildInfoFailure) return { ok: false, status: 404 };
    if (url.startsWith("extension/")) {
      const body = JSON.parse(fs.readFileSync(url, "utf8"));
      if (shard && options.corruptPackaged?.includes(shard)) body.cipher = "AAAA";
      return json(body);
    }
    if (url.endsWith("/updates/latest.json")) return json(JSON.parse(fs.readFileSync("updates/latest.json", "utf8")));
    if (url.includes("/updates/catalog-") && url.endsWith(".prdb")) {
      const bytes = Uint8Array.from(fs.readFileSync("updates/" + new URL(url).pathname.split("/").at(-1)));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    }
    throw new Error("Unexpected network request: " + url);
  };
  vm.runInNewContext(source, { chrome, fetch, crypto: webcrypto, AbortController, TextEncoder, TextDecoder,
    Uint8Array, setTimeout, clearTimeout, Date, URL, console, btoa, atob });
  return { options, storage, fetches, changed: changes => listeners.changed(changes, "local"),
    message(payload, sender = { url: "https://dblp.org/search?q=regression" }) {
      return new Promise(resolve => {
        assert.equal(listeners.message(payload, sender, resolve), true);
      });
    },
    match(items) { return this.message({ type: "rank-assistant-match-dblp-venues", items }); }
  };
}

const independent = [
  { text: "Proceedings of the International Conference on Machine Learning", key: "/db/conf/icml/" },
  { text: "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition", key: "/db/conf/cvpr/" },
  { text: "Advances in Neural Information Processing Systems", key: "/db/conf/nips/" },
  { text: "Unfamiliar Historical Conference Name", key: "/db/conf/icml/" }
];
for (const item of independent) {
  const instance = background();
  const response = await instance.match([item]);
  assert.equal(response.ok, true);
  assert.equal(response.records[0][1], "A", "A stable ID must work independently of visible-name shards: " + item.text);
  if (item.text.startsWith("Advances in")) {
    assert.equal(response.records[0][0], item.text);
    assert.ok(response.records[0][24], "The series' EI index must survive CCF enrichment");
    assert.equal(response.records[0][25], "Book-Series");
  }
  const count = instance.fetches.filter(url => url.includes(".encrypted.json")).length;
  const repeated = await instance.match([item]);
  assert.equal(repeated.records[0][1], "A");
  assert.equal(instance.fetches.filter(url => url.includes(".encrypted.json")).length, count, "Repeated stable-ID lookup must use cached decrypted data/index");
}

const fast = background();
const primary = await fast.match([
  { text: "IEEE Access 14", key: "/db/journals/access/" },
  { text: "Comput. Vis. Image Underst. 265", key: "/db/journals/cviu/" },
  { text: "J. Am. Soc. Inf. Sci. 50", key: "/db/journals/jasis/" }
]);
assert.equal(primary.ok, true);
assert.ok(primary.shardCount <= 3, "Clear existing venue names must keep the primary-shard path");
assert.equal(primary.records[1][1], "B");
assert.equal(primary.records[2][1], "B");
const safe = await fast.match([
  { text: "ACM International Conference on Mobile...", key: "" },
  { text: "Analysis of results", key: "" },
  { text: "Example Unlisted Research Symposium", key: "/db/conf/unlisted-audit/" },
  { text: "ICML", key: "/db/conf/unlisted-audit/" },
  { text: "", key: "" }
]);
assert.equal(safe.ok, true);
assert.deepEqual(Array.from(safe.records), [null, null, null, null, null]);
const normalized = await fast.match([
  { text: "The Cryptographer's Track at RSA Conference", key: "" },
  { text: "The Cryptographers Track at RSA Conference", key: "" },
  { text: "THE CRYPTOGRAPHER'S TRACK AT RSA CONFERENCE", key: "" },
  { text: "Hart's E and P", key: "" },
  { text: "Harts E and P", key: "" },
  { text: "EAI Community Research Series ΓÇô CORE.", key: "" }
]);
assert.equal(normalized.ok, true);
assert.equal(normalized.records[0][1], "C");
assert.equal(normalized.records[1][1], "C");
assert.ok(normalized.records[3][24]);
assert.ok(normalized.records[4][24]);
assert.ok(normalized.records[5][24]);
assert.equal(normalized.records[2][1], "C");
const staleUrl = await fast.match([
  { text: "Pattern Recognition", key: "/db/journals/pr/" },
  { text: "Information Sciences", key: "/db/journals/information-sciences/" },
  { text: "The Cryptographer's Track at RSA Conference", key: "/db/conf/unlisted-audit/" },
  { text: "Comput. Vis. Image Underst.", key: "/db/journals/unlisted-audit/" },
  { text: "IEEE Transactions on Pattern Analysis and Machine...", key: "/db/journals/unlisted-audit/" },
  { text: "Pattern Recognition", key: "/db/journals/pami/" }
]);
assert.equal(staleUrl.ok, true);
assert.equal(staleUrl.records[0][1], "B", "A stale catalog DBLP URL must not discard a unique full journal title");
assert.ok(staleUrl.records[0][13].includes("00313203"));
assert.equal(staleUrl.records[1][1], "B", "The exact-title fallback must generalize to an independent journal");
assert.equal(staleUrl.records[2][1], "C", "The exact-title fallback must generalize to conferences");
assert.equal(staleUrl.records[3], null, "An abbreviation must not override a conflicting unlisted ID");
assert.equal(staleUrl.records[4], null, "A truncated title must not override a conflicting unlisted ID");
assert.equal(staleUrl.records[5][1], "A", "A successfully resolved stable ID must remain stronger than another visible title");
const kinds = await fast.match([
  { text: "MICRO", key: "/db/conf/micro/" },
  { text: "IEEE/ACM International Symposium on Microarchitecture", key: "/db/conf/micro/" },
  { text: "IEEE Micro", key: "/db/journals/micro/" },
  { text: "Pattern Recognition", key: "/db/conf/par/" },
  { text: "Pattern Recognition", key: "/db/journals/pr/" },
  { text: "SIGSPATIAL", key: "/db/conf/sigspatial/" },
  { text: "ACM SIGSPATIAL", key: "/db/conf/gis/" },
  { text: "MICRO", key: "/db/conf/unlisted-audit/" },
  { text: "MICRO", key: "/db/journals/micro/" }
]);
assert.equal(kinds.ok, true);
assert.equal(kinds.records[0][1], "A", "A unique catalog acronym plus the matching conference stream must survive a stale cross-type URL");
assert.equal(kinds.records[1][1], "A");
assert.match(kinds.records[2][0], /^IEEE MICRO$/i, "A bad conference URL must not replace a journal's own record");
assert.equal(kinds.records[2][1], "");
assert.ok(kinds.records[2][13].includes("02721732"));
assert.equal(kinds.records[3], null, "A journal's bad conference URL must not rank a conference");
assert.equal(kinds.records[4][1], "B");
assert.equal(kinds.records[5][1], "C", "The catalog acronym/stream fallback must generalize to a second conference");
assert.equal(kinds.records[6], null, "Missing stream/alias evidence must remain conservative");
assert.equal(kinds.records[7], null);
assert.equal(kinds.records[8]?.[1] || "", "", "A journal-linked row must never inherit the conference's CCF A");
assert.equal((await fast.match([{ text: "MICRO", key: "/db/journals/micro/" }])).records[0], null);

for (const options of [
  { missingPackaged: true }, { missingPackaged: ["i"] }, { corruptPackaged: ["i"] }, { buildInfoFailure: true }
]) {
  const instance = background(options);
  const result = await instance.match([{ text: "ICML", key: "/db/conf/icml/" }]);
  assert.equal(result.ok, false, "Catalog failures must not become successful null matches");
  assert.ok(result.error);
  assert.equal(result.records, undefined);
}
const partial = await background({ missingPackaged: ["i"] }).match([
  { text: "ICML", key: "/db/conf/icml/" },
  { text: "Comput. Vis. Image Underst. 265", key: "/db/journals/cviu/" }
]);
assert.equal(partial.ok, false, "A partial batch load must remain a catalog failure");
assert.equal(partial.records, undefined);

const updated = background();
const installed = await updated.message({ type: "rank-assistant-install-updates" });
assert.equal(installed.state, "current");
assert.equal(updated.storage.dataUpdateInfo.verifiedSignature, true);
assert.equal((await updated.match([independent[0]])).records[0][1], "A");
updated.storage["rankAssistantDataShard.i"].cipher = "AAAA";
updated.changed({ "rankAssistantDataShard.i": {} });
assert.equal((await updated.match([{ text: "ICML", key: "/db/conf/icml/" }])).records[0][1], "A", "Corrupt current cache must fall back to valid packaged data");
updated.options.missingPackaged = true;
updated.changed({ "rankAssistantDataShard.i": {} });
const bothFailed = await updated.match([{ text: "ICML", key: "/db/conf/icml/" }]);
assert.equal(bothFailed.ok, false);
assert.match(bothFailed.error, /基础分片回退失败/);
updated.options.missingPackaged = [];
assert.equal((await updated.match([independent[0]])).records[0][1], "A", "A failed complete-index promise must be retryable");
assert.equal((await background({ buildInfoFailure: true }).message({ type: "rank-assistant-get-data-shard", key: "i" })).ok, false,
  "A build-info exception must answer the shard message with an explicit failure");
assert.equal((await fast.message({ type: "rank-assistant-match-dblp-venues", items: independent }, { url: "https://example.org/" })).ok, false);
console.log(JSON.stringify({ passed: true, independentStableIds: independent.length,
  normalizationCases: normalized.records.length, faultKinds: 4, partialFailureRejected: true,
  staleUrlExactTitleFallbackCases: 3, conflictingFuzzyNamesRejected: 2,
  venueKindCases: kinds.records.length,
  signedUpdateAndCorruptCacheFallback: true, seriesEiPreserved: true, plaintextCatalogReads: 0 }));
