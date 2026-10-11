import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBackground, runEncryptedPage } from './helpers/encrypted-runtime.mjs';

const officialA = 'IEEE Transactions on Pattern Analysis and Machine Intelligence';
const outside = 'Journal of Campus Methods';
const unknown = 'Unlisted Venue QZX';
const entry = (title, level, aliases = [], issns = []) => ({ title, level, aliases, issns });
const indexes = [
  { id: 'campus', name: '校级目录', enabled: true, updatedAt: '2026-10-11T00:00:00Z', entries: [entry(officialA, '一级'), entry(outside, '二级'), entry('校本信息科学学报', '三级')] },
  { id: 'unit', name: '院级目录', enabled: true, entries: [entry(officialA, '重点'), entry(outside, '收录')] },
  { id: 'issn', name: 'ISSN目录', enabled: true, entries: [entry('Campus Alternate Title', 'I', [], ['0162-8828'])] },
  { id: 'unlisted-issn', name: '独立ISSN目录', enabled: true, entries: [entry('Campus Private Venue Registered', '独有', [], ['1234-5679'])] },
  { id: 'safe', name: '目录 <img src=x>', enabled: true, entries: [entry('校本信息科学学报', '<优>')] },
  { id: 'disabled', name: '停用目录', enabled: false, entries: [entry(outside, '隐藏')] }
];
const settings = { customIndexes: indexes };
const background = createBackground();
const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const labels = (page, id = '') => [...page.dom.window.document.querySelectorAll((id ? '#' + id + ' ' : '') + '.rank-assistant-badge')].map(node => node.textContent);
const custom = (page, id = '') => [...page.dom.window.document.querySelectorAll((id ? '#' + id + ' ' : '') + '.rank-assistant-badge[data-kind="custom"]')].map(node => node.textContent);
const hidden = (page, id) => page.dom.window.document.querySelector('#' + id).classList.contains('rank-assistant-filter-hidden');
const scholarCard = (id, venue, paperTitle = 'A diagnostic paper', author = 'A Author', extra = '') => `<div class="gs_r gs_or gs_scl" id="${id}"><div class="gs_ri"><h3 class="gs_rt"><a>${paperTitle}</a></h3><div class="gs_a">${author} - ${venue}, 2026 - example.org</div>${extra}</div></div>`;
async function pageCase(name, url, html, check, options = {}) {
  const page = await runEncryptedPage(url, html, { background, settings, waitMs: 350, ...options });
  try {
    await check(page);
    assert.equal(page.snapshot().plaintextFallbackFetches.length, 0, name + ' read a plaintext catalog');
    results.push({ name, status: page.snapshot().status, labels: labels(page), passed: true });
    console.log(name + ': passed');
  } finally { page.close(); }
  global.gc?.();
}

await pageCase('Scholar trusted source, official canonical ISSN, and unsafe fields', 'https://scholar.google.com/scholar?q=custom',
  '<main>' + [
    scholarCard('known', officialA), scholarCard('outside', outside), scholarCard('chinese', '校本信息科学学报'),
    scholarCard('title', unknown, outside, 'A Author', `<div class="gs_rs">${outside}</div>`),
    scholarCard('author', unknown, 'A paper', `<a href="/citations?user=sample">${outside}</a>`),
    scholarCard('truncated', 'Journal of Campus…'),
    scholarCard('explicit', unknown, 'A paper', 'A Author', `<span class="easyScholarPaperFlag" data-journal="${outside}">${outside}</span>`),
    scholarCard('author-enrichment', unknown, 'A paper', `<a href="/citations?user=sample"><span class="easyScholarPaperFlag">${outside}</span></a>`)
  ].join('') + '</main>', async page => {
    assert.ok(labels(page, 'known').includes('CCF A'));
    assert.ok(custom(page, 'known').includes('自定义：校级目录 一级'));
    assert.ok(custom(page, 'known').includes('自定义：ISSN目录 I'), 'real official record ISSN must match');
    assert.deepEqual(custom(page, 'outside'), ['自定义：校级目录 二级', '自定义：院级目录 收录']);
    assert.equal(page.dom.window.document.querySelector('#outside').dataset.paperRankMatched, undefined, 'custom must not impersonate an official match');
    assert.deepEqual(JSON.parse(page.dom.window.document.querySelector('#outside').dataset.paperRankCustomMembership), [{ id: 'campus', level: '二级' }, { id: 'unit', level: '收录' }]);
    for (const id of ['title', 'author', 'truncated', 'author-enrichment']) assert.deepEqual(custom(page, id), [], id + ' unsafe source leaked');
    assert.ok(custom(page, 'explicit').includes('自定义：校级目录 二级'));
    const safeBadge = page.dom.window.document.querySelector('#chinese [data-custom-index-id="safe"]');
    assert.equal(safeBadge.textContent, '自定义：目录 <img src=x> <优>');
    assert.equal(safeBadge.querySelector('img'), null);
    assert.match(safeBadge.dataset.tooltip, /用户上传|自定义/);
    assert.equal(page.snapshot().status, 'ready');
    assert.equal(page.errors.length, 0);
  });

