const copies = {
  zh: {
    title: "期刊会议等级与分区助手",
    description: "在 Google Scholar 和 DBLP 检索结果旁显示 CCF、中科院、JCR、SCI/WoS、影响因子与期刊会议信息。",
    copied: "已复制扩展 ID。",
    copyFailed: "复制失败，请手动选择文本。",
  },
  en: {
    title: "Journal & Conference Rank Assistant",
    description: "See CCF, CAS, JCR, Web of Science, impact-factor, and venue information beside Google Scholar and DBLP results.",
    copied: "Extension ID copied.",
    copyFailed: "Copy failed. Please select the text manually.",
  },
};

function applyLanguage(language) {
  const lang = language === "en" ? "en" : "zh";
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.title = copies[lang].title;
  document.querySelector('meta[name="description"]').content = copies[lang].description;

  document.querySelectorAll("[data-zh][data-en]").forEach((element) => {
    element.textContent = element.dataset[lang];
  });
  document.querySelectorAll("[data-alt-zh][data-alt-en]").forEach((element) => {
    element.alt = element.dataset[`alt${lang === "en" ? "En" : "Zh"}`];
  });
  document.querySelectorAll("[data-aria-zh][data-aria-en]").forEach((element) => {
    element.setAttribute("aria-label", element.dataset[`aria${lang === "en" ? "En" : "Zh"}`]);
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === lang));
  });
  document.querySelector(".copy-status").textContent = "";
  try {
    localStorage.setItem("jcra-language", lang);
  } catch {
    // The page remains fully usable when storage is unavailable.
  }
}

let savedLanguage = null;
try {
  savedLanguage = localStorage.getItem("jcra-language");
} catch {
  savedLanguage = null;
}
const initialLanguage = savedLanguage || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
applyLanguage(initialLanguage);

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.language));
});

document.querySelector("[data-copy-id]").addEventListener("click", async () => {
  const status = document.querySelector(".copy-status");
  const language = document.documentElement.dataset.lang;
  const extensionId = "journal-conference-rank-assistant@polarislight.github.io";
  try {
    await navigator.clipboard.writeText(extensionId);
    status.textContent = copies[language].copied;
  } catch {
    status.textContent = copies[language].copyFailed;
  }
});
