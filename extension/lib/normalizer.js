(function (global) {
  "use strict";

  const STOP_WORDS = new Set(["the", "of", "and", "for", "in", "on", "a", "an"]);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function usefulAlias(value) {
    const normalized = normalize(value);
    if (!normalized || normalized.length < 3) return false;
    const parts = normalized.split(" ");
    if (parts.length === 1 && normalized.length < 4) return false;
    return !parts.every((part) => STOP_WORDS.has(part));
  }

  global.RankAssistantNormalizer = { normalize, compact, usefulAlias };
})(globalThis);
