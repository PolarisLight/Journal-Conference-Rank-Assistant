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
    showAbs: true,
    showXinrui: true,
    showWarning: true,
    showCustomIndexes: true,
    customIndexes: [],
    hideWarnedJournals: false,
    colorTheme: "light",
    colorPalette: "vivid",
    resultFilters: { indexes: [], values: {} }
  };
  const STOP = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);
  const state = { settings: DEFAULTS, shards: new Map(), shardPromises: new Map(), maxAliasWords: 12, lastScanDetail: "", scanError: "", customMatcher: null, customLevels: null };
  let initialization = null;
  let scanInFlight = null;
  let rescanRequested = false;
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
        state.settings[key] = key === "language" ? I18N.normalize(nextValue)
          : key === "customIndexes" ? normalizedCustomIndexes(nextValue) : nextValue;
        if (key === "customIndexes") state.customMatcher = state.customLevels = null;
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
    if (document.documentElement.dataset.paperRankStatus !== status) document.documentElement.dataset.paperRankStatus = status;
    if (document.documentElement.dataset.paperRankDetail !== detail) document.documentElement.dataset.paperRankDetail = detail;
  }

  function getSettings() {
    return new Promise((resolve) => chrome.storage.local.get(DEFAULTS, (stored) => resolve({
      ...stored,
      language: I18N.normalize(stored.language),
      customIndexes: normalizedCustomIndexes(stored.customIndexes)
    })));
  }

  function normalizedCustomIndexes(value) {
    return globalThis.RankAssistantCustomIndexes?.normalizeIndexes(value) || [];
  }

  function customMatchesForContainer(container, record, verifiedVenueTitle = "") {
    const library = globalThis.RankAssistantCustomIndexes;
    if (!library || !state.settings.customIndexes.length) return [];
    if (!state.customMatcher) state.customMatcher = library.createMatcher(state.settings.customIndexes);
    let sources = candidateTexts(container);
    if (siteKind() !== "scholar") {
      let rawSource = fingerprintNativeText(venueNode(container));
      if (siteKind() === "baidu-scholar") rawSource = rawSource.match(/《([^》]+)》/)?.[1] || rawSource.split(/\s+-\s+/)[1] || rawSource;
      if (/\.{3,}|…/.test(rawSource.normalize("NFKC"))) sources = [];
      const scopes = rawSource.match(/\b(?:workshops?|findings|challenges?)\b/gi) || [];
      if (scopes.length) sources = sources.filter((source) => scopes.every((scope) => String(source).toLowerCase().includes(scope.toLowerCase())));
      if (isScholarlyDocumentPage() || isPublisherDocumentPage() || isResearchGatePublicationPage()) sources.push(...documentVenueSources());
    }
    if (siteKind() === "scholar") {
      const native = container.matches?.(".gsc_a_tr") ? container.querySelectorAll(".gs_gray")[1] : container.querySelector(".gs_a");
      const raw = fingerprintNativeText(native);
      sources = [container.matches?.(".gsc_a_tr") ? raw : (raw.split(/\s+-\s+/)[1] || "")];
      // Custom catalogs may contain arbitrary names. Only explicit source
      // fields can corroborate them; generic leaves can contain author names.
      for (const node of container.querySelectorAll(".easyScholarPaperFlag, .easyScholarTemp, [class*='easyScholar'], [data-journal], [data-source], [data-venue], [data-full-text], .journal-title, .venue-title, .publication-title")) {
        if (isScholarAuthorField(node) || node.closest(".gs_rt, .gsc_a_at, .gs_rs, .gs_fl, .gs_or_ggsm, .rank-assistant-row, .rank-assistant-venue-detail")) continue;
        sources.push(fingerprintNativeText(node));
        for (const name of ["data-journal", "data-source", "data-venue", "data-full-text", "title"]) sources.push(node.getAttribute(name));
      }
    }
    // Document ISSNs identify this journal only on its own article or home
    // page. Search cards must not inherit a document-wide ISSN.
    if (siteKind() === "publisher" && (isPublisherDocumentPage() || isJournalLandingPage())) sources.push(...publisherIssns());
    if (verifiedVenueTitle) sources.push(verifiedVenueTitle);
    return state.customMatcher({ record, sources: [...new Set(sources.filter(Boolean).flatMap(customSourceCandidates))] });
  }

  function customSourceCandidates(value) {
    const text = String(value || "").trim();
    // Reject the original before removing bibliographic tails. An ellipsis
    // after a year still marks an incomplete identity. Scope words such as
    // Workshops and Findings remain part of the name throughout this path.
    if (!text || /\.{3,}|…/.test(text.normalize("NFKC"))) return [];
    const withoutYear = text.replace(/(?:[,.;]\s*|\s+)(?:19|20)\d{2}(?:\s*[;:,]\s*\d+(?:\s*\([^)]*\))?(?:\s*:\s*\d+(?:[-–]\d+)?)?)?\.?\s*$/, "").trim();
    const withoutPages = text.replace(/\s+\d+\s*(?:\(\s*\d+\s*\))?\s*:\s*\d+(?:[-–]\d+)?\.?\s*$/, "").trim();
    return [...new Set([text, withoutYear, withoutPages].filter(Boolean))];
  }

  function customFilterLevels() {
    if (!state.customLevels) state.customLevels = new Map(state.settings.customIndexes.filter((index) => index.enabled)
      .map((index) => ["custom:" + index.id, new Set(index.entries.map((entry) => entry.level))]));
    return state.customLevels;
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
    ".rank-assistant-publication",
    "li.app-card-open",
    "li[class*='search-result']"
  ].join(", ");
  const PUBLISHER_TITLE_LINK_SELECTOR = [
    "a[href*='/article/']",
    "a[href*='/article?']",
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
    if (isScholarlyDocumentPage()) return "main, article[role='main'], [role='main'], #content-inner, .paper-detail, h1";
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
    if (isScholarlyDocumentPage()) {
      return [document.querySelector("main article, article[role='main'], main, [role='main'], #content-inner, .paper-detail") || document.body];
    }
    if (site === "pubmed" && isPubmedArticlePage()) {
      return [document.querySelector("main, article[role='main'], #enc-abstract") || document.body];
    }
    if (site === "scholar" && location.pathname.startsWith("/citations")) {
      return document.querySelectorAll(".gsc_a_tr");
    }
    if (site === "scholar") {
      // Scholar also uses gs_r for controls such as the Create alert row.
      // Compact publication cards still carry a native paper-title node.
      return [...document.querySelectorAll(".gs_r")].filter((node) => node.querySelector(".gs_rt, .gsc_a_at"));
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
      // Definition-list search layouts keep each title and its metadata in
      // adjacent dt/dd siblings. Group the native nodes without cloning them.
      for (const title of document.querySelectorAll("dl.search-results-list > dt.search-results-title")) {
        const description = title.nextElementSibling;
        if (!description?.matches("dd")) continue;
        const group = document.createElement("div");
        group.className = "rank-assistant-publication";
        title.before(group);
        group.append(title, description);
      }
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
      if (direct.length) return topLevelContainers(direct);
      const linked = containersFromTitleLinks(
        PUBLISHER_TITLE_LINK_SELECTOR,
        "article, li, .search-result-item, .result-item, .results-item, [class*='search-result'], [class*='article-list']"
      );
      if (linked.length) return linked;
      const citationTitle = document.querySelector('meta[name="citation_title"]')?.content;
      const citationJournal = documentVenueSources()[0];
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
      throw new Error(updated?.error || "failed to load encrypted data shard " + key);
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
    return N.normalize(String(value || "").replace(/([\p{L}\p{N}])['’]s\b/giu, "$1s"))
      .replace(/ß/g, "ss").replace(/ς/g, "σ");
  }

  function catalogVenueKey(value) {
    // The packaged builder preserves accents and splits apostrophes. Retain
    // its shard hint while runtime aliases use accent/possessive equivalence.
    return String(value || "").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ")
      .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
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

  function arxivVenueNode(container) {
    return firstMatchingTextNode(container, [".journal-ref", ".comments", "p"], /^Journal ref(?:erence)?\s*:/i) ||
      firstMatchingTextNode(container, [".comments", "p"], /^Comments\s*:/i);
  }

  function metadataNode(container) {
    const site = siteKind();
    if (isScholarlyDocumentPage()) return scholarlyDocumentVenueNode(container) || container;
    if (site === "dblp") return container.querySelector(".data, cite") || container;
    if (site === "scholar") {
      if (container.matches?.(".gsc_a_tr")) return container.querySelectorAll(".gs_gray")[1] || container.querySelector(".gs_gray") || container;
      return container.querySelector(".gs_a") || container.querySelector(".gs_ri") || container;
    }
    if (site === "pubmed") return container.querySelector(".docsum-journal-citation") || container;
    if (site === "arxiv") return arxivVenueNode(container) || container;
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
    if (isScholarlyDocumentPage()) return container.querySelector("h1, .title");
    if (site === "dblp") return container.querySelector('span.title[itemprop="name"], .title');
    if (site === "scholar") return container.querySelector(".gsc_a_at, .gs_rt");
    if (site === "arxiv") return container.querySelector(".title");
    if (site === "pubmed") return container.querySelector(".docsum-title") || (isPubmedArticlePage() ? container.querySelector("h1.heading-title, main h1, h1") : null);
    if (site === "semantic-scholar") return container.querySelector('a[href*="/paper/"]');
    if (site === "openalex") return container.querySelector('a[href^="/works/"], a[href*="openalex.org/works/"]');
    if (site === "cnki") return container.querySelector('td.name a, .name a, a.fz14, a[href*="/kcms2/article/abstract"], a[href*="/kns8s/detail/detail.aspx"], a[href*="/detail/detail.aspx"]');
    if (site === "wanfang") return container.querySelector('.title a, a.title, a[href*="d.wanfangdata.com.cn/periodical/"], a[href*="d.wanfangdata.com.cn/thesis/"], a[href*="d.wanfangdata.com.cn/conference/"]');
    if (site === "aminer") return container.querySelector('a.title-link[href^="/pub/"], .paper-title');
    if (site === "baidu-scholar") return container.querySelector('.paper-title a, h3.t a, .t a, a[href*="/usercenter/paper/show"]');
    if (site === "researchgate") return container.querySelector("h1") || researchGatePublicationLink(container);
    if (site === "publisher") {
      return container.querySelector(
        "dt.search-results-title a, [data-test*='title'] a, [data-testid*='title'] a, .article-title a, .result-title a, .title a, h2 a, h3 a, " + PUBLISHER_TITLE_LINK_SELECTOR
      ) || (container.matches?.("main, article") ? container.querySelector("h1") : null);
    }
    return null;
  }

  function venueNode(container) {
    const site = siteKind();
    if (isScholarlyDocumentPage()) return scholarlyDocumentVenueNode(container);
    if (site === "dblp") {
      return container.querySelector(
        '.data [itemprop="isPartOf"] a, cite [itemprop="isPartOf"] a, .data a[href*="/db/"], cite a[href*="/db/"], .rank-assistant-fallback-venue'
      );
    }
    if (site === "scholar" || site === "pubmed") return metadataNode(container);
    if (site === "arxiv") return arxivVenueNode(container);
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
    return [...container.querySelectorAll(
      "[data-test*='journal'], [data-testid*='journal'], [data-test*='publication'], [data-testid*='publication'], " +
      ".publication-title, .journal-title, .meta__journal, .result-journal, .search-result__publication, [id^='article-result-'][id$='-journal-name'], " +
      "a[href*='/journal/'], a[href*='/journals/']"
    )].find((node) => !node.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail")) || null;
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

  function isAccessChallengePage() {
    const heading = [document.title, document.querySelector("h1")?.textContent]
      .filter(Boolean).join("\n");
    const body = (document.body?.innerText || document.body?.textContent || "").slice(0, 5000);
    const dataDomeInterstitial = Boolean(document.querySelector(
      "#datadome-captcha, iframe[src*='captcha-delivery.com'], script[src*='captcha-delivery.com']"
    )) || (body.trim().length < 80 && [...document.scripts].some((script) => /\bvar\s+dd\s*=\s*\{/.test(script.textContent || "")));
    return dataDomeInterstitial || /access restricted/i.test(heading) || (
      (/are you a robot/i.test(heading) && /(?:captcha|confirm you are a human)/i.test(body)) ||
      /(?:verify|confirm) you are (?:a )?human/i.test(body) ||
      /checking (?:your )?browser/i.test(body) ||
      /正在进行安全验证|验证您不是自动程序/.test(body) ||
      (/cloudflare/i.test(body) && /ray id/i.test(body))
    );
  }

  function suppressAccessChallengeOutput() {
    document.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    document.querySelectorAll("[data-paper-rank-processed], [data-paper-rank-loading], [data-paper-rank-matched], [data-paper-rank-custom-membership]").forEach((node) => {
      delete node.dataset.paperRankProcessed;
      delete node.dataset.paperRankLoading;
      delete node.dataset.paperRankMatched;
      delete node.dataset.paperRankCustomMembership;
    });
    if (document.documentElement.dataset.paperRankHasResults !== "0") document.documentElement.dataset.paperRankHasResults = "0";
    state.lastScanDetail = "access challenge page skipped";
  }

  function journalHeaderNode() {
    const excluded = ".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail";
    const explicit = [...document.querySelectorAll(
      "[data-test*='journal-title'], [data-testid*='journal-title'], .journal-title h1, .journal-title, " +
      ".journal-header h1, .journal-header__title, .publication-header__title, .journal-banner h1, " +
      "[class*='journal-banner'] h1, [class*='journal-header'] h1, [class*='journal-name'], [class*='journalName']"
    )].find((node) => !node.closest(excluded));
    if (explicit) return explicit;
    const currentPath = location.pathname.replace(/\/$/, "");
    return [...document.querySelectorAll("a[href*='/journal/'], a[href*='/journals/']")].find((link) => {
      if (link.closest(excluded)) return false;
      try { return new URL(link.href, location.href).pathname.replace(/\/$/, "") === currentPath; } catch (_) { return false; }
    }) || null;
  }

  function researchGateVenueNode(container) {
    return [...container.querySelectorAll(
      "a[href*='/journal/'], [data-testid*='journal'], [data-testid*='publication-venue'], .publication-meta__journal, .publication-title"
    )].find((node) => !node.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail")) || null;
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

  function researchGatePublicationLink(container) {
    const links = [...(container.querySelectorAll?.("a") || [])].filter((link) => {
      try { return /\/publication\//.test(new URL(link.href, location.href).pathname); } catch (_) { return false; }
    });
    return links
      .filter((link) => {
        const text = (link.textContent || "").trim();
        return text && !/^(?:source|view|download)$/i.test(text);
      })
      .sort((left, right) => (right.textContent || "").trim().length - (left.textContent || "").trim().length)[0] || links[0] || null;
  }

  function researchGatePaperTitle(container) {
    const text = (researchGatePublicationLink(container)?.textContent || "").trim();
    return /^(?:source|view|download)$/i.test(text) ? "" : text;
  }

  function normalizedPaperTitle(value) {
    return String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function isPubmedArticlePage() {
    return siteKind() === "pubmed" && /^\/\d+\/?$/.test(location.pathname);
  }

  function isScholarlyDocumentPage() {
    const site = siteKind();
    const path = location.pathname;
    if (site === "arxiv") return /^\/(?:abs|html)\/[^/]+/i.test(path);
    if (site === "openalex") return /^\/(?:works\/)?W\d+\/?$/i.test(path);
    if (site === "aminer") return /^\/pub\/[^/]+/i.test(path);
    if (site === "semantic-scholar") return /^\/paper\/[^/]+/i.test(path);
    if (site === "baidu-scholar") return /^\/usercenter\/paper\/show\/?$/i.test(path);
    if (site === "cnki") return /^\/(?:kcms2\/article\/abstract|(?:kcms|kns8s)?\/?detail\/detail\.aspx)/i.test(path);
    return false;
  }

  function scholarlyDocumentVenueNode(container) {
    return [...container.querySelectorAll(
      "[itemprop='isPartOf'] [itemprop='name'], [data-field='source'], [data-testid='source'], " +
      "[data-testid='venue'], [data-testid='paper-venue'], [data-selenium-selector='paper-venue'], " +
      "a[href*='/venue/'], .cl-paper-venue, .jref, .journal-ref, .journal-reference, .source-title, " +
      ".publication-venue, .conf-info-zone .venue-link, .venue-link, .top-tip .source, .source a"
    )].find((source) => {
      const blocked = source.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail");
      if (!blocked) return true;
      // A current-document journal-reference field is a source, while a
      // journal-reference node inside a bibliography remains excluded.
      return blocked === source && source.matches(".journal-reference") && !source.parentElement?.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail");
    }) || null;
  }

  function documentVenueSources() {
    const values = [];
    const add = (value) => {
      const cleaned = String(value || "").trim();
      if (!cleaned || /^(arxiv(?:\.org)?|researchgate|openalex|semantic scholar|aminer|springer(?:link| nature link)?|sciencedirect|elsevier|wiley(?: online library)?|sage journals?|oxford academic|emerald(?: publishing)?|taylor and francis|cambridge core|ieee xplore|acm digital library)$/i.test(cleaned)) return;
      if (!values.includes(cleaned)) values.push(cleaned);
    };
    const fields = ["citation_journal_title", "citation_conference_title", "citation_journal_abbrev", "prism.publicationName", "journal_title", "bepress_citation_journal_title", "dc.source", "dc.relation.ispartof", "dcterms.ispartof"];
    for (const field of fields) {
      for (const meta of document.querySelectorAll(`meta[name="${field}" i], meta[property="${field}" i]`)) add(meta.content);
    }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        const roots = Array.isArray(data) ? data : (Array.isArray(data?.["@graph"]) ? data["@graph"] : [data]);
        const articles = roots.filter((item) => item && /(?:ScholarlyArticle|Article|CreativeWork)$/i.test(String(item["@type"] || "")) && item.isPartOf);
        for (const article of articles) {
          if (articles.length > 1) {
            const address = article.url || article["@id"];
            if (!address || new URL(address, location.href).pathname !== location.pathname) continue;
          }
          const sources = Array.isArray(article.isPartOf) ? article.isPartOf : [article.isPartOf];
          for (const source of sources) {
            if (typeof source === "string") continue;
            add(source?.name);
            add(source?.isPartOf?.name);
          }
        }
      } catch (_) { /* Malformed structured metadata is not publication evidence. */ }
    }
    return values;
  }

  function currentSourceText(root) {
    const copy = root.cloneNode(true);
    copy.querySelectorAll("h1, h2, h3, .title, a[href*='/publication/'], .references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    copy.querySelectorAll("div, p, li, dt, dd, br").forEach((node) => node.append(copy.ownerDocument.createTextNode("\n")));
    return copy.textContent || "";
  }

  function isPublisherDocumentPage() {
    if (siteKind() !== "publisher" || isJournalLandingPage()) return false;
    if (/search|dosearch/i.test(location.pathname)) return false;
    if (/\/(?:article|articles|doi|document|content)\//.test(location.pathname)) return true;
    return Boolean(document.querySelector('meta[name="citation_title"]')) || documentVenueSources().length > 0;
  }

  function researchGateDocumentVenue() {
    const source = documentVenueSources()[0];
    if (source) return source;
    const root = document.querySelector("main, [role='main'], .nova-legacy-l-page__main") || document.body;
    const linked = (researchGateVenueNode(root)?.textContent || "").trim();
    if (linked) return linked;
    return researchGateVenueFromText(currentSourceText(root));
  }

  function researchGateDoi(root = document) {
    const clean = (value) => String(value || "")
      .replace(/(?:ISBN|ISSN|PMID|PMCID|CITATIONS?|READS?)[:\s].*$/i, "")
      .replace(/[.,;:)>\]}]+$/g, "");
    const metadataRoot = isResearchGatePublicationPage() ? document : root;
    for (const selector of ['meta[name="citation_doi" i]', 'meta[name="dc.identifier" i]', 'meta[name="prism.doi" i]', 'meta[property="prism.doi" i]']) {
      const value = metadataRoot.querySelector?.(selector)?.content || "";
      const match = value.match(/10\.\d{4,9}\/[\w.()/:;-]+/i);
      if (match) return clean(match[0]);
    }
    for (const link of root.querySelectorAll?.('a[href*="doi.org/"]') || []) {
      if (link.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail")) continue;
      const match = (link.href || "").match(/doi\.org\/(10\.\d{4,9}\/[\w.()/:;-]+)/i);
      if (match) return clean(decodeURIComponent(match[1]));
    }
    const text = currentSourceText(root === document ? document.body : root);
    return clean(text.match(/\bDOI\s*[:：]\s*(10\.\d{4,9}\/[\w.()/:;-]+)/i)?.[1]);
  }

  function publisherDocumentVenue() {
    const value = documentVenueSources()[0];
    if (value) return value;
    const source = [...document.querySelectorAll(
      "[data-test*='journal-title'], [data-testid*='journal-title'], header .journal-title, main .journal-title, " +
      "a[aria-label*='journal'], .publication-header__title"
    )].find((node) => !node.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail"));
    return (source?.textContent || "").trim();
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
    for (const source of documentVenueSources()) add(source);
    // Journal homes (notably the redesigned Emerald pages) often have no
    // citation metadata.  Their visible banner is nevertheless authoritative.
    if (isJournalLandingPage()) add(journalHeaderNode()?.textContent);
    // OUP frequently renders the journal identity as a masthead image.  Its
    // alt text is a reliable full title when there is no textual h1.
    if (location.hostname === "academic.oup.com" && isJournalLandingPage()) {
      for (const image of document.querySelectorAll("header img[alt], .journal-header img[alt], .journal-banner img[alt], img[alt][src*='masthead']")) add(image.alt);
    }
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
    if (isScholarlyDocumentPage()) {
      return (documentVenueSources()[0] || scholarlyDocumentVenueNode(container)?.textContent || "").trim()
        .replace(/^(?:Journal ref(?:erence)?|Journal|Source|来源|刊名)\s*[:：]\s*/i, "").trim();
    }
    if (site === "dblp") {
      const venue = venueNode(container);
      if (venue) return venue.textContent || "";
    }
    if (site === "semantic-scholar") {
      const candidates = semanticScholarVenueCandidates(container);
      if (candidates.length) return candidates[0];
    }
    const metadata = metadataNode(container);
    const nativeMetadata = site === "scholar" ? metadata.cloneNode(true) : metadata;
    if (site === "scholar") nativeMetadata.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    const raw = (nativeMetadata.textContent || "").trim();
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
    if (site === "pubmed") {
      if (isPubmedArticlePage()) {
        return (document.querySelector('meta[name="citation_journal_title"]')?.content || raw).trim();
      }
      return raw.replace(/\b(?:19|20)\d{2}\b.*$/, "").replace(/[.;,\s]+$/, "").trim();
    }
    if (site === "arxiv") return (arxivVenueNode(container)?.textContent || "").trim().replace(/^(Comments|Journal ref(?:erence)?)\s*:\s*/i, "").trim();
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
      if (isResearchGatePublicationPage()) return researchGateDocumentVenue();
      const perResult = (researchGateVenueNode(container)?.textContent || "").trim();
      const fromText = researchGateVenueFromText(currentSourceText(container));
      // A profile/search card must never inherit a journal from the open page.
      // An ordinary keyword result without an explicit source is not evidence
      // that the query phrase is the publication venue.
      return fromText || perResult;
    }
    if (site === "publisher") {
      if (isJournalLandingPage()) return (journalHeaderNode()?.textContent || publisherDocumentVenue()).trim();
      if (isPublisherDocumentPage()) return publisherDocumentVenue();
      const perResult = (publisherVenueNode(container)?.textContent || "").trim();
      return perResult;
    }
    return raw;
  }
  function publicationSourceCandidates(value) {
    const values = [];
    const add = (text) => {
      text = String(text || "").trim();
      if (text && !values.includes(text)) values.push(text);
    };
    add(value);
    // Normalize only the publication source, never the paper title/snippet.
    // Keep ellipses so truncated names still pass the ambiguity checks.
    for (let index = 0; index < values.length && index < 16; index += 1) {
      const text = values[index];
      add(text.replace(/^(?:accepted|published|presented|appearing|forthcoming)\s+(?:at|in|to|by)\s+/i, ""));
      add(text.replace(/^(?:proceedings|proc\.?)\s+(?:(?:of|from)\s+)?(?:the\s+)?/i, ""));
      add(text.replace(/^(?:19|20)\d{2}\s+/, ""));
      add(text.replace(/^\d+(?:st|nd|rd|th)\s+(?:annual\s+)?/i, ""));
      add(text.replace(/\s*\([A-Z][A-Z0-9-]{2,11}(?:\s+(?:19|20)\d{2})?\)\s*$/, ""));
      add(text.replace(/\s+\d+(?:\s*\([^)]*\))?(?:\s*[:,].*)?$/, ""));
      add(text.replace(/(?:[.,;]\s*)?(?:19|20)\d{2}(?:\s|[.,;:(]).*$/, ""));
      add(text.replace(/^(?:(?:IEEE|ACM|CVF|IFIP|IET|SIAM)(?:\s*[/&]\s*(?:IEEE|ACM|CVF|IFIP|IET|SIAM))*\s+)+(?=(?:(?:International|European|Asian|Annual)\s+)*(?:Conference|Symposium|Workshop|Meeting)\b)/i, ""));
      add(text.replace(/^(?:(?:international|annual)\s+)?(?:conference|symposium)\s+on\s+/i, ""));
    }
    // Book-series titles can name conference proceedings. The matcher below
    // accepts this variant only with both a catalogued series and conference.
    for (const text of values.slice()) {
      if (/^advances in\s+/i.test(text)) add(text.replace(/^advances in\s+/i, "Conference on "));
    }
    return values;
  }

  function scholarSourceCandidates(value) {
    return publicationSourceCandidates(value);
  }

  function isScholarAuthorField(node) {
    if (node.closest?.('a[href*="/citations?user="]')) return true;
    const citation = node.closest?.(".gs_a");
    if (citation) {
      const sourceStart = (citation.textContent || "").search(/\s+-\s+/);
      if (sourceStart >= 0) {
        const before = document.createRange();
        before.setStart(citation, 0);
        before.setEndBefore(node);
        return before.toString().length < sourceStart;
      }
    }
    const profileRow = node.closest?.(".gsc_a_tr");
    const gray = node.closest?.(".gs_gray");
    const profileFields = profileRow?.querySelectorAll(".gs_gray");
    return Boolean(gray && profileFields?.length > 1 && gray === profileFields[0]);
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
      if (node.closest?.(".gs_rt, .gsc_a_at, .gs_rs, .gs_fl, .gs_or_ggsm, .rank-assistant-row, .rank-assistant-venue-detail")) continue;
      if (node.children.length) continue;
      if (isScholarAuthorField(node)) continue;
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
      if (node.closest?.(".gs_rt, .gsc_a_at, .gs_rs, .gs_fl, .gs_or_ggsm")) continue;
      if (node.children.length) continue;
      if (isScholarAuthorField(node)) continue;
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
    return [candidateText(container), ...scholarExplicitVenueCandidates(container)].map((value) => N.normalize(value)).join("\u001f");
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
    if (siteKind() === "semantic-scholar" && !isScholarlyDocumentPage()) return semanticScholarVenueCandidates(container);
    const candidates = [];
    const add = (value) => {
      const cleaned = String(value || "").trim();
      if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
    };
    add(candidateText(container));
    if (isScholarlyDocumentPage() || isPublisherDocumentPage() || isResearchGatePublicationPage()) {
      for (const source of documentVenueSources()) add(source);
    }
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
    for (const meta of document.querySelectorAll('meta[name="citation_issn" i], meta[name="prism.issn" i], meta[property="prism.issn" i], meta[name="prism.eissn" i], meta[property="prism.eissn" i], meta[name="issn" i], meta[name="eissn" i], meta[name="dc.identifier" i]')) add(meta.content);
    // A journal's own masthead and explicitly labelled homepage ISSNs are
    // identity fields. Article body text and reference lists are not.
    for (const node of document.querySelectorAll(".journal-header, .journal-banner, [data-test='journal-issn'], [data-testid='journal-issn']")) {
      if (!node.closest(".references, #references, [role='doc-bibliography']")) add(node.textContent);
    }
    if (isJournalLandingPage()) {
      for (const node of document.querySelectorAll("main div, main p, main span, header div, footer div, footer p, footer span, [itemprop='issn']")) {
        if (node.children.length || node.closest(".references, #references, [role='doc-bibliography'], [class*='reference' i], [id*='reference' i], .rank-assistant-row, .rank-assistant-venue-detail")) continue;
        const value = (node.textContent || "").trim();
        if (node.matches("[itemprop='issn']") || /^(?:(?:print|online|electronic|e|p)[ -]*)?ISSN\s*[:：]?\s*\d{4}[- ]?\d{3}[\dX]/i.test(value)) add(value);
      }
      const journalIdentifier = location.pathname.match(/\/(?:journal|journals|issn)\/(\d{4}[- ]?\d{3}[\dX])(?:\/|$)/i)?.[1];
      if (journalIdentifier) add(journalIdentifier);
    }
    return [...found];
  }

  function pubmedId(container) {
    if (isPubmedArticlePage()) return location.pathname.match(/\d+/)?.[0] || "";
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
    await ensureShards(hints.map(([key]) => key));
    return uniqueRecord(hints.map(([key, offset]) => state.shards.get(key)?.r?.[offset] || null));
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
  const normalizedShardCache = new WeakMap();

  function normalizedAliasVariants(value) {
    const normalized = venueKey(value);
    return [...new Set([normalized, normalized.replace(/([\p{L}\p{N}]) s\b/gu, "$1s")].filter(Boolean))];
  }

  function normalizedShard(shard) {
    if (!shard) return null;
    if (normalizedShardCache.has(shard)) return normalizedShardCache.get(shard);
    const aliases = new Map(), abbreviations = new Map();
    const blockedAliases = new Set(), blockedAbbreviations = new Set();
    const add = (owners, key, index) => {
      if (!key) return;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(index);
    };
    for (const [stored, index] of Object.entries(shard.a || {})) {
      for (const key of normalizedAliasVariants(stored)) add(aliases, key, index);
    }
    // Raw canonical titles preserve apostrophes that the build-time index
    // separates. Alias variants above cover the same equivalence for aliases.
    shard.r.forEach((record, index) => add(aliases, venueKey(record[0]), index));
    for (const stored of shard.x || []) {
      for (const key of normalizedAliasVariants(stored)) blockedAliases.add(key);
    }
    for (const [stored, index] of Object.entries(shard.b || {})) {
      for (const key of normalizedAliasVariants(stored)) add(abbreviations, key, index);
    }
    for (const [key, owners] of aliases) {
      if (owners.size > 1) blockedAliases.add(key);
      for (const index of owners) add(abbreviations, abbreviationKey(key), index);
    }
    for (const stored of shard.y || []) {
      for (const key of normalizedAliasVariants(stored)) blockedAbbreviations.add(key);
    }
    for (const key of blockedAliases) blockedAbbreviations.add(abbreviationKey(key));
    const a = Object.create(null), b = Object.create(null);
    for (const [key, owners] of aliases) {
      if (owners.size === 1 && !blockedAliases.has(key)) a[key] = [...owners][0];
    }
    for (const [key, owners] of abbreviations) {
      if (owners.size > 1) blockedAbbreviations.add(key);
      if (owners.size === 1 && !blockedAbbreviations.has(key)) b[key] = [...owners][0];
    }
    const streams = new Map();
    for (const record of shard.r) {
      const stream = record[15]?.match(/\/db\/conf\/([^/]+)\//)?.[1]?.toLowerCase();
      if (!stream || !isCcfConference(record)) continue;
      if (!streams.has(stream)) streams.set(stream, []);
      streams.get(stream).push(record);
    }
    const result = { r: shard.r, a, b, x: blockedAliases, y: blockedAbbreviations, streams };
    normalizedShardCache.set(shard, result);
    return result;
  }

  function recordInShard(key, normalized, abbreviated) {
    const shard = normalizedShard(state.shards.get(key));
    if (!shard) return null;
    if (shard.x.has(normalized)) return null;
    if (Object.prototype.hasOwnProperty.call(shard.a, normalized)) return shard.r[shard.a[normalized]] || null;
    if (abbreviated && !shard.y.has(abbreviated) && Object.prototype.hasOwnProperty.call(shard.b, abbreviated)) {
      return shard.r[shard.b[abbreviated]] || null;
    }
    return null;
  }

  function exactRecord(text) {
    const normalized = venueKey(text);
    if (!normalized) return null;
    return uniqueRecord(primaryShardsForText(text).map((key) => recordInShard(key, normalized, abbreviationKey(normalized))));
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
    const matches = [];
    for (const key of primaryShardsForText(text)) {
      const shard = normalizedShard(state.shards.get(key));
      if (!shard) continue;
      for (const [stored, index] of Object.entries(shard.a)) {
        if ((includeExact && stored === normalized) || stored.startsWith(normalized + " ")) matches.push(shard.r[index]);
      }
      for (const stored of shard.x) {
        if ((includeExact && stored === normalized) || stored.startsWith(normalized + " ")) return false;
      }
    }
    return matches.length ? uniqueRecord(matches) || false : null;
  }

  function fuzzyAbbreviationRecord(text) {
    const normalized = venueKey(text);
    const candidate = abbreviationKey(normalized);
    const candidateTokens = candidate.split(" ").filter(Boolean);
    if (candidateTokens.length < 2) return null;
    const matches = [];
    for (const key of primaryShardsForText(text)) {
      const shard = normalizedShard(state.shards.get(key));
      if (!shard) continue;
      for (const stored of shard.y) {
        const storedTokens = stored.split(" ");
        if (storedTokens.length !== candidateTokens.length) continue;
        if (candidateTokens.every((token, position) =>
          storedTokens[position].startsWith(token) || token.startsWith(storedTokens[position])
        )) return null;
      }
      for (const [stored, index] of Object.entries(shard.b)) {
        const storedTokens = stored.split(" ");
        if (storedTokens.length !== candidateTokens.length) continue;
        if (!candidateTokens.every((token, position) =>
          storedTokens[position].startsWith(token) || token.startsWith(storedTokens[position])
        )) continue;
        matches.push(shard.r[index]);
      }
    }
    return uniqueRecord(matches);
  }
  function longEmbeddedRecord(text) {
    const normalized = venueKey(text);
    const words = normalized.split(" ").filter(Boolean);
    for (let size = Math.min(state.maxAliasWords, words.length); size >= 4; size -= 1) {
      const matches = [];
      for (let start = 0; start <= words.length - size; start += 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const shard = normalizedShard(state.shards.get(shardKey(phrase)));
        if (!shard || shard.x.has(phrase) || !Object.prototype.hasOwnProperty.call(shard.a, phrase)) continue;
        matches.push(shard.r[shard.a[phrase]] || null);
      }
      if (matches.length) return uniqueRecord(matches);
    }
    return null;
  }

  function acronymRecord(text) {
    const raw = String(text || "").trim();
    const simple = raw.match(/^([A-Z][A-Za-z0-9-]{2,11})(?:\s+(?:19|20)\d{2})?$/);
    const contextual = raw.match(/\b(?:accepted|published|appearing|presented|forthcoming)\s+(?:at|in|to)\s+([A-Za-z][A-Za-z0-9-]{2,11})\b/i);
    const acronym = simple?.[1] || contextual?.[1] || "";
    // Case-insensitive context words must not turn ordinary words such as
    // "Analysis" into an acronym for a journal. Mixed-case NeurIPS remains valid.
    if ((acronym.match(/[A-Z]/g) || []).length < 2) return null;
    const record = exactRecord(acronym);
    return record && (!contextual || isCcfConference(record)) && publicationScopeMatches(raw, record) ? record : null;
  }

  function isCcfConference(record) {
    return Boolean(record?.[1] && /会议|conference/i.test(record[2] || "") && /\/db\/conf\/[^/]+\//.test(record[15] || ""));
  }

  function publicationScopeMatches(value, record) {
    const scopeWords = /\b(workshops?|findings|supplements?|companion|tutorials?)\b/gi;
    const scopes = String(value || "").match(scopeWords) || [];
    const title = venueKey(record?.[0]);
    return scopes.every((scope) => new RegExp("\\b" + scope.toLowerCase().replace(/s$/, "") + "s?\\b").test(title));
  }

  function venueTruncation(value) {
    const raw = String(value || "").normalize("NFKC").trim();
    const markers = [...raw.matchAll(/\.{3,}|\u2026+/g)];
    if (!markers.length) return "";
    return markers.length === 1 && markers[0].index > 0 && markers[0].index + markers[0][0].length === raw.length ? "suffix" : "incomplete";
  }

  function matchRecord(text, { allowEmbedded = false, allowCompletion = true } = {}) {
    const normalized = venueKey(text);
    if (!normalized) return null;
    for (const key of primaryShardsForText(text)) {
      if (normalizedShard(state.shards.get(key))?.x.has(normalized)) return null;
    }
    const truncation = venueTruncation(text);
    if (truncation === "incomplete") return null;
    const truncated = truncation === "suffix";
    const scoped = (record) => record && publicationScopeMatches(text, record) ? record : null;
    if (!truncated) {
      // Scholar commonly spells canonical titles with a leading article
      // (e.g. "The Lancet"), while the catalogue stores "Lancet".
      const exact = exactRecord(text) || (normalized.startsWith("the ") ? exactRecord(String(text).replace(/^the\s+/i, "")) : null);
      if (exact) return scoped(exact);
    }
    if (allowCompletion) {
      const prefixed = prefixRecord(text, { includeExact: truncated });
      if (prefixed === false) return null;
      if (prefixed) return scoped(prefixed);
      // Ellipses represent missing evidence, never an abbreviation. A short
      // truncated title cannot be restored by fuzzy or embedded matching.
      if (truncated) return null;
      const abbreviated = fuzzyAbbreviationRecord(text);
      if (abbreviated) return scoped(abbreviated);
    }
    return allowEmbedded && !truncated ? scoped(longEmbeddedRecord(text) || acronymRecord(text)) : null;
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

  function publicationSourceRecord(value) {
    if (isUnsafeScholarVenue(value)) return null;
    if (venueTruncation(value) === "incomplete") return null;
    const candidates = publicationSourceCandidates(value);
    const context = /^(?:accepted|published|presented|appearing|forthcoming)\s+(?:at|in|to|by)\s+/i.test(String(value || "").trim());
    const journalContext = /^published\s+in\s+/i.test(String(value || "").trim());
    const conferenceContext = /\b(?:proceedings|proc|conference|symposium|workshops?|findings|supplements?|companion)\b/i.test(String(value || ""));
    const sourceRecord = scholarSourceBaseRecord(value) || uniqueRecord(candidates
      .map((text) => ({ text, record: scholarSourceBaseRecord(text) }))
      .filter(({ text, record }) => record && publicationScopeMatches(value, record) && (
        (record[25] === "Book-Series" && /^(?:advances in|proceedings|proc\.?)\s+/i.test(text)) ||
        ((!conferenceContext || (/^(?:proceedings|proc\.?)\s+/i.test(text) && matchRecord(text, { allowCompletion: false }))) && !isCcfConference(record) && (
          !context || (journalContext && venueKey(text).split(" ").length >= 2 && matchRecord(text, { allowCompletion: false }))
        ))
      )).map(({ record }) => record));
    const conferenceMatches = candidates.map((text) => {
      // "Advances in ..." is a series-to-conference relation, not an alias
      // for arbitrary journal titles or free-form source strings.
      if (/^conference on /i.test(text) && candidates.some((candidate) => /^advances in /i.test(candidate)) && sourceRecord?.[25] !== "Book-Series") return null;
      const record = scholarSourceBaseRecord(text);
      return isCcfConference(record) && publicationScopeMatches(value, record) ? record : null;
    });
    // Historical conference acronyms remain in their stable DBLP stream ID.
    // Resolve those IDs from the catalog instead of a per-conference table.
    for (const candidate of candidates) {
      const acronym = candidate.match(/^([A-Z][A-Z0-9-]{2,11})$/)?.[1];
      if (!acronym) continue;
      for (const shard of state.shards.values()) {
        conferenceMatches.push(...(normalizedShard(shard).streams.get(acronym.toLowerCase()) || []).filter((record) => publicationScopeMatches(value, record)));
      }
    }
    const conference = uniqueRecord(conferenceMatches);
    if (!conference) return sourceRecord;
    if (!sourceRecord || sourceRecord[1] || sourceRecord[25] !== "Book-Series") return conference;
    // Keep the series' ISSNs and index labels while adding the conference's
    // CCF metadata; the underlying catalog entities remain separate.
    const combined = sourceRecord.slice();
    for (const index of [1, 2, 3, 14, 15]) combined[index] = conference[index];
    return combined;
  }

  function scholarSourceRecord(value) {
    return publicationSourceRecord(value);
  }

  function scholarSourceBaseRecord(value) {
    const normalized = venueKey(value);
    const words = normalized.split(" ").filter(Boolean);
    // Short journal titles are common (Appetite, Insects, Animals, Science).
    // Permit them only as an exact catalogue title, never via prefix/fuzzy
    // completion, so the fix does not reintroduce the generic-title problem.
    if (words.length <= 2) {
      if (venueTruncation(value)) return null;
      const exact = exactRecord(value) || (normalized.startsWith("the ") ? exactRecord(String(value).replace(/^the\s+/i, "")) : null);
      // Two compact journal words can be a genuine bibliographic abbreviation
      // (Ann Med, Phys Rev). An author initial and surname cannot supply this
      // evidence, and longer short titles remain exact-only.
      const abbreviated = words.length === 2 && words.every((word) => word.length >= 3 && word.length <= 4)
        ? fuzzyAbbreviationRecord(value)
        : null;
      const record = exact || abbreviated;
      return record && publicationScopeMatches(value, record) ? record : null;
    }
    return matchRecord(value);
  }

  function scholarFallbackRecord(texts) {
    const safe = (texts || []).filter((text) => !isUnsafeScholarVenue(text));
    return uniqueRecord(safe.map(publicationSourceRecord));
  }
  function primaryShardForText(text) {
    const normalized = venueKey(text);
    return normalized ? shardKey(normalized) : "";
  }

  function primaryShardsForText(text) {
    const normalized = venueKey(text);
    if (!normalized) return [];
    const catalogKey = catalogVenueKey(text);
    const keys = [shardKey(normalized), shardKey(catalogKey)];
    // "The Lancet" and equivalent leading-article titles may normalize to a
    // record in another shard. Load both deterministically before exact match.
    if (normalized.startsWith("the ")) keys.push(shardKey(normalized.slice(4)));
    if (catalogKey.startsWith("the ")) keys.push(shardKey(catalogKey.slice(4)));
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

  function renderBusinessBadges(row, business, ajg) {
    const s = state.settings;
    if (s.showUtd24 && business?.utd24) row.appendChild(badge("utd24", "UTD24", "UT Dallas 24", [
      { label: "期刊", value: business.name }, { label: "目录", value: "UTD 24" }
    ], "UT Dallas Top 100 Business School Research Rankings 使用的 24 本商科期刊目录。"));
    if (s.showFt50 && business?.ft50) row.appendChild(badge("ft50", "FT50", "Financial Times 50", [
      { label: "期刊", value: business.name }, { label: "版本", value: "2026 年 4 月" }
    ], "Financial Times 全球商学院研究排名使用的 FT50 期刊目录。"));
    if (s.showAbs && ajg?.rating) row.appendChild(badge("abs", "ABS " + ajg.rating, "ABS / Academic Journal Guide", [
      { label: "期刊", value: ajg.title }, { label: "评级", value: ajg.rating }, { label: "版本", value: "AJG 2024" }
    ], "Chartered Association of Business Schools 发布的 Academic Journal Guide（常称 ABS）评级；4* 为最高等级。", ajg.rating));
  }

  function renderCustomBadges(row, matches) {
    if (!state.settings.showCustomIndexes) return;
    for (const match of matches) {
      const element = badge("custom", tr("自定义") + "：" + match.name + " " + match.level,
        "用户上传的自定义索引", [{ label: "索引", value: match.name }, { label: "等级", value: match.level }],
        "由用户上传的期刊/会议目录提供，独立于插件内置的官方索引。", match.level);
      element.dataset.customIndexId = match.id;
      row.appendChild(element);
    }
  }

  function renderBadges(record, business = null, ajg = null, verifiedVenueTitle = "", customMatches = [], officialAvailable = true) {
    const row = document.createElement("span");
    row.className = "rank-assistant-row";
    row.dataset.paperRank = "1";
    const s = state.settings;

    if (!officialAvailable) {
      renderCustomBadges(row, customMatches);
      return row.children.length ? row : null;
    }

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
          [
            ...(verifiedVenueTitle ? [{ label: "来源", value: verifiedVenueTitle }] : []),
            { label: "目录", value: "CCF 2026" }
          ],
          "本地 CCF 目录未匹配到。可能是非 CCF 来源，也可能是页面来源信息不完整。"
        ));
      }
    }

    renderBusinessBadges(row, business, ajg);
    renderCustomBadges(row, customMatches);
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

  function filterValuesForRecord(index, record, customMatches = []) {
    if (index.startsWith("custom:")) return customMatches.filter((match) => "custom:" + match.id === index).map((match) => match.level);
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

  function recordPassesFilters(record, customMatches = [], officialAvailable = true) {
    if (state.settings.hideWarnedJournals && record?.[32]) return false;
    const filters = state.settings.resultFilters || {};
    const indexes = Array.isArray(filters.indexes) ? filters.indexes : [];
    for (const index of indexes) {
      if (typeof index !== "string") continue;
      let selected = Array.isArray(filters.values?.[index]) ? filters.values[index] : [];
      if (index.startsWith("custom:")) {
        const validLevels = customFilterLevels().get(index);
        if (!validLevels) continue;
        selected = selected.filter((level) => validLevels.has(level));
      }
      if (!selected.length) continue;
      if (!officialAvailable && !index.startsWith("custom:")) return false;
      const actual = filterValuesForRecord(index, record, customMatches);
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
      delete container.dataset.paperRankCustomMembership;
    }
    if (!state.settings.enabled) return;
    idle().then(scan).then(() => { if (!state.scanError) setStatus("ready", state.lastScanDetail); }).catch(reportScanError);
  }

  function fingerprintNativeText(node) {
    if (!node) return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll?.(".rank-assistant-row, .rank-assistant-venue-detail").forEach((child) => child.remove());
    return String(copy.textContent || "").replace(/\s+/g, " ").trim();
  }

  function resultVenueFingerprint(container) {
    const title = titleNode(container);
    const venue = venueNode(container);
    const sourceAttributes = ["data-full-text", "data-venue", "data-journal", "data-source", "title", "href"]
      .map((name) => venue?.getAttribute?.(name) || "");
    return JSON.stringify([
      location.pathname + location.search,
      fingerprintNativeText(title),
      title?.getAttribute?.("href") || title?.querySelector?.("a[href]")?.getAttribute("href") || "",
      candidateTexts(container),
      sourceAttributes,
      siteKind() === "dblp" ? dblpVenueKey(container) : "",
      siteKind() === "pubmed" ? pubmedId(container) : "",
      siteKind() === "researchgate" ? researchGateDoi(container) : ""
    ]);
  }

  function reportScanError(error) {
    state.scanError = String(error?.message || error);
    setStatus("error", String(error?.message || error));
    console.error("[期刊会议等级与分区助手]", error);
  }

  function renderContainer(container, record, texts = [], verifiedVenueTitle = "", expectedFingerprint, officialAvailable = true) {
    if (!container.isConnected) return;
    if (expectedFingerprint !== undefined && expectedFingerprint !== resultVenueFingerprint(container)) {
      delete container.dataset.paperRankLoading;
      delete container.dataset.paperRankProcessed;
      rescanRequested = true;
      return;
    }
    if (isResearchGatePublicationPage() || isPublisherDocumentPage()) {
      document.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    }
    container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
    if (officialAvailable) container.dataset.paperRankProcessed = "1";
    else delete container.dataset.paperRankProcessed;
    container.dataset.paperRankVenueFingerprint = resultVenueFingerprint(container);
    delete container.dataset.paperRankLoading;
    const customMatches = customMatchesForContainer(container, record, verifiedVenueTitle);
    container.dataset.paperRankCustomMembership = JSON.stringify(customMatches.map(({ id, level }) => ({ id, level })));
    if (siteKind() === "researchgate" && !isResearchGatePublicationPage() && !record && !researchGateVenueNode(container) && !verifiedVenueTitle) {
      delete container.dataset.paperRankMatched;
      delete container.dataset.paperRankCustomMembership;
      return;
    }
    const visible = recordPassesFilters(record, customMatches, officialAvailable);
    if (container.classList.contains("rank-assistant-filter-hidden") === visible) container.classList.toggle("rank-assistant-filter-hidden", !visible);
    if (!visible) return;
    const canonicalTexts = record ? [record[0]] : [];
    // UTD/FT matching is exact, so it may still be shown for a clean venue
    // line outside Scholar; Google Scholar uses only confirmed records.
    const businessTexts = siteKind() === "scholar" ? canonicalTexts : (canonicalTexts.length ? canonicalTexts : texts);
    const business = businessTexts.map((text) => globalThis.RankAssistantBusinessRankings?.match(text)).find(Boolean) || null;
    // ABS/AJG is deliberately tied to a catalog-confirmed journal title,
    // never to arbitrary paper-title text or an unverified short label.
    const ajg = record ? globalThis.RankAssistantAjg2024?.match(record[0]) || null : null;
    const row = renderBadges(record, business, ajg, verifiedVenueTitle, customMatches, officialAvailable);
    if (row) {
      attachTitleRow(container, row, [record?.[0], business?.name, verifiedVenueTitle]);
      if (officialAvailable && (record || business || verifiedVenueTitle)) container.dataset.paperRankMatched = "1";
      else delete container.dataset.paperRankMatched;
    } else {
      delete container.dataset.paperRankMatched;
    }
    if (officialAvailable && record) attachVenueDetails(container, renderVenueDetails(record));
  }

  async function resolveAndRenderResearchGateItems(items, paint = true) {
    if (!items.length) return;
    await ensureShards(items.flatMap((item) => item.texts.flatMap(publicationSourceCandidates).flatMap(primaryShardsForText)));
    const unresolved = [];
    for (const item of items) {
      item.record = await indexedRecordForIssns(item.externalIssns) ||
        uniqueRecord(item.texts.map(publicationSourceRecord));
      if (!item.record) unresolved.push(item);
    }
    if (unresolved.length) {
      await ensureShards(unresolved.flatMap((item) => item.texts.flatMap(secondaryShardsForText)));
      for (const item of unresolved) {
        item.record = uniqueRecord(item.texts.map(publicationSourceRecord));
      }
    }
    if (paint) for (const item of items) renderContainer(item.container, item.record, item.texts, item.verifiedVenueTitle, item.venueFingerprint);
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

  function scan() {
    if (scanInFlight) {
      rescanRequested = true;
      return scanInFlight;
    }
    scanInFlight = (async () => {
      do {
        rescanRequested = false;
        await scanPendingResults();
      } while (rescanRequested);
    })().finally(() => { scanInFlight = null; });
    return scanInFlight;
  }

  async function scanPendingResults() {
    if (isAccessChallengePage()) {
      suppressAccessChallengeOutput();
      return;
    }
    const containers = [...resultContainers()].filter(
      (container) => container.dataset.paperRankProcessed !== "1" && container.dataset.paperRankLoading !== "1"
    );
    if (!containers.length) return;
    state.scanError = "";
    const site = siteKind();
    const allowEmbedded = site === "arxiv" || site === "researchgate" || (site === "publisher" && isJournalLandingPage());
    const items = containers.map((container) => {
      container.dataset.paperRankLoading = "1";
      const sourceText = site === "scholar" ? candidateText(container) : "";
      const texts = candidateTexts(container);
      const explicitTexts = site === "scholar" ? scholarExplicitVenueCandidates(container) : [];
      const doi = site === "researchgate" && !researchGateVenueNode(container) ? researchGateDoi(container) : "";
      return { container, texts, explicitTexts, sourceText, venueFingerprint: resultVenueFingerprint(container), text: texts[0] || "", pmid: site === "pubmed" ? pubmedId(container) : "", doi, paperTitle: site === "researchgate" && !isResearchGatePublicationPage() ? researchGatePaperTitle(container) : "", pubmedIssns: [], externalIssns: [], verifiedVenueTitle: "", record: null };
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
      if (site === "researchgate" && isResearchGatePublicationPage()) {
        const detailDois = items.map((item) => item.doi).filter(Boolean);
        if (detailDois.length) {
          const response = await sendRuntimeMessage({ type: "rank-assistant-doi-venues", dois: detailDois.slice(0, 1) });
          for (const item of items) {
            const venue = response?.venues?.[item.doi.toLowerCase()];
            const title = String(venue?.title || "").trim();
            if (title && !item.texts.includes(title)) item.texts.unshift(title);
            item.externalIssns = Array.isArray(venue?.issns) ? venue.issns : [];
            if (title && /^(?:journal-article|proceedings-article)$/i.test(String(venue?.type || ""))) item.verifiedVenueTitle = title;
          }
        }
      }
      if (site === "researchgate" && !isResearchGatePublicationPage()) {
        const pending = new Set(items);
        const applyVenue = (item, venue) => {
          const title = String(venue?.title || "").trim();
          if (title && !item.texts.includes(title)) item.texts.unshift(title);
          if (Array.isArray(venue?.issns)) item.externalIssns = venue.issns;
          item.externalVenueResolved = Boolean(title || item.externalIssns.length);
          if (title && /^(?:journal-article|proceedings-article)$/i.test(String(venue?.type || ""))) item.verifiedVenueTitle = title;
        };

        const nativeVenueItems = items.filter((item) => candidateText(item.container));
        await resolveAndRenderResearchGateItems(nativeVenueItems, false);
        for (const item of nativeVenueItems) {
          if (!item.record) continue;
          pending.delete(item);
          renderContainer(item.container, item.record, item.texts, item.verifiedVenueTitle, item.venueFingerprint);
        }

        // Resolve and paint small DOI groups independently. One slow or bad
        // publication must not hold back every badge on the first screen.
        const doiItems = [...pending].filter((item) => item.doi).slice(0, 20);
        for (let start = 0; start < doiItems.length; start += 4) {
          const group = doiItems.slice(start, start + 4);
          const response = await sendRuntimeMessage({ type: "rank-assistant-doi-venues", dois: group.map((item) => item.doi) });
          const ready = [];
          for (const item of group) {
            const venue = response?.venues?.[item.doi.toLowerCase()];
            if (!venue) continue;
            applyVenue(item, venue);
            ready.push(item);
            pending.delete(item);
          }
          await resolveAndRenderResearchGateItems(ready);
        }

        // Cards still missing a usable DOI get a conservative exact-title
        // fallback, also in small independently rendered groups.
        const titleItems = [...pending].filter((item) => item.paperTitle).slice(0, 12);
        for (let start = 0; start < titleItems.length; start += 3) {
          const group = titleItems.slice(start, start + 3);
          const response = await sendRuntimeMessage({ type: "rank-assistant-title-venues", titles: group.map((item) => item.paperTitle) });
          const ready = [];
          for (const item of group) {
            const venue = response?.venues?.[normalizedPaperTitle(item.paperTitle)];
            if (!venue) continue;
            applyVenue(item, venue);
            ready.push(item);
            pending.delete(item);
          }
          await resolveAndRenderResearchGateItems(ready);
        }

        // Only now finalize cards for which neither source-recovery path had
        // trustworthy evidence. These remain blank instead of receiving a
        // fabricated journal rank.
        for (const item of pending) renderContainer(item.container, null, item.texts, "", item.venueFingerprint);
        state.lastScanDetail = state.shards.size + " content data shards";
        return;
      }
      if (isDblp()) {
        const response = await sendRuntimeMessage({
          type: "rank-assistant-match-dblp-venues",
          items: items.map((item) => ({ text: item.text, key: dblpVenueKey(item.container) }))
        });
        if (response?.ok && Array.isArray(response.records) && response.records.length === items.length) {
          response.records.forEach((record, index) => { items[index].record = record || null; });
          state.lastScanDetail = (Number(response.shardCount) || 0) + " background data shards";
          for (const item of items) renderContainer(item.container, item.record, item.texts, "", item.venueFingerprint);
          return;
        }
        throw new Error(response?.error || "DBLP venue catalog lookup failed");
      }
      await ensureShards(items.flatMap((item) => [
        ...item.texts.flatMap(publicationSourceCandidates),
        ...(site === "scholar" ? scholarSourceCandidates(item.sourceText) : [])
      ].flatMap(primaryShardsForText)));
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
        else localFallback = uniqueRecord(item.texts.map(publicationSourceRecord));
        // Current, explicit source metadata also wins on article pages. An
        // inconsistent or historical ISSN must not replace a known source.
        const publisherRecord = site === "publisher"
          ? (publisherTitleRecord || localFallback || indexedPublisherRecord)
          : null;
        // A confirmed native conference also carries the proceedings series'
        // index labels. A bare series match must not discard its CCF metadata.
        const scholarRecord = sourceRecord?.[1] && explicitScholarRecord?.[25] === "Book-Series"
          ? sourceRecord : explicitScholarRecord || sourceRecord;
        item.record = publisherRecord || scholarRecord ||
          (site === "pubmed" ? await indexedRecordForIssns(item.pubmedIssns) : null) ||
          (site === "researchgate" ? await indexedRecordForIssns(item.externalIssns) : null) || localFallback;
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
        renderContainer(item.container, item.record, item.texts, item.verifiedVenueTitle, item.venueFingerprint);
      }
    } catch (error) {
      state.scanError = String(error?.message || error);
      for (const item of items) renderContainer(item.container, null, item.texts, item.verifiedVenueTitle, item.venueFingerprint, false);
      throw error;
    }
  }
  function mutationContainsResults(records) {
    const selector = resultSelector();
    if (!selector) return false;
    const ownOutput = ".rank-assistant-row, .rank-assistant-venue-detail, #rank-assistant-shared-tooltip";
    const containers = [...resultContainers()];
    const touchesResult = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element || element.closest?.(ownOutput)) return false;
      return Boolean(element.matches?.(selector) || element.closest?.(selector) || element.querySelector?.(selector) ||
        containers.some((container) => container === element || container.contains(element)));
    };
    for (const record of records) {
      if (record.type === "attributes" && /^(?:data-paper-rank|data-rank-assistant)/.test(record.attributeName || "")) continue;
      if (record.type === "attributes" && record.target?.matches?.("meta[name], meta[property]")) return true;
      if (record.type === "characterData" || record.type === "attributes") {
        if (touchesResult(record.target)) return true;
        continue;
      }
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      for (const node of changedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.(ownOutput) || node.closest?.(ownOutput))) continue;
        if (node.nodeType === Node.ELEMENT_NODE && node.matches?.("meta[name], meta[property]")) return true;
        if (touchesResult(node) || (node.nodeType === Node.TEXT_NODE && touchesResult(record.target))) return true;
      }
    }
    return false;
  }

  function watchDynamicResults() {
    let timer;
    const observer = new MutationObserver((records) => {
      if (records.every((record) => record.type === "attributes" && /^(?:data-paper-rank|data-rank-assistant)/.test(record.attributeName || ""))) return;
      if (isAccessChallengePage()) {
        clearTimeout(timer);
        suppressAccessChallengeOutput();
        return;
      }
      const site = siteKind();
      if (!mutationContainsResults(records)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const container of resultContainers()) {
          if (resultVenueFingerprint(container) === (container.dataset.paperRankVenueFingerprint || "")) continue;
          container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
          container.classList.remove("rank-assistant-filter-hidden");
          delete container.dataset.paperRankProcessed;
          delete container.dataset.paperRankLoading;
          delete container.dataset.paperRankMatched;
          delete container.dataset.paperRankCustomMembership;
        }
        idle().then(scan).then(() => { if (!state.scanError) setStatus("ready", state.lastScanDetail); }).catch(reportScanError);
      }, site === "scholar" ? 320 : 80);
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, attributes: true, subtree: true });
  }

  function refreshDelayedScholarVenues() {
    if (siteKind() !== "scholar") return;
    let changed = false;
    for (const container of resultContainers()) {
      const nextFingerprint = resultVenueFingerprint(container);
      if (nextFingerprint === (container.dataset.paperRankVenueFingerprint || "")) continue;
      container.querySelectorAll(".rank-assistant-row, .rank-assistant-venue-detail").forEach((node) => node.remove());
      delete container.dataset.paperRankProcessed;
      delete container.dataset.paperRankLoading;
      delete container.dataset.paperRankMatched;
      changed = true;
      delete container.dataset.paperRankCustomMembership;
    }
    if (changed) idle().then(scan).then(() => { if (!state.scanError) setStatus("ready", state.lastScanDetail); }).catch(reportScanError);
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
