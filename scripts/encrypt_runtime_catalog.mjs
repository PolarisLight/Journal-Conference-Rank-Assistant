#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

const dataDir = path.resolve("extension/data");
const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("Journal Conference Rank Assistant packaged data v1"));
const key = await webcrypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
const files = fs.readdirSync(dataDir).filter((name) => /^catalog-shard-[0a-z]\.private\.json$/.test(name)).sort();
if (files.length !== 27) throw new Error("Expected 27 plaintext shards, found " + files.length);
for (const stale of fs.readdirSync(dataDir).filter((name) => /^catalog-shard-[0a-z]\.encrypted\.json$/.test(name))) {
  fs.rmSync(path.join(dataDir, stale));
}
let total = 0;
for (const name of files) {
  const plain = fs.readFileSync(path.join(dataDir, name));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const [cipher, plainDigest] = await Promise.all([
    webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
    webcrypto.subtle.digest("SHA-256", plain)
  ]);
  const payload = {
    format: 1,
    keyMode: "packaged",
    iv: Buffer.from(iv).toString("base64"),
    cipher: Buffer.from(cipher).toString("base64"),
    sha256: Buffer.from(plainDigest).toString("hex")
  };
  const encoded = JSON.stringify(payload);
  fs.writeFileSync(path.join(dataDir, name.replace(".private.json", ".encrypted.json")), encoded);
  total += Buffer.byteLength(encoded);
}
console.log(JSON.stringify({ shards: files.length, encryptedKiB: Math.round(total / 1024) }));
