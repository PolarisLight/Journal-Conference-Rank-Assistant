"use strict";

const I18N = globalThis.RankAssistantI18n;
const SETTINGS = {
  enabled: true, showCcf: true, showCas: true, showJcr: true,
  showIf: true, showWos: true, showTop: true, showCssci: true, showPku: true, showEi: true,
  showXinrui: true, showWarning: true,
  autoCheckUpdates: true, language: "zh-CN", colorTheme: "light", colorPalette: "vivid"
};
let activeLanguage = I18N.DEFAULT_LANGUAGE;
let currentStatus = null;
let currentFeed = [];

function tr(value) {
  return I18N.exact(value, activeLanguage);
}

function localizePopup() {
  I18N.localizeDom(document, activeLanguage);
  document.title = tr("期刊会议等级与分区助手");
}

function syncPalettePreview(value) {
  const preview = document.getElementById("palettePreview");
  if (preview) preview.dataset.palette = ["soft", "vivid", "colorblind"].includes(value) ? value : "vivid";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function formatDate(value) {
  if (!value) return tr("尚未检查");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(I18N.locale(activeLanguage), { hour12: false });
}

function renderDataVersions(info) {
  const fields = {
    cas: "casVersion", jcr: "jcrVersion", ccf: "ccfVersion", cssci: "cssciVersion",
    pkuCore: "pkuVersion", ei: "eiVersion", xinrui: "xinruiVersion", warning: "warningVersion"
  };
  for (const [key, id] of Object.entries(fields)) {
    if (info?.[key]) document.getElementById(id).textContent = info[key];
  }
}

function renderStatus(status) {
  currentStatus = status || currentStatus;
  status = currentStatus;
  const banner = document.getElementById("updateBanner");
  const title = document.getElementById("statusTitle");
  const detail = document.getElementById("statusDetail");
  const last = document.getElementById("lastChecked");
  const state = status?.state || "idle";
  banner.dataset.state = state;
  if (state === "available") {
    title.textContent = tr("发现新的官方数据");
    detail.textContent = [status.latestDate?.slice(0, 10), status.latestMessage].filter(Boolean).join(" · ") || tr("建议获取新版安装包");
  } else if (state === "current") {
    title.textContent = tr("当前数据已是最新基线");
    detail.textContent = tr("官方数据库已是最新版本");
  } else if (state === "error") {
    title.textContent = tr("暂时无法检查更新");
    detail.textContent = status.error || tr("当前本地数据仍可正常使用");
  } else {
    title.textContent = tr("本地数据已就绪");
    detail.textContent = tr("尚未检查官方更新");
  }
  const install = document.getElementById("installUpdates");
  install.disabled = false;
  install.textContent = state === "available" ? tr("下载并替换数据库") : tr("重新同步数据库");
  if (status?.dataVersions) renderDataVersions(status.dataVersions);
  last.textContent = status?.checkedAt
    ? (activeLanguage === "en" ? `Last checked: ${formatDate(status.checkedAt)}` : `上次检查：${formatDate(status.checkedAt)}`)
    : tr("尚未检查");
}

function renderFeed(items = currentFeed) {
  currentFeed = Array.isArray(items) ? items : [];
  const list = document.getElementById("newsList");
  list.replaceChildren();
  for (const item of currentFeed.slice(0, 3)) {
    const article = document.createElement("article");
    article.className = "news-item";
    const heading = document.createElement("strong");
    heading.append(String(activeLanguage === "en" ? (item.titleEn || item.title || "Data update") : (item.title || "数据动态")) + " ");
    const date = document.createElement("span");
    date.className = "news-date";
    date.textContent = item.date || "";
    heading.append(date);
    const summary = document.createElement("p");
    summary.textContent = activeLanguage === "en"
      ? (item.detailEn || item.summaryEn || item.detail || item.summary || "")
      : (item.summary || item.detail || "");
    article.append(heading, summary);
    list.append(article);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = tr("暂无动态");
    list.append(empty);
  }
}

chrome.storage.local.get(SETTINGS, async (settings) => {
  activeLanguage = I18N.normalize(settings.language);
  await I18N.ready(activeLanguage);
  for (const id of Object.keys(SETTINGS)) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.type === "checkbox") element.checked = settings[id];
    else element.value = id === "language" ? activeLanguage : settings[id];
  }
  syncPalettePreview(settings.colorPalette);
  localizePopup();
  renderFeed();
  renderStatus(currentStatus);
});

for (const id of Object.keys(SETTINGS)) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("change", async (event) => {
    let value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (id === "language") value = I18N.normalize(value);
    chrome.storage.local.set({ [id]: value });
    if (id === "colorPalette") syncPalettePreview(value);
    if (id === "language") {
      await I18N.ready(value);
      activeLanguage = value;
      localizePopup();
      renderFeed();
      renderStatus(currentStatus);
    }
  });
}

Promise.all([
  fetch(chrome.runtime.getURL("extension/data/build-info.json")).then((response) => response.json()),
  fetch(chrome.runtime.getURL("extension/data/update-feed.json")).then((response) => response.json())
]).then(([info, feed]) => {
  document.getElementById("recordCount").textContent = Number(info.records || 0).toLocaleString(I18N.locale(activeLanguage));
  renderDataVersions(info);
  renderFeed(Array.isArray(feed) ? feed : feed.news || feed.items || []);
}).catch(() => {
  currentFeed = [];
  const list = document.getElementById("newsList");
  list.replaceChildren();
  const error = document.createElement("p");
  error.className = "muted";
  error.textContent = tr("动态读取失败");
  list.append(error);
});

sendMessage({ type: "rank-assistant-get-update-status" }).then(renderStatus);

document.getElementById("checkUpdates").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = tr("检查中…");
  renderStatus(await sendMessage({ type: "rank-assistant-check-updates" }));
  button.disabled = false;
  button.textContent = tr("立即检查");
});

document.getElementById("installUpdates").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = tr("下载并重建中…");
  const status = await sendMessage({ type: "rank-assistant-install-updates" });
  renderStatus(status);
  if (status?.state === "current" && status?.installedAt) button.textContent = tr("已替换，刷新页面生效");
});

document.getElementById("clearJournalCache").addEventListener("click", (event) => {
  chrome.storage.local.set({ journalMetaCache: {} }, () => {
    event.currentTarget.textContent = tr("已清除");
    setTimeout(() => { event.currentTarget.textContent = tr("清除期刊缓存"); }, 1200);
  });
});