const scopeIndexes = [{ id: 'scope', name: '范围目录', enabled: true, entries: [
  entry('IEEE/CVF Conference on Computer Vision and Pattern Recognition', 'A', ['CVPR']),
  entry('Nature', 'N'), entry(outside, '校级'), entry('Workshop on Campus Methods', 'W')
] }];
await pageCase('Custom sources preserve venue scope and reject original ellipses', 'https://arxiv.org/search/?query=custom-scope',
  '<ol>' + [
    ['workshops', 'Accepted at CVPR 2026 Workshops'], ['nature', 'International Conference on Nature'],
    ['ellipsis-after-year', outside + ' 2026 …'], ['workshops-control', 'CVPR Workshops 2026'],
    ['cvpr', 'CVPR 2026'], ['complete', outside + ' 2026'], ['legitimate-workshop', 'Workshop on Campus Methods 2026']
  ].map(([id, source]) => `<li class="arxiv-result" id="${id}"><p class="title">Diagnostic paper</p><p class="comments">Comments: ${source}</p></li>`).join('') + '</ol>', page => {
    for (const id of ['workshops', 'nature', 'ellipsis-after-year', 'workshops-control']) assert.deepEqual(custom(page, id), [], id + ' lost a source qualifier');
    assert.deepEqual(custom(page, 'cvpr'), ['自定义：范围目录 A']);
    assert.deepEqual(custom(page, 'complete'), ['自定义：范围目录 校级']);
    assert.deepEqual(custom(page, 'legitimate-workshop'), ['自定义：范围目录 W']);
  }, { settings: { customIndexes: scopeIndexes } });
await pageCase('Scholar original source qualifiers survive bibliographic parsing', 'https://scholar.google.com/scholar?q=custom-scope',
  '<main>' + scholarCard('ellipsis', outside + ', 2026 …') + scholarCard('workshops', outside + ', 2026 Workshops') + '</main>', page => {
    assert.deepEqual(custom(page, 'ellipsis'), []);
    assert.deepEqual(custom(page, 'workshops'), []);
  });

