"use strict";

const PRODUCT_ID = "journal-conference-rank-assistant";
const UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/PolarisLight/Journal-Conference-Rank-Assistant/main/updates/latest.json";
const UPDATE_ALARM = "rank-assistant-update-check";
const UPDATE_PERIOD_MINUTES = 7 * 24 * 60;
const JOURNAL_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_JOURNAL_CACHE = 300;
const SHARD_KEYS = ["0", ..."abcdefghijklmnopqrstuvwxyz"];
const DATA_KEY_PREFIX = "rankAssistantDataShard.";
const STOP = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);
const decryptedShardCache = new Map();

function storageGet(defaults = null) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(values) {
  return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message));
    else resolve();
  }));
}

async function buildInfo() {
  const response = await fetch(chrome.runtime.getURL("extension/data/build-info.json"));
  if (!response.ok) throw new Error("无法读取本地数据版本");
  return response.json();
}

async function fetchJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function setUpdateBadge(status) {
  const available = status?.state === "available";
  chrome.action.setBadgeText({ text: available ? "新" : "" });
  if (available) chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
}

async function latestRelease() {
  const payload = await fetchJson(UPDATE_MANIFEST_URL);
  if (
    payload?.schema !== 1 ||
    payload?.product !== PRODUCT_ID ||
    !payload?.version ||
    !payload?.bundleUrl ||
    !/^[a-f0-9]{64}$/i.test(payload?.sha256 || "")
  ) {
    throw new Error("官方更新清单格式无效");
  }
  return payload;
}

