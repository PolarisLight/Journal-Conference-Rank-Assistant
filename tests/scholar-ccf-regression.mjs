import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runEncryptedPage } from './helpers/encrypted-runtime.mjs';

// Reuse the runtime suite's real content-script setup and local catalog loader.
// Keep the extraction guarded: an upstream harness change must fail visibly.
const root = process.argv[2] || process.cwd();
const runtimeSource = fs.readFileSync(path.join(root, "tests/runtime-test-v7.mjs"), "utf8");
const harnessBoundary = runtimeSource.indexOf("const dblpHtml =");
assert.ok(harnessBoundary > 0, "The shared runtime harness boundary must exist");
const injectOnce = (source, marker, injected) => {
  assert.equal(source.split(marker).length, 2, "The shared harness injection must have one target: " + marker);
  return source.replace(marker, marker + injected);
};
let harnessSource = runtimeSource.slice(0, harnessBoundary) + "\nexport { run };\n";
harnessSource = injectOnce(harnessSource, 'if (message.type === "rank-assistant-get-data-shard") {',
  '\n          if (runOptions.catalogLoadFailure) { callback({ ok: false, error: "Simulated background catalog failure" }); return; }');
harnessSource = injectOnce(harnessSource, 'if (address.startsWith("moz-extension://")) {',
  '\n      if (runOptions.catalogLoadFailure && /catalog-shard-/.test(address)) { catalogFetches += 1; return { ok: false, status: 404, json: async () => ({}) }; }');
const { run } = await import("data:text/javascript;base64," + Buffer.from(harnessSource).toString("base64"));

const cases = [
  { id: "cvpr-acronym", venue: "CVPR", expected: "A" },
  { id: "cvpr-proceedings", venue: "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition", expected: "A" },
  { id: "cvpr-year", venue: "2025 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)", expected: "A" },
  { id: "cvpr-historical-proc", venue: "Proc. of the IEEE Conference on Computer Vision and Pattern Recognition", expected: "A" },
  { id: "iccv-proceedings", venue: "Proceedings of the IEEE/CVF International Conference on Computer Vision", expected: "A" },
  { id: "iccv-year", venue: "2023 IEEE/CVF International Conference on Computer Vision (ICCV)", expected: "A" },
  { id: "iccv-historical-proc", venue: "Proc. IEEE International Conference on Computer Vision", expected: "A" },
  { id: "icml-proceedings", venue: "Proceedings of the International Conference on Machine Learning", expected: "A" },
  { id: "icml-year", venue: "2025 International Conference on Machine Learning (ICML)", expected: "A" },
  { id: "icml-proc", venue: "Proc. of the International Conference on Machine Learning", expected: "A" },
  { id: "neurips-acronym", venue: "NeurIPS", expected: "A" },
  { id: "neurips-historical-acronym", venue: "NIPS", expected: "A" },
  { id: "neurips-historical-year", venue: "NIPS 2020", expected: "A" },
  { id: "neurips-proceedings-series", venue: "Advances in Neural Information Processing Systems", expected: "A", expectedIndexes: ["EI"] },
  { id: "neurips-proceedings-volume", venue: "Advances in Neural Information Processing Systems 37", expected: "A", expectedIndexes: ["EI"] },
  { id: "aaai-proceedings-series", venue: "Proceedings of the AAAI Conference on Artificial Intelligence", expected: "A", expectedIndexes: ["EI"] },
  { id: "ijcai-proceedings", venue: "Proceedings of the International Joint Conference on Artificial Intelligence", expected: "B" },
  { id: "icpr-proceedings", venue: "Proceedings of the International Conference on Pattern Recognition", expected: "C" },
  { id: "journal-control", venue: "IEEE Transactions on Pattern Analysis and Machine Intelligence", expected: "A", expectedIndexes: ["JCR Q1"] },
  { id: "ambiguous-mobile", venue: "ACM International Conference on Mobile...", expected: null },
  { id: "ambiguous-computer-vision", venue: "Proceedings of the International Conference on Computer...", expected: null },
  { id: "generic-proceedings", venue: "Proceedings of the International Conference...", expected: null },
  { id: "conference-journal-title-collision", venue: "Conference on Nature", expected: null },
  { id: "workshop-name", venue: "Workshop on Computer Vision and Pattern Recognition", expected: null },
  { id: "cvpr-workshops", venue: "CVPR Workshops", expected: null },
  { id: "unknown-venue", venue: "Example Unlisted Research Symposium", expected: null },
  { id: "arxiv-title-acronym", venue: "arXiv preprint arXiv:2501.12345", title: "A CVPR benchmark for long-tailed recognition", expected: null },
  { id: "arxiv-title-full-name", venue: "arXiv preprint arXiv:2501.12346", title: "Lessons from the International Conference on Machine Learning", expected: null },
  { id: "arxiv-title-exact-conference", venue: "arXiv preprint arXiv:2501.12348", title: "International Conference on Machine Learning", expected: null },
  { id: "arxiv-title-exact-journal", venue: "arXiv preprint arXiv:2501.12349", title: "IEEE Transactions on Pattern Analysis and Machine Intelligence", expected: null },
  { id: "arxiv-snippet", venue: "arXiv preprint arXiv:2501.12347", snippet: "We compare results reported at the International Conference on Machine Learning and CVPR.", expected: null }
];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

