import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const context = { TextDecoder, crypto: webcrypto };
vm.runInNewContext(fs.readFileSync('extension/lib/custom-indexes.js', 'utf8'), context);
const api = context.RankAssistantCustomIndexes;
const plain = value => JSON.parse(JSON.stringify(value));
const file = (name, content) => ({
  name, size: Buffer.byteLength(content), text: async () => content,
  arrayBuffer: async () => Uint8Array.from(Buffer.from(content)).buffer,
});
const table = rows => ({ headers: ['名称', '等级', 'ISSN', '别名'], rows });
const build = (rows, name = '学校目录', id = 'custom-school') => api.fromTable(table(rows), { name, id });
const record = (title, issns = []) => { const value = Array(14).fill(''); value[0] = title; value[13] = issns; return value; };
const cases = [];
async function test(id, operation) {
  try { await operation(); cases.push({ id, passed: true }); }
  catch (error) { cases.push({ id, passed: false, error: error.message }); }
}

await test('public-schema-and-columns', () => {
  assert.equal(api.SCHEMA_VERSION, 1);
  assert.equal(api.STORAGE_KEY, 'customIndexes');
  assert.deepEqual(plain(api.CSV_HEADERS), ['名称', '等级', 'ISSN', '别名']);
  assert.deepEqual(plain(api.inferColumns(['名称', '等级', 'ISSN', '别名'])), { titleColumn: 0, levelColumn: 1, issnColumn: 2, aliasColumn: 3 });
  assert.deepEqual(plain(api.inferColumns(['Journal Name', 'Tier', 'e-ISSN', 'Abbreviations'])), { titleColumn: 0, levelColumn: 1, issnColumn: 2, aliasColumn: 3 });
  assert.equal(api.inferColumns(['等级', '别名']).titleColumn, -1);
});

await test('csv-bom-chinese-quotes-comma-and-newline', async () => {
  const parsed = await api.parseFile(file('校内经管.csv', '\uFEFF名称,等级,ISSN,别名\r\n"管理,科学",A,1234-567X,"管科;Management Science"\r\n"Journal ""Alpha""\nSeries",B,,Alpha\r\n'));
  assert.equal(parsed.suggestedName, '校内经管');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][0], '管理,科学');
  assert.equal(parsed.rows[1][0], 'Journal "Alpha"\nSeries');
  const result = api.fromTable(parsed, { name: '校内经管' });
  assert.equal(result.errors.length, 0);
  assert.equal(result.index.entries[0].aliases.length, 2);
});

await test('tsv-english-template', async () => {
  const parsed = await api.parseFile(file('business.tsv', 'name\tlevel\tissn\taliases\nJournal of Finance\tA+\t1540-6261\tJF;The Journal of Finance\n'));
  const result = api.fromTable(parsed, { name: parsed.suggestedName });
  assert.equal(result.errors.length, 0);
  assert.equal(result.index.entries[0].issns[0], '15406261');
});

await test('json-single-index-backup', async () => {
  const original = build([['School-only Conference', '重点', '', 'SOC;School Conference']]).index;
  const parsed = await api.parseFile(file('backup.json', JSON.stringify(original)));
  const result = api.fromTable(parsed, { name: parsed.suggestedName, id: original.id });
  assert.equal(parsed.suggestedName, '学校目录');
  assert.deepEqual(plain(result.index.entries), plain(original.entries));
});

await test('json-entry-array-and-single-index-wrapper', async () => {
  const entry = { title: '校内会议', level: '推荐', aliases: ['校会'], issns: ['1234-567X'] };
  for (const input of [[entry], { schemaVersion: 1, customIndexes: [{ name: '备份', entries: [entry] }] }]) {
    const parsed = await api.parseFile(file('backup.json', JSON.stringify(input)));
    assert.equal(api.fromTable(parsed, { name: '导入' }).errors.length, 0);
  }
  await assert.rejects(api.parseFile(file('backup.json', '{"customIndexes":[{},{}]}')), /多个索引/);
});

