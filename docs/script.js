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
    description: "在常用学术检索与出版社公开页面的论文标题旁显示期刊会议等级、分区与收录信息，并按索引与等级筛选论文。",
  },
  en: {
    title: "Journal & Conference Rank Assistant",
    description: "See journal and conference rankings beside paper titles across major academic search and publisher pages, with filtering by index and tier.",
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
