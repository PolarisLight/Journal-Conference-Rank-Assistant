import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createBackground, runEncryptedPage, saveJson } from './helpers/encrypted-runtime.mjs';

const started = Date.now();
const background = createBackground();
const keys = ['0', ...'abcdefghijklmnopqrstuvwxyz', 'other'];
const shards = new Map();
for (const key of keys) {
  const result = await background.api.getUpdatedShard(key);
  assert.equal(result.ok, true, 'Actual encrypted shard failed: ' + key);
  shards.set(key, result.shard);
}
const page = await runEncryptedPage('https://example.invalid/', '<!doctype html><html><head><title>Catalog audit</title></head><body></body></html>', { waitMs: 0 });
const api = page.api;
for (const [key, shard] of shards) api.state.shards.set(key, shard);
const source = JSON.parse(fs.readFileSync('build/journals.private.json', 'utf8'));
const compact = item => {
  const c = item.ccf || {}, ca = item.cas || {}, j = item.jcr || {}, css = item.cssci || {}, p = item.pkuCore || {}, ei = item.ei || {}, xr = item.xinrui || {}, w = item.warning || {};
  return [item.title || '',c.rank || '',c.type || '',c.year || '',ca.largeZone || '',ca.top ? 1 : 0,ca.category || '',ca.year || '',j.quartile || '',j.impactFactor || '',j.category || '',j.year || '',item.wos || '',item.issns || [],c.field || '',c.url || '',item.publisher || '',css.tier || '',css.year || '',css.category || '',item.pkuCore ? 1 : 0,p.year || '',p.category || '',p.cn || '',ei.date || '',ei.sourceType || '',ei.subjects || [],ei.status || '',xr.zone || '',xr.top ? 1 : 0,xr.category || '',xr.year || '',w.year || '',w.reason || '',xr.type || '',xr.url || ''];
};
const packedSource = source.map(compact);
const serialization = packedSource.map(value => JSON.stringify(value));
const catalogSet = new Set([...shards.values()].flatMap(shard => shard.r.map(record => JSON.stringify(record))));
assert.equal(source.length, 35093);
const missingEncryptedSourceIds = serialization.flatMap((value,id)=>catalogSet.has(value)?[]:[id]);
const rawAliasesByRecord = source.map(item => [...new Set([item.title, ...(item.aliases || [])].filter(Boolean))]);
const aliasesByRecord = rawAliasesByRecord.map(aliases=>aliases.filter(alias=>api.venueKey(alias)));
const ignoredInvalidAliasInputs = rawAliasesByRecord.reduce((sum,aliases,id)=>sum+aliases.length-aliasesByRecord[id].length,0);
const runtimeOwners = new Map();
for (let id = 0; id < source.length; id++) for (const alias of aliasesByRecord[id]) {
  const normalized = api.venueKey(alias);
  if (!normalized) continue;
  if (!runtimeOwners.has(normalized)) runtimeOwners.set(normalized, new Set());
  runtimeOwners.get(normalized).add(id);
}
const index = page.dom.window.RankAssistantIssnIndex;
const canonical = [], unreachable = [], uniqueAliasFailures = [], wrongAliasMatches = [], ambiguousResolved = [];
const categories = { totalAliasInputs: 0, correctAliasInputs: 0, expectedAmbiguousInputs: 0, expectedAmbiguousRejected: 0,
  uniqueAliasUnmatched: 0, uniqueAliasWrongEntity: 0, ambiguousAliasResolved: 0, normalizationDriftInputs: 0 };
