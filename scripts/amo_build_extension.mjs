#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "source");
const sourceDataDir = path.join(root, "source-data");
const outputDir = path.join(root, "dist", "firefox-extension");
const ivs = JSON.parse(fs.readFileSync(path.join(sourceDataDir, "encryption-ivs.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(sourceDataDir, "expected-files.json"), "utf8"));

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.cpSync(sourceDir, outputDir, { recursive: true });
const keyBytes = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("Journal Conference Rank Assistant packaged data v1"));
const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);

for (const shard of Object.keys(ivs).sort()) {
  const plain = fs.readFileSync(path.join(sourceDataDir, `catalog-shard-${shard}.private.json`));
  const iv = Buffer.from(ivs[shard], "base64");
  const [cipher, digest] = await Promise.all([
    webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
    webcrypto.subtle.digest("SHA-256", plain),
  ]);
  const payload = { format: 1, keyMode: "packaged", iv: iv.toString("base64"), cipher: Buffer.from(cipher).toString("base64"), sha256: Buffer.from(digest).toString("hex") };
  fs.writeFileSync(path.join(outputDir, "extension", "data", `catalog-shard-${shard}.encrypted.json`), JSON.stringify(payload));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const actual = Object.fromEntries(walk(outputDir).map((file) => [path.relative(outputDir, file).split(path.sep).join("/"), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
const differences = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().filter((name) => expected[name] !== actual[name]);
if (differences.length) throw new Error(`Build differs from submission:\n${differences.join("\n")}`);
console.log(`Built and verified ${Object.keys(actual).length} files in ${outputDir}`);
