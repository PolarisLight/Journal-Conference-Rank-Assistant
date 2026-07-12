(async function () {
  "use strict";

  const N = globalThis.RankAssistantNormalizer;
  const DEFAULTS = {
    enabled: true,
    showCcf: true,
    showCas: true,
    showJcr: true,
    showIf: true,
    showWos: true,
    showTop: true,
    colorTheme: "light"
  };
  const STOP = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);
  const state = { settings: DEFAULTS, shards: new Map(), shardPromises: new Map(), maxAliasWords: 12 };
  let initialization = null;
  const controlDetails = new WeakMap();
  let tooltipHost = null;
  let tooltipPanel = null;
  let hideTimer = null;
  const systemDarkMode = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedColorTheme() {
    const selected = state.settings.colorTheme || "light";
    return selected === "system" ? (systemDarkMode.matches ? "dark" : "light") : selected;
  }

  function syncColorTheme() {
    const resolved = resolvedColorTheme();
    document.documentElement.dataset.paperRankTheme = resolved;
    if (tooltipHost) tooltipHost.dataset.theme = resolved;
  }

  if (systemDarkMode.addEventListener) systemDarkMode.addEventListener("change", syncColorTheme);
  else if (systemDarkMode.addListener) systemDarkMode.addListener(syncColorTheme);
  if (chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.colorTheme) return;
      state.settings.colorTheme = changes.colorTheme.newValue || "light";
      syncColorTheme();
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
    return new Promise((resolve) => chrome.storage.local.get(DEFAULTS, resolve));
  }

  function isDblp() {
    return /(^|\.)dblp\.(org|uni-trier\.de|dagstuhl\.de)$/.test(location.hostname);
  }

  function resultContainers() {
    if (isDblp()) return document.querySelectorAll("li.entry, article.entry");
    return document.querySelectorAll(".gs_r.gs_or.gs_scl, .gs_r");
  }

  function shardKey(value) {
    const first = (value || "")[0] || "";
    if (first >= "a" && first <= "z") return first;
    if (first >= "0" && first <= "9") return "0";
    return "other";
  }

  async function loadShard(key) {
    if (!key || key === "other") return null;
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
  function abbreviationKey(value) {
    return N.normalize(value).split(" ").filter((token) => token && !STOP.has(token))
      .map((token) => token.slice(0, 4)).join(" ");
  }

  function metadataNode(container) {
    if (isDblp()) return container.querySelector(".data, cite") || container;
    return container.querySelector(".gs_a") || container.querySelector(".gs_ri") || container;
  }

  function titleNode(container) {
    if (isDblp()) {
      return container.querySelector('span.title[itemprop="name"], .title');
    }
    return container.querySelector(".gs_rt");
  }

  function venueNode(container) {
    if (isDblp()) {
      return container.querySelector(
        '.data [itemprop="isPartOf"] a, cite [itemprop="isPartOf"] a, .data a[href*="/db/"], cite a[href*="/db/"], .rank-assistant-fallback-venue'
      );
    }
    return metadataNode(container);
  }

  function candidateText(container) {
    if (isDblp()) {
      const venue = venueNode(container);
      if (venue) return venue.textContent || "";
    }
    const raw = metadataNode(container).textContent || "";
    const parts = raw.split(/\s+-\s+/);
    if (parts.length >= 2) return parts[1].replace(/,\s*\d{4}.*$/, "").trim();
    return raw;
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
    const normalized = N.normalize(text);
    if (!normalized) return null;
    return recordInShard(shardKey(normalized), normalized, abbreviationKey(normalized));
  }

  function matchRecord(text) {
    const normalized = N.normalize(text);
    if (!normalized) return null;
    const exact = exactRecord(normalized);
    if (exact) return exact;
    const words = normalized.split(" ");
    for (let size = Math.min(state.maxAliasWords, words.length); size >= 1; size -= 1) {
      for (let start = 0; start <= words.length - size; start += 1) {
        const phrase = words.slice(start, start + size).join(" ");
        const record = recordInShard(
          shardKey(phrase),
          phrase,
          size >= 2 ? abbreviationKey(phrase) : ""
        );
        if (record) return record;
      }
    }
    return null;
  }

  function primaryShardForText(text) {
    const normalized = N.normalize(text);
    return normalized ? shardKey(normalized) : "";
  }

  function secondaryShardsForText(text) {
    const normalized = N.normalize(text);
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
        const publisherRow = details.rows.find((row) => row.label === "发行商");
        if (publisherRow && publisher) publisherRow.value = publisher;
        const directionRow = details.rows.find((row) => row.label === "主要方向");
        const directions = researchDirections(details.record, metadata.subjects);
        if (directionRow && directions) directionRow.value = directions;
        const sourceRow = details.rows.find((row) => row.label === "信息来源");
        if (sourceRow) sourceRow.value = response.cached ? "本地目录 + Crossref 缓存" : "本地目录 + Crossref";
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
      if (row?.value || row?.value === 0) lines.push(row.label + "：" + row.value);
    }
    if (details.note) lines.push(details.note);
    return lines.join("\n");
  }

  function control(className, kind, label, title, rows, note, options = {}) {
    const element = document.createElement("span");
    element.className = className;
    if (kind) element.dataset.kind = kind;
    element.textContent = label;
    const details = { title, rows, note, ...options };
    const tooltipText = plainTooltipText(details);
    element.dataset.tooltip = tooltipText;
    element.setAttribute("aria-label", label + "。" + tooltipText.replace(/\n/g, "。"));
    element.addEventListener("mouseenter", () => showTooltip(element, details));
    element.addEventListener("mouseleave", () => hideTooltip());
    return element;
  }
  function badge(kind, label, title, rows, note) {
    return control("rank-assistant-badge", kind, label, title, rows, note);
  }

  function recordType(record) {
    if (record?.[2]?.includes("会议")) return "会议";
    if (record?.[2]?.includes("刊物")) return "期刊";
    if (record?.[4] || record?.[8] || record?.[12]) return "期刊";
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
      ...(Array.isArray(remoteSubjects) ? remoteSubjects : [])
    ].map((value) => String(value || "").trim()).filter(Boolean))].join("；");
  }

  function venueRows(record) {
    return [
      { label: "规范名称", value: record[0] },
      { label: "类型", value: recordType(record) },
      { label: "发行商", value: record[16] || (recordType(record) === "期刊" ? "查询中…" : "无") },
      { label: "主要方向", value: researchDirections(record) || "暂无分类信息" },
      { label: "ISSN", value: Array.isArray(record[13]) ? record[13].join(", ") : record[13] },
      { label: "信息来源", value: record[16] ? "本地目录" : "本地目录 + Crossref" }
    ];
  }

  function renderBadges(record) {
    const row = document.createElement("span");
    row.className = "rank-assistant-row";
    row.dataset.paperRank = "1";
    const s = state.settings;

    if (s.showCcf) {
      if (record?.[1]) {
        row.appendChild(badge(
          "ccf",
          "CCF " + record[1],
          "CCF 推荐目录",
          ccfRows(record),
          "本地 CCF 2026 数据。"
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
        "中科院期刊分区表由中国科学院文献情报中心科学计量中心研制。大类分区按 13 个较宽领域划分为 1–4 区，1 区层级最高，Top 是额外标记。本页显示大类分区；它与按较细 WoS 学科计算的 JCR Q1–Q4 不是同一体系。分区属于定量参考，不宜单独用于个人评价。"
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
        "JCR 分区按学科类别计算，同一本期刊在不同学科可能有不同分区。本插件显示最佳分区。"
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

  function attachTitleRow(container, row) {
    const title = titleNode(container);
    if (!title) {
      metadataNode(container).prepend(row);
      return;
    }
    if (isDblp()) title.insertAdjacentElement("afterend", row);
    else title.appendChild(row);
  }

  function attachVenueDetails(container, details) {
    const venue = venueNode(container);
    if (!venue) return;
    if (isDblp()) venue.insertAdjacentElement("afterend", details);
    else venue.appendChild(details);
  }

  function renderContainer(container, record) {
    container.dataset.paperRankProcessed = "1";
    delete container.dataset.paperRankLoading;
    const row = renderBadges(record);
    if (row) attachTitleRow(container, row);
    if (record) attachVenueDetails(container, renderVenueDetails(record));
  }

  async function scan() {
    const containers = [...resultContainers()].filter(
      (container) => container.dataset.paperRankProcessed !== "1" && container.dataset.paperRankLoading !== "1"
    );
    if (!containers.length) return;
    const items = containers.map((container) => {
      container.dataset.paperRankLoading = "1";
      return { container, text: candidateText(container), record: null };
    });

    try {
      await ensureShards(items.map((item) => primaryShardForText(item.text)));
      const unresolved = [];
      for (const item of items) {
        item.record = exactRecord(item.text);
        if (!item.record) unresolved.push(item);
      }
      if (unresolved.length) {
        await ensureShards(unresolved.flatMap((item) => secondaryShardsForText(item.text)));
        for (const item of unresolved) item.record = matchRecord(item.text);
      }
      for (const item of items) renderContainer(item.container, item.record);
    } catch (error) {
      for (const item of items) delete item.container.dataset.paperRankLoading;
      throw error;
    }
  }

  function mutationContainsResults(records) {
    const selector = isDblp() ? "li.entry, article.entry" : ".gs_r.gs_or.gs_scl, .gs_r";
    for (const record of records) {
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
      if (!mutationContainsResults(records)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle().then(scan).catch((error) => console.error("[期刊会议等级与分区助手]", error));
      }, 80);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        setStatus("loading-data");
        await idle();
        await scan();
        watchDynamicResults();
        setStatus("ready", state.shards.size + " data shards");
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

  function renderApiFallback(hits) {
    let section = document.querySelector("#completesearch-publs");
    if (!section) {
      section = document.createElement("section");
      section.id = "completesearch-publs";
      section.className = "section rank-assistant-api-section";
      section.innerHTML = '<header><h2>Publication search results</h2></header><div class="body"></div>';
      (document.querySelector("main") || document.body).appendChild(section);
    }
    const body = section.querySelector(".body") || section;
    body.querySelectorAll("ul.error, ul.waiting").forEach((node) => node.remove());
    body.querySelector(".rank-assistant-fallback-list")?.remove();

    const notice = document.createElement("p");
    notice.className = "rank-assistant-fallback-notice";
    notice.textContent = "DBLP 页面列表服务暂时不可用，以下结果由 DBLP 官方 JSON API 恢复。";
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

  async function recoverDblpResults() {
    if (!isDblp() || resultContainers().length || !location.pathname.startsWith("/search")) return false;
    const section = document.querySelector("#completesearch-publs");
    const pageText = (section || document.body).textContent || "";
    if (!/service temporarily not available|temporarily not available|no server is available/i.test(pageText)) return false;
    const query = new URLSearchParams(location.search).get("q");
    if (!query) return false;
    try {
      setStatus("recovering-results", "DBLP JSON API");
      const url = new URL("/search/publ/api", location.origin);
      url.searchParams.set("q", query);
      url.searchParams.set("h", "30");
      url.searchParams.set("c", "0");
      url.searchParams.set("format", "json");
      const response = await fetch(url.href, { credentials: "omit" });
      if (!response.ok) throw new Error("DBLP API HTTP " + response.status);
      const payload = await response.json();
      const value = payload?.result?.hits?.hit || [];
      const hits = Array.isArray(value) ? value : value ? [value] : [];
      if (!hits.length) throw new Error("DBLP API returned no publications");
      renderApiFallback(hits);
      return true;
    } catch (error) {
      setStatus("api-unavailable", String(error?.message || error));
      console.warn("[期刊会议等级与分区助手] DBLP fallback failed", error);
      return false;
    }
  }

  function waitForFirstResult() {
    if (resultContainers().length) {
      initialize();
      return;
    }
    setStatus("sleeping", "no publication results");
    const observer = new MutationObserver(() => {
      if (!resultContainers().length) return;
      observer.disconnect();
      initialize();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(recoverDblpResults, 1200);
  }

  try {
    state.settings = await getSettings();
    syncColorTheme();
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