await test('csv-structure-errors-are-explicit', async () => {
  for (const input of ['名称,等级\nFoo,A,extra\n', '名称,等级\n"Foo,A\n', '名称,等级\n"Foo"bad,A\n', '名称,等级\nF"oo,A\n']) {
    await assert.rejects(api.parseFile(file('broken.csv', input)), /列|引号|字符/);
  }
  await assert.rejects(api.parseFile(file('duplicate.csv', '名称,名称\nFoo,Bar\n')), /重复列名/);
});

await test('missing-name-column-or-row-never-silently-dropped', () => {
  const missingColumn = api.fromTable({ headers: ['等级', 'ISSN'], rows: [['A', '1234-567X']] }, { name: '目录' });
  assert.equal(missingColumn.index, null);
  assert(missingColumn.errors.some(error => /名称.*列/.test(error)));
  const missingRow = build([['Valid Journal', 'A', '', ''], ['', 'B', '', '']]);
  assert.equal(missingRow.index, null);
  assert.equal(missingRow.stats.totalRows, 2);
  assert(missingRow.errors.some(error => /第 3 行缺少名称/.test(error)));
  const blank = build([['', '', '', '']]);
  assert.equal(blank.index, null);
  assert.equal(blank.stats.blankRows, 1);
});

await test('empty-level-defaults-to-included-and-optional-columns', () => {
  const result = build([['School-only Journal', '', '', '']]);
  assert.equal(result.index.entries[0].level, '收录');
  const titleOnly = api.fromTable({ headers: ['名称'], rows: [['School-only Journal']] }, { name: '简单目录' });
  assert.equal(titleOnly.errors.length, 0);
  assert.equal(titleOnly.index.entries[0].level, '收录');
});

await test('duplicate-merge-retains-every-name-alias-and-issn', () => {
  const result = build([
    ['Journal Alpha', 'A', '1234-567X', 'JA'],
    ['Journal Alpha', 'A', '1234-567X;8765-4321', 'Journal A'],
    ['Historical Journal Alpha', 'A', '1234-567X', 'Old JA'],
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.mergedRows, 2);
  assert.equal(result.index.entries.length, 1);
  assert.deepEqual(plain(result.index.entries[0].issns), ['1234567X', '87654321']);
  assert(result.index.entries[0].aliases.includes('Historical Journal Alpha'));
  assert(result.index.entries[0].aliases.includes('Old JA'));
  assert.equal(result.warnings.length, 1);
});

await test('duplicate-chinese-name-conflicting-issns-rejects-with-lines', () => {
  const result = build([['测试学报', 'A', '1234-5679', ''], ['测试学报。', 'A', '9876-5432', '']]);
  assert.equal(result.index, null);
  assert.equal(result.stats.mergedRows, 0);
  assert(result.errors.some(error => /第 2 行与第 3 行/.test(error) && /ISSN 集合冲突/.test(error)));
});

await test('duplicate-alias-conflicting-issns-rejects', () => {
  const result = build([['Journal Alpha', 'A', '1234-5679', 'Shared Journal'], ['Journal Beta', 'A', '9876-5432', 'Shared Journal']]);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /名称或别名.*ISSN 集合冲突/.test(error)));
});

await test('multiple-issns-on-one-row-and-overlapping-duplicates-remain-valid', () => {
  const single = build([['Journal Alpha', 'A', '1234-5679;9876-5432', 'JA']]);
  assert.equal(single.errors.length, 0);
  assert.deepEqual(plain(single.index.entries[0].issns), ['12345679', '98765432']);
  const overlap = build([
    ['Journal Alpha', 'A', '1234-5679', 'JA'],
    ['Journal Alpha.', 'A', '1234-5679;9876-5432', 'Journal A'],
    ['Historical Alpha', 'A', '9876-5432', 'Old Alpha'],
  ]);
  assert.equal(overlap.errors.length, 0);
  assert.equal(overlap.stats.mergedRows, 2);
  assert.equal(overlap.index.entries.length, 1);
  assert.deepEqual(plain(overlap.index.entries[0].issns), ['12345679', '98765432']);
});

