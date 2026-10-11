import assert from 'node:assert/strict';
import { createBackground, runEncryptedPage, saveJson } from './helpers/encrypted-runtime.mjs';

const A = 'IEEE Transactions on Pattern Analysis and Machine Intelligence';
const B = 'Pattern Recognition';
const unknown = 'Unknown Diagnostic Venue';
const fixtures = [
  {site:'scholar',url:'https://scholar.google.com/scholar?q=dynamic',row:(v,id='card')=>`<div class="gs_r gs_or gs_scl" id="${id}"><div class="gs_ri"><h3 class="gs_rt"><a>Diagnostic paper</a></h3><div class="gs_a">Author - ${v}, 2026 - example.org</div></div></div>`,source:'.gs_a',wrap:x=>x,sourceText:v=>`Author - ${v}, 2026 - example.org`},
  {site:'semantic',url:'https://www.semanticscholar.org/search?q=dynamic',row:(v,id='card')=>`<article data-testid="paper-row" id="${id}"><a href="/paper/diagnostic">Diagnostic paper</a><span class="cl-paper-venue">${v}</span></article>`,source:'.cl-paper-venue'},
  {site:'arxiv',url:'https://arxiv.org/search/?query=dynamic',row:(v,id='card')=>`<li class="arxiv-result" id="${id}"><p class="title">Diagnostic paper</p><p class="journal-ref">Journal reference: ${v}</p></li>`,source:'.journal-ref',wrap:x=>`<ol>${x}</ol>`,sourceText:v=>`Journal reference: ${v}`},
  {site:'openalex',url:'https://openalex.org/works?search=dynamic',row:(v,id='card')=>`<article data-testid="work-result" id="${id}"><a href="/works/W123">Diagnostic paper</a><span data-testid="source">${v}</span></article>`,source:'[data-testid="source"]'},
  {site:'pubmed',url:'https://pubmed.ncbi.nlm.nih.gov/?term=dynamic',row:(v,id='card')=>`<article class="full-docsum" id="${id}"><a class="docsum-title">Diagnostic paper</a><span class="docsum-journal-citation">${v}. 2026;1:1.</span></article>`,source:'.docsum-journal-citation',sourceText:v=>v?`${v}. 2026;1:1.`:''},
  {site:'cnki',url:'https://kns.cnki.net/kns8s/defaultresult/index?kw=dynamic',row:(v,id='card')=>`<tr id="${id}"><td class="name"><a href="/kcms2/article/abstract?v=diagnostic">Diagnostic paper</a></td><td class="source"><a>${v}</a></td></tr>`,source:'.source a',wrap:x=>`<table class="result-table-list"><tbody>${x}</tbody></table>`},
  {site:'wanfang',url:'https://s.wanfangdata.com.cn/paper?q=dynamic',row:(v,id='card')=>`<div class="normal-list-item" id="${id}"><div class="title"><a href="https://d.wanfangdata.com.cn/periodical/diagnostic">Diagnostic paper</a></div><div class="source"><a>${v}</a></div></div>`,source:'.source a'},
  {site:'aminer',url:'https://www.aminer.cn/search/pub?q=dynamic',row:(v,id='card')=>`<div class="paper-item" id="${id}"><a class="title-link" href="/pub/diagnostic">Diagnostic paper</a><div class="conf-info-zone"><span class="venue-link"><a>${v}</a></span></div></div>`,source:'.venue-link a'},
  {site:'baidu',url:'https://xueshu.baidu.com/s?wd=dynamic',row:(v,id='card')=>`<div class="paper-wrap result" id="${id}"><h3 class="paper-title"><a href="/usercenter/paper/show?paperid=diagnostic">Diagnostic paper</a></h3><div class="paper-info">Author - 《${v}》 - 2026</div></div>`,source:'.paper-info',sourceText:v=>`Author - 《${v}》 - 2026`},
  {site:'publisher',url:'https://www.sciencedirect.com/search?q=dynamic',row:(v,id='card')=>`<div class="result-item" id="${id}"><h2><a href="/article/diagnostic">Diagnostic paper</a></h2><div class="publication-title">${v}</div></div>`,source:'.publication-title'},
  {site:'researchgate',url:'https://www.researchgate.net/search/publication?q=dynamic',row:(v,id='card')=>`<article class="publication-item" id="${id}"><h2><a href="/publication/123_diagnostic">Diagnostic paper</a></h2><a class="journal-source" href="/journal/diagnostic">${v}</a></article>`,source:'.journal-source'},
  {site:'dblp',url:'https://dblp.org/search?q=dynamic',row:(v,id='card')=>`<li class="entry article" id="${id}"><cite class="data"><span class="title" itemprop="name">Diagnostic paper</span><span itemprop="isPartOf"><a href="/db/journals/unknown/"><span itemprop="name">${v}</span></a></span></cite></li>`,source:'[itemprop="isPartOf"] a',wrap:x=>`<section id="completesearch-publs"><ul class="publ-list">${x}</ul></section>`}
];
const background = createBackground();
const results = [];
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
for (const fixture of fixtures) {
  const wrap = fixture.wrap || (value=>`<main>${value}</main>`);
  const page = await runEncryptedPage(fixture.url, wrap(fixture.row(unknown)), {background,waitMs:450});
  try {
    const doc=page.dom.window.document, card=doc.querySelector('#card'), source=card.querySelector(fixture.source);
    const labels=()=>[...card.querySelectorAll('.rank-assistant-badge')].map(node=>node.textContent);
    const stages=[];
    const change=async(value, mode='textContent')=>{
      const text=fixture.sourceText?.(value)??value;
      if(mode==='data'&&source.firstChild?.nodeType===3) source.firstChild.data=text;
      else source.textContent=text;
      if(fixture.site==='dblp')source.href=value===A?'/db/journals/pami/':value===B?'/db/journals/pr/':'/db/journals/unknown/';
      await wait(480);
    };
    stages.push({stage:'unknown',actual:labels()});
    assert.equal(page.snapshot().status,'ready',fixture.site+' initial status');
    await change(A);
    stages.push({stage:'textContent source arrives',actual:labels()});
    assert.ok(labels().includes('CCF A'),fixture.site+' failed late source: '+JSON.stringify(labels()));
    await change(B,'data');
    stages.push({stage:'matched source changes via Text.data',actual:labels()});
    assert.ok(labels().includes('CCF B')&&!labels().includes('CCF A'),fixture.site+' stale A after B: '+JSON.stringify(labels()));
    await change('');
    stages.push({stage:'source removed',actual:labels()});
    assert.ok(!labels().some(label=>/^CCF [ABC]$/.test(label)),fixture.site+' kept rank after source removal');
    const range=doc.createRange();
    range.selectNodeContents(card.parentElement);
    const fragment=range.createContextualFragment(fixture.row(A,'new-card'));
    if(fixture.site==='dblp')fragment.querySelector('[itemprop="isPartOf"] a').href='/db/journals/pami/';
    card.parentElement.appendChild(fragment);
    await wait(480);
    const newLabels=[...doc.querySelectorAll('#new-card .rank-assistant-badge')].map(node=>node.textContent);
    stages.push({stage:'new complete card',actual:newLabels});
    assert.ok(newLabels.includes('CCF A'),fixture.site+' new card failed');
    assert.ok(card.querySelectorAll('.rank-assistant-row').length<=1,fixture.site+' duplicate badge rows');
    results.push({site:fixture.site,url:fixture.url,passed:true,stages,errors:page.errors});
    console.log(fixture.site+': dynamic stages passed');
  } finally {page.close();}
  global.gc?.();
}

