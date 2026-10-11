let storeStats = null;

function renderStoreStats() {
  if (!storeStats) return;
  const locale = document.documentElement.dataset.lang === "en" ? "en-US" : "zh-CN";
  document.getElementById("chrome-users").textContent = storeStats.chrome.users_display;
  document.getElementById("firefox-users").textContent = storeStats.firefox.average_daily_users.toLocaleString(locale);
  const updated = document.getElementById("store-stats-updated");
  updated.dateTime = storeStats.collected_at;
  updated.textContent = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai",
  }).format(new Date(storeStats.collected_at)) + " (UTC+8)";
  document.getElementById("store-stats").hidden = false;
}

async function loadStoreStats() {
  try {
    const response = await fetch("store-stats.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Statistics unavailable");
    const data = await response.json();
    if (data.schema_version !== 1 || !Number.isInteger(data.chrome?.users) || data.chrome.users < 0 ||
        typeof data.chrome.users_display !== "string" || !data.chrome.users_display ||
        !Number.isInteger(data.firefox?.average_daily_users) || data.firefox.average_daily_users < 0 ||
        typeof data.collected_at !== "string" || !Number.isFinite(Date.parse(data.collected_at))) {
      throw new Error("Invalid statistics snapshot");
    }
    storeStats = data;
    renderStoreStats();
  } catch {
    // Leave the statistics hidden if the snapshot cannot be loaded or validated.
  }
}

const copies = {
  zh: {
    title: "期刊会议等级与分区助手",
    description: "在论文标题旁查看期刊会议等级、分区与收录信息，支持导入多组自定义索引，并提供 CSV 模板与 AI 整理名单指南。",
    promptCopied: "已复制，可粘贴到 AI 工具中。",
    promptCopyFailed: "复制未完成，请展开提示词手动复制，或下载文本。",
  },
  en: {
    title: "Journal & Conference Rank Assistant",
    description: "See venue rankings beside paper titles, import multiple custom index lists, and prepare CSV files with a template and an AI conversion guide.",
    promptCopied: "Copied. Paste it into your AI tool.",
    promptCopyFailed: "Could not copy. Expand the prompt to copy it manually, or download the text.",
  },
};

function applyLanguage(language) {
  const lang = language === "en" ? "en" : "zh";
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.title = copies[lang].title;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = copies[lang].description;
  }

  document.querySelectorAll("[data-zh][data-en]").forEach((element) => {
    element.textContent = element.dataset[lang];
  });
  document.querySelectorAll("[data-aria-zh][data-aria-en]").forEach((element) => {
    element.setAttribute("aria-label", element.dataset[`aria${lang === "en" ? "En" : "Zh"}`]);
  });
  document.querySelectorAll("[data-alt-zh][data-alt-en]").forEach((element) => {
    element.setAttribute("alt", element.dataset[`alt${lang === "en" ? "En" : "Zh"}`]);
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === lang));
  });
  document.querySelectorAll("[data-language-only]").forEach((element) => {
    element.hidden = element.dataset.languageOnly !== lang;
  });
  const promptDownload = document.getElementById("download-index-prompt");
  if (promptDownload) promptDownload.href = `downloads/custom-index-ai-prompt-${lang}.txt`;
  const promptStatus = document.getElementById("copy-index-status");
  if (promptStatus) promptStatus.textContent = "";

  renderStoreStats();

  try {
    localStorage.setItem("jcra-language", lang);
  } catch {
    // Language switching still works when browser storage is unavailable.
  }
}

let savedLanguage = null;
try {
  savedLanguage = localStorage.getItem("jcra-language");
} catch {
  savedLanguage = null;
}

applyLanguage(savedLanguage || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"));
loadStoreStats();

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.language));
});

document.getElementById("copy-index-prompt")?.addEventListener("click", async () => {
  const lang = document.documentElement.dataset.lang === "en" ? "en" : "zh";
  const prompt = document.getElementById(`index-prompt-${lang}`);
  const status = document.getElementById("copy-index-status");
  try {
    await navigator.clipboard.writeText(prompt.textContent.trim());
    status.textContent = copies[lang].promptCopied;
  } catch {
    status.textContent = copies[lang].promptCopyFailed;
  }
});