const fixtures = [
  ['Scholar profile', 'https://scholar.google.com/citations?user=custom', `<table><tbody><tr class="gsc_a_tr" id="card"><td class="gsc_a_t"><a class="gsc_a_at">Diagnostic paper</a><div class="gs_gray">A Author</div><div class="gs_gray">${outside}, 2026</div></td></tr></tbody></table>`],
  ['DBLP', 'https://dblp.org/search?q=custom', `<section id="completesearch-publs"><ul class="publ-list"><li class="entry article" id="card"><cite class="data"><span class="title" itemprop="name">Diagnostic paper</span><span itemprop="isPartOf"><a href="/db/journals/campus/"><span itemprop="name">${outside}</span></a></span></cite></li></ul></section>`],
  ['arXiv', 'https://arxiv.org/search/?query=custom', `<ol><li class="arxiv-result" id="card"><p class="title">Diagnostic paper</p><p class="journal-ref">Journal reference: ${outside}</p></li></ol>`],
  ['PubMed', 'https://pubmed.ncbi.nlm.nih.gov/?term=custom', `<article class="full-docsum" id="card"><a class="docsum-title">Diagnostic paper</a><span class="docsum-journal-citation">${outside}. 2026;1:1.</span></article>`],
  ['Semantic Scholar', 'https://www.semanticscholar.org/search?q=custom', `<div data-testid="paper-row" id="card"><a href="/paper/custom">Diagnostic paper</a><span class="cl-paper-venue">${outside}</span></div>`],
  ['OpenAlex', 'https://openalex.org/works?q=custom', `<article data-testid="work-result" id="card"><a href="/works/custom">Diagnostic paper</a><span data-testid="source">${outside}</span></article>`],
  ['CNKI', 'https://kns.cnki.net/kns8s/defaultresult/index?kw=custom', `<table class="result-table-list"><tbody><tr id="card"><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=custom">Diagnostic paper</a></td><td class="source"><a>${outside}</a></td></tr></tbody></table>`],
  ['Wanfang', 'https://s.wanfangdata.com.cn/paper?q=custom', `<div class="normal-list-item" id="card"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/custom">Diagnostic paper</a></div><div class="source"><a>${outside}</a></div></div>`],
  ['AMiner', 'https://www.aminer.cn/search/pub?q=custom', `<div class="paper-item" id="card"><a class="title-link" href="/pub/custom">Diagnostic paper</a><div class="conf-info-zone"><div class="venue-link"><a>${outside}</a></div></div></div>`],
  ['Baidu Scholar', 'https://xueshu.baidu.com/s?wd=custom', `<div class="paper-wrap result" id="card"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=custom">Diagnostic paper</a></h3><div class="paper-info">Author - 《${outside}》 - 2026</div></div>`],
  ['ResearchGate', 'https://www.researchgate.net/search/publication?q=custom', `<article class="publication-item" id="card"><h3><a href="/publication/custom">Diagnostic paper</a></h3><a href="/journal/custom">${outside}</a></article>`],
  ['Publisher search', 'https://www.sciencedirect.com/search?q=custom', `<div class="search-result-item" id="card"><h2><a href="/article/custom">Diagnostic paper</a></h2><div class="publication-title">${outside}</div></div>`],
  ['Publisher article', 'https://www.sciencedirect.com/science/article/pii/custom', `<head><meta name="citation_journal_title" content="${outside}"></head><main id="card"><h1>Diagnostic paper</h1><a class="journal-title">${outside}</a></main>`]
];
for (const [name, url, html] of fixtures) await pageCase(name + ' outside official catalog', url, html, page => {
  assert.ok(custom(page).includes('自定义：校级目录 二级'), name + ': ' + JSON.stringify(labels(page)));
  assert.equal(page.snapshot().status, 'ready', name);
  assert.equal(page.snapshot().plaintextFallbackFetches.length, 0);
});

for (const [name, url, html] of [
  ['Publisher article native ISSN', 'https://www.sciencedirect.com/science/article/pii/custom-native-issn', '<head><meta name="citation_journal_title" content="Uncatalogued Native Venue QZX"><meta name="citation_issn" content="1234-5679"></head><main><h1>Diagnostic paper</h1></main>'],
  ['Publisher journal home native ISSN', 'https://www.sciencedirect.com/journal/custom-native-issn', '<head><meta name="citation_issn" content="1234-5679"></head><main><header class="journal-header"><h1>Uncatalogued Native Venue QZX</h1></header></main>']
]) await pageCase(name, url, html, page => {
  assert.deepEqual(custom(page), ['自定义：独立ISSN目录 独有']);
  assert.ok(labels(page).includes('CCF None'), 'unique custom ISSN must not fabricate an official catalog record');
  assert.equal(page.dom.window.document.querySelector('[data-paper-rank-custom-membership]').dataset.paperRankMatched, undefined);
  assert.equal(page.snapshot().status, 'ready');
});
await pageCase('Publisher search global ISSN does not contaminate cards', 'https://www.sciencedirect.com/search?q=custom-native-issn',
  `<head><meta name="citation_journal_title" content="Uncatalogued Native Venue QZX"><meta name="citation_issn" content="1234-5679"></head><main><div class="search-result-item" id="unknown"><h2><a>Diagnostic paper</a></h2><div class="publication-title">${unknown}</div></div><div class="search-result-item" id="outside"><h2><a>Another paper</a></h2><div class="publication-title">${outside}</div></div></main>`, page => {
    assert.deepEqual(custom(page, 'unknown'), []);
    assert.deepEqual(custom(page, 'outside'), ['自定义：校级目录 二级', '自定义：院级目录 收录']);
    assert.ok(!custom(page).some(label => label.includes('独立ISSN目录')));
  });

