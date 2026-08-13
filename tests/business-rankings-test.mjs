import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("extension/data/business-rankings.js", "utf8"), context);
vm.runInContext(fs.readFileSync("extension/data/ajg-2024.js", "utf8"), context);
vm.runInContext(fs.readFileSync("extension/data/issn-index.js", "utf8"), context);

const rankings = context.RankAssistantBusinessRankings;
assert.equal(rankings.counts.utd24, 24, "UTD24 must contain exactly 24 journals");
assert.equal(rankings.counts.ft50, 50, "FT50 must contain exactly 50 journals");
assert.match(rankings.sources.utd24, /^https:\/\/jindal\.utdallas\.edu\//);
assert.equal(rankings.sources.ft50, "https://www.ft.com/ft50-journals");

for (const title of [
  "The Accounting Review",
  "MIS Quarterly",
  "Strategic Management Journal"
]) {
  assert.equal(rankings.match(title)?.utd24, true, `${title} must be UTD24`);
}
assert.equal(rankings.match("MISQ")?.name, "MIS Quarterly", "A documented abbreviation must resolve");
assert.equal(rankings.match("M&SOM")?.utd24, true, "Punctuation-bearing aliases must resolve");

for (const title of [
  "Academy of Management Annals",
  "American Sociological Review",
  "Psychological Science"
]) {
  assert.equal(rankings.match(title)?.ft50, true, `${title} must be in the April 2026 FT50`);
}
for (const removed of ["Human Relations", "Journal of Business Ethics", "Organization Studies"]) {
  assert.notEqual(rankings.match(removed)?.ft50, true, `${removed} must not remain in the April 2026 FT50`);
}

for (const unsafe of [
  "Marketing",
  "A paper about Management Science",
  "Journal of Marketing Research Letters",
  "Analysis of results"
]) {
  assert.equal(rankings.match(unsafe), null, `${unsafe} must not inherit a business ranking`);
}

const issnIndex = context.RankAssistantIssnIndex;
assert.ok(Object.keys(issnIndex).length > 40000, "The packaged ISSN index is unexpectedly incomplete");
for (const [issn, target] of Object.entries(issnIndex).slice(0, 1000)) {
  assert.match(issn, /^\d{7}[\dX]$/);
  assert.ok(Array.isArray(target) && target.length === 2);
  assert.match(target[0], /^(?:[0a-z]|other)$/);
  assert.ok(Number.isInteger(target[1]) && target[1] >= 0);
}

const ajg = context.RankAssistantAjg2024;
assert.equal(ajg.version, "AJG 2024");
assert.equal(ajg.count, 1635, "AJG 2024 must contain the complete 1,635-title list");
assert.equal(ajg.match("Academy of Management Journal")?.rating, "4*");
assert.equal(ajg.match("Aslib Journal of Information Management")?.rating, "1");
assert.equal(ajg.match("Tourism Management")?.rating, "4");
assert.equal(ajg.match("A paper about Marketing"), null, "Paper titles must not inherit short AJG journal names");
assert.equal(ajg.match("Journal of Marketing Research Letters"), null, "Longer unlisted journals must not inherit AJG ratings");
assert.equal(ajg.match("Analysis of results"), null);

console.log(JSON.stringify({
  utd24: rankings.counts.utd24,
  ft50: rankings.counts.ft50,
  issnEntries: Object.keys(issnIndex).length,
  ajg2024: ajg.count
}));
