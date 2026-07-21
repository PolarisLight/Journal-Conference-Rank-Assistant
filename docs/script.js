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

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(button.dataset.language));
});
