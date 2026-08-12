/* Local business-journal rankings.  Title matching is normalized by normalizer.js. */
(function (global) {
  "use strict";
  const rows = [
    // name | aliases | UTD24 | FT50 (April 2026)
    ["The Accounting Review", ["Accounting Review"], 1, 1],
    ["Journal of Accounting and Economics", [], 1, 1],
    ["Journal of Accounting Research", [], 1, 1],
    ["Journal of Finance", ["The Journal of Finance"], 1, 1],
    ["Journal of Financial Economics", [], 1, 1],
    ["The Review of Financial Studies", ["Review of Financial Studies"], 1, 1],
    ["Information Systems Research", [], 1, 1],
    ["INFORMS Journal on Computing", ["Informs Journal on Computing"], 1, 0],
    ["MIS Quarterly", ["Management Information Systems Quarterly", "MISQ"], 1, 1],
    ["Journal of Consumer Research", [], 1, 1],
    ["Journal of Marketing", [], 1, 1],
    ["Journal of Marketing Research", [], 1, 1],
    ["Marketing Science", [], 1, 1],
    ["Management Science", [], 1, 1],
    ["Operations Research", [], 1, 1],
    ["Journal of Operations Management", [], 1, 1],
    ["Manufacturing & Service Operations Management", ["Manufacturing and Service Operations Management", "M&SOM", "MSOM"], 1, 1],
    ["Production and Operations Management", [], 1, 0],
    ["Academy of Management Journal", ["AMJ"], 1, 1],
    ["Academy of Management Review", ["AMR"], 1, 1],
    ["Administrative Science Quarterly", ["ASQ"], 1, 1],
    ["Organization Science", [], 1, 1],
    ["Journal of International Business Studies", ["JIBS"], 1, 1],
    ["Strategic Management Journal", ["SMJ"], 1, 1],
    ["Academy of Management Annals", [], 0, 1],
    ["Accounting, Organizations and Society", ["Accounting Organizations and Society"], 0, 1],
    ["American Economic Review", [], 0, 1],
    ["American Sociological Review", [], 0, 1],
    ["Contemporary Accounting Research", [], 0, 1],
    ["Econometrica", [], 0, 1],
    ["Entrepreneurship Theory and Practice", ["Entrepreneurship: Theory and Practice"], 0, 1],
    ["Harvard Business Review", [], 0, 1],
    ["Human Resource Management", [], 0, 1],
    ["Journal of Applied Psychology", [], 0, 1],
    ["Journal of Business Venturing", [], 0, 1],
    ["Journal of Consumer Psychology", [], 0, 1],
    ["Journal of Financial and Quantitative Analysis", ["JFQA"], 0, 1],
    ["Journal of Management", [], 0, 1],
    ["Journal of Management Information Systems", ["JMIS"], 0, 1],
    ["Journal of Management Studies", [], 0, 1],
    ["Journal of Political Economy", [], 0, 1],
    ["Journal of Retailing", [], 0, 1],
    ["Strategic Entrepreneurship Journal", ["SEJ"], 0, 1],
    ["Journal of Organizational Behavior", [], 0, 1],
    ["The Leadership Quarterly", ["Leadership Quarterly"], 0, 1],
    ["Organizational Behavior and Human Decision Processes", ["OBHDP"], 0, 1],
    ["Personnel Psychology", [], 0, 1],
    ["Psychological Science", [], 0, 1],
    ["Quarterly Journal of Economics", ["The Quarterly Journal of Economics", "QJE"], 0, 1],
    ["Review of Accounting Studies", [], 0, 1],
    ["Review of Economic Studies", ["The Review of Economic Studies"], 0, 1],
    ["Review of Finance", [], 0, 1],
  ];
  const normalize = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase().replace(/\s+/g, " ");
  const byTitle = new Map();
  for (const [name, aliases, utd24, ft50] of rows) {
    const entry = Object.freeze({ name, utd24: Boolean(utd24), ft50: Boolean(ft50) });
    for (const value of [name, ...aliases]) byTitle.set(normalize(value), entry);
  }
  global.RankAssistantBusinessRankings = Object.freeze({
    version: "UTD24 current list · FT50 April 2026",
    counts: Object.freeze({
      utd24: rows.filter((row) => Boolean(row[2])).length,
      ft50: rows.filter((row) => Boolean(row[3])).length
    }),
    sources: Object.freeze({
      utd24: "https://jindal.utdallas.edu/news/2026-utd-top-100-business-school-research-rankings/",
      ft50: "https://www.ft.com/ft50-journals"
    }),
    match(value) {
      const raw = String(value || "").trim();
      // UTD/FT labels require an exact journal title.  Do not let a journal
      // merely containing another journal's name inherit its ranking.
      const candidates = [raw, raw.split(/\s+[|｜]\s+/)[0]];
      for (const candidate of candidates) {
        const exact = byTitle.get(normalize(candidate));
        if (exact) return exact;
      }
      return null;
    }
  });
})(globalThis);
