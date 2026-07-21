(function (global) {
  "use strict";

  const DEFAULT_LANGUAGE = "zh-CN";
  const SUPPORTED_LANGUAGES = Object.freeze(["zh-CN", "en"]);
  const EN = Object.freeze({
    "期刊会议等级与分区助手": "Journal & Conference Rank Assistant",
    "CCF · 中科院 · 新锐 · JCR · 预警 · 中文核心 · EI": "CCF · CAS · XinRui · JCR · Warning · Chinese Core · EI",
    "启用扩展": "Enable extension",
    "本地数据已就绪": "Local data is ready",
    "尚未检查官方更新": "Official updates have not been checked",
    "显示标签": "Visible badges",
    "中科院分区": "CAS partitions",
    "新锐分区": "XinRui partitions",
    "当前预警": "Current warning",
    "JCR 分区": "JCR quartile",
    "影响因子": "Impact factor",
    "中科院 Top": "CAS Top",
    "北大核心": "PKU Core",
    "界面语言": "Interface language",
    "明确选择中文或 English": "Choose Chinese or English explicitly",
    "浮层颜色": "Panel theme",
    "不受论文网站是否支持深色模式影响": "Independent of the paper website theme",
    "浅色": "Light",
    "深色": "Dark",
    "跟随系统": "Follow system",
    "标签色系": "Badge palette",
    "一次切换整套标签配色": "Switch the complete badge palette",
    "柔和彩": "Soft",
    "鲜明色": "Vivid",
    "色盲友好": "Color-blind friendly",
    "本地数据": "Local data",
    "期刊/会议": "Journals / conferences",
    "中科院": "CAS",
    "未加载": "Not loaded",
    "数据更新": "Data updates",
    "每周检查": "Check weekly",
    "立即检查": "Check now",
    "同步数据库": "Sync database",
    "清除期刊缓存": "Clear journal cache",
    "尚未检查": "Not checked",
    "数据动态": "Data news",
    "正在读取…": "Loading…",
    "鼠标放到标签和“期刊详情”上可查看解释；等级匹配在本地完成，缺失发行商时才按 ISSN 查询 Crossref。": "Hover over badges and venue details for explanations. Ranking matches run locally; missing publishers are queried from Crossref by ISSN.",
    "发现新的官方数据": "New official data is available",
    "建议获取新版安装包": "A newer data package is recommended",
    "当前数据已是最新基线": "Current data matches the latest baseline",
    "官方数据库已是最新版本": "The official database is current",
    "暂时无法检查更新": "Unable to check for updates",
    "当前本地数据仍可正常使用": "The local database remains available",
    "下载并替换数据库": "Download and replace database",
    "重新同步数据库": "Resync database",
    "暂无动态": "No news available",
    "动态读取失败": "Failed to load news",
    "检查中…": "Checking…",
    "下载并重建中…": "Downloading and rebuilding…",
    "已替换，刷新页面生效": "Replaced. Refresh pages to apply",
    "已清除": "Cleared",
    "筛选论文": "Filter papers",
    "论文筛选": "Paper filters",
    "论文筛选": "Paper filters",
    "点击打开，可拖动": "Click to open, drag to move",
    "先选择索引，再选择需要保留的等级或类型。": "Select indexes, then choose the levels or types to keep.",
    "关闭筛选": "Close filters",
    "索引": "Indexes",
    "同一索引内为“或”，不同索引之间为“且”": "Within one index: OR. Between indexes: AND.",
    "清空筛选": "Clear filters",
    "未启用筛选，显示全部论文。": "No filters enabled. Showing all papers.",
    "隐藏当前预警期刊": "Hide currently warned journals",
    "仅按插件所载的 2025 年最新名单隐藏": "Uses only the latest 2025 list bundled with the extension",
    "来源": "Source",
    "扩展": "Extended",
    "期刊": "Journal",
    "会议": "Conference",
    "会议论文集": "Proceedings",
    "其他来源": "Other source",
    "入选": "Included",
    "等级": "Rank",
    "类型": "Type",
    "领域": "Field",
    "年份": "Year",
    "规范名称": "Canonical name",
    "发行商": "Publisher",
    "主要方向": "Primary topics",
    "信息来源": "Information source",
    "查询中…": "Looking up…",
    "无": "None",
    "暂无分类信息": "No topic information",
    "是": "Yes",
    "否": "No",
    "学科": "Subject",
    "大类分区": "Broad-field zone",
    "分区": "Quartile",
    "收录类型": "Index type",
    "版本": "Edition",
    "来源类型": "Source type",
    "数据日期": "Data date",
    "目录": "Catalog",
    "名单年份": "List year",
    "预警原因": "Warning reason",
    "本地目录": "Local catalog",
    "本地目录 + Crossref": "Local catalog + Crossref",
    "本地目录 + Crossref 缓存": "Local catalog + Crossref cache",
    "CCF 推荐目录": "CCF recommended catalog",
    "未匹配 CCF 等级": "No CCF rank matched",
    "中科院 Top 期刊": "CAS Top journal",
    "新锐学术分区": "XinRui academic partitions",
    "Web of Science 收录": "Web of Science indexing",
    "中文社会科学引文索引": "Chinese Social Sciences Citation Index",
    "中文核心期刊要目总览": "A Guide to the Core Journals of China",
    "Ei Compendex 收录来源": "Ei Compendex source",
    "来源详情": "Source details",
    "期刊详情": "Journal details",
    "会议详情": "Conference details",
    "重试": "Retry"
  });

  const catalogs = new Map();
  const catalogPromises = new Map();

  function messageKey(value) {
    const normalized = String(value || "").normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return "ui_" + normalized.slice(0, 100);
  }

  function fallbackCatalog(language) {
    const lang = normalize(language);
    const output = {};
    for (const [source, english] of Object.entries(EN)) {
      output[messageKey(english)] = lang === "en" ? english : source;
    }
    return output;
  }

  async function ready(language) {
    const lang = normalize(language);
    if (catalogs.has(lang)) return catalogs.get(lang);
    if (catalogPromises.has(lang)) return catalogPromises.get(lang);
    const promise = (async () => {
      const localeCode = lang === "en" ? "en" : "zh_CN";
      try {
        const url = global.chrome?.runtime?.getURL
          ? global.chrome.runtime.getURL("_locales/" + localeCode + "/messages.json")
          : "/_locales/" + localeCode + "/messages.json";
        const response = await global.fetch(url);
        if (!response?.ok && typeof response?.ok !== "undefined") throw new Error("HTTP " + response.status);
        const payload = await response.json();
        const catalog = {};
        for (const [key, value] of Object.entries(payload || {})) {
          if (typeof value?.message === "string") catalog[key] = value.message;
        }
        if (!Object.keys(catalog).length) throw new Error("empty locale catalog");
        catalogs.set(lang, catalog);
      } catch (_) {
        catalogs.set(lang, fallbackCatalog(lang));
      }
      return catalogs.get(lang);
    })();
    catalogPromises.set(lang, promise);
    try {
      return await promise;
    } finally {
      catalogPromises.delete(lang);
    }
  }

  function nativeMessage(key, language) {
    const api = global.chrome?.i18n;
    if (!api?.getMessage) return "";
    const uiLanguage = normalize(String(api.getMessage("@@ui_locale") || "").replace("_", "-").split("-")[0] === "en" ? "en" : "zh-CN");
    if (uiLanguage !== normalize(language)) return "";
    return api.getMessage(key) || "";
  }

  function localizedStatic(source, language) {
    const lang = normalize(language);
    const english = EN[source];
    if (!english) return "";
    const key = messageKey(english);
    const value = nativeMessage(key, lang) || catalogs.get(lang)?.[key];
    return value || (lang === "en" ? english : source);
  }

  function normalize(value) {
    return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
  }

  function locale(value) {
    return normalize(value) === "en" ? "en-US" : "zh-CN";
  }

  function exact(value, language) {
    const source = String(value == null ? "" : value);
    const lang = normalize(language);
    if (Object.prototype.hasOwnProperty.call(EN, source)) return localizedStatic(source, lang);
    if (lang !== "en") return source;
    let match = source.match(/^中科院 ([1-4])区( Top)?$/);
    if (match) return `CAS Zone ${match[1]}${match[2] || ""}`;
    match = source.match(/^新锐 ([1-4])区( Top)?$/);
    if (match) return `XinRui Zone ${match[1]}${match[2] || ""}`;
    match = source.match(/^预警 (.+)$/);
    if (match) return `Warning ${match[1]}`;
    match = source.match(/^([1-4])区( Top)?( · .+)?$/);
    if (match) return `Zone ${match[1]}${match[2] || ""}${match[3] || ""}`;
    match = source.match(/^CSSCI (来源|扩展)$/);
    if (match) return `CSSCI ${match[1] === "来源" ? "Source" : "Extended"}`;
    match = source.match(/^CSSCI (来源|扩展)期刊$/);
    if (match) return `CSSCI ${match[1] === "来源" ? "Source" : "Extended"} journal`;
    match = source.match(/^论文筛选，已选 (\d+) 项$/);
    if (match) return `Paper filters, ${match[1]} selected`;
    return source;
  }

  const originals = new WeakMap();
  function localizeDom(root, language) {
    if (!root) return;
    const lang = normalize(language);
    const document = root.ownerDocument || root;
    const start = root.documentElement || root;
    const walker = document.createTreeWalker(start, global.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("[data-i18n-fixed]")) continue;
      if (!originals.has(node)) originals.set(node, node.nodeValue);
      const original = originals.get(node);
      const trimmed = original.trim();
      if (trimmed) node.nodeValue = original.replace(trimmed, exact(trimmed, lang));
    }
    for (const element of root.querySelectorAll?.("[title],[aria-label]") || []) {
      for (const attribute of ["title", "aria-label"]) {
        if (!element.hasAttribute(attribute)) continue;
        const key = attribute === "title" ? "i18nTitle" : "i18nAriaLabel";
        if (!element.dataset[key]) element.dataset[key] = element.getAttribute(attribute);
        element.setAttribute(attribute, exact(element.dataset[key], lang));
      }
    }
    if (root.documentElement) root.documentElement.lang = lang;
  }

  global.RankAssistantI18n = Object.freeze({
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    normalize,
    locale,
    ready,
    exact,
    localizeDom
  });
})(globalThis);