await test('empty-issn-duplicates-still-merge-with-one-identified-entity', () => {
  for (const rows of [
    [['测试学报', 'A', '', '简称'], ['测试学报。', 'A', '', '旧简称']],
    [['测试学报', 'A', '', '简称'], ['测试学报。', 'A', '1234-5679', '旧简称']],
  ]) {
    const result = build(rows);
    assert.equal(result.errors.length, 0);
    assert.equal(result.stats.mergedRows, 1);
    assert.equal(result.index.entries.length, 1);
    assert(result.index.entries[0].aliases.includes('简称'));
    assert(result.index.entries[0].aliases.includes('旧简称'));
  }
});

await test('empty-issn-row-cannot-bridge-conflicts-in-any-input-order', () => {
  const source = [['测试学报', 'A', '1234-5679', ''], ['测试学报。', 'A', '', '测试刊'], ['测试学报', 'A', '9876-5432', '']];
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const result = build(order.map(index => source[index]));
    assert.equal(result.index, null, order.join(','));
    assert(result.errors.some(error => /ISSN 集合冲突/.test(error)), order.join(','));
    const stored = { id: 'legacy', name: '旧目录', entries: order.map(index => ({
      title: source[index][0], level: 'A', issns: source[index][2] ? [source[index][2]] : [], aliases: source[index][3] ? [source[index][3]] : [],
    })) };
    const normalized = api.normalizeIndexes([stored]);
    assert.equal(normalized[0].entries.length, 3);
    assert(normalized[0].entries.every(entry => entry.issns.length <= 1), 'conflicting ISSNs were unioned');
    assert.deepEqual(plain(api.normalizeIndexes(normalized)), plain(normalized), 'normalization drifted');
    const matcher = api.createMatcher(normalized);
    assert.equal(matcher({ sources: ['测试学报'] }).length, 0, 'same-level entity ambiguity was accepted');
    assert.equal(matcher({ record: record('测试学报', ['1234-5679']) })[0].level, 'A');
    assert.equal(matcher({ sources: ['9876-5432'] })[0].level, 'A');
    assert.equal(matcher({ record: record('测试学报', ['1234-5679', '9876-5432']) }).length, 0);
  }
});

await test('alias-chain-cannot-bridge-distinct-identified-entities', () => {
  const rows = [
    ['Journal Alpha', 'A', '1234-5679', 'Alpha'],
    ['Bridge Journal', 'A', '', 'Alpha;Beta'],
    ['Journal Beta', 'A', '9876-5432', 'Beta'],
  ];
  const result = build(rows);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /第 2 行与第 4 行/.test(error) && /ISSN 集合冲突/.test(error)));
  const normalized = api.normalizeIndexes([{ id: 'legacy', name: '旧目录', entries: rows.map(row => ({ title: row[0], level: row[1], issns: row[2] ? [row[2]] : [], aliases: row[3].split(';') })) }]);
  assert.equal(normalized[0].entries.length, 3);
  const matcher = api.createMatcher(normalized);
  for (const source of ['Alpha', 'Beta']) assert.equal(matcher({ sources: [source] }).length, 0);
  for (const source of ['1234-5679', '9876-5432']) assert.equal(matcher({ sources: [source] })[0].level, 'A');
});

await test('persisted-same-level-name-conflict-needs-a-unique-issn', () => {
  const index = { id: 'legacy', name: '旧目录', entries: [
    { title: 'Journal Alpha', level: 'A', aliases: ['Shared'], issns: ['1234-5679'] },
    { title: 'Journal Beta', level: 'A', aliases: ['Shared'], issns: ['9876-5432'] },
  ] };
  const normalized = api.normalizeIndexes([index]);
  assert.equal(normalized[0].entries.length, 2);
  const matcher = api.createMatcher(normalized);
  assert.equal(matcher({ sources: ['Shared'] }).length, 0);
  assert.equal(matcher({ sources: ['Journal Alpha'] })[0].level, 'A');
  assert.equal(matcher({ record: record('Shared', ['1234-5679']) })[0].level, 'A');
  assert.equal(matcher({ record: record('Journal Beta', ['1234-5679']) }).length, 0, 'conflicting name and ISSN evidence');
});

await test('same-title-different-level-is-a-conflict', () => {
  const result = build([['管理科学', 'A', '', ''], ['管理科学', 'B', '', '']]);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /不同等级/.test(error)));
});

