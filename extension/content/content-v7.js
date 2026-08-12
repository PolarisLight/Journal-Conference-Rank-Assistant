(async function () {
  "use strict";

  const N = globalThis.RankAssistantNormalizer;
  const I18N = globalThis.RankAssistantI18n;
  const DEFAULTS = {
    enabled: true,
    language: "zh-CN",
    showCcf: true,
    showCas: true,
    showJcr: true,
    showIf: true,
    showWos: true,
    showTop: true,
    showCssci: true,
    showPku: true,
    showEi: true,
    showUtd24: true,
    showFt50: true,
    showXinrui: true,
    showWarning: true,
    hideWarnedJournals: false,
    colorTheme: "light",
    colorPalette: "vivid",
    resultFilters: { indexes: [], values: {} }
  };
  const STOP = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);
  const state = { settings: DEFAULTS, shards: new Map(), shardPromises: new Map(), maxAliasWords: 12, lastScanDetail: "" };
  let initialization = null;
  const controlDetails = new WeakMap();
  let tooltipHost = null;
  let tooltipPanel = null;
  let hideTimer = null;
  const systemDarkMode = window.matchMedia("(prefers-color-scheme: dark)");
  const DBLP_RESULT_TIMEOUT_MS = Math.max(250, Number(globalThis.__PAPER_RANK_DBLP_TIMEOUT_MS) || 5000);
  let dblpRecoveryPromise = null;

  const EN_NOTES = Object.freeze({
    warning: "This badge uses only the latest warning list bundled with the extension. A warning applies to the journal and does not judge every paper it contains.",
    ccf: "Based on the local CCF recommended catalog.",
    "ccf-none": "No rank was matched in the local CCF catalog. The venue may not be listed, or the page may provide incomplete venue information.",
    cas: "CAS journal partitions use broad-field Zones 1–4, with Zone 1 highest. Top is an additional marker. This system differs from JCR quartiles calculated within Web of Science categories.",
    top: "The Top marker comes from the CAS journal partition table.",
    xinrui: "XinRui publishes broad-field Zones 1–4. It is independent from both CAS partitions and JCR quartiles.",
    jcr: "JCR quartiles are calculated by subject category. One journal may have different quartiles across categories; the extension shows its best quartile.",
    if: "The impact factor comes from the local JCR dataset.",
    wos: "SCI, SCIE, SSCI, AHCI, and ESCI are Web of Science indexing types, not quartiles. See the JCR or CAS badge for partition information.",
    cssci: "CSSCI Source journals are selected by Nanjing University's Chinese Social Sciences Research Evaluation Center. CSSCI is independent from SSCI, JCR, and PKU Core.",
    pku: "PKU Core is a journal title list, not a Q1–Q4 system, and is independent from CSSCI.",
    ei: "The EI badge means the journal or proceedings appear in the Compendex Source List. EI has no Q1–Q4 scale. Verify individual records in Engineering Village."
  });

  function tr(value) {
    return I18N.exact(value, state.settings.language);
  }

  function resolvedColorTheme() {
    const selected = state.settings.colorTheme || "light";
    return selected === "system" ? (systemDarkMode.matches ? "dark" : "light") : selected;
  }

  function syncColorTheme() {
    const resolved = resolvedColorTheme();
    document.documentElement.dataset.paperRankTheme = resolved;
    if (tooltipHost) tooltipHost.dataset.theme = resolved;
  }
  function syncColorPalette() {
    const selected = ["soft", "vivid", "colorblind"].includes(state.settings.colorPalette)
      ? state.settings.colorPalette
      : "vivid";
    document.documentElement.dataset.paperRankPalette = selected;
  }

  if (systemDarkMode.addEventListener) systemDarkMode.addEventListener("change", syncColorTheme);
  else if (systemDarkMode.addListener) systemDarkMode.addListener(syncColorTheme);
  if (chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let rerender = false;
      for (const key of Object.keys(DEFAULTS)) {
        if (!changes[key]) continue;
        const nextValue = changes[key].newValue ?? DEFAULTS[key];
        state.settings[key] = key === "language" ? I18N.normalize(nextValue) : nextValue;
        if (key === "colorTheme") syncColorTheme();
        else if (key === "colorPalette") syncColorPalette();
        else {
          if (key === "language") {
            tooltipHost?.remove();
            tooltipHost = tooltipPanel = activeTooltipElement = null;
          }
          rerender = true;
        }
      }
      if (rerender) {
        const localization = changes.language ? I18N.ready(state.settings.language) : Promise.resolve();
        localization.then(() => setTimeout(resetRenderedResults, 0));
      }
    });
  }

  const idle = () => new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 750 });
    else setTimeout(resolve, 25);
  });

  function setStatus(status, detail = "") {
    document.documentElement.dataset.paperRankStatus = status;
    document.documentElement.dataset.paperRankDetail = detail;
  }

  function getSettings() {
    return new Promise((resolve) => chrome.storage.local.get(DEFAULTS, (stored) => resolve({
      ...stored,
      language: I18N.normalize(stored.language)
    })));
  }

  function siteKind() {
    const host = location.hostname.toLowerCase();
    if (/(^|\.)dblp\.(org|uni-trier\.de|dagstuhl\.de)$/.test(host)) return "dblp";
    if (host === "scholar.google.com" || host === "scholar.googleusercontent.com") return "scholar";
    if (host === "arxiv.org") return "arxiv";
    if (host === "pubmed.ncbi.nlm.nih.gov") return "pubmed";
    if (host === "www.semanticscholar.org" || host === "semanticscholar.org") return "semantic-scholar";
    if (host === "openalex.org" || host === "www.openalex.org") return "openalex";
    if (host === "kns.cnki.net" || host === "kns8.cnki.net") return "cnki";
    if (host === "s.wanfangdata.com.cn") return "wanfang";
    if (host === "www.aminer.cn" || host === "aminer.cn") return "aminer";
    if (host === "xueshu.baidu.com") return "baidu-scholar";
    if (host === "www.researchgate.net" || host === "researchgate.net") return "researchgate";
    if (/(^|\.)(nature\.com|springer\.com|sciencedirect\.com|wiley\.com|tandfonline\.com|cambridge\.org|mdpi\.com|frontiersin\.org|biomedcentral\.com|emerald\.com|emeraldgrouppublishing\.com|myscp\.org|science\.org|cell\.com|jamanetwork\.com|nejm\.org|thelancet\.com|bmj\.com|karger\.com|degruyter\.com|hindawi\.com|annualreviews\.org|royalsocietypublishing\.org)$/.test(host)
      || ["ieeexplore.ieee.org", "dl.acm.org", "journals.sagepub.com", "academic.oup.com", "journals.plos.org", "journals.aps.org", "pubs.aip.org", "iopscience.iop.org", "pubs.acs.org", "pubs.rsc.org", "journals.lww.com", "epubs.siam.org", "journals.asm.org", "journals.physiology.org"].includes(host)) {
      return "publisher";
    }
    return "unknown";
  }

  const PUBLISHER_RESULT_SELECTOR = [
    "article[data-test*='article']",
    "article[data-testid*='article']",
    ".search-result-item",
    ".search__item",
    ".result-item",
    ".results-item",
    ".article-listing",
    ".issue-item",
    "li.app-card-open",
    "li[class*='search-result']"
  ].join(", ");
  const PUBLISHER_TITLE_LINK_SELECTOR = [
    "a[href*='/article/']",
    "a[href*='/articles/']",
    "a[href*='/doi/']",
    "a[href*='/document/']",
    "a[href*='/science/article/']",
    "a[href*='/content/']"
  ].join(", ");
  const RESEARCHGATE_RESULT_SELECTOR = "[data-testid*='publication'], .publication-item, .nova-legacy-v-publication-item, .research-item, .result-item, [class*='publication-item'], a[href*='/publication/']";

  function isDblp() {
    return siteKind() === "dblp";
  }

  function resultSelector() {
    const site = siteKind();
    if (site === "dblp") return "li.entry, article.entry";
    if (site === "scholar") return ".gs_r.gs_or.gs_scl, .gs_r, .gsc_a_tr";
    if (site === "arxiv") return "li.arxiv-result";
    if (site === "pubmed") return "article.full-docsum";
    if (site === "semantic-scholar") return '[data-testid="paper-row"], [data-selenium-selector="paper-row"], .cl-paper-row, a[href*="/paper/"]';
    if (site === "openalex") return '[data-testid="work-result"], [data-testid="work-card"], a[href^="/works/"], a[href*="openalex.org/works/"]';
    if (site === "cnki") return '.result-table-list tbody tr, table.result-table-list tbody tr, .result-item, a[href*="/kcms2/article/abstract"], a[href*="/kns8s/detail/detail.aspx"], a[href*="/detail/detail.aspx"]';
    if (site === "wanfang") return '.normal-list-item, .result-item, .paper-item, a[href*="d.wanfangdata.com.cn/periodical/"], a[href*="d.wanfangdata.com.cn/thesis/"], a[href*="d.wanfangdata.com.cn/conference/"]';
    if (site === "aminer") return '.paper-item, a.title-link[href^="/pub/"]';
    if (site === "baidu-scholar") return '.paper-wrap.result, .sc_default_result, a[href*="/usercenter/paper/show"]';
    if (site === "researchgate") return RESEARCHGATE_RESULT_SELECTOR;
    if (site === "publisher") return PUBLISHER_RESULT_SELECTOR + ", " + PUBLISHER_TITLE_LINK_SELECTOR;
    return "";
  }

  function containersFromTitleLinks(linkSelector, preferredSelector) {
    const containers = [];
    const seen = new Set();
    for (const link of document.querySelectorAll(linkSelector)) {
      let container = link.closest(preferredSelector);
      if (!container) {
        container = link;
        for (let depth = 0; depth < 4 && container?.parentElement; depth += 1) container = container.parentElement;
      }
      if (!container || container === document.body || container === document.documentElement || seen.has(container)) continue;
      seen.add(container);
      containers.push(container);
    }
    return containers;
  }

  function resultContainers() {
    const site = siteKind();
    if (site === "scholar" && location.pathname.startsWith("/citations")) {
      return document.querySelectorAll(".gsc_a_tr");
    }
    if (site === "dblp" && location.pathname.startsWith("/search")) {
      const section = document.querySelector("#completesearch-publs");
      return section ? section.querySelectorAll("li.entry, article.entry") : document.querySelectorAll("li.entry, article.entry");
    }
    if (site === "semantic-scholar") {
      const direct = document.querySelectorAll('[data-testid="paper-row"], [data-selenium-selector="paper-row"], .cl-paper-row');
      return direct.length ? direct : containersFromTitleLinks('a[href*="/paper/"]', 'article, li, [data-testid*="paper"], [class*="paper-row"]');
    }
    if (site === "openalex") {
      const direct = document.querySelectorAll('[data-testid="work-result"], [data-testid="work-card"], article.work-result');
      return direct.length ? direct : containersFromTitleLinks('a[href^="/works/"], a[href*="openalex.org/works/"]', 'article, li, [data-testid*="work"], [class*="result"], [class*="card"]');
    }
    if (site === "cnki") {
      const direct = document.querySelectorAll('.result-table-list tbody tr, table.result-table-list tbody tr, .result-item');
      return direct.length ? direct : containersFromTitleLinks('a[href*="/kcms2/article/abstract"], a[href*="/kns8s/detail/detail.aspx"], a[href*="/detail/detail.aspx"]', 'tr, li, .result-item, [class*="result"]');
    }
    if (site === "wanfang") {
      const direct = document.querySelectorAll('.normal-list-item, .result-item, .paper-item');
      return direct.length ? direct : containersFromTitleLinks('a[href*="d.wanfangdata.com.cn/periodical/"], a[href*="d.wanfangdata.com.cn/thesis/"], a[href*="d.wanfangdata.com.cn/conference/"]', 'article, li, .normal-list-item, .result-item, .paper-item, [class*="result"]');
    }
    if (site === "aminer") {
      const direct = document.querySelectorAll('.paper-item');
      return direct.length ? direct : containersFromTitleLinks('a.title-link[href^="/pub/"]', '.paper-item, article, li, [class*="publication"]');
    }
    if (site === "baidu-scholar") {
      const direct = document.querySelectorAll('.paper-wrap.result, .sc_default_result');
      return direct.length ? direct : containersFromTitleLinks('a[href*="/usercenter/paper/show"]', '.paper-wrap, .sc_default_result, .result, article, li');
    }
    if (site === "researchgate") {
      if (/\/publication\//.test(location.pathname)) {
        const main = document.querySelector("main, [role='main'], .nova-legacy-l-page__main");
        if (main) return [main];
        return [document.body];
      }
      const linked = containersFromTitleLinks("a[href*='/publication/']", "article, li, [data-testid*='publication'], [class*='publication']");
      if (linked.length) return topLevelContainers(linked);
      return topLevelContainers(document.querySelectorAll(".publication-item, .nova-legacy-v-publication-item, .research-item, .result-item, [class*='publication-item']"));
    }
    if (site === "publisher") {
      // A document page is one logical item.  Do this before looking for
      // related-article cards, otherwise publisher sidebars win the scan.
      if (isPublisherDocumentPage()) {
        return [document.querySelector("main article, article[role='main'], main, [role='main']") || document.body];
      }
      if (isJournalLandingPage()) {
        const title = journalHeaderNode();
        if (title?.parentElement) return [title.parentElement];
        // Some journal homes use a cover/logo instead of textual h1 markup.
        // Keep one stable container so the ISSN fallback can still render ranks.
        return [document.querySelector("main, header, [role='main']") || document.body];
      }
      const direct = document.querySelectorAll(PUBLISHER_RESULT_SELECTOR);
      if (direct.length) return direct;
      const linked = containersFromTitleLinks(
        PUBLISHER_TITLE_LINK_SELECTOR,
        "article, li, .search-result-item, .result-item, .results-item, [class*='search-result'], [class*='article-list']"
      );
      if (linked.length) return linked;
      const citationTitle = document.querySelector('meta[name="citation_title"]')?.content;
      const citationJournal = document.querySelector('meta[name="citation_journal_title"], meta[name="prism.publicationName"], meta[name="journal_title"], meta[name="bepress_citation_journal_title"]')?.content;
      const article = document.querySelector("main article, article[role='main'], main");
      const journalLanding = /\/(?:journal|journals|loi|about)(?:\/|$)/i.test(location.pathname);
      const journalHeading = document.querySelector("main h1, header h1, .journal-title");
      // Journal landing pages commonly have a journal-name meta tag but no article title.
      return (citationTitle || citationJournal || (journalLanding && journalHeading)) && article ? [article] : [];
    }
    const selector = resultSelector();
    return selector ? document.querySelectorAll(selector) : [];
  }

  function shardKey(value) {
    const first = (value || "")[0] || "";
    if (first >= "a" && first <= "z") return first;
    if (first >= "0" && first <= "9") return "0";
    return "other";
  }

  async function loadShard(key) {
    if (!key) return null;
    if (state.shards.has(key)) return state.shards.get(key);
    if (state.shardPromises.has(key)) return state.shardPromises.get(key);
    const promise = (async () => {
      const updated = await sendRuntimeMessage({ type: "rank-assistant-get-data-shard", key });
      if (updated?.ok && updated.shard) {
        state.shards.set(key, updated.shard);
        return updated.shard;
      }
      const response = await fetch(chrome.runtime.getURL("extension/data/catalog-shard-" + key + ".private.json"));
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("failed to load data shard " + key + ": HTTP " + response.status);
      }
      const shard = await response.json();
      state.shards.set(key, shard);
      await idle();
      return shard;
    })();
    state.shardPromises.set(key, promise);
    try {
      return await promise;
    } finally {
      state.shardPromises.delete(key);
    }
  }

  async function ensureShards(keys) {
    const unique = [...new Set(keys)].filter(Boolean);
    await Promise.all(unique.map(loadShard));
  }
  // Catalogues usually store English possessives without the apostrophe
  // ("Parkinsons"), whereas publisher and Scholar pages render "Parkinson's".
  // Normalising the possessive before lookup makes this a title equivalence,
  // rather than a one-off alias for a particular npj journal.
  function venueKey(value) {
    return N.normalize(String(value || "").replace(/([\p{L}\p{N}])['’]s\b/gu, "$1s"));
  }

  function abbreviationKey(value) {
    return venueKey(value).split(" ").filter((token) => token && !STOP.has(token))
      .map((token) => token.slice(0, 4)).join(" ");
  }

  function firstMatchingTextNode(container, selectors, pattern = null) {
    for (const selector of selectors) {
      for (const node of container.querySelectorAll(selector)) {
        if (!pattern || pattern.test((node.textContent || "").trim())) return node;
      }
    }
    return null;
  }

  function metadataNode(container) {
    const site = siteKind();
    if (site === "dblp") return container.querySelector(".data, cite") || container;
    if (site === "scholar") {
      if (container.matches?.(".gsc_a_tr")) return container.querySelectorAll(".gs_gray")[1] || container.querySelector(".gs_gray") || container;
      return container.querySelector(".gs_a") || container.querySelector(".gs_ri") || container;
    }
    if (site === "pubmed") return container.querySelector(".docsum-journal-citation") || container;
    if (site === "arxiv") return firstMatchingTextNode(container, [".comments", ".journal-ref", "p"], /^(Comments|Journal reference):/i) || container;
    if (site === "semantic-scholar") return container.querySelector('a[href*="/venue/"], [data-testid="paper-meta"], [data-selenium-selector="paper-venue"], .cl-paper-venue, [class*="venue"]') || container;
    if (site === "openalex") return container.querySelector('[data-testid="source"], [data-testid="venue"], [class*="source"], [class*="venue"]') || container;
    if (site === "cnki") return container.querySelector('td.source a, .source a, [data-field="source"] a') || container.querySelector('td.source, .source, [data-field="source"]') || container;
    if (site === "wanfang") return container.querySelector('.source a, .periodical a, .journal a, [class*="magazine"] a') || container.querySelector('.source, .periodical, .journal, [class*="magazine"]') || container;
    if (site === "aminer") return container.querySelector('.conf-info-zone .venue-link a, .conf-info-zone .venue-link, .venue-link a') || container;
    if (site === "baidu-scholar") return container.querySelector('.paper-info, .sc_info') || container;
    if (site === "researchgate") return researchGateVenueNode(container) || container;
    if (site === "publisher") return publisherVenueNode(container) || container;
    return container;
  }

  function titleNode(container) {
    const site = siteKind();
    if (site === "dblp") return container.querySelector('span.title[itemprop="name"], .title');
    if (site === "scholar") return container.querySelector(".gsc_a_at, .gs_rt");
    if (site === "arxiv") return container.querySelector(".title");
    if (site === "pubmed") return container.querySelector(".docsum-title");
    if (site === "semantic-scholar") return container.querySelector('a[href*="/paper/"]');
    if (site === "openalex") return container.querySelector('a[href^="/works/"], a[href*="openalex.org/works/"]');
    if (site === "cnki") return container.querySelector('td.name a, .name a, a.fz14, a[href*="/kcms2/article/abstract"], a[href*="/kns8s/detail/detail.aspx"], a[href*="/detail/detail.aspx"]');
    if (site === "wanfang") return container.querySelector('.title a, a.title, a[href*="d.wanfangdata.com.cn/periodical/"], a[href*="d.wanfangdata.com.cn/thesis/"], a[href*="d.wanfangdata.com.cn/conference/"]');
    if (site === "aminer") return container.querySelector('a.title-link[href^="/pub/"], .paper-title');
    if (site === "baidu-scholar") return container.querySelector('.paper-title a, h3.t a, .t a, a[href*="/usercenter/paper/show"]');
    if (site === "researchgate") return container.querySelector("h1, h2 a[href*='/publication/'], h3 a[href*='/publication/'], a[href*='/publication/']");
    if (site === "publisher") {
      return container.querySelector(
        "[data-test*='title'] a, [data-testid*='title'] a, .article-title a, .result-title a, .title a, h2 a, h3 a, " + PUBLISHER_TITLE_LINK_SELECTOR
      ) || (container.matches?.("main, article") ? container.querySelector("h1") : null);
    }
    return null;
  }

  function venueNode(container) {
    const site = siteKind();
    if (site === "dblp") {
      return container.querySelector(
        '.data [itemprop="isPartOf"] a, cite [itemprop="isPartOf"] a, .data a[href*="/db/"], cite a[href*="/db/"], .rank-assistant-fallback-venue'
      );
    }
    if (site === "scholar" || site === "pubmed") return metadataNode(container);
    if (site === "arxiv") return firstMatchingTextNode(container, [".journal-ref", ".comments", "p"], /^(Journal reference|Comments):/i);
    if (site === "semantic-scholar") return container.querySelector('a[href*="/venue/"], [data-testid="paper-meta"], [data-selenium-selector="paper-venue"], .cl-paper-venue, [class*="venue"]');
    if (site === "openalex") return container.querySelector('[data-testid="source"], [data-testid="venue"], [class*="source"], [class*="venue"]');
    if (site === "cnki") return container.querySelector('td.source a, .source a, [data-field="source"] a') || container.querySelector('td.source, .source, [data-field="source"]');
    if (site === "wanfang") return container.querySelector('.source a, .periodical a, .journal a, [class*="magazine"] a') || container.querySelector('.source, .periodical, .journal, [class*="magazine"]');
    if (site === "aminer") return container.querySelector('.conf-info-zone .venue-link a, .conf-info-zone .venue-link, .venue-link a');
    if (site === "baidu-scholar") return container.querySelector('.paper-info, .sc_info');
    if (site === "researchgate") return researchGateVenueNode(container);
    if (site === "publisher") return publisherVenueNode(container);
    return null;
  }

  function publisherVenueNode(container) {
    return container.querySelector(
      "[data-test*='journal'], [data-testid*='journal'], [data-test*='publication'], [data-testid*='publication'], " +
      ".publication-title, .journal-title, .meta__journal, .result-journal, .search-result__publication, " +
      "a[href*='/journal/'], a[href*='/journals/']"
    );
  }

  function topLevelContainers(containers) {
    const values = [...containers];
    return values.filter((container) => !values.some((other) => other !== container && other.contains(container)));
  }

  function isJournalLandingPage() {
    const path = location.pathname.toLowerCase();
    if (/\/(?:article|articles|doi|document|search)(?:\/|$)/.test(path)) return false;
    if (/\/(?:journal|journals|loi)(?:\/|$)/.test(path)) return true;
    // Nature Portfolio journal homes use short paths such as /npjscifood/.
    if (/(^|\.)nature\.com$/.test(location.hostname) && /^\/[^/]+\/?$/.test(path)) return true;
    // Emerald's redesigned site uses the journal code itself as the home
    // path (for example, /ejm/).  It is neither an article route nor named
    // /journal/, so recognize the whole family of code-based journal homes.
    if (/(^|\.)emerald\.com$/.test(location.hostname) && /^\/(?!insight\/?$)[a-z0-9-]+\/?$/i.test(path)) return true;
    // Oxford Academic uses compact journal codes such as /jcr/ rather than a
    // /journal/ route.  Exclude site utility pages but support the entire
    // code-based journal-home family.
    if (location.hostname === "academic.oup.com" && /^\/(?!search|my-account|advanced-search)[a-z0-9-]+\/?$/i.test(path)) return true;
    return siteKind() === "publisher" && Boolean(journalHeaderNode()) && /\/(?:about|publication)\b/.test(path);
  }

  function journalHeaderNode() {
    return document.querySelector(
      "[data-test*='journal-title'], [data-testid*='journal-title'], .journal-title h1, .journal-title, " +
      ".journal-header h1, .journal-header__title, .publication-header__title, .journal-banner h1, " +
      "[class*='journal-banner'] h1, [class*='journal-header'] h1, main h1, header h1, h1"
    );
  }

  function researchGateVenueNode(container) {
    return container.querySelector(
      "a[href*='/journal/'], [data-testid*='journal'], [data-testid*='publication-venue'], .publication-meta__journal, .publication-title"
    );
  }

  function researchGateVenueFromText(value) {
    const raw = String(value || "");
    const direct = raw.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*[\u00b7\u2022]\s*([^\n\u00b7\u2022]+?)(?:\s+\d+\s*:\s*\d+)?(?:\n|$)/i);
    const directVenue = (direct?.[1] || "").trim();
    if (directVenue && !/\b(?:read|citation)s?\b/i.test(directVenue)) return directVenue;
    const inline = raw.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*[·•]\s*([^\n·]+?)(?:\s+\d+\s*:\s*\d+)?(?:\n|$)/i);
    const inlineVenue = (inline?.[1] || "").trim();
    if (inlineVenue && !/\b(?:read|citation)s?\b/i.test(inlineVenue)) return inlineVenue;
    const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const dateAt = lines.findIndex((line) => /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i.test(line));
    if (dateAt >= 0) {
      // On profile cards the journal is the first substantive line after the
      // Article/date/reads line.  Ignore controls and author lines defensively.
      for (let index = dateAt + 1; index < Math.min(lines.length, dateAt + 4); index += 1) {
        const line = lines[index].replace(/^\s*(?:journal|source)\s*[:·-]\s*/i, "").trim();
        if (line && !/^(download|share|article|full-text available)$/i.test(line) && !/[•·]\s*[^•·]+$/.test(line)) return line;
      }
    }
    return "";
  }

  function isResearchGatePublicationPage() {
    return siteKind() === "researchgate" && /\/publication\//.test(location.pathname);
  }

  function isPublisherDocumentPage() {
    if (siteKind() !== "publisher" || isJournalLandingPage()) return false;
    if (/\/(?:article|articles|doi|document|content)\//.test(location.pathname)) return true;
    return Boolean(document.querySelector('meta[name="citation_title"], meta[name="citation_journal_title"], meta[name="prism.publicationName"]'));
  }

  function researchGateDocumentVenue() {
    const meta = document.querySelector('meta[name="citation_journal_title"], meta[name="dc.source"], meta[name="prism.publicationName"]');
    if (meta?.content?.trim()) return meta.content.trim();
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      const match = (node.textContent || "").match(/"isPartOf"\s*:\s*\{[^{}]{0,800}?"name"\s*:\s*"([^"]+)"/i);
      if (match?.[1]) return match[1];
    }
    const linked = (document.querySelector("a[href*='/journal/'], [data-testid*='journal']")?.textContent || "").trim();
    if (linked) return linked;
    // ResearchGate sometimes exposes the journal only below the paper title.
    return researchGateVenueFromText(document.body?.innerText || "");
  }

  function publisherDocumentVenue() {
    const meta = document.querySelector('meta[name="citation_journal_title"], meta[name="prism.publicationName"], meta[name="journal_title"], meta[name="bepress_citation_journal_title"], meta[name="dc.source"]');
    const value = (meta?.content || "").trim();
    if (value && !/^(springer(?:link| nature link)?|sciencedirect|elsevier|wiley(?: online library)?|sage journals?|oxford academic|emerald(?: publishing)?|taylor and francis|cambridge core|ieee xplore|acm digital library)$/i.test(value)) return value;
    return (document.querySelector(
      "[data-test*='journal-title'], [data-testid*='journal-title'], header .journal-title, main .journal-title, " +
      "a[aria-label*='journal'], .publication-header__title, main h1, header h1, h1"
    )?.textContent || document.title || "").trim();
  }

  function publisherPageTitleCandidates() {
    const values = [];
    const add = (value) => {
      const cleaned = String(value || "").trim();
      if (!cleaned || values.includes(cleaned)) return;
      values.push(cleaned);
      const lead = cleaned.split(/\s+[|｜]\s+/)[0].trim();
      if (lead && lead !== cleaned && !values.includes(lead)) values.push(lead);
      const withoutPublisher = cleaned.replace(/\s+[-|｜]\s+(?:wiley(?: online library)?|nature(?: portfolio)?|springer(?: nature)?|emerald(?: publishing)?|sage journals?|oxford academic|taylor\s*&\s*francis).*$/i, "").trim();
      if (withoutPublisher && withoutPublisher !== cleaned && !values.includes(withoutPublisher)) values.push(withoutPublisher);
    };
    for (const meta of document.querySelectorAll('meta[name="citation_journal_title"], meta[name="prism.publicationName"], meta[name="journal_title"], meta[name="bepress_citation_journal_title"], meta[property="og:title"], meta[name="twitter:title"]')) add(meta.content);
    // Journal homes (notably the redesigned Emerald pages) often have no
    // citation metadata.  Their visible banner is nevertheless authoritative.
    if (isJournalLandingPage()) add(journalHeaderNode()?.textContent);
    // OUP frequently renders the journal identity as a masthead image.  Its
    // alt text is a reliable full title when there is no textual h1.
    if (location.hostname === "academic.oup.com" && isJournalLandingPage()) {
      for (const image of document.querySelectorAll("img[alt]")) add(image.alt);
    }
    add(document.title);
    return values;
  }

  function dblpKeyFromHref(href) {
    if (!href) return "";
    try {
      const pathname = new URL(href, location.href).pathname;
      const match = pathname.match(/^\/db\/([^/]+)\/([^/]+)\//);
      return match ? `/db/${match[1]}/${match[2]}/` : "";
    } catch (_) {
      return "";
    }
  }

  function dblpVenueKey(container) {
    return dblpKeyFromHref(venueNode(container)?.getAttribute?.("href"));
  }
  function cleanSemanticScholarVenue(value) {
    return String(value || "")
      .replace(/\s*[\u00b7\u2022]\s*(?:19|20)\d{2}.*$/, "")
      .trim();
  }

  function semanticScholarVenueCandidates(container) {
    const candidates = [];
    const add = (value) => {
      const cleaned = cleanSemanticScholarVenue(value);
      if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
    };
    const primary = venueNode(container);
    const nodes = [primary];
    const linked = primary?.matches?.('a[href*="/venue/"]')
      ? primary
      : primary?.querySelector?.('a[href*="/venue/"]');
    if (linked && linked !== primary) nodes.unshift(linked);
    for (const node of nodes.filter(Boolean)) {
      for (const attribute of ["title", "aria-label", "data-venue", "data-full-text"]) {
        add(node.getAttribute?.(attribute));
      }
      const href = node.getAttribute?.("href");
      if (href) {
        try {
          const match = new URL(href, location.href).pathname.match(/\/venue\/([^/]+)/);
          if (match) add(decodeURIComponent(match[1]).replace(/[-_]+/g, " "));
        } catch (_) {}
      }
      add(node.textContent);
    }
    return candidates;
  }


  function candidateText(container) {
    const site = siteKind();
    if (site === "dblp") {
      const venue = venueNode(container);
      if (venue) return venue.textContent || "";
    }
    if (site === "semantic-scholar") {
      const candidates = semanticScholarVenueCandidates(container);
      if (candidates.length) return candidates[0];
    }
    const raw = (metadataNode(container).textContent || "").trim();
    if (site === "scholar") {
      if (container.matches?.(".gsc_a_tr")) {
        return raw
          .replace(/\s+\d+(?:\s*\([^)]*\))?\s*,.*$/, "")
          .replace(/,\s*(?:19|20)\d{2}.*$/, "")
          .trim();
      }
      const parts = raw.split(/\s+-\s+/);
      if (parts.length >= 2) return parts[1].replace(/,\s*\d{4}.*$/, "").trim();
    }
    if (site === "pubmed") return raw.replace(/\b(?:19|20)\d{2}\b.*$/, "").replace(/[.;,\s]+$/, "").trim();
    if (site === "arxiv") return raw.replace(/^(Comments|Journal reference):\s*/i, "").trim();
    if (site === "cnki" || site === "wanfang") {
      const venue = venueNode(container);
      if (venue) return (venue.textContent || "").trim();
      const labeled = raw.match(/(?:来源|刊名)[:：]\s*([^\n;；]+)/);
      return labeled ? labeled[1].trim() : "";
    }
    if (site === "aminer") {
      return raw.replace(new RegExp("\\s*[\\uFF08(](?:19|20)\\d{2}[\\uFF09)]\\s*$"), "").trim();
    }
    if (site === "baidu-scholar") {
      const quotedVenue = raw.match(new RegExp("\\u300A([^\\u300B]+)\\u300B"));
      if (quotedVenue) return quotedVenue[1].trim();
      const parts = raw.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
      return parts.length >= 2
        ? parts[1].replace(new RegExp("^(?:\\u6765\\u6E90|\\u520A\\u540D)[:\\uFF1A]\\s*"), "").trim()
        : "";
    }
    if (site === "researchgate") {
      if (isResearchGatePublicationPage()) return researchGateDocumentVenue() || raw;
      const perResult = (researchGateVenueNode(container)?.textContent || "").trim();
      const fromText = researchGateVenueFromText(container.innerText || container.textContent || "");
      // A profile/search card must never inherit a journal from the open page.
      // Its full local text is retained as a fallback so embedded journal text can be matched.
      return fromText || perResult || raw;
    }
    if (site === "publisher") {
      if (isJournalLandingPage()) return (journalHeaderNode()?.textContent || publisherDocumentVenue()).trim();
      const perResult = (publisherVenueNode(container)?.textContent || "").trim();
      return perResult || publisherDocumentVenue();
    }
    return raw;
  }
  function scholarVisibleVenueCandidates(container) {
    const values = [];
    const add = (value) => {
      const text = String(value || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (text.length >= 6 && text.length <= 140 && words.length >= 2 && words.length <= 18 && !values.includes(text)) values.push(text);
    };
    const citation = container.querySelector(".gs_a")?.textContent || "";
    for (const part of citation.split(/\s+-\s+/).slice(1)) {
      // Keep an ellipsis intact.  It means Scholar has truncated the venue,
      // not that the visible prefix is a journal title in its own right.
      add(part.replace(/,?\s*(?:19|20)\d{2}.*$/, "").trim());
    }
    // EasyScholar resolves ellipsized Scholar citations asynchronously.  Reuse
    // its displayed, full venue text when it is present rather than guessing.
    for (const node of container.querySelectorAll(".easyScholarPaperFlag, .easyScholarTemp, [class*='easyScholar']")) {
      add(node.textContent);
      add(node.getAttribute("title"));
      add(node.getAttribute("data-journal"));
      add(node.getAttribute("data-source"));
    }
    // Google Scholar and companion extensions render source names using
    // different classes. Leaf text keeps this selector-independent.
    for (const node of container.querySelectorAll("a, span")) {
      if (node.children.length) continue;
      add(node.textContent);
      add(node.getAttribute("title"));
    }
    return values;
  }

  function scholarExplicitVenueCandidates(container) {
    const values = [];
    const add = (value) => {
      const text = String(value || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (text.length >= 6 && text.length <= 140 && words.length >= 2 && words.length <= 18 && !values.includes(text)) values.push(text);
    };
    // Companion extensions use varying elements for their full journal-name
    // pill. Read known enrichment containers and generic leaf elements, while
    // excluding our own badges so rendering cannot change the fingerprint and
    // trigger a self-rescan loop.
    for (const node of container.querySelectorAll(".easyScholarPaperFlag, .easyScholarTemp, [class*='easyScholar']")) {
      add(node.textContent);
      add(node.getAttribute?.("data-journal"));
      add(node.getAttribute?.("data-source"));
      add(node.getAttribute?.("title"));
    }
    for (const node of container.querySelectorAll("*")) {
      if (node.closest?.(".rank-assistant-row, .rank-assistant-venue-detail, #rank-assistant-shared-tooltip")) continue;
      if (node.matches?.(".gs_a, .gs_rt, .gsc_a_at")) continue;
      if (node.children.length) continue;
      add(node.textContent);
      add(node.getAttribute?.("data-journal"));
      add(node.getAttribute?.("data-source"));
      add(node.getAttribute?.("title"));
    }
    return values;
  }

  function scholarVenueFingerprint(container) {
    // Keep a stable snapshot of the text that may identify a venue.  This is
    // used to distinguish EasyScholar's delayed venue enrichment from normal
    // Google Scholar page churn (which must not clear existing badges).
    return scholarExplicitVenueCandidates(container).map((value) => N.normalize(value)).join("\u001f");
  }

  function pubmedVisibleVenueCandidates(container) {
    const values = [];
    const add = (value) => {
      const text = String(value || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (text.length >= 6 && text.length <= 140 && words.length >= 2 && words.length <= 18 && !values.includes(text)) values.push(text);
    };
    // EasyScholar renders the expanded journal title asynchronously on PubMed.
    // The native PubMed line frequently has only an abbreviation (e.g. Front
    // Neurol.), so prefer the explicit full-title fields when they arrive.
    for (const node of container.querySelectorAll(".easyScholarPaperFlag, .easyScholarTemp, [class*='easyScholar']")) {
      add(node.textContent);
      add(node.getAttribute("title"));
      add(node.getAttribute("data-journal"));
      add(node.getAttribute("data-source"));
    }
    return values;
  }

  function candidateTexts(container) {
    if (siteKind() === "semantic-scholar") return semanticScholarVenueCandidates(container);
    const candidates = [];
    const add = (value) => {
      const cleaned = String(value || "").trim();
      if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
    };
    add(candidateText(container));
    if (siteKind() === "scholar") {
      const source = candidates[0] || "";
      const normalizedSource = N.normalize(source);
      // These are unambiguous Scholar source labels, not fuzzy prefix rules:
      // bare "Jama" denotes the flagship journal, whereas named JAMA
      // specialty journals retain their full labels (JAMA Neurology, etc.).
      if (normalizedSource === "jama") add("JAMA Journal of the American Medical Association");
      if (normalizedSource === "the lancet") add("Lancet");
      // Keep explicit, rendered full venue names ahead of Scholar's source
      // line. Google Scholar sometimes attributes an article to a similarly
      // named but different journal; those source strings are only fallback.
      const explicit = scholarExplicitVenueCandidates(container);
      for (const value of explicit.slice().reverse()) candidates.unshift(value);
      for (const value of scholarVisibleVenueCandidates(container)) add(value);
    }
    if (siteKind() === "pubmed") {
      for (const value of pubmedVisibleVenueCandidates(container)) add(value);
    }
    // Document-level metadata belongs only to a ResearchGate publication page.
    // Adding it to cards made every result on a profile inherit the same journal.
    if (isResearchGatePublicationPage()) add(researchGateDocumentVenue());
    if (siteKind() === "publisher" && isJournalLandingPage()) {
      for (const value of publisherPageTitleCandidates()) add(value);
      // MDPI displays short brand titles such as "Agriculture" on its
      // journal home pages, whereas authoritative catalogues commonly store
      // the disambiguated official form "Agriculture-Basel".  Try that
      // official variant only on MDPI homes; it does not loosen matching on
      // other publishers or article search results.
      if (/(^|\.)mdpi\.com$/.test(location.hostname)) {
        const shortTitle = (journalHeaderNode()?.textContent || "").trim();
        if (shortTitle && shortTitle.split(/\s+/).length <= 6) add(shortTitle + " Basel");
      }
    }
    const venue = venueNode(container);
    for (const attribute of ["data-full-text", "data-venue", "title"]) {
      add(venue?.getAttribute?.(attribute));
    }
    return candidates;
  }

  function publisherIssns() {
    const found = new Set();
    const add = (value) => {
      const matches = String(value || "").match(/\b\d{4}[- ]?\d{3}[\dX]\b/gi) || [];
      for (const match of matches) found.add(match.replace(/[^0-9X]/gi, "").toUpperCase());
    };
    for (const meta of document.querySelectorAll('meta[name*="issn" i], meta[property*="issn" i], meta[name="dc.identifier"]')) add(meta.content);
    add(location.pathname);
    const main = document.querySelector("main, header");
    add(main?.innerText || main?.textContent || "");
    // Some publisher homes put their authoritative ISSN outside <main>:
    // Emerald uses the cover/issue area, while Oxford Academic puts it in the
    // journal footer.  Use that page-level identifier only on journal landing
    // pages, where it identifies the journal itself rather than a cited work.
    if ((/(^|\.)emerald\.com$/.test(location.hostname) || location.hostname === "academic.oup.com") && isJournalLandingPage()) {
      add(document.body?.innerText || document.body?.textContent || "");
    }
    return [...found];
  }

  function pubmedId(container) {
    const href = container.querySelector("a.docsum-title, a[href*='/pubmed/'], a[href]")?.getAttribute("href") || "";
    const fromHref = href.match(/(?:^|\/)\d{6,10}(?:\/|$)/)?.[0]?.replace(/\//g, "");
    if (fromHref) return fromHref;
    return (container.textContent || "").match(/PMID:\s*(\d{6,10})/i)?.[1] || "";
  }

  async function indexedRecordForIssns(values) {
    const index = globalThis.RankAssistantIssnIndex;
    if (!index) return null;
    const hints = (Array.isArray(values) ? values : [values])
      .map((value) => index[String(value || "").replace(/[^0-9X]/gi, "").toUpperCase()])
      .filter((value) => Array.isArray(value) && value.length === 2);
    if (!hints.length) return null;
    const [key, offset] = hints[0];
    await loadShard(key);
    return state.shards.get(key)?.r?.[offset] || null;
  }

  async function indexedIssnRecord() {
    return indexedRecordForIssns(publisherIssns());
  }

  function publisherLandingTitleRecord() {
    // Keep this deliberately exact.  It is a separate path from the broad
    // result-card matcher because journal home pages can contain many article
    // and navigation titles.  The masthead/title candidates are authoritative.
    return uniqueRecord(publisherPageTitleCandidates().map((title) =>
      matchRecord(title, { allowCompletion: false })
    ));
  }
  function recordInShard(key, normalized, abbreviated) {
    const shard = state.shards.get(key);
    if (!shard) return null;
    if (Object.prototype.hasOwnProperty.call(shard.a, normalized)) return shard.r[shard.a[normalized]] || null;
    if (abbreviated && Object.prototype.hasOwnProperty.call(shard.b, abbreviated)) {
      return shard.r[shard.b[abbreviated]] || null;
    }
    return null;
  }

  function exactRecord(text) {
    const normalized = venueKey(text);
    if (!normalized) return null;
    return recordInShard(shardKey(normalized), normalized, abbreviationKey(normalized));
  }

  function recordCompleteness(record) {
    if (!record) return -1;
    return [1, 4, 8, 9, 12, 16, 17, 20, 24, 26, 28, 32, 34]
      .reduce((score, index) => score + (record[index] ? 1 : 0), 0);
  }

  function recordIdentity(record) {
    if (!record) return "";
    return [record[0] || "", record[15] || "", ...(record[13] || [])].join("|");
  }

  function uniqueRecord(records) {
    const byIdentity = new Map();
    for (const record of records.filter(Boolean)) byIdentity.set(recordIdentity(record), record);
    return byIdentity.size === 1 ? [...byIdentity.values()][0] : null;
  }

  function prefixRecord(text, { includeExact = false } = {}) {
    const normalized = venueKey(text);
    const candidateTokens = normalized.split(" ").filter(Boolean);
    if (candidateTokens.length < 4 || normalized.length < 20) return null;
    const shard = state.shards.get(shardKey(normalized));
    if (!shard) return null;
    const matches = new Set();
    for (const [stored, index] of Object.entries(shard.a)) {
      if ((includeExact && stored === normalized) || stored.startsWith(normalized + " ")) matches.add(index);
      if (matches.size > 1) return false;
    }
    for (const stored of shard.x || []) {
      if ((includeExact && stored === normalized) || stored.startsWith(normalized + " ")) return false;
    }

    return matches.size === 1 ? shard.r[[...matches][0]] || null : null;
  }

  function fuzzyAbbreviationRecord(text) {
    const normalized = venueKey(text);
    const candidate = abbreviationKey(normalized);
    const candidateTokens = candidate.split(" ").filter(Boolean);
    if (candidateTokens.length < 2) return null;
    const shard = state.shards.get(shardKey(normalized));
    if (!shard) return null;
    for (const stored of shard.y || []) {
      const storedTokens = stored.split(" ");
      if (storedTokens.length !== candidateTokens.length) continue;
      if (candidateTokens.every((token, position) =>
        storedTokens[position].startsWith(token) || token.startsWith(storedTokens[position])
      )) return null;
    }
    const matches = new Set();
    for (const [stored, index] of Object.entries(shard.b)) {
      const storedTokens = stored.split(" ");
      if (storedTokens.length !== candidateTokens.length) continue;
      if (!candidateTokens.every((token, position) =>
        storedTokens[position].startsWith(token) || token.startsWith(storedTokens[position])
      )) continue;
      matches.add(index);
      if (matches.size > 1) return null;
    }
    return matches.size === 1 ? shard.r[[...matches][0]] || null : null;
  }
  function longEmbeddedRecord(text) {
    const normalized = venueKey(text);
    const words = normalized.split(" ").filter(Boolean);
    for (let size = Math.min(state.maxAliasWords, words.length); size >= 4; size -= 1) {
      const matches = [];
      for (let start = 0; start <= words.length - size; start += 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const shard = state.shards.get(shardKey(phrase));
        if (!shard || !Object.prototype.hasOwnProperty.call(shard.a, phrase)) continue;
        matches.push(shard.r[shard.a[phrase]] || null);
      }
      if (matches.length) return uniqueRecord(matches);
    }
    return null;
  }

  function acronymRecord(text) {
    const raw = String(text || "").trim();
    const simple = raw.match(/^([A-Z][A-Z0-9-]{2,11})(?:\s+(?:19|20)\d{2})?$/);
    const contextual = raw.match(/(?:accepted|published|appearing|presented|forthcoming)\s+(?:at|in|to)?\s*([A-Z][A-Z0-9-]{2,11})\b/i);
    const acronym = simple?.[1] || contextual?.[1] || "";
    return acronym ? exactRecord(acronym) : null;
  }

  function matchRecord(text, { allowEmbedded = false, allowCompletion = true } = {}) {
    const normalized = venueKey(text);
    if (!normalized) return null;
    const shard = state.shards.get(shardKey(normalized));
    if (shard?.x?.includes(normalized)) return null;
    const truncated = /(?:\.\.\.|\u2026)+\s*$/.test(String(text || ""));
    if (!truncated) {
      // Scholar commonly spells canonical titles with a leading article
      // (e.g. "The Lancet"), while the catalogue stores "Lancet".
      const exact = exactRecord(normalized) || (normalized.startsWith("the ") ? exactRecord(normalized.slice(4)) : null);
      if (exact) return exact;
    }
    if (allowCompletion) {
      const prefixed = prefixRecord(normalized, { includeExact: truncated });
      if (prefixed === false) return null;
      if (prefixed) return prefixed;
      const abbreviated = fuzzyAbbreviationRecord(normalized);
      if (abbreviated) return abbreviated;
    }
    return allowEmbedded ? longEmbeddedRecord(normalized) || acronymRecord(text) : null;
  }
  function semanticScholarRecord(texts) {
    return uniqueRecord(texts.map((text) => matchRecord(text)));
  }

  function scholarExplicitRecord(texts) {
    // Scholar's native source line is occasionally wrong or abbreviated.  A
    // companion extension may expose the full journal name in the same card,
    // so do not let an unrelated shorter title ("Journal of Marketing")
    // cancel a more specific exact title ("European Journal of Marketing").
    // This accepts exact catalogue matches only; prefixes and fuzzy aliases
    // remain fallback behaviour and can never win this conflict.
    const matches = [];
    for (const text of texts || []) {
      const record = matchRecord(text, { allowCompletion: false });
      if (!record) continue;
      const titleWords = venueKey(record[0]).split(" ").filter(Boolean).length;
      const textWords = venueKey(text).split(" ").filter(Boolean).length;
      matches.push({ record, score: Math.min(titleWords, textWords), titleWords });
    }
    if (!matches.length) return null;
    matches.sort((left, right) => right.score - left.score || right.titleWords - left.titleWords);
    const best = matches[0];
    const tied = matches.filter((match) => match.score === best.score && match.titleWords === best.titleWords);
    return uniqueRecord(tied.map((match) => match.record)) || best.record;
  }

  function isUnsafeScholarVenue(value) {
    const normalized = venueKey(value);
    // These catalogue names are valid journals but are too generic to infer
    // from Scholar's collapsed source line.  They require an ISSN-backed
    // article lookup instead of a title-only match.
    return normalized === "international journal" || normalized === "journal";
  }

  function scholarSourceRecord(value) {
    if (isUnsafeScholarVenue(value)) return null;
    const normalized = venueKey(value);
    const words = normalized.split(" ").filter(Boolean);
    // Short journal titles are common (Appetite, Insects, Animals, Science).
    // Permit them only as an exact catalogue title, never via prefix/fuzzy
    // completion, so the fix does not reintroduce the generic-title problem.
    if (words.length <= 2) {
      return exactRecord(normalized) || (normalized.startsWith("the ") ? exactRecord(normalized.slice(4)) : null);
    }
    return matchRecord(value);
  }

  function scholarFallbackRecord(texts) {
    const safe = (texts || []).filter((text) => !isUnsafeScholarVenue(text));
    return uniqueRecord(safe.map((text) => matchRecord(text)));
  }
  function primaryShardForText(text) {
    const normalized = venueKey(text);
    return normalized ? shardKey(normalized) : "";
  }

  function primaryShardsForText(text) {
    const normalized = venueKey(text);
    if (!normalized) return [];
    const keys = [shardKey(normalized)];
    // "The Lancet" and equivalent leading-article titles may normalize to a
    // record in another shard. Load both deterministically before exact match.
    if (normalized.startsWith("the ")) keys.push(shardKey(normalized.slice(4)));
    return [...new Set(keys)];
  }

  function secondaryShardsForText(text) {
    const normalized = venueKey(text);
    if (!normalized) return [];
    return normalized.split(" ").map(shardKey);
  }
  function ensureTooltipOverlay() {
    if (tooltipPanel) return tooltipPanel;
    tooltipHost = document.createElement("div");
    tooltipHost.id = "rank-assistant-overlay-host";
    tooltipHost.style.setProperty("all", "initial", "important");
    tooltipHost.style.setProperty("position", "fixed", "important");
    tooltipHost.style.setProperty("inset", "0", "important");
    tooltipHost.style.setProperty("width", "0", "important");
    tooltipHost.style.setProperty("height", "0", "important");
    tooltipHost.style.setProperty("z-index", "2147483647", "important");
    tooltipHost.style.setProperty("pointer-events", "none", "important");
    syncColorTheme();

    const shadow = tooltipHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial !important; }
      #panel {
        all: initial !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        display: none;
        box-sizing: border-box !important;
        width: max-content !important;
        min-width: 240px !important;
        max-width: min(360px, calc(100vw - 24px)) !important;
        padding: 12px 14px !important;
        border: 1px solid #667085 !important;
        border-radius: 8px !important;
        color: #101828 !important;
        background: #ffffff !important;
        background-color: #ffffff !important;
        background-image: none !important;
        opacity: 1 !important;
        filter: none !important;
        mix-blend-mode: normal !important;
        isolation: isolate !important;
        box-shadow: inset 0 0 0 1000px #ffffff, 0 12px 32px rgba(16, 24, 40, 0.32) !important;
        font: 400 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
        text-align: left !important;
        white-space: pre-line !important;
        overflow-wrap: anywhere !important;
        pointer-events: none !important;
        color-scheme: light !important;
      }
      :host([data-theme="dark"]) #panel {
        color: #f2f4f7 !important;
        background: #101828 !important;
        background-color: #101828 !important;
        border-color: #667085 !important;
        box-shadow: inset 0 0 0 1000px #101828, 0 12px 32px rgba(0, 0, 0, 0.58) !important;
        color-scheme: dark !important;
      }
    `;
    tooltipPanel = document.createElement("div");
    tooltipPanel.id = "panel";
    tooltipPanel.setAttribute("role", "tooltip");
    shadow.append(style, tooltipPanel);
    document.documentElement.appendChild(tooltipHost);
    return tooltipPanel;
  }

  function positionTooltipAbove(element) {
    const panel = ensureTooltipOverlay();
    const anchor = element.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const gap = 9;
    const centered = anchor.left + anchor.width / 2 - box.width / 2;
    const left = Math.max(10, Math.min(centered, viewportWidth - box.width - 10));
    let top = anchor.top - box.height - gap;
    if (top < 10) top = anchor.bottom + gap;
    panel.style.setProperty("left", Math.round(left) + "px", "important");
    panel.style.setProperty("top", Math.round(top) + "px", "important");
  }

  let activeTooltipElement = null;

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function showTooltip(element, details) {
    clearTimeout(hideTimer);
    activeTooltipElement = element;
    const panel = ensureTooltipOverlay();
    panel.textContent = plainTooltipText(details);
    panel.style.setProperty("display", "block", "important");
    panel.style.setProperty("visibility", "hidden", "important");
    positionTooltipAbove(element);
    panel.style.setProperty("visibility", "visible", "important");

    if (details.lookup && !details.lookupRequested) {
      details.lookupRequested = true;
      sendRuntimeMessage(details.lookup).then((response) => {
        if (!response?.ok || !response.metadata) return;
        const metadata = response.metadata;
        const publisher = metadata.publisher || metadata.publisherFull;
        const publisherRow = details.rows.find((row) => row.sourceLabel === "发行商");
        if (publisherRow && publisher) publisherRow.value = publisher;
        const directionRow = details.rows.find((row) => row.sourceLabel === "主要方向");
        const directions = researchDirections(details.record, metadata.subjects);
        if (directionRow && directions) directionRow.value = directions;
        const sourceRow = details.rows.find((row) => row.sourceLabel === "信息来源");
        if (sourceRow) sourceRow.value = tr(response.cached ? "本地目录 + Crossref 缓存" : "本地目录 + Crossref");
        if (activeTooltipElement !== element) return;
        panel.textContent = plainTooltipText(details);
        panel.style.setProperty("visibility", "hidden", "important");
        positionTooltipAbove(element);
        panel.style.setProperty("visibility", "visible", "important");
      });
    }
  }

  function hideTooltip(delay = 80) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      activeTooltipElement = null;
      if (tooltipPanel) tooltipPanel.style.setProperty("display", "none", "important");
    }, delay);
  }
  function plainTooltipText(details) {
    const lines = [details.title];
    for (const row of details.rows || []) {
      if (row?.value || row?.value === 0) lines.push(row.label + (I18N.normalize(state.settings.language) === "en" ? ": " : "：") + row.value);
    }
    if (details.note) lines.push(details.note);
    return lines.join("\n");
  }

  function control(className, kind, label, title, rows, note, options = {}) {
    const element = document.createElement("span");
    element.className = className;
    if (kind) element.dataset.kind = kind;
    const translatedLabel = tr(label);
    element.textContent = translatedLabel;
    const translatedRows = (rows || []).map((row) => ({
      ...row,
      sourceLabel: row.sourceLabel || row.label,
      label: tr(row.label),
      value: tr(row.value)
    }));
    const translatedNote = I18N.normalize(state.settings.language) === "en"
      ? ((kind === "cssci" && String(label).includes("扩展")
        ? "The CSSCI Extended list is separate from the CSSCI Source list. The extension displays them separately."
        : EN_NOTES[kind]) || (className === "rank-assistant-venue-detail"
        ? (recordType(options.record) === "期刊"
          ? "Publisher data comes from the local catalog first, then Crossref by ISSN when missing. Topics combine local classifications and Crossref subjects."
          : "Conference topics come from CCF field classifications.")
        : tr(note)))
      : note;
    const details = { title: tr(title), rows: translatedRows, note: translatedNote, ...options };
    const tooltipText = plainTooltipText(details);
    element.dataset.tooltip = tooltipText;
    element.setAttribute("aria-label", translatedLabel + (I18N.normalize(state.settings.language) === "en" ? ". " : "。") + tooltipText.replace(/\n/g, I18N.normalize(state.settings.language) === "en" ? ". " : "。"));
    element.addEventListener("mouseenter", () => showTooltip(element, details));
    element.addEventListener("mouseleave", () => hideTooltip());
    return element;
  }
  function badge(kind, label, title, rows, note, level = "") {
    const element = control("rank-assistant-badge", kind, label, title, rows, note);
    if (level || level === 0) element.dataset.level = String(level).toLowerCase();
    return element;
  }

  function recordType(record) {
    if (record?.[2]?.includes("会议")) return "会议";
    if (record?.[2]?.includes("刊物")) return "期刊";
    if (/conference/i.test(record?.[34] || "")) return "会议";
    if (/journal/i.test(record?.[34] || "")) return "期刊";
    if (/proceed/i.test(record?.[25] || "")) return "会议";
    if (/journal|serial|magazine/i.test(record?.[25] || "")) return "期刊";
    if (record?.[4] || record?.[8] || record?.[12] || record?.[17] || record?.[20]) return "期刊";
    return "来源";
  }

  function ccfRows(record) {
    if (!record?.[1]) return [];
    return [
      { label: "等级", value: "CCF " + record[1] },
      { label: "类型", value: record[2] },
      { label: "领域", value: record[14] },
      { label: "年份", value: record[3] }
    ];
  }

  function researchDirections(record, remoteSubjects = []) {
    return [...new Set([
      record?.[6],
      record?.[10],
      record?.[14],
      record?.[19],
      record?.[22],
      record?.[30],
      ...(Array.isArray(record?.[26]) ? record[26] : []),
      ...(Array.isArray(remoteSubjects) ? remoteSubjects : [])
    ].map((value) => String(value || "").trim()).filter(Boolean))].join("；");
  }

  function venueRows(record) {
    return [
      { label: "规范名称", value: record[0] },
      { label: "类型", value: recordType(record) },
      { label: "发行商", value: record[16] || (recordType(record) === "期刊" ? "查询中…" : "无") },
      { label: "主要方向", value: researchDirections(record) || "暂无分类信息" },
      ...(record[28] ? [{ label: "新锐分区", value: record[28] + "区" + (record[29] ? " Top" : "") + " · " + record[31] }] : []),
      ...(record[32] ? [{ label: "当前预警", value: record[32] + (record[33] ? " · " + record[33] : "") }] : []),
      { label: "ISSN", value: Array.isArray(record[13]) ? record[13].join(", ") : record[13] },
      { label: "信息来源", value: record[16] ? "本地目录" : "本地目录 + Crossref" }
    ];
  }

  function renderBusinessBadges(row, business) {
    const s = state.settings;
    if (s.showUtd24 && business?.utd24) row.appendChild(badge("utd24", "UTD24", "UT Dallas 24", [
      { label: "期刊", value: business.name }, { label: "目录", value: "UTD 24" }
    ], "UT Dallas Top 100 Business School Research Rankings 使用的 24 本商科期刊目录。"));
    if (s.showFt50 && business?.ft50) row.appendChild(badge("ft50", "FT50", "Financial Times 50", [
      { label: "期刊", value: business.name }, { label: "版本", value: "2026 年 4 月" }
    ], "Financial Times 全球商学院研究排名使用的 FT50 期刊目录。"));
  }

  function renderBadges(record, business = null) {
    const row = document.createElement("span");
    row.className = "rank-assistant-row";
    row.dataset.paperRank = "1";
    const s = state.settings;

    if (s.showWarning && record?.[32]) {
      row.appendChild(badge(
        "warning",
        "预警 " + record[32],
        "中国科学院国际期刊预警名单",
        [
          { label: "名单年份", value: record[32] },
          { label: "预警原因", value: record[33] }
        ],
        "本标签仅使用插件所载的 2025 年最新名单，不包含历年预警。预警是期刊层面的风险提示，不代表对其中每篇论文的判定。"
      ));
    }

    if (s.showCcf) {
      if (record?.[1]) {
        row.appendChild(badge(
          "ccf",
          "CCF " + record[1],
          "CCF 推荐目录",
          ccfRows(record),
          "本地 CCF 2026 数据。",
          record[1]
        ));
      } else {
        row.appendChild(badge(
          "ccf-none",
          "CCF None",
          "未匹配 CCF 等级",
          [{ label: "目录", value: "CCF 2026" }],
          "本地 CCF 目录未匹配到。可能是非 CCF 来源，也可能是页面来源信息不完整。"
        ));
      }
    }

    renderBusinessBadges(row, business);
    if (!record) return row.children.length ? row : null;

    if (s.showCas && record[4]) {
      const topText = s.showTop && record[5] ? " Top" : "";
      row.appendChild(badge(
        "cas",
        "中科院 " + record[4] + "区" + topText,
        "中科院分区",
        [
          { label: "大类分区", value: record[4] + "区" },
          { label: "学科", value: record[6] },
          { label: "Top", value: record[5] ? "是" : "否" },
          { label: "年份", value: record[7] }
        ],
        "中科院期刊分区表由中国科学院文献情报中心科学计量中心研制。大类分区按 13 个较宽领域划分为 1–4 区，1 区层级最高，Top 是额外标记。本页显示大类分区；它与按较细 WoS 学科计算的 JCR Q1–Q4 不是同一体系。分区属于定量参考，不宜单独用于个人评价。",
        record[4]
      ));
    } else if (s.showTop && record[5]) {
      row.appendChild(badge(
        "top",
        "中科院 Top",
        "中科院 Top 期刊",
        [
          { label: "学科", value: record[6] },
          { label: "大类分区", value: record[4] ? record[4] + "区" : "无" },
          { label: "年份", value: record[7] }
        ],
        "Top 标记来自中科院期刊分区表。"
      ));
    }
    if (s.showXinrui && record[28]) {
      row.appendChild(badge(
        "xinrui",
        "新锐 " + record[28] + "区" + (record[29] ? " Top" : ""),
        "新锐学术分区",
        [
          { label: "大类分区", value: record[28] + "区" },
          { label: "学科", value: record[30] },
          { label: "类型", value: record[34] === "Conference" ? "会议" : "期刊" },
          { label: "Top", value: record[29] ? "是" : "否" },
          { label: "年份", value: record[31] }
        ],
        "新锐分区由新锐学术发布，本页显示大类 1–4 区。它是独立的分区体系，与中科院期刊分区和 JCR Q1–Q4 都不是同一套标准。",
        record[28]
      ));
    }

    if (s.showJcr && record[8]) {
      row.appendChild(badge(
        "jcr",
        "JCR " + record[8],
        "JCR 分区",
        [
          { label: "分区", value: record[8] },
          { label: "学科", value: record[10] },
          { label: "影响因子", value: record[9] },
          { label: "年份", value: record[11] }
        ],
        "JCR 分区按学科类别计算，同一本期刊在不同学科可能有不同分区。本插件显示最佳分区。",
        record[8]
      ));
    }

    if (s.showIf && record[9] !== undefined && record[9] !== "") {
      row.appendChild(badge(
        "if",
        "IF " + record[9],
        "Journal Impact Factor",
        [
          { label: "影响因子", value: record[9] },
          { label: "JCR 分区", value: record[8] },
          { label: "年份", value: record[11] }
        ],
        "影响因子来自本地 JCR 数据。"
      ));
    }

    if (s.showWos && record[12]) {
      const indexLabel = record[12] === "SCIE" ? "SCI/SCIE" : record[12];
      row.appendChild(badge(
        "wos",
        indexLabel,
        "Web of Science 收录",
        [
          { label: "收录类型", value: record[12] },
          { label: "年份", value: record[11] || record[7] }
        ],
        "SCI、SCIE、SSCI、AHCI 和 ESCI 只表示 Web of Science 收录类型，本标签不显示分区。分区请分别查看 JCR 或中科院标签。"
      ));
    }

    if (s.showCssci && record[17]) {
      const tierLabel = record[17] === "source" ? "来源" : "扩展";
      row.appendChild(badge(
        "cssci",
        "CSSCI " + tierLabel,
        "中文社会科学引文索引",
        [
          { label: "类型", value: "CSSCI " + tierLabel + "期刊" },
          { label: "学科", value: record[19] },
          { label: "版本", value: record[18] }
        ],
        record[17] === "source"
          ? "CSSCI 来源期刊由南京大学中国社会科学研究评价中心遴选，常被俗称为“南大核心”或“C刊”。它与 SSCI、JCR 和北大核心是相互独立的体系。"
          : "CSSCI 扩展版不是 CSSCI 来源期刊。插件明确分开显示，避免把“C扩”误写为“C刊”。",
        record[17]
      ));
    }

    if (s.showPku && record[20]) {
      row.appendChild(badge(
        "pku",
        "北大核心",
        "中文核心期刊要目总览",
        [
          { label: "版本", value: record[21] },
          { label: "学科", value: record[22] },
          { label: "CN", value: record[23] }
        ],
        "北大核心指北京大学图书馆与北京高校图书馆期刊工作研究会编制的《中文核心期刊要目总览》。它是入选目录，不是 Q1–Q4 分区，也不等同于 CSSCI。"
      ));
    }

    if (s.showEi && record[24]) {
      row.appendChild(badge(
        "ei",
        "EI",
        "Ei Compendex 收录来源",
        [
          { label: "来源类型", value: record[25] },
          { label: "主要方向", value: Array.isArray(record[26]) ? record[26].join("；") : record[26] },
          { label: "数据日期", value: record[24] }
        ],
        "EI 标签表示该期刊或具体会议论文集出现在 Elsevier 官方 Compendex Source List。会议系列可能逐届变化，具体论文是否最终入库仍应以 Engineering Village 记录为准；EI 本身没有 Q1–Q4 分区。"
      ));
    }

    return row.children.length ? row : null;
  }

  function renderVenueDetails(record) {
    const type = recordType(record);
    const issns = Array.isArray(record[13]) ? record[13] : [record[13]].filter(Boolean);
    return control(
      "rank-assistant-venue-detail",
      "",
      type + "详情",
      record[0] || type + "详情",
      venueRows(record),
      type === "期刊"
        ? "发行商优先取本地目录，缺失时按 ISSN 查询 Crossref；主要方向来自中科院、JCR、CCF 学科分类及 Crossref。"
        : "会议方向来自 CCF 领域分类。",
      type === "期刊" && issns.length
        ? { record, lookup: { type: "rank-assistant-journal-metadata", title: record[0], issns } }
        : { record }
    );
  }

  function visibleVenueNode(container, names = []) {
    const wanted = new Set(names.map((name) => venueKey(name)).filter(Boolean));
    if (!wanted.size) return null;
    return [...container.querySelectorAll("a, h1, h2, h3, h4, p, span, div, img[alt]")]
      .find((node) => wanted.has(venueKey(node.getAttribute?.("alt") || node.textContent || ""))) || null;
  }

  function attachTitleRow(container, row, venueNames = []) {
    const site = siteKind();
    // A journal landing page is itself the ranked object, so keep the badges
    // beside its journal heading. Search cards and article pages still follow
    // the extension-wide convention of placing badges next to the paper title.
    if ((site === "publisher" && isJournalLandingPage()) ||
        (site === "researchgate" && isResearchGatePublicationPage())) {
      const journal = visibleVenueNode(container, venueNames) ||
        (site === "publisher" ? visibleVenueNode(document, venueNames) : null) || venueNode(container);
      if (journal) {
        if (journal.nextElementSibling?.classList?.contains("rank-assistant-row")) journal.nextElementSibling.remove();
        journal.insertAdjacentElement("afterend", row);
        return;
      }
    }
    const title = titleNode(container);
    if (!title) {
      metadataNode(container).prepend(row);
      return;
    }
    if (site === "scholar" && !title.matches?.(".gsc_a_at")) title.appendChild(row);
    else title.insertAdjacentElement("afterend", row);
  }

  function attachVenueDetails(container, details) {
    // On a journal home (including its About/Submission tabs), ranks belong
    // beside the journal heading only. Never inject a details control into the
    // page body, where every ordinary link can become an insertion target.
    if (siteKind() === "publisher" && isJournalLandingPage()) return;
    const venue = venueNode(container);
    if (!venue) {
      if (siteKind() === "publisher") {
        const row = container.querySelector(".rank-assistant-row");
        (row || titleNode(container))?.insertAdjacentElement("afterend", details);
      }
      return;
    }
    if (siteKind() === "scholar") venue.appendChild(details);
    else venue.insertAdjacentElement("afterend", details);
  }

  function filterValuesForRecord(index, record) {
    if (index === "ccf") return [record?.[1] || "None"];
    if (index === "jcr") return record?.[8] ? [record[8]] : [];
    if (index === "cas") return [record?.[4], record?.[5] ? "Top" : ""].filter(Boolean);
    if (index === "xinrui") return [record?.[28], record?.[29] ? "Top" : ""].filter(Boolean);
    if (index === "cssci") return record?.[17] ? [record[17]] : [];
    if (index === "pku") return record?.[20] ? ["included"] : [];
    if (index === "wos") {
      return String(record?.[12] || "").split(/[,;/]+/).map((value) => value.trim()).filter(Boolean);
    }
    if (index === "ei") {
      if (!record?.[24]) return [];
      const type = String(record?.[25] || "");
      if (/journal|serial|magazine/i.test(type)) return ["Journal"];
      if (/proceed|conference/i.test(type)) return ["Proceeding"];
      return ["Other"];
    }
    return [];
  }

  function recordPassesFilters(record) {
    if (state.settings.hideWarnedJournals && record?.[32]) return false;
    const filters = state.settings.resultFilters || {};
    const indexes = Array.isArray(filters.indexes) ? filters.indexes : [];
    for (const index of indexes) {
      const selected = Array.isArray(filters.values?.[index]) ? filters.values[index] : [];
      if (!selected.length) continue;
      const actual = filterValuesForRecord(index, record);
      if (!selected.some((value) => actual.includes(value))) return false;
    }
    return true;
  }

  function resetRenderedResults() {
    for (const container of resultContainers()) {
      container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
      container.classList.remove("rank-assistant-filter-hidden");
      delete container.dataset.paperRankProcessed;
      delete container.dataset.paperRankLoading;
      delete container.dataset.paperRankMatched;
    }
    if (!state.settings.enabled) return;
    idle().then(scan).catch((error) => console.error("[期刊会议等级与分区助手]", error));
  }

  function renderContainer(container, record, texts = []) {
    if (isResearchGatePublicationPage() || isPublisherDocumentPage()) {
      document.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    }
    container.dataset.paperRankProcessed = "1";
    delete container.dataset.paperRankLoading;
    const visible = recordPassesFilters(record);
    container.classList.toggle("rank-assistant-filter-hidden", !visible);
    if (!visible) return;
    const canonicalTexts = record ? [record[0]] : [];
    // UTD/FT matching is exact, so it may still be shown for a clean venue
    // line outside Scholar; Google Scholar uses only confirmed records.
    const businessTexts = siteKind() === "scholar" ? canonicalTexts : (canonicalTexts.length ? canonicalTexts : texts);
    const business = businessTexts.map((text) => globalThis.RankAssistantBusinessRankings?.match(text)).find(Boolean) || null;
    const row = renderBadges(record, business);
    if (row) {
      attachTitleRow(container, row, [record?.[0], business?.name]);
      container.dataset.paperRankMatched = "1";
    } else {
      delete container.dataset.paperRankMatched;
    }
    if (record) attachVenueDetails(container, renderVenueDetails(record));
  }

  function unifyDblpVenueLineages(items) {
    if (!isDblp()) return;
    const linkedRecords = new Map();
    for (const shard of state.shards.values()) {
      for (const record of shard.r) {
        const key = dblpKeyFromHref(record?.[15]);
        if (!key) continue;
        const current = linkedRecords.get(key);
        if (recordCompleteness(record) > recordCompleteness(current)) linkedRecords.set(key, record);
      }
    }
    const groups = new Map();
    for (const item of items) {
      const key = dblpVenueKey(item.container);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [key, group] of groups) {
      const canonical = linkedRecords.get(key) || group.reduce(
        (best, item) => recordCompleteness(item.record) > recordCompleteness(best) ? item.record : best,
        null
      );
      if (canonical) for (const item of group) item.record = canonical;
    }
  }

  async function scan() {
    const containers = [...resultContainers()].filter(
      (container) => container.dataset.paperRankProcessed !== "1" && container.dataset.paperRankLoading !== "1"
    );
    if (!containers.length) return;
    const site = siteKind();
    const isSemanticScholar = site === "semantic-scholar";
    const allowEmbedded = site === "arxiv" || site === "researchgate" || (site === "publisher" && isJournalLandingPage());
    const items = containers.map((container) => {
      container.dataset.paperRankLoading = "1";
      const sourceText = site === "scholar" ? candidateText(container) : "";
      const texts = candidateTexts(container);
      const explicitTexts = site === "scholar" ? scholarExplicitVenueCandidates(container) : [];
      return { container, texts, explicitTexts, sourceText, venueFingerprint: site === "scholar" ? scholarVenueFingerprint(container) : "", text: texts[0] || "", pmid: site === "pubmed" ? pubmedId(container) : "", pubmedIssns: [], record: null };
    });

    try {
      // Scholar matching remains local. Paper titles are never sent to
      // Crossref merely to recover a truncated source name.
      // PubMed's result cards show abbreviated journal strings. Use the NCBI
      // PMID summary as the source of truth for the full title and ISSN.
      if (site === "pubmed") {
        const response = await sendRuntimeMessage({ type: "rank-assistant-pubmed-journals", pmids: items.map((item) => item.pmid).filter(Boolean) });
        for (const item of items) {
          const summary = response?.summaries?.[item.pmid];
          if (summary?.title && !item.texts.includes(summary.title)) item.texts.unshift(summary.title);
          if (summary?.issn) item.pubmedIssns.push(summary.issn);
        }
      }
      if (isDblp()) {
        const response = await sendRuntimeMessage({
          type: "rank-assistant-match-dblp-venues",
          items: items.map((item) => ({ text: item.text, key: dblpVenueKey(item.container) }))
        });
        if (response?.ok && Array.isArray(response.records) && response.records.length === items.length) {
          response.records.forEach((record, index) => { items[index].record = record || null; });
          state.lastScanDetail = (Number(response.shardCount) || 0) + " background data shards";
          for (const item of items) renderContainer(item.container, item.record, item.texts);
          return;
        }
      }
      await ensureShards(items.flatMap((item) => item.texts.flatMap(primaryShardsForText)));
      // Publisher journal homes, especially Wiley's logo-led templates, often
      // expose ISSNs long before any machine-readable journal title.  Resolve
      // those ISSNs through the packaged index, so we load only one shard
      // instead of timing out while the background decrypts the whole catalog.
      const indexedPublisherRecord = site === "publisher" && (isJournalLandingPage() || isPublisherDocumentPage())
        ? await indexedIssnRecord()
        : null;
      const publisherTitleRecord = site === "publisher" && isJournalLandingPage()
        ? publisherLandingTitleRecord()
        : null;
      const unresolved = [];
      for (const item of items) {
        const explicitScholarRecord = site === "scholar"
          ? scholarExplicitRecord(item.explicitTexts)
          : null;
        // Candidate text includes author/title/snippet nodes, so a strict
        // all-candidates agreement can discard a perfectly clear native
        // Scholar source such as "Management Science".  Use the source line
        // deterministically after any richer EasyScholar full-title match.
        const sourceRecord = site === "scholar"
          ? scholarSourceRecord(item.sourceText)
          : null;
        let localFallback = null;
        if (site === "scholar") localFallback = scholarFallbackRecord(item.texts);
        else if (isSemanticScholar) localFallback = semanticScholarRecord(item.texts);
        else localFallback = uniqueRecord(item.texts.map((text) => matchRecord(text, { allowCompletion: !allowEmbedded })));
        item.record = indexedPublisherRecord || publisherTitleRecord || explicitScholarRecord || sourceRecord || (site === "pubmed" ? await indexedRecordForIssns(item.pubmedIssns) : null) || localFallback;
        if (!item.record) unresolved.push(item);
      }
      if (unresolved.length && allowEmbedded) {
        await ensureShards(unresolved.flatMap((item) => item.texts.flatMap(secondaryShardsForText)));
        for (const item of unresolved) {
          item.record = uniqueRecord(item.texts.map((text) => matchRecord(text, { allowEmbedded: true, allowCompletion: false })));
        }
      }
      unifyDblpVenueLineages(items);
      state.lastScanDetail = state.shards.size + " content data shards";
      for (const item of items) {
        renderContainer(item.container, item.record, item.texts);
        if (site === "scholar") item.container.dataset.paperRankVenueFingerprint = item.venueFingerprint;
      }
    } catch (error) {
      for (const item of items) delete item.container.dataset.paperRankLoading;
      throw error;
    }
  }
  function mutationContainsResults(records) {
    const selector = resultSelector();
    if (!selector) return false;
    for (const record of records) {
      if (record.type === "characterData") {
        const parent = record.target?.parentElement;
        if (parent && !parent.closest?.(".rank-assistant-row, .rank-assistant-venue-detail, #rank-assistant-shared-tooltip") && parent.closest?.(selector)) return true;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.closest?.(".rank-assistant-row, .rank-assistant-venue-detail, #rank-assistant-shared-tooltip")) continue;
        if (node.matches?.(selector) || node.closest?.(selector) || node.querySelector?.(selector)) return true;
      }
    }
    return false;
  }

  function watchDynamicResults() {
    let timer;
    const observer = new MutationObserver((records) => {
      const site = siteKind();
      const dynamicVenueSite = site === "researchgate" || site === "publisher" || site === "scholar" || site === "pubmed";
      // Ignore mutations made by our own badges, but react when Scholar or a
      // companion extension fills in a venue after the first page render.
      if (!mutationContainsResults(records)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (dynamicVenueSite) {
          for (const container of resultContainers()) {
            // EasyScholar's full journal label often arrives after this
            // extension's initial pass. Scholar cards must be reconsidered
            // even if a provisional badge was already rendered.
            if (site === "scholar") {
              const nextFingerprint = scholarVenueFingerprint(container);
              if (nextFingerprint === (container.dataset.paperRankVenueFingerprint || "")) continue;
            } else if (container.dataset.paperRankMatched === "1") continue;
            // A rescan replaces its old output rather than appending another
            // copy of the badges while a companion extension is hydrating.
            container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
            delete container.dataset.paperRankProcessed;
            delete container.dataset.paperRankLoading;
            delete container.dataset.paperRankMatched;
          }
        }
        idle().then(scan).catch((error) => console.error("[期刊会议等级与分区助手]", error));
      }, site === "scholar" ? 320 : 80);
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }

  function refreshDelayedScholarVenues() {
    if (siteKind() !== "scholar") return;
    let changed = false;
    for (const container of resultContainers()) {
      const nextFingerprint = scholarVenueFingerprint(container);
      if (nextFingerprint === (container.dataset.paperRankVenueFingerprint || "")) continue;
      container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
      delete container.dataset.paperRankProcessed;
      delete container.dataset.paperRankLoading;
      delete container.dataset.paperRankMatched;
      changed = true;
    }
    if (changed) idle().then(scan).catch((error) => console.error("[期刊会议等级与分区助手]", error));
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        setStatus("loading-data");
        document.documentElement.dataset.paperRankHasResults = "1";
        await idle();
        await scan();
        watchDynamicResults();
        // EasyScholar may add its full journal pill while the initial scan is
        // still running, before the observer is installed.  One delayed check
        // closes that narrow race; subsequent changes are handled by the
        // observer, so a second unconditional pass is unnecessary.
        if (siteKind() === "scholar") {
          setTimeout(refreshDelayedScholarVenues, 900);
        }
        setStatus("ready", state.lastScanDetail || (state.shards.size + " data shards"));
      } catch (error) {
        setStatus("error", String(error?.message || error));
        console.error("[期刊会议等级与分区助手]", error);
      }
    })();
    return initialization;
  }
  function authorText(author) {
    if (typeof author === "string") return author;
    return author?.text || author?.name || "";
  }

  function dblpSourceName(origin) {
    try {
      const host = new URL(origin).hostname;
      if (host === "dblp.dagstuhl.de") return "DBLP Dagstuhl 镜像";
      if (host === "dblp.uni-trier.de") return "DBLP Trier 镜像";
      return "DBLP 主站";
    } catch (_) {
      return "DBLP";
    }
  }

  function ensureDblpPublicationBody() {
    let section = document.querySelector("#completesearch-publs");
    if (!section) {
      section = document.createElement("section");
      section.id = "completesearch-publs";
      section.className = "section rank-assistant-api-section";
      section.innerHTML = '<header><h2>Publication search results</h2></header><div class="body"></div>';
      (document.querySelector("main") || document.body).appendChild(section);
    }
    return section.querySelector(".body") || section;
  }

  function renderDblpRecoveryStatus(kind, detail = "") {
    const body = ensureDblpPublicationBody();
    body.querySelector(".rank-assistant-fallback-notice")?.remove();
    const notice = document.createElement("div");
    notice.className = "rank-assistant-fallback-notice rank-assistant-fallback-" + kind;
    notice.setAttribute("role", "status");
    if (kind === "loading") {
      notice.textContent = I18N.normalize(state.settings.language) === "en"
        ? "DBLP's page-list service is temporarily unavailable. The extension is restoring the publication list through DBLP's official JSON API…"
        : "DBLP 页面列表服务暂时不可用，期刊会议等级与分区助手正在通过官方 JSON API 恢复论文列表…";
    } else {
      body.querySelectorAll("ul.error, ul.waiting").forEach((node) => node.remove());
      const message = document.createElement("span");
      message.textContent = I18N.normalize(state.settings.language) === "en"
        ? "The extension could not restore the publication list from DBLP's official API: " + detail + "."
        : "期刊会议等级与分区助手未能从 DBLP 官方 API 恢复论文列表：" + detail + "。";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "rank-assistant-fallback-retry";
      retry.textContent = tr("重试");
      retry.addEventListener("click", async () => {
        dblpRecoveryPromise = null;
        const recovered = await recoverDblpResults("manual-retry");
        if (recovered && resultContainers().length) await initialize();
      });
      notice.append(message, retry);
    }
    body.prepend(notice);
  }

  async function fetchDblpPublicationsDirect(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const url = new URL("/search/publ/api", location.origin);
      url.searchParams.set("q", query);
      url.searchParams.set("h", "30");
      url.searchParams.set("c", "0");
      url.searchParams.set("format", "json");
      const response = await fetch(url.href, {
        signal: controller.signal,
        credentials: "omit",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const value = payload?.result?.hits?.hit || [];
      const hits = Array.isArray(value) ? value : value ? [value] : [];
      if (!hits.length) throw new Error("DBLP API returned no publications");
      return { ok: true, cached: false, hits, sourceOrigin: location.origin };
    } finally {
      clearTimeout(timer);
    }
  }

  function renderApiFallback(hits, recovery = {}) {
    const body = ensureDblpPublicationBody();
    body.querySelectorAll("ul.error, ul.waiting").forEach((node) => node.remove());
    body.querySelector(".rank-assistant-fallback-list")?.remove();
    body.querySelector(".rank-assistant-fallback-notice")?.remove();

    const notice = document.createElement("p");
    notice.className = "rank-assistant-fallback-notice";
    const english = I18N.normalize(state.settings.language) === "en";
    const cacheText = recovery.cached ? (english ? " (from a 10-minute cache)" : "（来自 10 分钟缓存）") : "";
    notice.textContent = english
      ? "DBLP's page-list service is temporarily unavailable. The results below were restored through the official JSON API at " + dblpSourceName(recovery.sourceOrigin) + cacheText + "."
      : "DBLP 页面列表服务暂时不可用，以下结果由 " + dblpSourceName(recovery.sourceOrigin) + " 官方 JSON API 恢复" + cacheText + "。";
    const list = document.createElement("ul");
    list.className = "publ-list rank-assistant-fallback-list";

    for (const hit of hits) {
      const info = hit?.info || {};
      const authorsValue = info.authors?.author;
      const authors = (Array.isArray(authorsValue) ? authorsValue : authorsValue ? [authorsValue] : [])
        .map(authorText).filter(Boolean).join(", ");
      const entry = document.createElement("li");
      entry.className = "entry rank-assistant-api-fallback";
      const data = document.createElement("div");
      data.className = "data";
      if (authors) data.append(document.createTextNode(authors + ": "));
      const title = document.createElement("a");
      title.className = "title";
      title.textContent = String(info.title || "Untitled").replace(/<[^>]*>/g, "");
      title.href = info.url || info.ee || "#";
      const venue = document.createElement("span");
      venue.className = "rank-assistant-fallback-venue";
      venue.textContent = String(info.venue || "");
      data.append(title, document.createTextNode(" "), venue, document.createTextNode(" " + (info.year || "")));
      entry.appendChild(data);
      list.appendChild(entry);
    }
    body.prepend(list);
    body.prepend(notice);
  }

  function dblpFailureVisible() {
    const section = document.querySelector("#completesearch-publs");
    const pageText = (section || document.body).textContent || "";
    return /service temporarily not available|temporarily not available|no server is available/i.test(pageText);
  }

  function recoverDblpResults(reason = "service-error") {
    if (dblpRecoveryPromise) return dblpRecoveryPromise;
    if (!isDblp() || resultContainers().length || !location.pathname.startsWith("/search")) {
      return Promise.resolve(false);
    }
    const query = new URLSearchParams(location.search).get("q");
    if (!query) return Promise.resolve(false);

    dblpRecoveryPromise = (async () => {
      try {
        setStatus("recovering-results", reason === "timeout" ? "DBLP result timeout" : "DBLP service error");
        renderDblpRecoveryStatus("loading");
        let response;
        try {
          response = await fetchDblpPublicationsDirect(query);
        } catch (directError) {
          response = await sendRuntimeMessage({
            type: "rank-assistant-dblp-recover",
            query,
            origin: location.origin
          });
          if (!response?.ok && directError?.message) {
            response = { ...response, error: (response?.error || "DBLP mirror recovery failed") + "; main API: " + directError.message };
          }
        }
        if (!response?.ok) throw new Error(response?.error || "DBLP recovery request failed");
        const hits = Array.isArray(response.hits) ? response.hits : [];
        if (!hits.length) throw new Error("DBLP API returned no publications");
        if (resultContainers().length) {
          document.querySelector(".rank-assistant-fallback-notice")?.remove();
          return true;
        }
        renderApiFallback(hits, response);
        return true;
      } catch (error) {
        setStatus("api-unavailable", String(error?.message || error));
        renderDblpRecoveryStatus("error", String(error?.message || error));
        console.warn("[期刊会议等级与分区助手] DBLP fallback failed", error);
        return false;
      }
    })();
    return dblpRecoveryPromise;
  }

  function waitForFirstResult() {
    if (resultContainers().length) {
      initialize();
      return;
    }

    const site = siteKind();
    if (site === "publisher") {
      const route = (location.pathname + location.search).toLowerCase();
      const hasArticleMetadata = Boolean(document.querySelector('meta[name="citation_title"], meta[name="citation_journal_title"], meta[name="prism.publicationName"], meta[name="journal_title"], meta[name="bepress_citation_journal_title"]'));
      const mayLoadPapers = hasArticleMetadata || /search|article|doi|document|journal|journals|issue|loi|content|publication/.test(route);
      if (!mayLoadPapers) {
        setStatus("idle", "publisher page has no publication results");
        return;
      }
    }

    if (site === "aminer" || site === "baidu-scholar") {
      const route = (location.pathname + location.search).toLowerCase();
      const mayLoadPapers = site === "aminer"
        ? /\/search\/pub|\/pub\//.test(route)
        : /\/browse\/search|\/paper\/show/.test(route);
      if (!mayLoadPapers) {
        setStatus("idle", site + " page has no publication results");
        return;
      }
    }

    const query = isDblp() && location.pathname.startsWith("/search")
      ? new URLSearchParams(location.search).get("q")
      : "";
    if (isDblp() && location.pathname.startsWith("/search") && !query) {
      setStatus("idle", "DBLP search query is empty");
      return;
    }

    setStatus("sleeping", "no publication results");
    const canRecoverDblp = Boolean(query);
    let settled = false;
    let fallbackTimer = null;
    const observer = new MutationObserver(() => {
      if (resultContainers().length) {
        settled = true;
        observer.disconnect();
        if (fallbackTimer) clearTimeout(fallbackTimer);
        initialize();
        return;
      }
      if (canRecoverDblp && dblpFailureVisible()) startRecovery("service-error");
    });

    async function startRecovery(reason) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      await recoverDblpResults(reason);
      if (resultContainers().length) await initialize();
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (canRecoverDblp) {
      fallbackTimer = setTimeout(() => startRecovery("timeout"), DBLP_RESULT_TIMEOUT_MS);
      if (dblpFailureVisible()) setTimeout(() => startRecovery("service-error"), 0);
    }
  }
  try {
    state.settings = await getSettings();
    await I18N.ready(state.settings.language);
    syncColorTheme();
    syncColorPalette();
    if (!state.settings.enabled) {
      setStatus("disabled");
      return;
    }
    waitForFirstResult();
  } catch (error) {
    setStatus("error", String(error?.message || error));
    console.error("[期刊会议等级与分区助手]", error);
  }
})();