const faultOptions={missingPackaged:['i']};
const faultBackground=createBackground(faultOptions);
const fixture=fixtures.find(row=>row.site==='publisher');
const faultPage=await runEncryptedPage(fixture.url,`<main>${fixture.row(unknown)}</main>`,{background:faultBackground,waitMs:400});
try {
  faultPage.dom.window.document.querySelector('.publication-title').textContent=A;
  await wait(450);
  const failure=faultPage.snapshot();
  assert.equal(failure.status,'error');
  assert.deepEqual(failure.labels,[]);
  assert.deepEqual(failure.plaintextFallbackFetches,[]);
  faultOptions.missingPackaged=[];
  faultPage.dom.window.document.querySelector('.publication-title').textContent=A+' ';
  await wait(500);
  const recovered=faultPage.snapshot();
  assert.equal(recovered.status,'ready');
  assert.ok(recovered.labels.includes('CCF A'));
  results.push({site:'publisher',passed:true,dynamicFailure:failure,recovery:recovered});
} finally {faultPage.close();}

// Current-document metadata can change without any visible text mutation.
const metaPage=await runEncryptedPage('https://www.sciencedirect.com/article/metadata-dynamic',
  `<head><meta name="citation_journal_title" content="${unknown}"></head><main><h1>Diagnostic paper</h1></main>`,
  {background,waitMs:400});
