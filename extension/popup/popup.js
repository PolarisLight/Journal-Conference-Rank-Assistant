"use strict";

const SETTINGS = {
  enabled: true, showCcf: true, showCas: true, showJcr: true,
  showIf: true, showWos: true, showTop: true, autoCheckUpdates: true,
  colorTheme: "light"
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function formatDate(value) {
  if (!value) return "尚未检查";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function renderStatus(status) {
  const banner = document.getElementById("updateBanner");
  const title = document.getElementById("statusTitle");
  const detail = document.getElementById("statusDetail");
  const last = document.getElementById("lastChecked");
  const state = status?.state || "idle";
  banner.dataset.state = state;
  if (state === "available") {
    title.textContent = "发现新的官方数据";
    detail.textContent = [status.latestDate?.slice(0, 10), status.latestMessage].filter(Boolean).join(" · ") || "建议获取新版安装包";
  } else if (state === "current") {
    title.textContent = "当前数据已是最新基线";
    detail.textContent = "官方数据库已是最新版本";
  } else if (state === "error") {
    title.textContent = "暂时无法检查更新";
    detail.textContent = status.error || "当前本地数据仍可正常使用";
  } else {
    title.textContent = "本地数据已就绪";
    detail.textContent = "尚未检查官方更新";
  }
  const install = document.getElementById("installUpdates");
  install.disabled = false;
  install.textContent = state === "available" ? "下载并替换数据库" : "重新同步数据库";
  if (status?.dataVersions) {
    document.getElementById("casVersion").textContent = status.dataVersions.cas || "未加载";
    document.getElementById("jcrVersion").textContent = status.dataVersions.jcr || "未加载";
    document.getElementById("ccfVersion").textContent = status.dataVersions.ccf || "未加载";
  }
  last.textContent = status?.checkedAt ? "上次检查：" + formatDate(status.checkedAt) : "尚未检查";
}

chrome.storage.local.get(SETTINGS, (settings) => {
  for (const id of Object.keys(SETTINGS)) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.type === "checkbox") element.checked = settings[id];
    else element.value = settings[id];
  }
});

for (const id of Object.keys(SETTINGS)) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("change", (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    chrome.storage.local.set({ [id]: value });
  });
}

Promise.all([
  fetch(chrome.runtime.getURL("extension/data/build-info.json")).then((r) => r.json()),
  fetch(chrome.runtime.getURL("extension/data/update-feed.json")).then((r) => r.json())
]).then(([info, feed]) => {
  document.getElementById("recordCount").textContent = Number(info.records || 0).toLocaleString();
  document.getElementById("casVersion").textContent = info.cas || "未加载";
  document.getElementById("jcrVersion").textContent = info.jcr || "未加载";
  document.getElementById("ccfVersion").textContent = info.ccf || "未加载";
  const items = Array.isArray(feed) ? feed : feed.news || feed.items || [];
  const list = document.getElementById("newsList");
  list.replaceChildren();
  for (const item of items.slice(0, 3)) {
    const article = document.createElement("article");
    article.className = "news-item";
    const heading = document.createElement("strong");
    heading.append(String(item.title || "数据动态") + " ");
    const date = document.createElement("span");
    date.className = "news-date";
    date.textContent = item.date || "";
    heading.append(date);
    const summary = document.createElement("p");
    summary.textContent = item.summary || item.detail || "";
    article.append(heading, summary);
    list.append(article);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "暂无动态";
    list.append(empty);
  }
}).catch(() => {
  const list = document.getElementById("newsList");
  list.replaceChildren();
  const error = document.createElement("p");
  error.className = "muted";
  error.textContent = "动态读取失败";
  list.append(error);
});

sendMessage({ type: "rank-assistant-get-update-status" }).then(renderStatus);

document.getElementById("checkUpdates").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "检查中…";
  renderStatus(await sendMessage({ type: "rank-assistant-check-updates" }));
  button.disabled = false;
  button.textContent = "立即检查";
});

document.getElementById("installUpdates").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "下载并重建中…";
  const status = await sendMessage({ type: "rank-assistant-install-updates" });
  renderStatus(status);
  if (status?.state === "current" && status?.installedAt) {
    button.textContent = "已替换，刷新页面生效";
  }
});

document.getElementById("clearJournalCache").addEventListener("click", (event) => {
  chrome.storage.local.set({ journalMetaCache: {} }, () => {
    event.currentTarget.textContent = "已清除";
    setTimeout(() => { event.currentTarget.textContent = "清除期刊缓存"; }, 1200);
  });
});