await test('same-alias-different-level-is-a-conflict', () => {
  const result = build([['Journal A', 'A', '', 'Shared'], ['Journal B', 'B', '', 'Shared']]);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /名称或别名/.test(error)));
});

await test('same-issn-different-level-is-a-conflict', () => {
  const result = build([['Journal A', 'A', '1234-567X', ''], ['Journal B', 'B', '1234567x', '']]);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /ISSN/.test(error)));
});

await test('invalid-issn-incomplete-name-and-row-width', () => {
  assert.equal(build([['Journal', 'A', 'bad-issn', '']]).index, null);
  assert.equal(build([['Journal…', 'A', '', '']]).index, null);
  assert.equal(build([['Journal', 'A', '', 'Alias…']]).index, null);
  assert.equal(build([['Journal', 'A']]).index, null);
});

await test('multiple-custom-indexes-coexist', () => {
  const school = build([['Journal Alpha', '学校 A', '', 'JA']], '学校目录', 'school').index;
  const business = build([['Journal Alpha', '经管重点', '', '']], '经管目录', 'business').index;
  assert.deepEqual(plain(api.createMatcher([school, business])({ sources: ['Journal Alpha'] })), [
    { id: 'school', name: '学校目录', level: '学校 A' },
    { id: 'business', name: '经管目录', level: '经管重点' },
  ]);
});

await test('disabled-index-does-not-match', () => {
  const index = build([['Journal Alpha', 'A', '', '']]).index;
  index.enabled = false;
  assert.equal(api.createMatcher([index])({ sources: ['Journal Alpha'] }).length, 0);
});

await test('outside-official-catalog-matches-exact-source-alias', () => {
  const index = build([['School-only Conference', '推荐', '', 'SOC']]).index;
  const matcher = api.createMatcher([index]);
  assert.equal(matcher({ record: null, sources: ['SOC'] })[0].level, '推荐');
  for (const source of ['School-only', 'Accepted at SOC', 'Paper about School-only Conference', 'School-only Conference…', '… School-only Conference']) {
    assert.equal(matcher({ sources: [source] }).length, 0, source);
  }
});

await test('paper-title-is-never-an-input-channel', () => {
  const index = build([['Journal Alpha', 'A', '', 'JA']]).index;
  const matcher = api.createMatcher([index]);
  assert.equal(matcher({ title: 'Journal Alpha', paperTitle: 'JA', sources: ['arXiv'] }).length, 0);
});

await test('record-canonical-title-and-issn-match-without-mutation', () => {
  const index = build([['Custom Journal Name', '重点', '1234-567X', 'Canonical Journal']]).index;
  const official = record('Canonical Journal');
  const original = JSON.stringify(official);
  const matcher = api.createMatcher([index]);
  assert.equal(matcher({ record: official })[0].level, '重点');
  assert.equal(matcher({ record: record('Other Official Title', ['1234-567x']) })[0].level, '重点');
  assert.equal(matcher({ sources: ['1234-567X'] })[0].level, '重点');
  assert.equal(JSON.stringify(official), original);
});

await test('normalized-accent-possessive-punctuation-and-chinese', () => {
  const index = build([
    ["The Cryptographer's Track", 'C', '', ''],
    ['Économie & Société', 'A', '', ''],
    ['《管理科学》', '重点', '', ''],
  ]).index;
  const matcher = api.createMatcher([index]);
  for (const source of ["THE CRYPTOGRAPHER’S TRACK", 'Economie and Societe', '管理科学']) assert.equal(matcher({ sources: [source] }).length, 1, source);
});

await test('ambiguous-persisted-data-is-refused-by-matcher', () => {
  const index = { id: 'bad', name: '损坏备份', entries: [
    { title: 'Journal Alpha', aliases: ['Shared'], issns: ['1234-567X'], level: 'A' },
    { title: 'Journal Beta', aliases: ['Shared'], issns: ['1234567X'], level: 'B' },
  ] };
  const matcher = api.createMatcher([index]);
  assert.equal(matcher({ sources: ['Shared'] }).length, 0);
  assert.equal(matcher({ sources: ['1234-567X'] }).length, 0);
  assert.equal(matcher({ sources: ['Journal Alpha', 'Journal Beta'] }).length, 0);
  assert.equal(matcher({ sources: ['Journal Alpha'] })[0].level, 'A');
});