await pageCase('Dynamic custom settings, filter UI, OR/AND semantics and lifecycle', 'https://scholar.google.com/scholar?q=custom-filter',
  '<main>' + scholarCard('known', officialA) + scholarCard('outside', outside) + scholarCard('unknown', unknown) + '</main>', async page => {
    const shadow = page.dom.window.document.querySelector('#rank-assistant-filter-host').shadowRoot;
    assert.match(shadow.querySelector('#indexes').textContent, /自定义：校级目录/);
    assert.doesNotMatch(shadow.querySelector('#indexes').textContent, /停用目录/);
    await page.changeSettings({ resultFilters: { indexes: ['custom:campus'], values: { 'custom:campus': ['一级', '二级'] } } });
    await wait(450);
    assert.equal(hidden(page, 'known'), false);
    assert.equal(hidden(page, 'outside'), false);
    assert.equal(hidden(page, 'unknown'), true, 'same-index selected levels must be OR');
    assert.match(shadow.querySelector('#values').textContent, /一级/);
    await page.changeSettings({ resultFilters: { indexes: ['ccf', 'custom:campus'], values: { ccf: ['A'], 'custom:campus': ['一级', '二级'] } } });
    await wait(450);
    assert.equal(hidden(page, 'known'), false);
    assert.equal(hidden(page, 'outside'), true, 'different indexes must be AND');
    await page.changeSettings({ resultFilters: { indexes: [], values: {} }, showCcf: false });
    await wait(450);
    assert.ok(custom(page, 'outside').length > 0, 'showCcf must not hide custom badges');
    assert.ok(!labels(page).some(label => /^CCF /.test(label)));
    await page.changeSettings({ showCustomIndexes: false, showCcf: true });
    await wait(450);
    assert.equal(custom(page).length, 0);
    assert.ok(labels(page, 'known').includes('CCF A'));
    assert.equal(JSON.parse(page.dom.window.document.querySelector('#outside').dataset.paperRankCustomMembership).length, 2, 'hidden custom badges retain filter membership');
    const updated = structuredClone(indexes);
    updated[0].name = '新版校级目录';
    updated[0].entries[1].level = '特级';
    await page.changeSettings({ customIndexes: updated, showCustomIndexes: true, resultFilters: { indexes: ['custom:campus'], values: { 'custom:campus': ['二级'] } } });
    await wait(500);
    assert.ok(custom(page, 'outside').includes('自定义：新版校级目录 特级'), 'matcher cache must follow storage changes');
    assert.deepEqual(page.settings.resultFilters.values['custom:campus'], [], 'removed level filter must be cleaned');
    const disabled = structuredClone(updated);
    disabled[0].enabled = false;
    await page.changeSettings({ customIndexes: disabled });
    await wait(450);
    assert.ok(!page.settings.resultFilters.indexes.includes('custom:campus'), 'disabled dynamic key persisted');
    assert.ok(!custom(page, 'outside').some(label => label.includes('新版校级目录')));
    assert.doesNotMatch(shadow.querySelector('#indexes').textContent, /新版校级目录/);
    await page.changeSettings({ resultFilters: { indexes: ['custom:unit'], values: { 'custom:unit': ['收录'] } } });
    await wait(450);
    await page.changeSettings({ customIndexes: [] });
    await wait(500);
    assert.deepEqual(JSON.parse(JSON.stringify(page.settings.resultFilters)), { indexes: [], values: {} });
    assert.equal(custom(page).length, 0);
    for (const id of ['known', 'outside', 'unknown']) assert.equal(hidden(page, id), false);
    await page.changeSettings({ customIndexes: indexes });
    await wait(450);
    const source = page.dom.window.document.querySelector('#outside .gs_a');
    source.textContent = 'A Author - ' + unknown + ', 2026 - example.org';
    await wait(500);
    assert.deepEqual(custom(page, 'outside'), [], 'source mutation must discard old custom badge');
    source.textContent = 'A Author - ' + outside + ', 2026 - example.org';
    await wait(500);
    assert.equal(custom(page, 'outside').length, 2);
    const messages = page.messages.length;
    await wait(600);
    assert.equal(page.messages.length, messages, 'own output must not trigger endless catalog reloads');
    for (const id of ['known', 'outside', 'unknown']) assert.equal(page.dom.window.document.querySelector('#' + id).querySelectorAll('.rank-assistant-row').length, 1);
    await page.changeSettings({ enabled: false });
    await wait(300);
    assert.equal(labels(page).length, 0);
    assert.equal(page.dom.window.document.querySelector('#outside').dataset.paperRankCustomMembership, undefined, 'disabled extension retained custom membership');
    await page.changeSettings({ enabled: true });
    await wait(450);
    assert.equal(custom(page, 'outside').length, 2);
    assert.equal(page.errors.length, 0);
  }, { includeFilterUi: true });

