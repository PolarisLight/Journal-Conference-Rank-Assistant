const copies = {
  zh: {
    title: "期刊会议等级与分区助手",
    description: "在 Google Scholar、DBLP、Semantic Scholar、arXiv、OpenAlex、PubMed、知网和万方的论文标题旁显示 CCF、中科院、新锐、JCR、SSCI、CSSCI、北大核心、EI 和当前预警，并按索引与等级筛选论文。",
  },
  en: {
    title: "Journal & Conference Rank Assistant",
    description: "See rankings and indexing beside paper titles on Google Scholar, DBLP, Semantic Scholar, arXiv, OpenAlex, PubMed, CNKI, and Wanfang Data.",
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
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === lang));
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