try {
  const source=metaPage.dom.window.document.querySelector('meta');
  source.content=A;
  await wait(450);
  assert.ok(metaPage.snapshot().labels.includes('CCF A'));
  source.content=B;
  await wait(450);
  assert.ok(metaPage.snapshot().labels.includes('CCF B')&&!metaPage.snapshot().labels.includes('CCF A'));
  source.remove();
  await wait(450);
  assert.ok(!metaPage.snapshot().labels.some(label=>/^CCF [ABC]$/.test(label)));
  results.push({site:'publisher metadata attributes',passed:true,snapshot:metaPage.snapshot()});
} finally {metaPage.close();}

// A response for an earlier source must not paint over a reused card.
const slowBackground=createBackground();
const nativeMessage=slowBackground.message.bind(slowBackground);
slowBackground.message=async(payload,sender)=>{
  const result=await nativeMessage(payload,sender);
  if(payload.type==='rank-assistant-get-data-shard') await wait(220);
  return result;
};
const racePage=await runEncryptedPage(fixture.url,`<main>${fixture.row(unknown)}</main>`,{background:slowBackground,waitMs:500});
try {
  const source=racePage.dom.window.document.querySelector('.publication-title');
  source.textContent=A;
  await wait(110);
  source.textContent=B;
  await wait(200);
  assert.ok(!racePage.snapshot().labels.includes('CCF A'),'Stale async A response was painted');
  await wait(700);
  assert.ok(racePage.snapshot().labels.includes('CCF B'));
  assert.equal(racePage.snapshot().rows,1);
  results.push({site:'publisher asynchronous source race',passed:true,snapshot:racePage.snapshot()});
} finally {racePage.close();}

// Ignoring an access challenge must settle rather than observe its own status
// attributes forever and starve the browser event loop.
const challengePage=await runEncryptedPage('https://www.sciencedirect.com/journal/tourism-management',
  '<title>Are you a robot?</title><main><h1>Are you a robot?</h1><p>captcha: Confirm you are a human</p></main>',
  {background,waitMs:350});
try {
  const doc=challengePage.dom.window.document;
  doc.querySelector('p').textContent+='.';
  await wait(200);
  assert.equal(challengePage.snapshot().rows,0);
  assert.equal(doc.documentElement.dataset.paperRankHasResults,'0');
  results.push({site:'access challenge event loop',passed:true,snapshot:challengePage.snapshot()});
} finally {challengePage.close();}

saveJson('dynamic-venue-regression.json',{pages:results.length,passed:true,results});
console.log(JSON.stringify({pages:results.length,passed:true}));