function compareVersions(left, right) {
  const a = String(left || "0").split(/[^0-9]+/).filter(Boolean).map(Number);
  const b = String(right || "0").split(/[^0-9]+/).filter(Boolean).map(Number);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

async function effectiveDataInfo() {
  const [packaged, stored] = await Promise.all([
    buildInfo(),
    storageGet({ dataUpdateInfo: null })
  ]);
  return stored.dataUpdateInfo || packaged;
}

async function checkUpdates(source = "manual") {
  const checkedAt = new Date().toISOString();
  try {
    const [info, latest] = await Promise.all([effectiveDataInfo(), latestRelease()]);
    const baselineVersion = info.remoteVersion || "0";
    const available = compareVersions(latest.version, baselineVersion) > 0;
    const status = {
      state: available ? "available" : "current",
      source,
      checkedAt,
      installedAt: info.installedAt || "",
      latestSha: latest.sha256,
      latestDate: latest.publishedAt || "",
      latestMessage: "官方签名数据包 " + latest.version,
      latestVersion: latest.version,
      baselineVersion,
      dataVersions: info.dataVersions || latest.dataVersions || { cas: info.cas, jcr: info.jcr, ccf: info.ccf }
    };
    await storageSet({ updateStatus: status });
    setUpdateBadge(status);
    return status;
  } catch (error) {
    const previous = (await storageGet({ updateStatus: null })).updateStatus;
    const status = {
      ...(previous || {}),
      state: previous?.state === "available" ? "available" : "error",
      source,
      checkedAt,
      error: String(error?.message || error)
    };
    await storageSet({ updateStatus: status });
    setUpdateBadge(status);
    return status;
  }
}

async function configureAlarm() {
  const { autoCheckUpdates } = await storageGet({ autoCheckUpdates: true });
  chrome.alarms.clear(UPDATE_ALARM, () => {
    if (autoCheckUpdates) {
      chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 5, periodInMinutes: UPDATE_PERIOD_MINUTES });
    }
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function abbreviationKey(value) {
  return normalize(value).split(" ").filter((token) => token && !STOP.has(token))
    .map((token) => token.slice(0, 4)).join(" ");
}

function shardKey(value) {
  const first = String(value || "")[0] || "";
  if (first >= "a" && first <= "z") return first;
  if (first >= "0" && first <= "9") return "0";
  return "other";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function cleanIssn(value) {
  const clean = String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
  return clean.length === 8 ? clean : "";
}

function splitIssns(value) {
  return String(value || "").split(/[/;,\s]+/).map(cleanIssn).filter(Boolean);
}

function emptyRecord(title) {
  return [title, "", "", "", "", 0, "", "", "", "", "", "", "", [], "", "", ""];
}

function recordScore(record) {
  return (record[1] ? 10 : 0) + (record[4] ? 6 : 0) + (record[8] ? 5 : 0) + (record[12] ? 2 : 0);
}

function zone(value) {
  return String(value || "").match(/[1-4]/)?.[0] || "";
}

function topFlag(value) {
  return ["是", "yes", "true", "1"].includes(String(value || "").trim().toLowerCase()) ? 1 : 0;
}

function ccfRank(value) {
  return String(value || "").match(/[ABC]/i)?.[0]?.toUpperCase() || "";
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(mode = "runtime") {
  const seedText = mode === "packaged"
    ? "Journal Conference Rank Assistant packaged data v1"
    : "Journal Conference Rank Assistant encrypted data v1|" + chrome.runtime.id;
  const seed = new TextEncoder().encode(seedText);
  const digest = await crypto.subtle.digest("SHA-256", seed);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptShard(shard, mode = "runtime") {
  const plain = new TextEncoder().encode(JSON.stringify(shard));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const [key, digest] = await Promise.all([encryptionKey(mode), crypto.subtle.digest("SHA-256", plain)]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    format: 1,
    keyMode: mode,
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
    sha256: hex(new Uint8Array(digest))
  };
}

async function decryptShard(payload, mode = payload?.keyMode || "runtime") {
  if (!payload?.cipher || !payload?.iv || !payload?.sha256) throw new Error("更新数据格式无效");
  const key = await encryptionKey(mode);
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.cipher)
  ));
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", plain)));
  if (digest !== payload.sha256) throw new Error("更新数据完整性校验失败");
  return JSON.parse(new TextDecoder().decode(plain));
}

async function loadPackagedShard(key) {
  const response = await fetch(chrome.runtime.getURL("extension/data/catalog-shard-" + key + ".encrypted.json"));
  if (!response.ok) throw new Error("无法读取加密基础分片 " + key);
  return decryptShard(await response.json(), "packaged");
}

async function loadPackagedShards() {
  return Promise.all(SHARD_KEYS.map(loadPackagedShard));
}

async function sha256Hex(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function verifyOfficialBundle(bundle) {
  if (
    bundle?.schema !== 1 ||
    bundle?.product !== PRODUCT_ID ||
    bundle?.signatureAlgorithm !== "ECDSA_P256_SHA256" ||
    !bundle?.signature ||
    !bundle?.shards
  ) {
    throw new Error("官方数据包格式无效");
  }
  const keyResponse = await fetch(chrome.runtime.getURL("extension/data/update-public-key.json"));
  if (!keyResponse.ok) throw new Error("无法读取内置更新公钥");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    await keyResponse.json(),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  const { signature, ...signedPayload } = bundle;
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64ToBytes(signature),
    new TextEncoder().encode(JSON.stringify(signedPayload))
  );
  if (!valid) throw new Error("数据库签名验证失败");
  for (const key of SHARD_KEYS) {
    if (!bundle.shards[key]?.cipher) throw new Error("数据库缺少分片 " + key);
  }
  return signedPayload;
}

async function installUpdates() {
  const startedAt = new Date().toISOString();
  try {
    const latest = await latestRelease();
    const bytes = await fetchBytes(latest.bundleUrl);
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== String(latest.sha256).toLowerCase()) {
      throw new Error("数据库 SHA-256 校验失败");
    }
    const bundle = JSON.parse(new TextDecoder().decode(bytes));
    const verified = await verifyOfficialBundle(bundle);
    if (verified.version !== latest.version) throw new Error("更新清单与数据库版本不一致");

    const encrypted = {};
    const encryptedPairs = await Promise.all(SHARD_KEYS.map(async (key) => {
      const shard = await decryptShard(verified.shards[key], "packaged");
      return [key, await encryptShard(shard, "runtime")];
    }));
    for (const [key, payload] of encryptedPairs) encrypted[DATA_KEY_PREFIX + key] = payload;

    const dataUpdateInfo = {
      format: 2,
      installedAt: new Date().toISOString(),
      remoteVersion: verified.version,
      sourceRepository: "PolarisLight/Journal-Conference-Rank-Assistant",
      sourceSha256: actualSha256,
      dataVersions: verified.dataVersions,
      records: verified.records,
      encrypted: true,
      verifiedSignature: true,
      integrity: "ECDSA P-256 + SHA-256 + AES-GCM"
    };
    const status = {
      state: "current",
      source: "installed",
      checkedAt: new Date().toISOString(),
      installedAt: dataUpdateInfo.installedAt,
      latestSha: actualSha256,
      latestDate: verified.publishedAt,
      latestMessage: "已安装官方签名数据包 " + verified.version,
      latestVersion: verified.version,
      baselineVersion: verified.version,
      dataVersions: verified.dataVersions
    };
    await storageSet({ ...encrypted, dataUpdateInfo, updateStatus: status });
    decryptedShardCache.clear();
    setUpdateBadge(status);
    return status;
  } catch (error) {
    const previous = (await storageGet({ updateStatus: null })).updateStatus;
    const status = {
      ...(previous || {}),
      state: "error",
      source: "install",
      checkedAt: new Date().toISOString(),
      installStartedAt: startedAt,
      error: String(error?.message || error)
    };
    await storageSet({ updateStatus: status });
    return status;
  }
}
async function getUpdatedShard(key) {
  if (!SHARD_KEYS.includes(key)) return { ok: false, error: "无效分片" };
  if (decryptedShardCache.has(key)) return { ok: true, shard: decryptedShardCache.get(key), updated: true };
  const storageKey = DATA_KEY_PREFIX + key;
  const stored = await storageGet({ [storageKey]: null, dataUpdateInfo: null });
  if (!stored.dataUpdateInfo || !stored[storageKey]) {
    try {
      const shard = await loadPackagedShard(key);
      decryptedShardCache.set(key, shard);
      return { ok: true, shard, updated: false };
    } catch (error) {
      return { ok: false, shard: null, error: String(error?.message || error) };
    }
  }
  try {
    const shard = await decryptShard(stored[storageKey], "runtime");
    decryptedShardCache.set(key, shard);
    return { ok: true, shard, updated: true };
  } catch (error) {
    return { ok: false, shard: null, error: String(error?.message || error) };
  }
}

function shortPublisher(value) {
  const name = String(value || "").trim();
  if (/Institute of Electrical and Electronics Engineers/i.test(name)) return "IEEE";
  if (/Association for Computing Machinery/i.test(name)) return "ACM";
  if (/Elsevier/i.test(name)) return "Elsevier";
  if (/Springer/i.test(name)) return "Springer Nature";
  if (/Wiley/i.test(name)) return "Wiley";
  if (/Taylor\s*(?:&|and)\s*Francis|Informa UK/i.test(name)) return "Taylor & Francis";
  if (/SAGE/i.test(name)) return "SAGE";
  return name;
}

function normalizeIssn(value) {
  const clean = String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
  return clean.length === 8 ? clean.slice(0, 4) + "-" + clean.slice(4) : "";
}

async function lookupJournalMetadata(request) {
  const issns = [...new Set((request.issns || []).map(normalizeIssn).filter(Boolean))];
  const key = issns[0] || String(request.title || "").toLowerCase();
  if (!key) return { ok: false, error: "缺少 ISSN" };
  const stored = await storageGet({ journalMetaCache: {} });
  const cache = stored.journalMetaCache || {};
  const cached = cache[key];
  if (cached && Date.now() - cached.cachedAt < JOURNAL_CACHE_TTL) {
    return { ok: true, cached: true, metadata: cached.metadata };
  }
  let lastError = null;
  for (const issn of issns) {
    try {
      const payload = await fetchJson("https://api.crossref.org/journals/" + encodeURIComponent(issn));
      const message = payload?.message || {};
      const metadata = {
        title: message.title || request.title || "",
        publisher: shortPublisher(message.publisher),
        publisherFull: message.publisher || "",
        subjects: Array.isArray(message.subject) ? message.subject.filter(Boolean).slice(0, 4) : [],
        issns: Array.isArray(message.ISSN) ? message.ISSN : issns,
        source: "Crossref",
        retrievedAt: new Date().toISOString()
      };
      cache[key] = { cachedAt: Date.now(), metadata };
      const entries = Object.entries(cache).sort((a, b) => b[1].cachedAt - a[1].cachedAt).slice(0, MAX_JOURNAL_CACHE);
      await storageSet({ journalMetaCache: Object.fromEntries(entries) });
      return { ok: true, cached: false, metadata };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: String(lastError?.message || "Crossref 未匹配到期刊") };
}

chrome.runtime.onInstalled.addListener(() => {
  configureAlarm();
  checkUpdates("installed");
});

chrome.runtime.onStartup.addListener(() => configureAlarm());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkUpdates("scheduled");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoCheckUpdates) configureAlarm();
  if (area === "local" && Object.keys(changes).some((key) => key.startsWith(DATA_KEY_PREFIX))) {
    decryptedShardCache.clear();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "rank-assistant-check-updates") {
    checkUpdates("manual").then(sendResponse);
    return true;
  }
  if (message?.type === "rank-assistant-install-updates") {
    installUpdates().then(sendResponse);
    return true;
  }
  if (message?.type === "rank-assistant-get-update-status") {
    storageGet({ updateStatus: null }).then((value) => sendResponse(value.updateStatus));
    return true;
  }
  if (message?.type === "rank-assistant-get-data-shard") {
    getUpdatedShard(message.key).then(sendResponse);
    return true;
  }
  if (message?.type === "rank-assistant-journal-metadata") {
    lookupJournalMetadata(message).then(sendResponse);
    return true;
  }
  return false;
});

configureAlarm();
storageGet({ updateStatus: null }).then(({ updateStatus }) => setUpdateBadge(updateStatus));
