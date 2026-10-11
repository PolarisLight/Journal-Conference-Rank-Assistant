(async function () {
  "use strict";
  const API = globalThis.RankAssistantCustomIndexes;
  const I18N = globalThis.RankAssistantI18n;
  const EN = Object.freeze({
    "管理自定义索引": "Manage custom indexes",
    "导入自己的期刊和会议名单，在支持的论文页面显示标签并参与筛选。": "Import your journal and conference lists to label and filter papers on supported sites.",
    "下载 CSV 模板": "Download CSV template", "导入索引": "Import index", "CSV 文件仅在本机读取和保存。": "CSV files are read and saved on this device only.",
    "选择 CSV 文件": "Choose CSV file", "模板列：名称、等级、ISSN、别名。名称必填；等级留空显示“收录”。多个 ISSN 或别名用分号分隔。": "Columns: name, level, ISSN, aliases. Name is required. A blank level means Included. Separate multiple ISSNs or aliases with semicolons.",
    "模板中的等级仅作填写示例，请按自己的目录修改。": "Template levels are examples only. Replace them with levels from your own index.",
    "索引名称": "Index name", "预览前 10 行": "Preview of the first 10 rows", "取消": "Cancel",
    "每次导入创建独立索引，同名索引可以共存。": "Each import creates a separate index. Duplicate names are allowed.",
    "我的索引": "My indexes", "索引已删除。": "Index deleted.", "撤销删除": "Undo deletion",
    "自定义索引独立于官方评级，更新官方数据库会保留你的索引。": "Custom indexes are separate from official rankings and are retained when the official database is updated.",
    "个索引": "indexes", "条目": "entries",
    "还没有自定义索引。下载模板，填写后导入即可。": "No custom indexes yet. Download and complete a template to get started.",
    "更新于": "Updated", "启用索引": "Enable index", "启用": "Enabled", "导出 CSV": "Export CSV", "删除": "Delete",
    "索引已不存在": "This index no longer exists", "其余提示数量": "Additional messages", "文件数据行": "File rows", "可导入条目": "Entries to import",
    "合并重复行": "Merged duplicate rows", "请先修正以下错误": "Fix these errors before importing", "导入提示": "Import notes",
    "请选择 CSV 文件": "Choose a CSV file",
    "索引已保存，已打开的论文页面会自动更新。": "Index saved. Open paper pages will update automatically.",
    "索引已存在，无法撤销删除": "This index already exists. Its deletion cannot be undone.", "已撤销删除": "Deletion undone",
    "索引数量已达上限，请删除部分索引后再导入。": "The index limit has been reached. Delete an index before importing another.",
    "索引数量已达上限，请删除部分索引后再撤销。": "The index limit has been reached. Delete an index before undoing this deletion.",
    "当前环境不支持安全保存自定义索引，未写入数据。": "This environment cannot safely save custom indexes. No data was written.",
    "检测到电子表格公式前缀，请修正后再导出。": "A spreadsheet formula prefix was detected. Correct the entries before exporting."
  });
  const $ = id => document.getElementById(id);
  let language = "zh-CN", indexes = [], table = null, previewResult = null, deleted = null, parsing = 0, saving = false;
  let previewTimer = null, validationPending = false;
  let mutationQueue = Promise.resolve();
  const tr = text => language === "en" && EN[text] ? EN[text] : I18N.exact(text, language);
  const originalTexts = new WeakMap();
  function localizePage() {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("[data-i18n-fixed], script, style")) continue;
      if (!originalTexts.has(node)) originalTexts.set(node, node.nodeValue);
      const original = originalTexts.get(node), trimmed = original.trim();
      if (trimmed) node.nodeValue = original.replace(trimmed, tr(trimmed));
    }
    document.documentElement.lang = language;
  }

  function status(text, kind = "success") {
    $("status").textContent = text;
    $("status").dataset.kind = kind;
    $("status").hidden = !text;
  }
  function getStored() {
    return new Promise((resolve, reject) => chrome.storage.local.get({ customIndexes: [], language: "zh-CN" }, values => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(values);
    }));
  }
  function setStored(values) {
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }
  function mutate(change) {
    const task = mutationQueue.then(async () => {
      if (typeof navigator.locks?.request !== "function") throw new Error(tr("当前环境不支持安全保存自定义索引，未写入数据。"));
      return navigator.locks.request("paper-rank-custom-indexes", async () => {
        const stored = await getStored();
        const next = change(API.normalizeIndexes(stored.customIndexes));
        await setStored({ customIndexes: next });
        indexes = API.normalizeIndexes(next);
        renderIndexes();
        return next;
      });
    });
    mutationQueue = task.catch(() => {});
    return task;
  }
  function errorText(error) { return String(error?.message || error); }
  function csvCell(value) {
    const text = String(value ?? "");
    // Reject unsafe cells rather than modifying user data during a round trip.
    if (/^[\t\r]/.test(text) || /^[\s\u0000-\u001f]*[=+@-]/.test(text)) throw new Error(tr("检测到电子表格公式前缀，请修正后再导出。"));
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(rows) { return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n"; }
  function download(name, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function filename(name) { return (String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "custom-index") + ".csv"; }
  function exportIndex(index) {
    download(filename(index.name), csv([["名称", "等级", "ISSN", "别名"], ...index.entries.map(entry => [entry.title, entry.level, entry.issns.join(";"), entry.aliases.join(";")])]));
  }
  function renderIndexes() {
    const list = $("indexList");
    list.replaceChildren();
    $("indexCount").textContent = `${indexes.length} ${tr("个索引")} · ${indexes.reduce((sum, index) => sum + index.entries.length, 0)} ${tr("条目")}`;
    if (!indexes.length) {
      const empty = document.createElement("p"); empty.className = "empty muted";
      empty.textContent = tr("还没有自定义索引。下载模板，填写后导入即可。"); list.append(empty);
    }
    for (const index of indexes) {
      const row = document.createElement("article"); row.className = "index-row"; row.dataset.indexId = index.id;
      const info = document.createElement("div"); info.className = "index-info";
      const heading = document.createElement("h3"); heading.textContent = index.name; heading.dataset.i18nFixed = "";
      const detail = document.createElement("p"); detail.className = "muted";
      const updated = new Date(index.updatedAt);
      detail.textContent = `${index.entries.length} ${tr("条目")}${Number.isNaN(updated.getTime()) ? "" : " · " + tr("更新于") + " " + updated.toLocaleString(I18N.locale(language), { hour12: false })}`;
      info.append(heading, detail);
      const actions = document.createElement("div"); actions.className = "index-actions";
      const label = document.createElement("label"); label.className = "enabled-label";
      const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = index.enabled !== false;
      enabled.setAttribute("aria-label", `${tr("启用索引")} ${index.name}`);
      enabled.addEventListener("change", async () => {
        const value = enabled.checked;
        enabled.disabled = true;
        try { await mutate(current => current.map(item => item.id === index.id ? { ...item, enabled: value } : item)); }
        catch (error) { enabled.checked = !value; enabled.disabled = false; status(errorText(error), "error"); }
      });
      const labelText = document.createElement("span"); labelText.textContent = tr("启用"); label.append(enabled, labelText);
      const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "secondary"; exportButton.textContent = tr("导出 CSV");
      exportButton.addEventListener("click", () => { try { exportIndex(index); } catch (error) { status(errorText(error), "error"); } });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = tr("删除");
      remove.addEventListener("click", async () => {
        let previous;
        remove.disabled = true;
        try {
          await mutate(current => {
            const position = current.findIndex(item => item.id === index.id);
            if (position < 0) throw new Error(tr("索引已不存在"));
            previous = { index: current[position], position };
            return current.filter(item => item.id !== index.id);
          });
          deleted = previous; $("undoNotice").hidden = false; status("");
        } catch (error) { remove.disabled = false; status(errorText(error), "error"); }
      });
      actions.append(label, exportButton, remove); row.append(info, actions); list.append(row);
    }
    updateImportState();
  }
  function diagnostics(kind, title, messages) {
    if (!messages?.length) return;
    const section = document.createElement("section"); section.className = "diagnostic " + kind;
    const heading = document.createElement("strong"); heading.textContent = title;
    const list = document.createElement("ul");
    for (const message of messages.slice(0, 20)) { const item = document.createElement("li"); item.textContent = String(message); list.append(item); }
    if (messages.length > 20) { const item = document.createElement("li"); item.textContent = `${tr("其余提示数量")}：${messages.length - 20}`; list.append(item); }
    section.append(heading, list); $("diagnostics").append(section);
  }
  function updateImportState() {
    const atLimit = indexes.length >= API.LIMITS.maxIndexes;
    $("importIndex").disabled = saving || validationPending || atLimit || !previewResult?.index || Boolean(previewResult.errors?.length) || !previewResult.index.entries.length;
    $("targetHint").textContent = tr(atLimit ? "索引数量已达上限，请删除部分索引后再导入。" : "每次导入创建独立索引，同名索引可以共存。");
  }
  function validatePreview() {
    clearValidationTimer();
    if (!table) return;
    previewResult = API.fromTable(table, { name: $("indexName").value.trim(), ...API.inferColumns(table.headers) });
    $("diagnostics").replaceChildren();
    const stats = previewResult.stats || {};
    $("previewSummary").textContent = `${tr("文件数据行")}：${stats.totalRows ?? table.rows.length} · ${tr("可导入条目")}：${previewResult.index?.entries.length ?? stats.entries ?? 0}${stats.mergedRows ? " · " + tr("合并重复行") + "：" + stats.mergedRows : ""}`;
    diagnostics("error", tr("请先修正以下错误"), previewResult.errors);
    diagnostics("warning", tr("导入提示"), previewResult.warnings);
    updateImportState();
  }
  function clearValidationTimer() {
    clearTimeout(previewTimer); previewTimer = null; validationPending = false;
  }
  function schedulePreviewValidation() {
    clearValidationTimer();
    if (!table) return;
    validationPending = true; updateImportState();
    previewTimer = setTimeout(validatePreview, 200);
  }
  function renderPreview() {
    const headers = table.headers;
    const head = $("previewTable").querySelector("thead"), body = $("previewTable").querySelector("tbody");
    const headingRow = document.createElement("tr");
    headers.forEach(header => { const cell = document.createElement("th"); cell.textContent = String(header); headingRow.append(cell); });
    head.replaceChildren(headingRow); body.replaceChildren();
    for (const values of table.rows.slice(0, 10)) {
      const row = document.createElement("tr");
      values.forEach(value => { const cell = document.createElement("td"); cell.textContent = String(value ?? ""); row.append(cell); }); body.append(row);
    }
    $("preview").hidden = false;
    validatePreview();
  }
  function clearPreview() {
    clearValidationTimer();
    parsing += 1; table = previewResult = null;
    $("csvFile").value = ""; $("preview").hidden = true;
    $("previewTable").querySelector("thead").replaceChildren(); $("previewTable").querySelector("tbody").replaceChildren();
    updateImportState();
  }
  $("downloadTemplate").addEventListener("click", () => download("custom-index-template.csv", csv([
    ["名称", "等级", "ISSN", "别名"], ["Management Science", "示例A", "0025-1909", "管理科学"], ["International Conference on Machine Learning", "示例B", "", "ICML"]
  ])));
  $("csvFile").addEventListener("change", async () => {
    const file = $("csvFile").files?.[0], attempt = ++parsing;
    if (!file) return;
    clearValidationTimer();
    status(""); previewResult = null; table = null; $("preview").hidden = true; updateImportState();
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error(tr("请选择 CSV 文件"));
      const parsed = await API.parseFile(file);
      if (attempt !== parsing) return;
      table = parsed; $("indexName").value = parsed.suggestedName || file.name.replace(/\.csv$/i, "");
      renderPreview();
    } catch (error) { if (attempt === parsing) status(errorText(error), "error"); }
  });
  $("indexName").addEventListener("input", schedulePreviewValidation);
  $("cancelPreview").addEventListener("click", clearPreview);
  $("importIndex").addEventListener("click", async () => {
    if (saving || $("importIndex").disabled) return;
    validatePreview();
    if ($("importIndex").disabled) return;
    const imported = structuredClone(previewResult.index);
    saving = true; updateImportState();
    try {
      await mutate(current => {
        if (current.length >= API.LIMITS.maxIndexes) throw new Error(tr("索引数量已达上限，请删除部分索引后再导入。"));
        if (current.some(item => item.id === imported.id)) imported.id = crypto.randomUUID();
        return [...current, imported];
      });
      clearPreview(); status(tr("索引已保存，已打开的论文页面会自动更新。"));
    } catch (error) { status(errorText(error), "error"); }
    finally { saving = false; updateImportState(); }
  });
  $("undoDelete").addEventListener("click", async () => {
    if (!deleted) return;
    const previous = deleted; $("undoDelete").disabled = true;
    try {
      await mutate(current => {
        if (current.some(index => index.id === previous.index.id)) throw new Error(tr("索引已存在，无法撤销删除"));
        if (current.length >= API.LIMITS.maxIndexes) throw new Error(tr("索引数量已达上限，请删除部分索引后再撤销。"));
        const next = [...current]; next.splice(Math.min(previous.position, next.length), 0, previous.index); return next;
      });
      deleted = null; $("undoNotice").hidden = true; status(tr("已撤销删除"));
    } catch (error) { status(errorText(error), "error"); }
    finally { $("undoDelete").disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.customIndexes) { indexes = API.normalizeIndexes(changes.customIndexes.newValue); renderIndexes(); }
    if (changes.language) applyLanguage(changes.language.newValue);
  });
  async function applyLanguage(value) {
    language = I18N.normalize(value); await I18N.ready(language);
    localizePage(); document.title = tr("管理自定义索引");
    renderIndexes(); if (table) validatePreview();
  }
  try {
    const stored = await getStored(); indexes = API.normalizeIndexes(stored.customIndexes);
    await applyLanguage(stored.language);
  } catch (error) { status(errorText(error), "error"); }
})();