const searchCard = (testCase, compact) => {
  const title = escapeHtml(testCase.title || "Diagnostic research paper " + testCase.id);
  const source = escapeHtml(testCase.venue);
  const citation = compact
    ? '<span class="authors">A Researcher</span> - <span class="source">' + source + '</span>, 2025 - example.org'
    : "A Researcher - " + source + ", 2025 - example.org";
  return '<div class="' + (compact ? "gs_r" : "gs_r gs_or gs_scl") + '" id="' + testCase.id + '"><div class="gs_ri">' +
    '<h3 class="gs_rt"><a href="https://example.org/paper/' + testCase.id + '">' + title + '</a></h3>' +
    '<div class="gs_a">' + citation + '</div><div class="gs_rs">' + escapeHtml(testCase.snippet || "A neutral research abstract.") + '</div></div></div>';
};

const profileCard = (testCase) => '<tr class="gsc_a_tr" id="' + testCase.id + '"><td class="gsc_a_t">' +
  '<a class="gsc_a_at" href="/citations?view_op=view_citation&amp;citation_for_view=' + testCase.id + '">' +
  escapeHtml(testCase.title || "Diagnostic research paper " + testCase.id) + '</a><div class="gs_gray">A Researcher</div>' +
  '<div class="gs_gray">' + escapeHtml(testCase.venue) + ', 2025</div></td><td class="gsc_a_c">12</td><td class="gsc_a_y">2025</td></tr>';

const pageShapes = [
  { id: "search-standard", url: "https://scholar.google.com/scholar?q=ccf-regression", html: '<main id="gs_res_ccl_mid">' + cases.map((testCase) => searchCard(testCase, false)).join("") + '</main>' },
  { id: "search-compact", url: "https://scholar.googleusercontent.com/scholar?q=ccf-regression", html: '<main id="gs_res_ccl_mid">' + cases.map((testCase) => searchCard(testCase, true)).join("") + '</main>' },
  { id: "author-profile", url: "https://scholar.google.com/citations?user=regression", html: '<table id="gsc_a_t"><tbody>' + cases.map(profileCard).join("") + '</tbody></table>' }
];

const failures = [];
const reports = [];
let renderedSearchHtml = "";
for (const pageShape of pageShapes) {
  const startedAt = Date.now();
  const page = await run(pageShape.url, pageShape.html, 1100);
  const document = page.dom.window.document;
  const results = cases.map((testCase) => {
    const container = document.getElementById(testCase.id);
    const labels = [...container.querySelectorAll(".rank-assistant-badge")].map((badge) => badge.textContent);
    const ccfLabels = labels.filter((label) => /^CCF /.test(label));
    const expectedCcf = "CCF " + (testCase.expected || "None");
    const issues = [];
    if (JSON.stringify(ccfLabels) !== JSON.stringify([expectedCcf])) issues.push("Expected only " + expectedCcf + "; got " + JSON.stringify(ccfLabels));
    for (const index of testCase.expectedIndexes || []) if (!labels.includes(index)) issues.push("Missing preserved index " + index);
    if (container.querySelectorAll(".rank-assistant-row").length !== 1) issues.push("Expected exactly one badge row");
    if (testCase.expected && !container.querySelector(".rank-assistant-venue-detail")) issues.push("Missing matched venue detail");
    if (!testCase.expected && labels.some((label) => /^(?:JCR |中科院 |新锐 |UTD24|FT50|ABS )/.test(label))) issues.push("Unrelated rank leaked into a negative case");
    if (issues.length) failures.push({ page: pageShape.id, id: testCase.id, venue: testCase.venue, issues });
    return { id: testCase.id, source: testCase.venue, expected: expectedCcf, labels, passed: issues.length === 0, issues };
  });
  if (document.documentElement.dataset.paperRankStatus !== "ready") failures.push({ page: pageShape.id, issues: ["Runtime did not reach ready: " + document.documentElement.dataset.paperRankDetail] });
  if (page.errors.length) failures.push({ page: pageShape.id, issues: page.errors });
  if (page.runtimeMessages.includes("rank-assistant-scholar-work-venues")) failures.push({ page: pageShape.id, issues: ["Scholar paper titles were sent to an external venue fallback"] });
  reports.push({ page: pageShape.id, url: pageShape.url, elapsedMs: Date.now() - startedAt, status: document.documentElement.dataset.paperRankStatus, errors: page.errors, cases: results });
  if (pageShape.id === "search-standard") {
    const styles = ["palettes.css", "badges.css"].map((file) => fs.readFileSync(path.join(root, "extension/content", file), "utf8")).join("\n");
    renderedSearchHtml = '<!doctype html><html lang="zh-CN" data-paper-rank-palette="vivid" data-paper-rank-theme="light"><head><meta charset="utf-8"><title>谷歌学术 CCF 专项回归渲染样本</title><style>' + styles +
      '\nbody{margin:32px 48px;background:#fff;color:#222;font:14px Arial,sans-serif}h1{font-size:22px;font-weight:500}.intro{color:#666}.gs_r{max-width:1000px;margin:30px 0}.gs_rt{font-size:18px;font-weight:400;margin:0 0 8px}.gs_rt>a{color:#1a0dab;text-decoration:none}.gs_a{color:#006621;margin-bottom:5px}.gs_rs{line-height:1.6}.rank-assistant-row{vertical-align:middle}</style></head><body><h1>谷歌学术 CCF 专项回归渲染样本</h1><p class="intro">本地构造页面，用于核对来源解析与扩展实际生成的标签。</p>' + document.getElementById("gs_res_ccl_mid").outerHTML + '</body></html>\n';
  }
}