const simpleBuildNorm = value => String(value || '').toLowerCase().replaceAll('ß','ss').replace(/&/g,' and ').replace(/[^\p{L}\p{N}_]+/gu,' ').replaceAll('_',' ').trim().replace(/\s+/g,' ');
for (let id = 0; id < source.length; id++) {
  const item = source[id], expected = serialization[id];
  const current = api.matchRecord(item.title, { allowCompletion: false });
  const normalizedTitle = api.venueKey(item.title);
  canonical.push({ id, title: item.title, matchedTitle: current?.[0] || null,
    matched: current ? JSON.stringify(current) === expected : false,
    expectedAmbiguous: (runtimeOwners.get(normalizedTitle)?.size || 0) > 1 });
  let reachable = false, hasUnique = false;
  const failedAliases = [];
  for (const alias of aliasesByRecord[id]) {
    categories.totalAliasInputs++;
    const normalized = api.venueKey(alias);
    const ownerCount = runtimeOwners.get(normalized)?.size || 0;
    const ambiguous = ownerCount > 1;
    const result = api.matchRecord(alias, { allowCompletion: false });
    const equal = result && JSON.stringify(result) === expected;
    const normDrift = simpleBuildNorm(alias) !== normalized;
    if (normDrift) categories.normalizationDriftInputs++;
    if (equal) { reachable = true; categories.correctAliasInputs++; }
    if (ambiguous) {
      categories.expectedAmbiguousInputs++;
      if (!result) categories.expectedAmbiguousRejected++;
      else {
        categories.ambiguousAliasResolved++;
        ambiguousResolved.push({ id, alias, normalized, ownerTitles: [...runtimeOwners.get(normalized)].map(owner=>source[owner].title), matchedTitle: result[0] });
      }
    } else {
      hasUnique = true;
      if (!result) {
        categories.uniqueAliasUnmatched++;
        uniqueAliasFailures.push({ id, title: item.title, alias, normalized, normalizationDrift: normDrift });
      } else if (!equal) {
        categories.uniqueAliasWrongEntity++;
        wrongAliasMatches.push({ id, title: item.title, alias, normalized, matchedTitle: result[0], normalizationDrift: normDrift });
      }
    }
    if (!equal) failedAliases.push({ alias, normalized, ambiguous, normalizationDrift: normDrift, matchedTitle: result?.[0] || null });
  }
  if (!reachable) {
    let issnReachable = false;
    const issnCases = (item.issns || []).map(issn => {
      const hint = index[String(issn).replace(/[^0-9X]/gi,'').toUpperCase()];
      const record = hint ? shards.get(hint[0])?.r[hint[1]] : null;
      const equal = record && JSON.stringify(record) === expected;
      issnReachable ||= Boolean(equal);
      return { issn, matchedTitle: record?.[0] || null, correct: Boolean(equal) };
    });
    const actualDefaultResults = aliasesByRecord[id].map(alias=>({alias,record:api.matchRecord(alias)}));
    const actualDefaultReachable = actualDefaultResults.some(result=>result.record && JSON.stringify(result.record)===expected);
    unreachable.push({ id, title: item.title, ccf: item.ccf?.rank || '', hasUniqueAlias: hasUnique, actualDefaultReachable,
      actualDefaultResults:actualDefaultResults.map(({alias,record})=>({alias,matchedTitle:record?.[0] || null})),
      classification: hasUnique ? 'unexpected-title-unreachable' : 'all-source-aliases-ambiguous',
      issnReachable, issnCases, failedAliases });
  }
}

