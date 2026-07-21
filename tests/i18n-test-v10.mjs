import assert from "node:assert/strict";
import fs from "node:fs";

const manifests = ["manifest.json", "manifest.firefox.json"].map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const zh = JSON.parse(fs.readFileSync("_locales/zh_CN/messages.json", "utf8"));
const en = JSON.parse(fs.readFileSync("_locales/en/messages.json", "utf8"));
const i18nSource = fs.readFileSync("extension/lib/i18n.js", "utf8");

for (const manifest of manifests) {
  assert.equal(manifest.default_locale, "zh_CN");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
}
assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), "Locale catalogs must expose identical keys");
for (const key of ["extensionName", "extensionDescription", "actionTitle"]) {
  assert.ok(zh[key]?.message);
  assert.ok(en[key]?.message);
}
for (const [key, value] of Object.entries(en)) {
  assert.match(key, /^[A-Za-z0-9_@]+$/);
  assert.equal(typeof value.message, "string");
  assert.ok(value.message.length > 0);
  assert.equal(typeof zh[key]?.message, "string");
}
assert.equal(en.extensionName.message, "Journal & Conference Rank Assistant");
assert.equal(zh.extensionName.message, "期刊会议等级与分区助手");
assert.match(i18nSource, /chrome\?\.i18n|chrome.*i18n/);
assert.match(i18nSource, /getMessage\("@@ui_locale"\)/);
console.log(JSON.stringify({ locales: ["zh_CN", "en"], messages: Object.keys(en).length }));