// An unavailable catalog is an infrastructure error, not a negative venue match.
const failedLoadPage = await runEncryptedPage("https://scholar.google.com/scholar?q=catalog-failure",
  searchCard({ id: "catalog-failure", venue: "International Conference on Machine Learning" }, false),
  { missingPackaged: true, waitMs: 900 });
const failedLoadDocument = failedLoadPage.dom.window.document;
const failedLoadLabels = [...failedLoadDocument.querySelectorAll(".rank-assistant-badge")].map((badge) => badge.textContent);
const failedLoadIssues = [];
if (failedLoadDocument.documentElement.dataset.paperRankStatus !== "error") failedLoadIssues.push("Catalog failure must set status=error");
if (failedLoadLabels.length) failedLoadIssues.push("Catalog failure must not render CCF None or any ranking badge: " + JSON.stringify(failedLoadLabels));
if (!failedLoadDocument.documentElement.dataset.paperRankDetail) failedLoadIssues.push("Catalog failure must retain the load error detail");
if (!failedLoadPage.messages.includes("rank-assistant-get-data-shard")) failedLoadIssues.push("The failed background catalog request was not exercised");
if (failedLoadPage.snapshot().plaintextFallbackFetches.length) failedLoadIssues.push("Runtime must never request private plaintext catalog files");
if (failedLoadIssues.length) failures.push({ id: "catalog-load-failure", issues: failedLoadIssues });
const catalogLoadFailure = {
  status: failedLoadDocument.documentElement.dataset.paperRankStatus,
  detail: failedLoadDocument.documentElement.dataset.paperRankDetail,
  labels: failedLoadLabels,
  errors: failedLoadPage.errors,
  passed: failedLoadIssues.length === 0,
  issues: failedLoadIssues
};
failedLoadPage.close();

const report = {
  test: "scholar-ccf-regression",
  generatedAt: new Date().toISOString(),
  pageShapes: pageShapes.length,
  uniqueCases: cases.length,
  matrixCases: cases.length * pageShapes.length,
  infrastructureCases: 1,
  totalCases: cases.length * pageShapes.length + 1,
  positiveCases: cases.filter((testCase) => testCase.expected).length * pageShapes.length,
  negativeCases: cases.filter((testCase) => !testCase.expected).length * pageShapes.length,
  passed: failures.length === 0,
  failures,
  catalogLoadFailure,
  pages: reports
};
const artifactDirectory = process.env.PAPER_RANK_TEST_ARTIFACT_DIR || path.join(root, "artifacts");
fs.mkdirSync(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "scholar-ccf-regression.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
const samplePath = path.join(artifactDirectory, "scholar-ccf-rendered.html");
fs.writeFileSync(samplePath, renderedSearchHtml, "utf8");
const saved = JSON.parse(fs.readFileSync(reportPath, "utf8"));
assert.equal(saved.totalCases, cases.length * pageShapes.length + 1, "Saved report must preserve the full matrix and catalog failure case");
assert.equal(saved.failures.length, failures.length, "Saved report must preserve every failure");
console.log(JSON.stringify({ reportPath, samplePath, pageShapes: report.pageShapes, totalCases: report.totalCases, passed: report.passed, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
