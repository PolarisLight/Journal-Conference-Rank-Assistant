(function (global) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = "customIndexes";
  const CSV_HEADERS = Object.freeze(["名称", "等级", "ISSN", "别名"]);
  const LIMITS = Object.freeze({
    maxFileBytes: 5 * 1024 * 1024,
    maxIndexes: 30,
    maxEntries: 50000,
    maxColumns: 32,
    maxTitleLength: 512,
    maxNameLength: 80,
    maxLevelLength: 80,
    maxAliases: 50,
    maxIssns: 20
  });

  function text(value) {
    return typeof value === "string" || typeof value === "number"
      ? String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
      : "";
  }

  function unsafeSpreadsheetValue(value) {
    return typeof value === "string" && (/^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r]/.test(value));
  }

  function rawParts(value) {
    return Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[;；]/) : []);
  }

  function nameKey(value) {
    return text(value).replace(/([\p{L}\p{N}])['’]s\b/giu, "$1s")
      .normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/ß/g, "ss").replace(/ς/g, "σ").replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  }

  function incomplete(value) {
    return /\.{3,}|…/.test(text(value).normalize("NFKC"));
  }

  function issnKey(value) {
    const key = text(value).replace(/[-\s]/g, "").toUpperCase();
    return /^\d{7}[\dX]$/.test(key) ? key : "";
  }

  function parts(value) {
    return (Array.isArray(value) ? value.map(text) : text(value).split(/[;；]/))
      .map(text).filter(Boolean);
  }

  function unique(values, key = value => value) {
    const seen = new Set();
    return values.filter(value => {
      const normalized = key(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function entryKeys(entry) {
    return [...[entry.title, ...entry.aliases].map(value => "n:" + nameKey(value)),
      ...entry.issns.map(value => "i:" + value)];
  }

  function levelKey(value) {
    return text(value).normalize("NFKC").toLowerCase();
  }

  function mergeEntries(entries, onConflict = () => {}) {
    const disjointSet = () => {
      const parents = entries.map((_, index) => index);
      const find = index => {
        while (parents[index] !== index) {
          parents[index] = parents[parents[index]];
          index = parents[index];
        }
        return index;
      };
      return { find, join(left, right) { parents[find(right)] = find(left); } };
    };
    const identities = disjointSet();
    const issnOwners = new Map();
    // A shared ISSN establishes identity before names are considered. A row
    // explicitly listing print/electronic ISSNs can connect their variants.
    entries.forEach((entry, index) => {
      for (const issn of entry.issns) {
        const key = levelKey(entry.level) + "\u001f" + issn;
        if (issnOwners.has(key)) identities.join(index, issnOwners.get(key));
        else issnOwners.set(key, index);
      }
    });
    const names = disjointSet();
    const nameOwners = new Map();
    entries.forEach((entry, index) => {
      names.join(index, identities.find(index));
      for (const value of [entry.title, ...entry.aliases]) {
        const key = levelKey(entry.level) + "\u001f" + nameKey(value);
        if (nameOwners.has(key)) names.join(index, nameOwners.get(key));
        else nameOwners.set(key, index);
      }
    });
    const nameGroups = new Map();
    entries.forEach((entry, index) => {
      const root = names.find(index);
      if (!nameGroups.has(root)) nameGroups.set(root, []);
      nameGroups.get(root).push(index);
    });
    for (const members of nameGroups.values()) {
      const identified = new Map();
      for (const index of members) {
        if (entries[index].issns.length) identified.set(identities.find(index), index);
      }
      if (identified.size <= 1) {
        for (const index of members) identities.join(members[0], index);
        continue;
      }
      const [first, second] = [...identified.values()].slice(0, 2);
      onConflict({ first: entries[first], second: entries[second] });
      // Conflicting identified entities stay separate. In particular an
      // ISSN-less row cannot bridge them through a chain of names/aliases.
      // Only duplicate ISSN-less rows may merge within this component.
      const emptyOwners = new Map();
      for (const index of members) {
        if (entries[index].issns.length) continue;
        for (const value of [entries[index].title, ...entries[index].aliases]) {
          const key = nameKey(value);
          if (emptyOwners.has(key)) identities.join(index, emptyOwners.get(key));
          else emptyOwners.set(key, index);
        }
      }
    }
    const groups = new Map();
    entries.forEach((entry, index) => {
      const root = identities.find(index);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(entry);
    });
    return [...groups.values()].map(group => ({
      title: group[0].title,
      level: group[0].level,
      aliases: unique(group.flatMap(entry => [entry.title, ...entry.aliases]), nameKey)
        .filter(alias => nameKey(alias) !== nameKey(group[0].title)),
      issns: unique(group.flatMap(entry => entry.issns))
    }));
  }

  function cleanEntry(value) {
    if (!value || typeof value !== "object") return null;
    if (unsafeSpreadsheetValue(value.title) || unsafeSpreadsheetValue(value.level) || rawParts(value.aliases).some(unsafeSpreadsheetValue)) return null;
    const title = text(value.title);
    const level = text(value.level) || "收录";
    if (!title || !nameKey(title) || incomplete(title) || title.length > LIMITS.maxTitleLength || level.length > LIMITS.maxLevelLength) return null;
    return {
      title, level,
      aliases: unique(parts(value.aliases).filter(alias => alias.length <= LIMITS.maxTitleLength && !incomplete(alias)), nameKey)
        .filter(alias => nameKey(alias) !== nameKey(title)).slice(0, LIMITS.maxAliases),
      issns: unique(parts(value.issns).map(issnKey).filter(Boolean)).slice(0, LIMITS.maxIssns)
    };
  }

  function stableId(value) {
    let hash = 2166136261;
    for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    return "custom-" + hash.toString(36);
  }

  function normalizeIndexes(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    const normalized = [];
    for (const item of value.slice(0, LIMITS.maxIndexes)) {
      if (!item || typeof item !== "object") continue;
      const name = text(item.name).slice(0, LIMITS.maxNameLength);
      if (!name || !Array.isArray(item.entries)) continue;
      const entries = mergeEntries(item.entries.slice(0, LIMITS.maxEntries).map(cleanEntry).filter(Boolean)).map(cleanEntry).filter(Boolean);
      if (!entries.length) continue;
      let id = text(item.id).slice(0, 120) || stableId(name + JSON.stringify(entries));
      const originalId = id;
      for (let suffix = 2; ids.has(id); suffix += 1) id = originalId + "-" + suffix;
      ids.add(id);
      const date = text(item.updatedAt);
      normalized.push({ id, name, enabled: item.enabled !== false,
        updatedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : "", entries });
    }
    return normalized;
  }

  function inferColumns(headers) {
    const keys = (Array.isArray(headers) ? headers : []).map(value => nameKey(value).replace(/\s/g, ""));
    const find = values => keys.findIndex(key => values.includes(key));
    return {
      titleColumn: find(["名称", "期刊名称", "会议名称", "期刊会议名称", "刊名", "会议名", "来源名称", "name", "title", "venue", "journal", "journalname", "conferencename"]),
      levelColumn: find(["等级", "级别", "层级", "分类", "索引等级", "level", "rank", "grade", "tier", "rating"]),
      issnColumn: find(["issn", "issns", "eissn", "pissn", "issn号"]),
      aliasColumn: find(["别名", "简称", "缩写", "其他名称", "其它名称", "alias", "aliases", "abbreviation", "abbreviations"])
    };
  }

  function parseDelimited(input, delimiter) {
    const source = input.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    const pushField = () => { row.push(field); field = ""; closed = false; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"') {
          if (source[index + 1] === '"') { field += '"'; index += 1; }
          else { quoted = false; closed = true; }
        } else field += character;
      } else if (character === delimiter) pushField();
      else if (character === "\r" || character === "\n") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        pushRow();
      } else if (closed) {
        if (!/[ \t]/.test(character)) throw new Error("CSV 引号结束后出现多余字符，请检查第 " + (rows.length + 1) + " 行。");
      } else if (character === '"') {
        if (field.length) throw new Error("CSV 引号必须从单元格开头开始，请检查第 " + (rows.length + 1) + " 行。");
        quoted = true;
      } else field += character;
      if (field.length > LIMITS.maxTitleLength * (LIMITS.maxAliases + 1)) throw new Error("单元格内容过长，请减少别名或拆分文件。");
      if (rows.length > LIMITS.maxEntries + 1) throw new Error("单个索引最多支持 " + LIMITS.maxEntries + " 行。");
    }
    if (quoted) throw new Error("CSV 存在未闭合的引号，请检查最后一个带引号的单元格。");
    if (field.length || row.length || closed) pushRow();
    if (!rows.length) throw new Error("文件为空，请填写名称后重新导入。");
    const headers = rows.shift().map(value => text(value));
    if (!headers.length || headers.length > LIMITS.maxColumns) throw new Error("文件列数超出限制，最多支持 " + LIMITS.maxColumns + " 列。");
    const headerKeys = headers.map(nameKey);
    if (new Set(headerKeys).size !== headerKeys.length) throw new Error("表头存在重复列名，请保留一列名称、等级、ISSN、别名。");
    rows.forEach((values, index) => {
      if (values.length !== headers.length) throw new Error("第 " + (index + 2) + " 行有 " + values.length + " 列，表头有 " + headers.length + " 列；请检查逗号和引号。");
    });
    return { headers, rows };
  }

  function jsonTable(input) {
    let value;
    try { value = JSON.parse(input.replace(/^\uFEFF/, "")); }
    catch (_) { throw new Error("JSON 格式无效，请检查文件或重新导出备份。"); }
    const cell = value => typeof value === "string" ? value : (typeof value === "number" ? String(value) : "");
    if (value && !Array.isArray(value) && Array.isArray(value.headers) && Array.isArray(value.rows)) {
      return { headers: value.headers.map(text), rows: value.rows.map(row => Array.isArray(row) ? row.map(cell) : []), suggestedName: text(value.name) };
    }
    if (value && !Array.isArray(value) && (Array.isArray(value.indexes) || Array.isArray(value.customIndexes))) {
      const indexes = value.indexes || value.customIndexes;
      if (indexes.length !== 1) throw new Error("该 JSON 包含多个索引，请分别导出和导入每个索引。");
      value = indexes[0];
    }
    const entries = Array.isArray(value) ? value : value?.entries;
    if (!Array.isArray(entries)) throw new Error("JSON 需要包含 entries 数组，或直接使用条目数组。");
    return {
      headers: [...CSV_HEADERS],
      rows: entries.map(entry => [cell(entry?.title ?? entry?.name), cell(entry?.level), rawParts(entry?.issns || entry?.issn).map(cell).join(";"), rawParts(entry?.aliases).map(cell).join(";")]),
      suggestedName: text(value?.name)
    };
  }

  async function parseFile(file) {
    if (!file || (typeof file.text !== "function" && typeof file.arrayBuffer !== "function")) throw new Error("请选择 CSV、TSV 或 JSON 文件。");
    if (Number(file.size) > LIMITS.maxFileBytes) throw new Error("文件不能超过 5 MB，请拆分为多个索引文件。");
    let input;
    try {
      if (typeof file.arrayBuffer === "function") input = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      else input = await file.text();
    } catch (_) { throw new Error("文件编码无法识别，请在 Excel 中另存为 CSV UTF-8 后导入。"); }
    if (typeof input !== "string" || input.length > LIMITS.maxFileBytes) throw new Error("文件过大或无法读取，请使用 5 MB 以内的 UTF-8 文件。");
    const filename = text(file.name);
    const extension = filename.split(".").pop().toLowerCase();
    let table;
    if (extension === "json") table = jsonTable(input);
    else if (extension === "csv" || extension === "tsv") table = parseDelimited(input, extension === "tsv" ? "\t" : ",");
    else throw new Error("支持 CSV UTF-8、TSV 和单索引 JSON 备份；请将 Excel 文件另存为 CSV UTF-8。");
    if (table.rows.length > LIMITS.maxEntries) throw new Error("单个索引最多支持 " + LIMITS.maxEntries + " 行。");
    return { ...table, suggestedName: table.suggestedName || filename.replace(/\.[^.]+$/, "").slice(0, LIMITS.maxNameLength) };
  }

  function fromTable(table, options = {}) {
    const headers = Array.isArray(table?.headers) ? table.headers : [];
    const rows = Array.isArray(table) ? table : table?.rows;
    const columns = { ...inferColumns(headers), ...options };
    const name = text(options.name);
    const errors = [], warnings = [];
    const entries = [];
    const stats = { totalRows: Array.isArray(rows) ? rows.length : 0, validRows: 0, mergedRows: 0, entries: 0, blankRows: 0 };
    const fail = message => { if (errors.length < 100) errors.push(message); };
    if (!name) fail("请填写自定义索引名称。");
    else if (name.length > LIMITS.maxNameLength) fail("索引名称最多支持 " + LIMITS.maxNameLength + " 个字符。");
    if (!Array.isArray(rows)) fail("导入内容缺少有效的数据行。");
    if (stats.totalRows > LIMITS.maxEntries) fail("单个索引最多支持 " + LIMITS.maxEntries + " 行。");
    const width = headers.length || rows?.[0]?.length || 0;
    if (!Number.isInteger(columns.titleColumn) || columns.titleColumn < 0 || columns.titleColumn >= width) fail("缺少必需的“名称”列，请使用名称、等级、ISSN、别名表头。");
    for (const field of ["levelColumn", "issnColumn", "aliasColumn"]) {
      if (!Number.isInteger(columns[field]) || columns[field] < -1 || columns[field] >= width) fail("列配置无效：" + field + "。");
    }
    if (errors.length) return { index: null, stats, warnings, errors };
    rows.forEach((row, position) => {
      const line = position + 2;
      if (!Array.isArray(row) || row.length !== width) { fail("第 " + line + " 行列数与表头不一致。"); return; }
      const read = column => column >= 0 ? text(row[column]) : "";
      const unsafeFields = [
        ["名称", columns.titleColumn], ["等级", columns.levelColumn], ["别名", columns.aliasColumn]
      ].filter(([, column]) => column >= 0 && (unsafeSpreadsheetValue(row[column]) ||
        (column === columns.aliasColumn && rawParts(row[column]).some(unsafeSpreadsheetValue))));
      if (unsafeFields.length) {
        fail("第 " + line + " 行“" + unsafeFields.map(([label]) => label).join("、") + "”以公式字符（=、+、@、-）或制表/回车开头；为保证 CSV 在 Excel 中安全且往返不改值，请使用普通文本名称和等级。");
        return;
      }
      const title = read(columns.titleColumn), level = read(columns.levelColumn) || "收录";
      if (!row.some(value => text(value))) stats.blankRows += 1;
      if (!title || !nameKey(title)) { fail("第 " + line + " 行缺少名称，请填写完整的期刊或会议名称。"); return; }
      if (title.length > LIMITS.maxTitleLength || incomplete(title)) { fail("第 " + line + " 行名称过长或含省略号，请填写完整名称。"); return; }
      if (level.length > LIMITS.maxLevelLength) { fail("第 " + line + " 行等级最多支持 " + LIMITS.maxLevelLength + " 个字符。"); return; }
      const aliases = parts(read(columns.aliasColumn));
      if (aliases.length > LIMITS.maxAliases || aliases.some(alias => alias.length > LIMITS.maxTitleLength || incomplete(alias) || !nameKey(alias))) { fail("第 " + line + " 行别名过多、过长或含省略号，请使用分号分隔完整别名。"); return; }
      const rawIssns = parts(read(columns.issnColumn));
      if (rawIssns.length > LIMITS.maxIssns || rawIssns.some(issn => !issnKey(issn))) { fail("第 " + line + " 行 ISSN 格式无效，请填写 1234-567X 格式，多个 ISSN 用分号分隔。"); return; }
      entries.push({ title, level, aliases: unique(aliases, nameKey), issns: unique(rawIssns.map(issnKey)), line });
      stats.validRows += 1;
    });
    const owners = new Map();
    for (const entry of entries) {
      for (const key of entryKeys(entry)) {
        const previous = owners.get(key);
        if (previous && levelKey(previous.level) !== levelKey(entry.level)) {
          fail("第 " + previous.line + " 行与第 " + entry.line + " 行的" + (key.startsWith("i:") ? " ISSN " : "名称或别名“") + key.slice(2) + (key.startsWith("i:") ? "" : "”") + "对应不同等级（" + previous.level + " / " + entry.level + "），请消除冲突。");
        } else if (!previous) owners.set(key, entry);
      }
    }
    const merged = mergeEntries(entries, ({ first, second }) => {
      fail("第 " + first.line + " 行与第 " + second.line + " 行的名称或别名重复或相互关联，但非空 ISSN 集合冲突（" + first.issns.join(";") + " / " + second.issns.join(";") + "），请核对后合并为同一实体或修正名称/别名。");
    });
    for (const entry of merged) {
      if (entry.aliases.length > LIMITS.maxAliases || entry.issns.length > LIMITS.maxIssns) fail("“" + entry.title + "”合并后超过 " + LIMITS.maxAliases + " 个别名或 " + LIMITS.maxIssns + " 个 ISSN，请减少重复条目的补充字段。");
    }
    stats.entries = merged.length;
    stats.mergedRows = stats.validRows - merged.length;
    if (stats.mergedRows) warnings.push("已合并 " + stats.mergedRows + " 行同等级重复条目，并保留名称、别名和 ISSN。");
    if (!entries.length && !errors.length) fail("文件没有可导入的条目，请至少填写一行名称。");
    if (errors.length) return { index: null, stats, warnings, errors };
    const id = text(options.id) || (global.crypto?.randomUUID ? "custom-" + global.crypto.randomUUID() : stableId(name + JSON.stringify(merged) + Date.now()));
    return { index: { id, name, enabled: true, updatedAt: new Date().toISOString(), entries: merged }, stats, warnings, errors };
  }

  function createMatcher(indexes) {
    const compiled = normalizeIndexes(indexes).filter(index => index.enabled).map(index => {
      const keys = new Map();
      for (const [entity, entry] of index.entries.entries()) for (const key of entryKeys(entry)) {
        if (!keys.has(key)) keys.set(key, new Set());
        keys.get(key).add(entity);
      }
      return { index, keys };
    });
    return ({ record = null, sources = [] } = {}) => {
      const keys = new Set();
      const addSource = value => {
        const source = text(value);
        if (!source || source.length > LIMITS.maxTitleLength || incomplete(source)) return;
        const normalized = nameKey(source);
        if (normalized) keys.add("n:" + normalized);
        const issn = issnKey(source);
        if (issn) keys.add("i:" + issn);
      };
      if (Array.isArray(record)) {
        addSource(record[0]);
        for (const issn of Array.isArray(record[13]) ? record[13] : []) {
          const normalized = issnKey(issn);
          if (normalized) keys.add("i:" + normalized);
        }
      }
      for (const source of Array.isArray(sources) ? sources : []) addSource(source);
      const matches = [];
      for (const { index, keys: ownerKeys } of compiled) {
        const confirmed = new Set();
        let ambiguous = false;
        for (const key of keys) {
          if (!key.startsWith("i:")) continue;
          const owners = ownerKeys.get(key);
          if (!owners) continue;
          if (owners.size > 1) { ambiguous = true; break; }
          for (const entity of owners) confirmed.add(entity);
        }
        if (ambiguous || confirmed.size > 1) continue;
        const entities = new Set(confirmed);
        for (const key of keys) {
          if (!key.startsWith("n:")) continue;
          const owners = ownerKeys.get(key);
          if (!owners) continue;
          if (confirmed.size) {
            if (!owners.has([...confirmed][0])) { ambiguous = true; break; }
          } else {
            if (owners.size > 1) { ambiguous = true; break; }
            for (const entity of owners) entities.add(entity);
          }
        }
        if (!ambiguous && entities.size === 1) matches.push({ id: index.id, name: index.name, level: index.entries[[...entities][0]].level });
      }
      return matches;
    };
  }

  global.RankAssistantCustomIndexes = Object.freeze({
    SCHEMA_VERSION, STORAGE_KEY, CSV_HEADERS, LIMITS,
    normalizeIndexes, parseFile, fromTable, inferColumns, createMatcher
  });
})(globalThis);