for (const [name, url, html, fault] of [
  ['Scholar missing encrypted catalog', 'https://scholar.google.com/scholar?q=custom-error', scholarCard('card', outside), { missingPackaged: true }],
  ['Scholar corrupt encrypted catalog', 'https://scholar.google.com/scholar?q=custom-error', scholarCard('card', outside), { corruptPackaged: ['j'] }],
  ['DBLP missing encrypted catalog', fixtures[1][1], fixtures[1][2], { missingPackaged: true }]
]) await pageCase(name, url, html, async page => {
  assert.equal(page.snapshot().status, 'error');
  assert.deepEqual(labels(page), ['自定义：校级目录 二级', '自定义：院级目录 收录']);
  assert.equal(page.dom.window.document.querySelector('#card').dataset.paperRankMatched, undefined);
  await wait(600);
  assert.equal(page.snapshot().status, 'error', 'own custom render must not overwrite catalog error');
  assert.equal(page.snapshot().plaintextFallbackFetches.length, 0);
}, { background: createBackground(fault) });

await pageCase('Empty custom indexes preserve catalog fault behavior', 'https://scholar.google.com/scholar?q=custom-error', scholarCard('card', outside), page => {
  assert.equal(page.snapshot().status, 'error');
  assert.deepEqual(labels(page), []);
}, { background: createBackground({ missingPackaged: true }), settings: { customIndexes: [] } });

const recoveryFault = { missingPackaged: ['i'] };
await pageCase('Custom-only error remains retryable when catalog recovers', 'https://www.sciencedirect.com/search?q=custom-recovery',
  `<div class="search-result-item" id="card"><h2><a>Diagnostic paper</a></h2><div class="publication-title">${outside}</div></div>`, async page => {
    const source = page.dom.window.document.querySelector('.publication-title');
    source.textContent = officialA;
    await wait(450);
    assert.equal(page.snapshot().status, 'error');
    assert.deepEqual(labels(page), ['自定义：校级目录 一级', '自定义：院级目录 重点']);
    const messageCount = page.messages.length;
    await wait(300);
    assert.equal(page.messages.length, messageCount, 'custom-only output retried its own catalog failure');
    recoveryFault.missingPackaged = [];
    source.textContent = officialA + ' ';
    await wait(450);
    assert.equal(page.snapshot().status, 'ready');
    assert.ok(labels(page).includes('CCF A'));
    assert.ok(custom(page).includes('自定义：ISSN目录 I'));
  }, { background: createBackground(recoveryFault) });

const sourceSha256 = Object.fromEntries(['extension/content/content-v7.js', 'extension/content/filter-ui.js', 'extension/content/badges.css', 'extension/lib/custom-indexes.js']
  .map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const report = { passed: true, cases: results.length, sourceShapes: fixtures.length + 1, sourceSha256, results };
const destination = path.resolve('artifacts/custom-indexes-20261011/runtime.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).passed, true);
console.log(JSON.stringify({ passed: true, cases: results.length, sourceShapes: fixtures.length + 1, plaintextCatalogReads: 0, report: destination }));