await test('normalization-is-stable-and-preserves-original-data', () => {
  const input = [{ name: '未分配ID目录', entries: [{ title: 'Journal Alpha', aliases: ['JA', 'JA'], level: '', issns: ['1234-567x'] }] }];
  const original = JSON.stringify(input);
  const once = api.normalizeIndexes(input);
  assert.deepEqual(plain(api.normalizeIndexes(once)), plain(once));
  assert.deepEqual(plain(api.normalizeIndexes(input)), plain(once));
  assert.equal(JSON.stringify(input), original);
  assert.equal(api.normalizeIndexes(null).length, 0);
  assert.equal(api.normalizeIndexes([null, {}, { name: '空', entries: [] }]).length, 0);
});

await test('file-size-extension-encoding-and-empty-errors', async () => {
  await assert.rejects(api.parseFile({ ...file('huge.csv', ''), size: api.LIMITS.maxFileBytes + 1 }), /5 MB/);
  await assert.rejects(api.parseFile(file('school.xlsx', 'anything')), /CSV UTF-8/);
  await assert.rejects(api.parseFile(file('empty.csv', '')), /文件为空/);
  await assert.rejects(api.parseFile({ name: 'ansi.csv', size: 1, arrayBuffer: async () => Uint8Array.of(255).buffer }), /编码/);
  await assert.rejects(api.parseFile(file('bad.json', '{ broken')), /JSON/);
});

await test('spreadsheet-formulas-explicitly-rejected-without-changing-values', async () => {
  for (const value of ['=1+1', '+CMD', '@SUM(A1)', '-1+1', '  =1+1', '\tJournal Alpha', '\rJournal Alpha']) {
    const title = build([[value, 'A', '', '']]);
    const level = build([['Journal Alpha', value, '', '']]);
    const alias = build([['Journal Alpha', 'A', '', 'Safe;' + value]]);
    for (const result of [title, level, alias]) {
      assert.equal(result.index, null, JSON.stringify(value));
      assert(result.errors.some(error => /公式字符/.test(error)));
    }
    const parsed = await api.parseFile(file('unsafe.json', JSON.stringify({ name: '目录', entries: [{ title: value, level: 'A' }] })));
    assert.equal(api.fromTable(parsed, { name: '目录' }).index, null);
    assert.equal(api.normalizeIndexes([{ name: '目录', entries: [{ title: value, level: 'A' }] }]).length, 0);
  }
});

await test('csv-roundtrip-preserves-safe-hyphen-quotes-and-chinese', async () => {
  const original = build([['Journal Alpha-Beta', 'A-', '1234-567X', '简称;Journal "A"']]).index;
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const csv = '\uFEFF' + [...api.CSV_HEADERS].map(quote).join(',') + '\r\n' + original.entries.map(entry =>
    [entry.title, entry.level, entry.issns.join(';'), entry.aliases.join(';')].map(quote).join(',')).join('\r\n') + '\r\n';
  const result = api.fromTable(await api.parseFile(file('roundtrip.csv', csv)), { name: original.name });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(plain(result.index.entries), plain(original.entries));
});

await test('duplicate-union-limit-does-not-silently-drop-aliases', () => {
  const aliases = Array.from({ length: api.LIMITS.maxAliases }, (_, index) => 'Alias ' + index).join(';');
  const result = build([['Journal Alpha', 'A', '', aliases], ['Journal Alpha', 'A', '', 'One additional alias']]);
  assert.equal(result.index, null);
  assert(result.errors.some(error => /合并后超过/.test(error)));
});

const report = { generatedAt: new Date().toISOString(), schemaVersion: api.SCHEMA_VERSION,
  total: cases.length, passed: cases.filter(value => value.passed).length, failures: cases.filter(value => !value.passed), cases };
const destination = path.join(process.cwd(), 'artifacts/custom-indexes-20261011/custom-indexes-test.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
JSON.parse(fs.readFileSync(destination, 'utf8'));
console.log(JSON.stringify({ destination, total: report.total, passed: report.passed, failures: report.failures }, null, 2));
assert.equal(report.failures.length, 0);