const diversitySpecs = [
  ...['A','B','C'].flatMap(rank=>[
    { id:'ccf-conference-'+rank, test:r=>r[1]===rank && /会议/.test(r[2]) },
    { id:'ccf-journal-'+rank, test:r=>r[1]===rank && /刊物/.test(r[2]) }
  ]),
  ...['1','2','3','4'].map(zone=>({ id:'cas-'+zone, test:r=>String(r[4])===zone })),
  ...['Q1','Q2','Q3','Q4'].map(quartile=>({ id:'jcr-'+quartile, test:r=>r[8]===quartile })),
  {id:'wos-SCI-SCIE-display',test:r=>String(r[12]).split(/[,;/\s]+/).includes('SCIE')},
  ...['SCIE','SSCI','AHCI','ESCI'].map(wos=>({ id:'wos-'+wos, test:r=>String(r[12]).split(/[,;/\s]+/).includes(wos) })),
  { id:'cssci-source', test:r=>r[17]==='来源版' || /来源|Source/i.test(r[17]) },
  { id:'cssci-extended', test:r=>/扩展|Extended/i.test(r[17]) },
  { id:'pku-core', test:r=>Boolean(r[20]) },
  { id:'ei', test:r=>Boolean(r[24]) },
  { id:'chinese-multi-index', test:r=>/[\u3400-\u9fff]/.test(r[0]) && Boolean(r[17]) && Boolean(r[20]) },
  { id:'chinese-pku-ei', test:r=>/[\u3400-\u9fff]/.test(r[0]) && Boolean(r[20]) && Boolean(r[24]) },
  { id:'abbreviation-only-ccf', test:r=>Boolean(r[1]) }
];
const diversity = diversitySpecs.map(spec=>{
  const candidates = packedSource.map((record,id)=>({record,id})).filter(value=>spec.test(value.record));
  const chosen = candidates.find(({id})=>aliasesByRecord[id].some(alias=>JSON.stringify(api.matchRecord(alias,{allowCompletion:false}))===serialization[id]));
  if (!chosen) return { id:spec.id, catalogCount:candidates.length, passed:false, reason:'No qualifying reachable record' };
  let alias = aliasesByRecord[chosen.id].find(alias=>JSON.stringify(api.matchRecord(alias,{allowCompletion:false}))===serialization[chosen.id]);
  if (spec.id==='abbreviation-only-ccf') alias = aliasesByRecord[chosen.id].filter(value=>/^[A-Z][A-Z0-9-]{2,11}$/.test(value)).find(value=>JSON.stringify(api.matchRecord(value,{allowCompletion:false}))===serialization[chosen.id]) || alias;
  return { id:spec.id, catalogCount:candidates.length, title:chosen.record[0], alias,
    metadata:{ccf:chosen.record[1],type:chosen.record[2],cas:chosen.record[4],jcr:chosen.record[8],wos:chosen.record[12],cssci:chosen.record[17],pku:chosen.record[20],ei:chosen.record[24]}, passed:true };
});
const aliases = [...shards.values()].reduce((sum,shard)=>sum+Object.keys(shard.a).length,0);
const abbreviations = [...shards.values()].reduce((sum,shard)=>sum+Object.keys(shard.b).length,0);
const ambiguousAliases = [...shards.values()].reduce((sum,shard)=>sum+(shard.x || []).length,0);
const ambiguousAbbreviations = [...shards.values()].reduce((sum,shard)=>sum+(shard.y || []).length,0);
const chineseAliases = [...runtimeOwners.entries()].filter(([alias])=>/[\u3400-\u9fff]/.test(alias));
const report = { generatedAt:new Date().toISOString(), mode:'Actual encrypted package decrypted by production background; actual content matchRecord with strict completion=false; one JSDOM instance',
  sourceRecords:source.length, encryptedUniqueRecords:catalogSet.size, allSourceRecordsPresent:missingEncryptedSourceIds.length===0,
  missingEncryptedSourceRecords:missingEncryptedSourceIds.map(id=>({id,title:source[id].title})),
  runtimeShardCount:shards.size, aliases, abbreviations, ambiguousAliases, ambiguousAbbreviations,
  chineseAliasAudit:{normalizedChineseAliases:chineseAliases.length,conflicts:chineseAliases.filter(([,owners])=>owners.size>1).map(([alias,owners])=>({alias,titles:[...owners].map(id=>source[id].title)}))},
  categories, ignoredInvalidAliasInputs, canonical:{total:canonical.length,matched:canonical.filter(value=>value.matched).length,
    unmatchedExpectedAmbiguous:canonical.filter(value=>!value.matched&&value.expectedAmbiguous).length,
    unmatchedUnexpected:canonical.filter(value=>!value.matched&&!value.expectedAmbiguous).length},
  reachability:{reachableByAtLeastOneSourceTitleOrAlias:source.length-unreachable.length,
    unreachable:unreachable.length,expectedAmbiguityOnly:unreachable.filter(value=>!value.hasUniqueAlias).length,
    unexpected:unreachable.filter(value=>value.hasUniqueAlias).length,
    unreachableByTitleButReachableByIssn:unreachable.filter(value=>value.issnReachable).length,
    strictUnreachableRecoveredByDefaultMatcher:unreachable.filter(value=>value.actualDefaultReachable).length,
    unexpectedlyUnreachableUnderDefaultMatcher:unreachable.filter(value=>value.hasUniqueAlias&&!value.actualDefaultReachable).length},
  diversity, uniqueAliasFailures, wrongAliasMatches, ambiguousResolved, unreachable,
  canonicalFailures:canonical.filter(value=>!value.matched), elapsedMs:Date.now()-started };
