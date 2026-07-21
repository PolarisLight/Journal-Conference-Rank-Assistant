(async function () {
  "use strict";

  const I18N = globalThis.RankAssistantI18n;

  const OPTIONS = {
    ccf: ["CCF", [["A", "A"], ["B", "B"], ["C", "C"], ["None", "None"]]],
    jcr: ["JCR", [["Q1", "Q1"], ["Q2", "Q2"], ["Q3", "Q3"], ["Q4", "Q4"]]],
    cas: ["中科院", [["1", "1区"], ["2", "2区"], ["3", "3区"], ["4", "4区"], ["Top", "Top"]]],
    xinrui: ["新锐", [["1", "1区"], ["2", "2区"], ["3", "3区"], ["4", "4区"], ["Top", "Top"]]],
    cssci: ["CSSCI", [["source", "来源"], ["extended", "扩展"]]],
    wos: ["WoS", [["SCIE", "SCIE"], ["SSCI", "SSCI"], ["AHCI", "AHCI"], ["ESCI", "ESCI"]]],
    ei: ["EI", [["Journal", "期刊"], ["Proceeding", "会议论文集"], ["Other", "其他来源"]]],
    pku: ["北大核心", [["included", "入选"]]]
  };
  const DEFAULTS = { enabled: true, language: "zh-CN", colorTheme: "light", resultFilters: { indexes: [], values: {} }, hideWarnedJournals: false, filterButtonPosition: null, filterGuideSeen: false };
  const SIZE = 52;
  const GAP = 14;
  const darkMode = matchMedia("(prefers-color-scheme: dark)");
  let settings = { ...DEFAULTS };
  let host, button, panel, indexesElement, valuesElement, warningElement, countElement, guideElement, drag;
  let suppressClick = false;

  function tr(value) {
    return I18N.exact(value, settings.language);
  }

  function normalize(value) {
    const indexes = Array.isArray(value?.indexes) ? [...new Set(value.indexes.filter((key) => OPTIONS[key]))] : [];
    const values = {};
    for (const key of indexes) {
      const valid = new Set(OPTIONS[key][1].map(([id]) => id));
      values[key] = Array.isArray(value?.values?.[key]) ? value.values[key].filter((id) => valid.has(id)) : [];
    }
    return { indexes, values };
  }

  function save(values) {
    Object.assign(settings, values);
    chrome.storage.local.set(values);
  }

  function dismissGuide() {
    if (!settings.filterGuideSeen) save({ filterGuideSeen: true });
    if (guideElement) guideElement.hidden = true;
  }

  function theme() {
    return settings.colorTheme === "system" ? (darkMode.matches ? "dark" : "light") : (settings.colorTheme || "light");
  }

  function syncTheme() {
    if (host) host.dataset.theme = theme();
  }

  function makeCheckbox(labelText, checked, change) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => change(input.checked));
    const mark = document.createElement("span");
    mark.className = "mark";
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, mark, text);
    return label;
  }

  function render() {
    if (!host) return;
    const filters = normalize(settings.resultFilters);
    settings.resultFilters = filters;
    indexesElement.replaceChildren();
    valuesElement.replaceChildren();

    for (const [key, [label]] of Object.entries(OPTIONS)) {
      indexesElement.append(makeCheckbox(tr(label), filters.indexes.includes(key), (checked) => {
        const next = normalize(settings.resultFilters);
        if (checked && !next.indexes.includes(key)) next.indexes.push(key);
        if (!checked) next.indexes = next.indexes.filter((item) => item !== key);
        next.values[key] ||= [];
        save({ resultFilters: next });
        render();
      }));
    }

    if (!filters.indexes.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = tr("未启用筛选，显示全部论文。");
      valuesElement.append(empty);
    }
    for (const key of filters.indexes) {
      const [label, options] = OPTIONS[key];
      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = tr(label);
      fieldset.append(legend);
      const choices = document.createElement("div");
      choices.className = "choices";
      for (const [id, optionLabel] of options) {
        choices.append(makeCheckbox(tr(optionLabel), filters.values[key].includes(id), (checked) => {
          const next = normalize(settings.resultFilters);
          const selected = new Set(next.values[key]);
          checked ? selected.add(id) : selected.delete(id);
          next.values[key] = [...selected];
          save({ resultFilters: next });
          render();
        }));
      }
      fieldset.append(choices);
      valuesElement.append(fieldset);
    }

    const warningChoice = makeCheckbox(tr("隐藏当前预警期刊"), Boolean(settings.hideWarnedJournals), (checked) => {
      save({ hideWarnedJournals: checked });
      render();
    });
    const warningHelp = document.createElement("small");
    warningHelp.textContent = tr("仅按插件所载的 2025 年最新名单隐藏");
    warningElement.replaceChildren(warningChoice, warningHelp);

    const count = filters.indexes.reduce((sum, key) => sum + filters.values[key].length, 0) + (settings.hideWarnedJournals ? 1 : 0);
    countElement.textContent = count ? String(count) : "";
    countElement.hidden = !count;
    button.classList.toggle("active", Boolean(count));
    button.setAttribute("aria-label", count ? tr(`论文筛选，已选 ${count} 项`) : tr("论文筛选"));
    guideElement.hidden = Boolean(settings.filterGuideSeen);
    I18N.localizeDom(host.shadowRoot, settings.language);
  }

  function viewport() {
    return {
      width: document.documentElement.clientWidth || innerWidth || 1024,
      height: document.documentElement.clientHeight || innerHeight || 768
    };
  }

  function clamp(position) {
    const view = viewport();
    return {
      x: Math.round(Math.max(GAP, Math.min(Number(position?.x) || GAP, view.width - SIZE - GAP))),
      y: Math.round(Math.max(GAP, Math.min(Number(position?.y) || GAP, view.height - SIZE - GAP)))
    };
  }

  function applyPosition() {
    if (!button) return;
    const position = settings.filterButtonPosition;
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
      const next = clamp(position);
      Object.assign(button.style, { left: `${next.x}px`, top: `${next.y}px`, right: "auto", bottom: "auto" });
    } else {
      const view = viewport();
      const initial = clamp({ x: view.width - SIZE - 24, y: Math.round(view.height * 0.34 - SIZE / 2) });
      Object.assign(button.style, { left: `${initial.x}px`, top: `${initial.y}px`, right: "auto", bottom: "auto" });
    }
  }

  function positionPanel() {
    if (!panel || panel.hidden) return;
    const view = viewport();
    const anchor = button.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const width = box.width || Math.min(340, view.width - 24);
    const height = box.height || Math.min(520, view.height - 24);
    let left = Math.max(12, Math.min(anchor.right - width, view.width - width - 12));
    let top = anchor.top - height - 10;
    if (top < 12) top = anchor.bottom + 10;
    top = Math.max(12, Math.min(top, view.height - height - 12));
    Object.assign(panel.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  function openPanel(open) {
    if (!panel) return;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) requestAnimationFrame(positionPanel);
  }

  function pointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    button.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag || (drag.id !== undefined && event.pointerId !== undefined && drag.id !== event.pointerId)) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      dismissGuide();
      button.classList.add("dragging");
      openPanel(false);
    }
    event.preventDefault();
    const next = clamp({ x: drag.left + dx, y: drag.top + dy });
    Object.assign(button.style, { left: `${next.x}px`, top: `${next.y}px`, right: "auto", bottom: "auto" });
  }

  function pointerUp(event) {
    if (!drag || (drag.id !== undefined && event.pointerId !== undefined && drag.id !== event.pointerId)) return;
    button.releasePointerCapture?.(event.pointerId);
    if (drag.moved) {
      const rect = button.getBoundingClientRect();
      suppressClick = true;
      save({ filterButtonPosition: clamp({ x: rect.left, y: rect.top }) });
    }
    button.classList.remove("dragging");
    drag = null;
  }

  function build() {
    if (host || !settings.enabled) return;
    host = document.createElement("div");
    host.id = "rank-assistant-filter-host";
    for (const [name, value] of Object.entries({ all: "initial", position: "fixed", inset: "0", zIndex: "2147483647", isolation: "isolate", pointerEvents: "none" })) {
      host.style.setProperty(name.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase()), value, "important");
    }
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;isolation:isolate!important;pointer-events:none!important;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif!important}*{box-sizing:border-box}button,input{font:inherit}
      #launcher{position:fixed;z-index:3;width:${SIZE}px;height:${SIZE}px;padding:0;border:3px solid rgba(255,255,255,.92);border-radius:50%;color:#f8fafc;background:#172033;box-shadow:0 0 0 1px rgba(23,32,51,.26),0 9px 24px rgba(23,42,73,.28);font-size:15px;font-weight:780;letter-spacing:.04em;cursor:grab;pointer-events:auto;touch-action:none;user-select:none;transition:background-color 140ms,border-color 140ms,box-shadow 140ms,transform 140ms}
      #launcher:before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,255,255,.22);border-radius:inherit;pointer-events:none}#glyph{position:relative;z-index:1}
      #launcher:hover{background:#23436f;box-shadow:0 0 0 1px rgba(23,32,51,.32),0 11px 28px rgba(23,42,73,.34);transform:translateY(-1px)}#launcher:active{transform:scale(.97)}#launcher:focus-visible{outline:3px solid rgba(23,92,211,.3);outline-offset:3px}#launcher.active{color:#fff;background:#175cd3}#launcher.dragging{cursor:grabbing;transform:none;transition:none}
      #count{position:absolute;top:-6px;right:-6px;z-index:2;min-width:20px;height:20px;padding:0 5px;border:2px solid #fff;border-radius:10px;color:#fff;background:#d92d20;font-size:10px;line-height:16px;text-align:center}
      #guide{position:absolute;right:calc(100% + 11px);top:50%;width:max-content;padding:8px 10px;border:1px solid #d8dee8;border-radius:10px;color:#344054;background:#fff;box-shadow:0 8px 22px rgba(23,42,73,.16);text-align:left;transform:translateY(-50%);pointer-events:none}#guide[hidden]{display:none}#guide strong{display:block;font-size:12px;line-height:1.2;white-space:nowrap}#guide small{display:block;margin-top:3px;color:#667085;font-size:10px;font-weight:550;line-height:1.2;white-space:nowrap}
      #panel{position:fixed;z-index:2;width:min(340px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 24px));border:1px solid #d8dee8;border-radius:14px;color:#17202a;background:#fff;box-shadow:0 18px 52px rgba(15,23,42,.24);overflow:hidden;pointer-events:auto;color-scheme:light}#panel[hidden]{display:none}
      .head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px;border-bottom:1px solid #e7ebf0}h2{margin:0;color:inherit;font-size:15px;line-height:1.25}.head p{margin:4px 0 0;color:#667085;font-size:11px;line-height:1.45}
      #close{flex:none;width:30px;height:30px;padding:0;border:0;border-radius:8px;color:#667085;background:transparent;font-size:20px;line-height:1;cursor:pointer}#close:hover{color:#17202a;background:#f2f4f7}
      .body{max-height:calc(min(560px,100vh - 24px) - 116px);padding:13px 16px 15px;overflow:auto}.label{margin:0 0 8px;color:#475467;font-size:11px;font-weight:700}#indexes,.choices{display:flex;flex-wrap:wrap;gap:7px 12px}#values{margin-top:13px}
      fieldset{margin:9px 0 0;padding:9px 10px 10px;border:1px solid #e3e8ef;border-radius:9px}legend{padding:0 5px;color:#475467;font-size:11px;font-weight:700}.choice{display:inline-flex;align-items:center;gap:6px;min-height:22px;color:#344054;font-size:12px;cursor:pointer}.choice input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.mark{position:relative;width:15px;height:15px;border:1px solid #98a2b3;border-radius:4px;background:#fff}.choice input:checked+.mark{border-color:#175cd3;background:#175cd3}.choice input:checked+.mark:after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}.choice input:focus-visible+.mark{outline:3px solid rgba(23,92,211,.22);outline-offset:2px}
      .empty{margin:0;padding:11px 12px;border-radius:8px;color:#667085;background:#f6f8fa;font-size:12px}.exclude{margin-top:13px;padding:10px 11px;border:1px solid #f1b9b5;border-radius:9px;background:#fff7f6}.exclude .choice{font-weight:700}.exclude small{display:block;margin:3px 0 0 21px;color:#8f3b35;font-size:10px;line-height:1.35}.foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px;padding-top:12px;border-top:1px solid #e7ebf0}.logic{margin:0;color:#667085;font-size:10px}#clear{padding:5px 7px;border:0;border-radius:6px;color:#175cd3;background:transparent;font-size:11px;font-weight:650;cursor:pointer}#clear:hover{background:#eef4ff}
      :host([data-theme=dark]) #launcher{color:#f2f4f7;border-color:#344054;background:#111827;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 10px 28px rgba(0,0,0,.48)}:host([data-theme=dark]) #launcher:hover{background:#1d3b66}:host([data-theme=dark]) #launcher.active{color:#fff;border-color:#528bff;background:#175cd3}:host([data-theme=dark]) #count{border-color:#101828}:host([data-theme=dark]) #guide{color:#e4e7ec;border-color:#475467;background:#1d2939;box-shadow:0 10px 28px rgba(0,0,0,.42)}:host([data-theme=dark]) #guide small{color:#98a2b3}:host([data-theme=dark]) #panel{color:#f2f4f7;border-color:#475467;background:#101828;box-shadow:0 18px 54px rgba(0,0,0,.58);color-scheme:dark}:host([data-theme=dark]) .head,:host([data-theme=dark]) .foot{border-color:#344054}:host([data-theme=dark]) .head p,:host([data-theme=dark]) .logic,:host([data-theme=dark]) .empty{color:#98a2b3}:host([data-theme=dark]) #close{color:#98a2b3}:host([data-theme=dark]) #close:hover,:host([data-theme=dark]) .empty{color:#e4e7ec;background:#1d2939}:host([data-theme=dark]) .label,:host([data-theme=dark]) legend{color:#d0d5dd}:host([data-theme=dark]) fieldset{border-color:#344054}:host([data-theme=dark]) .exclude{border-color:#7a3d39;background:#2a1718}:host([data-theme=dark]) .exclude small{color:#f0a8a2}:host([data-theme=dark]) .choice{color:#e4e7ec}:host([data-theme=dark]) .mark{border-color:#667085;background:#1d2939}:host([data-theme=dark]) #clear{color:#84adff}:host([data-theme=dark]) #clear:hover{background:#1d2939}
      @media(prefers-reduced-motion:reduce){#launcher{transition:none}}
    `;
    button = document.createElement("button");
    button.id = "launcher";
    button.type = "button";
    const glyph = document.createElement("span");
    glyph.id = "glyph";
    glyph.textContent = I18N.normalize(settings.language) === "en" ? "F" : "筛";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "panel");
    countElement = document.createElement("span");
    countElement.id = "count";
    countElement.hidden = true;
    countElement.setAttribute("aria-hidden", "true");
    guideElement = document.createElement("span");
    guideElement.id = "guide";
    guideElement.setAttribute("aria-hidden", "true");
    guideElement.innerHTML = "<strong>筛选论文</strong><small>点击打开，可拖动</small>";
    button.append(glyph, countElement, guideElement);

    panel = document.createElement("section");
    panel.id = "panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "论文筛选");
    panel.innerHTML = '<div class="head"><div><h2>筛选论文</h2><p>先选择索引，再选择需要保留的等级或类型。</p></div><button id="close" type="button" aria-label="关闭筛选">×</button></div><div class="body"><p class="label">索引</p><div id="indexes"></div><div id="values"></div><div id="warning-filter" class="exclude"></div><div class="foot"><p class="logic">同一索引内为“或”，不同索引之间为“且”</p><button id="clear" type="button">清空筛选</button></div></div>';
    indexesElement = panel.querySelector("#indexes");
    valuesElement = panel.querySelector("#values");
    warningElement = panel.querySelector("#warning-filter");
    panel.querySelector("#close").addEventListener("click", () => openPanel(false));
    panel.querySelector("#clear").addEventListener("click", () => {
      save({ resultFilters: { indexes: [], values: {} }, hideWarnedJournals: false });
      render();
    });
    button.addEventListener("click", () => {
      if (suppressClick) return void (suppressClick = false);
      dismissGuide();
      openPanel(panel.hidden);
    });
    button.addEventListener("pointerdown", pointerDown);
    button.addEventListener("pointermove", pointerMove);
    button.addEventListener("pointerup", pointerUp);
    button.addEventListener("pointercancel", pointerUp);
    shadow.append(style, button, panel);
    document.documentElement.append(host);
    I18N.localizeDom(shadow, settings.language);
    syncTheme();
    applyPosition();
    render();
  }

  function remove() {
    host?.remove();
    host = button = panel = indexesElement = valuesElement = warningElement = countElement = guideElement = null;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(DEFAULTS)) if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    if (changes.enabled) settings.enabled ? buildWhenRelevant() : remove();
    if (changes.language && settings.enabled) {
      settings.language = I18N.normalize(settings.language);
      I18N.ready(settings.language).then(() => {
        remove();
        buildWhenRelevant();
      });
      return;
    }
    if (!host) return;
    if (changes.colorTheme) syncTheme();
    if (changes.resultFilters || changes.hideWarnedJournals || changes.filterGuideSeen) render();
    if (changes.filterButtonPosition) applyPosition();
  });
  document.addEventListener("pointerdown", (event) => {
    if (panel && !panel.hidden && !event.composedPath().includes(host)) openPanel(false);
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel && !panel.hidden) {
      openPanel(false);
      button.focus();
    }
  }, true);
  addEventListener("resize", () => {
    if (settings.filterButtonPosition) applyPosition();
    positionPanel();
  });
  darkMode.addEventListener?.("change", syncTheme);
  darkMode.addListener?.(syncTheme);

  let relevanceObserver = null;
  function buildWhenRelevant() {
    if (!settings.enabled || host) return;
    if (document.documentElement.dataset.paperRankHasResults === "1") {
      relevanceObserver?.disconnect();
      relevanceObserver = null;
      build();
      return;
    }
    if (relevanceObserver) return;
    relevanceObserver = new MutationObserver(() => buildWhenRelevant());
    relevanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-paper-rank-has-results"]
    });
  }

  chrome.storage.local.get(DEFAULTS, async (stored) => {
    settings = { ...DEFAULTS, ...stored, language: I18N.normalize(stored.language), resultFilters: normalize(stored.resultFilters) };
    await I18N.ready(settings.language);
    buildWhenRelevant();
  });
})();
