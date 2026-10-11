import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createBackground, runEncryptedPage } from './helpers/encrypted-runtime.mjs';

const directory = path.resolve(process.env.PAPER_RANK_TEST_ARTIFACT_DIR || 'artifacts/all-sites-fix-20261011');
fs.mkdirSync(directory, { recursive: true });
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const firefox = JSON.parse(fs.readFileSync('manifest.firefox.json', 'utf8'));
const patterns = [...new Set(manifest.content_scripts.flatMap((entry) => entry.matches))];
const firefoxPatterns = [...new Set(firefox.content_scripts.flatMap((entry) => entry.matches))];
const contentSource = fs.readFileSync('extension/content/content-v7.js', 'utf8');
const backgroundSource = fs.readFileSync('extension/background/background.js', 'utf8');
const kindSource = contentSource.slice(contentSource.indexOf('function siteKind()'), contentSource.indexOf('const PUBLISHER_RESULT_SELECTOR'));
const getKind = new Function('location', kindSource + '; return siteKind();');
const canonicalUrl = (pattern) => pattern.replace('https://*.', 'https://matrix.').replace(/\/\*$/, '/search?q=encrypted-manifest-audit');
const kindFor = (url) => getKind({ hostname: new URL(url).hostname });
const background = createBackground();
const customMode = process.argv.includes('--custom-indexes');
const customSettings = customMode ? { customIndexes: [{
  id: 'manifest-custom', name: '跨学科样例目录', enabled: true,
  entries: [
    { title: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', level: '校内A', aliases: [], issns: [] },
    { title: 'Unlisted Audit Venue QZX', level: '校内B', aliases: [], issns: [] },
    { title: 'ACM International Conference on Mobile', level: '校内C', aliases: [], issns: [] },
  ],
}] } : {};
const venues = [
  { id: 'known-a', title: 'A model paper', venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence', expected: 'CCF A', key: '/db/journals/pami/' },
  { id: 'known-b', title: 'A recognition paper', venue: 'Pattern Recognition', expected: 'CCF B', key: '/db/journals/pr/' },
  { id: 'unknown', title: 'An unknown-source paper', venue: 'Unlisted Audit Venue QZX', expected: 'CCF None', key: '/db/journals/audit-unknown/' },
  { id: 'generic-negative', title: 'A neutral generic-source paper', venue: 'Analysis of results', expected: 'CCF None', key: '' },
];
function card(kind, item) {
  const { id, title, venue, key } = item;
  if (kind === 'dblp') return `<li class="entry article" id="${id}"><cite class="data"><span class="title" itemprop="name">${title}</span><span itemprop="isPartOf"><a href="${key}"><span itemprop="name">${venue}</span></a></span></cite></li>`;
  if (kind === 'scholar') return `<div class="gs_r gs_or gs_scl" id="${id}"><div class="gs_ri"><h3 class="gs_rt"><a>${title}</a></h3><div class="gs_a">A Author - ${venue}, 2025 - example.org</div></div></div>`;
  if (kind === 'arxiv') return `<li class="arxiv-result" id="${id}"><p class="title">${title}</p><p class="journal-ref">Journal reference: ${venue}</p></li>`;
  if (kind === 'pubmed') return `<article class="full-docsum" id="${id}"><a class="docsum-title">${title}</a><span class="docsum-journal-citation">${venue}. 2025;1:1.</span></article>`;
  if (kind === 'semantic-scholar') return `<div data-testid="paper-row" id="${id}"><a href="/paper/${id}">${title}</a><span class="cl-paper-venue">${venue}</span></div>`;
  if (kind === 'openalex') return `<article data-testid="work-result" id="${id}"><a href="/works/${id}">${title}</a><span data-testid="source">${venue}</span></article>`;
  if (kind === 'cnki') return `<tr id="${id}"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=${id}">${title}</a></td><td class="source"><a>${venue}</a></td></tr>`;
  if (kind === 'wanfang') return `<div class="normal-list-item" id="${id}"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/${id}">${title}</a></div><div class="source"><a>${venue}</a></div></div>`;
  if (kind === 'aminer') return `<div class="paper-item" id="${id}"><a class="title-link" href="/pub/${id}"><span class="paper-title">${title}</span></a><div class="conf-info-zone"><div class="venue-link"><a>${venue}</a></div></div></div>`;
  if (kind === 'baidu-scholar') return `<div class="paper-wrap result" id="${id}"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=${id}">${title}</a></h3><div class="paper-info">A Author - 《${venue}》 - 2025</div></div>`;
  if (kind === 'researchgate') return `<article class="publication-item" id="${id}"><h3><a href="/publication/${id}">${title}</a></h3><a href="/journal/${id}">${venue}</a></article>`;
  if (kind === 'publisher') return `<div class="search-result-item" id="${id}"><h2><a href="/article/${id}">${title}</a></h2><div class="publication-title">${venue}</div></div>`;
  throw new Error('Unhandled manifest kind: ' + kind);
}
function searchFixture(kind) {
  const body = venues.map((item) => card(kind, item)).join('');
  if (kind === 'dblp') return `<section id="completesearch-publs"><ul class="publ-list">${body}</ul></section>`;
  if (kind === 'cnki') return `<table class="result-table-list"><tbody>${body}</tbody></table>`;
  if (kind === 'arxiv') return `<ol>${body}</ol>`;
  return `<main>${body}</main>`;
}
function labelsWithin(document, id) {
  return [...(document.querySelector('#' + id)?.querySelectorAll('.rank-assistant-badge') || [])].map((node) => node.textContent);
}
const searchResults = [];
const detailResults = [];
const failures = [];
for (const [index, pattern] of patterns.entries()) {
  const url = canonicalUrl(pattern);
  const kind = kindFor(url);
  const page = await runEncryptedPage(url, searchFixture(kind), { background, settings: customSettings, waitMs: 220 });
  const snapshot = page.snapshot();
  const cards = venues.map((item) => {
    const labels = labelsWithin(page.dom.window.document, item.id);
    const officialLabels = labels.filter(label => !label.includes('跨学科样例目录'));
    const officialPass = item.expected === 'CCF None' ? officialLabels.length === 1 && officialLabels[0] === 'CCF None' : officialLabels.includes(item.expected);
    const customExpected = customMode && ['known-a', 'unknown'].includes(item.id);
    const customActual = labels.some(label => label.includes('跨学科样例目录'));
    const pass = officialPass && (!customMode || customExpected === customActual);
    return { id: item.id, expected: item.expected, customExpected, customActual, labels, pass };
  });
  const pass = cards.every((item) => item.pass) && snapshot.status === 'ready' && snapshot.errors.length === 0 && snapshot.plaintextFallbackFetches.length === 0;
  const result = { pattern, kind, url, evidence: 'constructed-selector-fixture-real-background-aes-gcm', pass, cards, ...snapshot };
  searchResults.push(result);
  if (!pass) failures.push({ phase: 'search', pattern, cards, errors: snapshot.errors, status: snapshot.status });
  page.close();
  if (kind === 'publisher') {
    for (const [variant, venue, expected] of [
      ['known', venues[0].venue, 'CCF A'],
      ['ambiguous-negative', 'ACM International Conference on Mobile...', 'CCF None'],
    ]) {
      const detailUrl = url.replace('/search?q=encrypted-manifest-audit', '/article/encrypted-manifest-' + variant);
      const html = `<head><meta name="citation_title" content="A model paper"><meta name="citation_journal_title" content="${venue}"></head><body><main id="detail"><h1>A model paper</h1></main></body>`;
      const detailPage = await runEncryptedPage(detailUrl, html, { background, settings: customSettings, waitMs: 200 });
      const detail = detailPage.snapshot();
      const labels = labelsWithin(detailPage.dom.window.document, 'detail');
      const officialLabels = labels.filter(label => !label.includes('跨学科样例目录'));
      const officialPass = expected === 'CCF None' ? officialLabels.length === 1 && officialLabels[0] === expected : officialLabels.includes(expected);
      const customPass = !customMode || labels.some(label => label.includes('跨学科样例目录')) === (variant === 'known');
      const pass = officialPass && customPass && detail.status === 'ready' && detail.errors.length === 0 && detail.plaintextFallbackFetches.length === 0;
      detailResults.push({ pattern, variant, expected, pass, ...detail, labels });
      if (!pass) failures.push({ phase: 'detail', pattern, variant, expected, labels, errors: detail.errors, status: detail.status });
      detailPage.close();
      if (global.gc) global.gc();
    }
  }
  if (global.gc) global.gc();
  if ((index + 1) % 10 === 0) console.log(JSON.stringify({ completedPatterns: index + 1, totalPatterns: patterns.length, failures: failures.length }));
}
const result = {
  customIndexesEnabled: customMode,
  auditDate: '2026-10-11',
  limitations: ['Constructed fixture shapes validate declared URL dispatch and actual encrypted background/content integration only; no live-site compatibility claim.', 'Shared actual background service code with mocked Chrome storage and local packaged-resource fetch; external network is unavailable.', 'The catalog is decrypted by the production AES-GCM/SHA-256 implementation; plaintext runtime shards are forbidden.'],
  sourceSha256: { content: createHash('sha256').update(contentSource).digest('hex'), background: createHash('sha256').update(backgroundSource).digest('hex') },
  manifestsAligned: JSON.stringify(patterns) === JSON.stringify(firefoxPatterns),
  counts: { patterns: patterns.length, searchPages: searchResults.length, searchCards: searchResults.length * venues.length, publisherPatterns: detailResults.length / 2, publisherDetailPages: detailResults.length, totalPages: searchResults.length + detailResults.length, searchPassed: searchResults.filter((entry) => entry.pass).length, detailsPassed: detailResults.filter((entry) => entry.pass).length, failures: failures.length },
  backgroundFetches: background.fetches,
  backgroundErrors: background.errors,
  searchResults, detailResults, failures,
};
const file = path.join(directory, customMode ? 'custom-manifest-site-regression.json' : 'manifest-site-regression.json');
fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(JSON.stringify({ counts: result.counts, manifestsAligned: result.manifestsAligned, encryptedFetches: background.fetches.filter((url) => url.endsWith('.encrypted.json')).length, plaintextFetches: background.fetches.filter((url) => url.includes('.private.json')).length, failures }, null, 2));
assert.equal(result.manifestsAligned, true, 'Chrome and Firefox declared URL patterns must align');
assert.equal(result.counts.failures, 0, 'Every manifest-driven search and publisher detail case must pass');
assert.equal(result.counts.totalPages, patterns.length + 2 * patterns.filter((pattern) => kindFor(canonicalUrl(pattern)) === 'publisher').length);
assert.equal(result.backgroundErrors.length, 0);
assert.equal(background.fetches.filter((url) => url.includes('.private.json')).length, 0);
assert.ok(background.fetches.some((url) => url.endsWith('.encrypted.json')), 'Production encrypted catalog decryption must be exercised');