const output = saveJson('source-catalog-reachability-results.json',report);
console.log(JSON.stringify({output,records:report.sourceRecords,categories:report.categories,reachability:report.reachability,diversityPassed:diversity.filter(value=>value.passed).length,elapsedMs:report.elapsedMs}));

const sourceCases = [
  ['cvpr-bare', 'CVPR', 'A'],
  ['icml-full', 'International Conference on Machine Learning', 'A'],
  ['cvpr-proceedings', 'Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition', 'A'],
  ['iccv-proc', 'Proc. IEEE International Conference on Computer Vision', 'A'],
  ['icml-year-proceedings', '2023 Proceedings of the 40th International Conference on Machine Learning', 'A'],
  ['neurips-series-volume', 'Advances in Neural Information Processing Systems 37', 'A'],
  ['aaai-series-volume', 'Proceedings of the AAAI Conference on Artificial Intelligence 38', 'A'],
  ['nips-historical-year', 'NIPS 2020', 'A'],
  ['published-in-journal', 'Published in Pattern Recognition', 'B'],
  ['published-in-full-journal', 'Published in IEEE Transactions on Pattern Analysis and Machine Intelligence', 'A'],
  ['all-caps-possessive', "THE CRYPTOGRAPHER'S TRACK AT RSA CONFERENCE", 'C'],
  ['accepted-cvpr', 'Accepted at CVPR', 'A'],
  ['accepted-to-icml', 'Accepted to International Conference on Machine Learning', 'A'],
  ['short-bibliographic-abbreviation', 'Ann Med. 2024 Dec;56(1):2302980.', null],
  ['author-initial-surname', 'S Jayasumana', null],
  ['tpami-reference', 'IEEE Transactions on Pattern Analysis and Machine Intelligence. 2023;45(2):123-130.', 'A'],
  ['tpami-abbreviated-reference', 'IEEE Trans Pattern Anal Mach Intell. 2023 Feb;45(2):123-130.', 'A'],
  ['pattern-recognition-reference', 'Pattern Recognition 145 (2024): 109851', 'B'],
  ['tpami-unique-truncated-prefix', 'IEEE Transactions on Pattern Analysis…', 'A'],
  ['leading-middle-ellipsis-live', '… Pattern Recognition …', null],
  ['leading-ellipsis', '... Pattern Recognition', null],
  ['middle-ellipsis', 'Proceedings of ... Pattern Recognition', null],
  ['short-truncated-journal', 'Pattern Recognition…', null],
  ['short-truncated-conference', 'International Conference…', null],
  ['cvpr-workshops', 'CVPR Workshops', null],
  ['cvpr-workshop-full', 'Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition Workshops', null],
  ['workshop-on-cvpr-name', 'Workshop on Computer Vision and Pattern Recognition', null],
  ['accepted-cvpr-workshops', 'Accepted at CVPR Workshops', null],
  ['accepted-miccai-workshop', 'Accepted at MICCAI Workshop', null],
  ['emnlp-findings', 'Findings of the Association for Computational Linguistics: EMNLP', null],
  ['accepted-emnlp-findings', 'Accepted at EMNLP Findings', null],
  ['accepted-cvpr-supplement', 'Accepted at CVPR Supplement', null],
  ['accepted-analysis-prose', 'Accepted at Analysis of results', null],
  ['published-science-prose', 'Published in Science for robots', null],
  ['proceedings-nature-context', 'Proceedings of Nature', null],
  ['proceedings-pattern-context', 'Proceedings of Pattern Recognition', null],
  ['proceedings-ieee-journal', 'Proceedings of the IEEE. 2023;111(5):123-130.', 'A'],
  ['unrelated-conference-name', 'Conference on Nature', null],
  ['arxiv-only', 'arXiv', null],
].map(([id, input, expectedCcf]) => {
  const result = api.scholarSourceRecord(input);
  const actualCcf = result?.[1] || null;
  return { id, input, expectedCcf, actualCcf, matchedTitle: result?.[0] || null, passed: actualCcf === expectedCcf };
});
const directCases = [
  ['embedded-cvpr-workshops', 'Accepted at CVPR Workshops'],
  ['embedded-miccai-workshop', 'Accepted at MICCAI Workshop'],
  ['embedded-emnlp-findings', 'Accepted at EMNLP Findings'],
  ['ordinary-analysis-context', 'Accepted at Analysis of results'],
  ['ordinary-science-context', 'Published in Science for robots'],
  ['embedded-leading-ellipsis', '… Pattern Recognition …'],
].map(([id,input]) => {
  const result=api.matchRecord(input,{allowEmbedded:true});
  return {id,input,expectedCcf:null,actualCcf:result?.[1] || null,matchedTitle:result?.[0] || null,passed:!result};
});
const scopeCatalog = [...shards.values()].flatMap(shard=>shard.r).filter(record=>record[1] && /\bWorkshop\b/i.test(record[0]));
const legitimateWorkshops = scopeCatalog.slice(0,3).map(record=>{
  const result=api.scholarSourceRecord(record[0]);
  return {input:record[0],expectedCcf:record[1],actualCcf:result?.[1] || null,passed:result?.[1]===record[1]};
});
const contentSource=fs.readFileSync('extension/content/content-v7.js','utf8');
const candidateStart=contentSource.indexOf('  function publicationSourceCandidates(value) {');
const candidateEnd=contentSource.indexOf('  function scholarSourceCandidates(value) {', candidateStart);
assert(candidateStart>=0 && candidateEnd>candidateStart);
// Extract the production helper, which has no external dependencies, so this
// test exercises the same preload candidate list as scan without expanding the harness API.
const productionCandidates=new Function(contentSource.slice(candidateStart,candidateEnd)+'; return publicationSourceCandidates;')();
const limitedShardCases=sourceCases.map(value=>{
  const loadedKeys=[...new Set(productionCandidates(value.input).flatMap(api.primaryShardsForText))];
  api.state.shards.clear();
  for(const key of loadedKeys) if(shards.has(key)) api.state.shards.set(key,shards.get(key));
  const result=api.scholarSourceRecord(value.input);
  return {...value,loadedKeys,actualCcf:result?.[1] || null,matchedTitle:result?.[0] || null,passed:(result?.[1] || null)===value.expectedCcf};
});
api.state.shards.clear();
for(const [key,shard] of shards) api.state.shards.set(key,shard);
const coreReport={generatedAt:new Date().toISOString(),mode:'Production content matcher plus actual encrypted package; controlled source fixtures; no online-page claim',
 sourceCases,directCases,legitimateWorkshops,limitedShardCases,
 summary:{sourceCases:sourceCases.length,directCases:directCases.length,legitimateWorkshops:legitimateWorkshops.length,limitedShardCases:limitedShardCases.length,
 failures:[...sourceCases,...directCases,...legitimateWorkshops,...limitedShardCases].filter(value=>!value.passed)},
 catalog:{sourceRecords:report.sourceRecords,categories:report.categories,reachability:report.reachability},
 errors:page.errors,plaintextFetches:background.fetches.filter(value=>value.includes('.private.json'))};
const coreOutput=saveJson('source-matching-regression.json',coreReport);
console.log(JSON.stringify({coreOutput,summary:coreReport.summary,catalog:coreReport.catalog,errors:coreReport.errors},null,2));
page.close();
assert.equal(report.categories.uniqueAliasUnmatched,0);
assert.equal(report.categories.uniqueAliasWrongEntity,0);
assert.equal(report.categories.ambiguousAliasResolved,0);
assert.equal(coreReport.summary.failures.length,0);

assert.equal(coreReport.errors.length,0);
assert.equal(coreReport.plaintextFetches.length,0);
