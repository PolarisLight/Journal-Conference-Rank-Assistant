import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'file:///C:/Users/polaris/Documents/Codex/2026-07-12/ch/work/testdeps/node_modules/jsdom/lib/api.js';

export const root = process.cwd();
export function createBackground(options = {}) {
  const storage = structuredClone(options.storage || {});
  const listeners = {}, fetches = [], errors = [];
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const chrome = {
    runtime: { id: 'all-sites-readonly-audit', lastError: null, getURL: name => name,
      onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    storage: { local: {
      get(defaults, cb) { cb({ ...(defaults || {}), ...storage }); },
      set(values, cb) { Object.assign(storage, values); cb?.(); },
      remove(keys, cb) { keys.forEach(key => delete storage[key]); cb?.(); }
    }, onChanged: event('changed') },
    alarms: { clear(_name, cb) { cb(); }, create() {}, onAlarm: event('alarm') },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
  };
  const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value) });
  const fetch = async value => {
    const url = String(value);
    fetches.push(url);
    if (url.includes('.private.json')) throw new Error('Audit must not load plaintext installation shards');
    const match = url.match(/catalog-shard-(\w+)\.encrypted\.json$/);
    if (match && (options.missingPackaged === true || options.missingPackaged?.includes(match[1]))) return { ok: false, status: 404 };
    if (url === 'extension/data/build-info.json' && options.buildInfoFailure) return { ok: false, status: 404 };
    if (url.startsWith('extension/')) {
      let body = JSON.parse(fs.readFileSync(path.join(root, url), 'utf8'));
      if (match && options.corruptPackaged?.includes(match[1])) body = { ...body, cipher: 'AAAA' };
      return response(body);
    }
    if (url.endsWith('/updates/latest.json')) return response(JSON.parse(fs.readFileSync(path.join(root, 'updates/latest.json'), 'utf8')));
    if (url.includes('/updates/catalog-') && url.endsWith('.prdb')) {
      const file = path.join(root, 'updates', new URL(url).pathname.split('/').at(-1));
      const bytes = Uint8Array.from(fs.readFileSync(file));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    }
    if (options.externalFetch) return options.externalFetch(url);
    throw new Error('External network unavailable in controlled audit: ' + url);
  };
  const context = { chrome, fetch, crypto: webcrypto, AbortController, TextEncoder, TextDecoder,
    Uint8Array, setTimeout, clearTimeout, Date, URL, btoa, atob,
    console: { log() {}, warn(...args) { errors.push(args.map(String).join(' ')); }, error(...args) { errors.push(args.map(String).join(' ')); } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/background/background.js'), 'utf8') +
    '\nglobalThis.__audit = { getUpdatedShard, loadPackagedShards, matchDblpVenues, installUpdates, normalizedDblpVenueKey };', context);
  return { storage, fetches, errors, api: context.__audit,
    message(payload, sender = {}) {
      return new Promise(resolve => {
        const handled = listeners.message(payload, sender, resolve);
        if (!handled) resolve({ ok: false, error: 'Message not handled' });
      });
    } };
}

export async function runEncryptedPage(url, html, options = {}) {
  const background = options.background || createBackground(options);
  const errors = [], messages = [], directFetches = [];
  const settings = structuredClone(options.settings || {});
  const storageListeners = [];
  const changeSettings = (values) => {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      changes[key] = { oldValue: settings[key], newValue: value };
      settings[key] = value;
    }
    for (const listener of storageListeners) listener(changes, 'local');
  };
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const observers = [];
  const NativeObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  dom.window.__PAPER_RANK_DBLP_TIMEOUT_MS = 350;
  dom.window.chrome = {
    runtime: { getURL: name => 'moz-extension://audit/' + name, lastError: null,
      sendMessage(message, callback) {
        messages.push(message.type);
        background.message(message, { url }).then(callback).catch(error => { errors.push(String(error)); callback({ ok: false, error: String(error) }); });
      } },
    storage: { local: { get(defaults, cb) { cb({ ...defaults, ...settings }); }, set(values, cb) { changeSettings(values); cb?.(); } },
      onChanged: { addListener(listener) { storageListeners.push(listener); } } }
  };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.fetch = async value => {
    const address = String(value);
    directFetches.push(address);
    if (address.includes('.private.json')) return { ok: false, status: 404, json: async () => ({}) };
    if (address.startsWith('moz-extension://audit/_locales/')) return { ok: true, status: 200,
      json: async () => JSON.parse(fs.readFileSync(path.join(root, address.replace('moz-extension://audit/', '')), 'utf8')) };
    throw new Error('Unplanned content fetch: ' + address);
  };
  dom.window.console.warn = dom.window.console.error = (...args) => errors.push(args.map(String).join(' '));
  for (const file of ['extension/lib/normalizer.js', 'extension/lib/custom-indexes.js', 'extension/lib/i18n.js', 'extension/data/business-rankings.js', 'extension/data/ajg-2024.js', 'extension/data/issn-index.js']) {
    dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  let content = fs.readFileSync(path.join(root, 'extension/content/content-v7.js'), 'utf8');
  content = content.replace(/  try \{\r?\n    state\.settings = await getSettings\(\);/,
    '  globalThis.__contentAudit = { state, venueKey, abbreviationKey, shardKey, matchRecord, scholarSourceRecord, recordIdentity, primaryShardsForText };\n  try {\n    state.settings = await getSettings();');
  if (!content.includes('globalThis.__contentAudit')) throw new Error('Content harness injection failed');
  dom.window.eval(content);
  if (options.includeFilterUi) dom.window.eval(fs.readFileSync(path.join(root, 'extension/content/filter-ui.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, options.waitMs ?? 300));
  const doc = dom.window.document;
  const deadline = Date.now() + 5000;
  while (doc.documentElement.dataset.paperRankStatus === 'loading-data' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return { dom, background, errors, messages, directFetches, changeSettings, settings, api: dom.window.__contentAudit,
    close() { observers.forEach(observer => observer.disconnect()); dom.window.close(); },
    snapshot() { return { url, status: doc.documentElement.dataset.paperRankStatus,
      detail: doc.documentElement.dataset.paperRankDetail,
      labels: [...doc.querySelectorAll('.rank-assistant-badge')].map(node => node.textContent),
      rows: doc.querySelectorAll('.rank-assistant-row').length, errors, messages,
      encryptedFetches: background.fetches.filter(value => value.includes('.encrypted.json')),
      plaintextFallbackFetches: directFetches.filter(value => value.includes('.private.json')) }; } };
}

export function saveJson(name, value) {
  const destination = path.join(process.env.PAPER_RANK_TEST_ARTIFACT_DIR || path.join(root, 'artifacts/all-sites-fix-20261011'), name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(destination, 'utf8'));
  return destination;
}
