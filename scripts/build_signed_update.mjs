#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign
} from "node:crypto";

const PRODUCT = "journal-conference-rank-assistant";
const REPOSITORY = "PolarisLight/Journal-Conference-Rank-Assistant";
const releaseVersion = process.argv[2] || new Date().toISOString().slice(0, 10).replaceAll("-", ".") + ".1";
const root = process.cwd();
const dataDir = path.join(root, "extension", "data");
const updatesDir = path.join(root, "updates");
const keysDir = path.join(root, ".keys");
const privateKeyPath = path.join(keysDir, "update-signing-private.pem");
const publicKeyPath = path.join(dataDir, "update-public-key.json");

fs.mkdirSync(keysDir, { recursive: true });
fs.mkdirSync(updatesDir, { recursive: true });

if (!fs.existsSync(privateKeyPath)) {
  const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  fs.writeFileSync(privateKeyPath, pair.privateKey, { mode: 0o600 });
  const publicJwk = createPublicKey(pair.publicKey).export({ format: "jwk" });
  fs.writeFileSync(publicKeyPath, JSON.stringify(publicJwk, null, 2) + "\n");
}

const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath));
const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });
fs.writeFileSync(publicKeyPath, JSON.stringify(publicJwk, null, 2) + "\n");

const buildInfoPath = path.join(dataDir, "build-info.private.json");
const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
buildInfo.remoteVersion = releaseVersion;
buildInfo.updateRepository = REPOSITORY;
buildInfo.updateChannel = "stable";
fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2) + "\n");
const publicBuildInfo = {
  records: Number(buildInfo.records || 0),
  cas: String(buildInfo.cas || ""),
  jcr: String(buildInfo.jcr || ""),
  ccf: String(buildInfo.ccf || ""),
  generatedAt: buildInfo.generatedAt || new Date().toISOString().slice(0, 10),
  remoteVersion: releaseVersion,
  updateRepository: REPOSITORY,
  updateChannel: "stable"
};
fs.writeFileSync(path.join(dataDir, "build-info.json"), JSON.stringify(publicBuildInfo, null, 2) + "\n");

const shards = {};
for (const key of ["0", ..."abcdefghijklmnopqrstuvwxyz"]) {
  const shardPath = path.join(dataDir, `catalog-shard-${key}.encrypted.json`);
  if (!fs.existsSync(shardPath)) throw new Error("Missing encrypted shard: " + shardPath);
  shards[key] = JSON.parse(fs.readFileSync(shardPath, "utf8"));
}

const publishedAt = new Date().toISOString();
const signedPayload = {
  schema: 1,
  product: PRODUCT,
  version: releaseVersion,
  publishedAt,
  signatureAlgorithm: "ECDSA_P256_SHA256",
  dataVersions: {
    cas: String(buildInfo.cas || ""),
    jcr: String(buildInfo.jcr || ""),
    ccf: String(buildInfo.ccf || "")
  },
  records: Number(buildInfo.records || 0),
  shards
};
const payloadBytes = Buffer.from(JSON.stringify(signedPayload));
const signature = sign("sha256", payloadBytes, {
  key: privateKey,
  dsaEncoding: "ieee-p1363"
}).toString("base64");
const bundle = JSON.stringify({ ...signedPayload, signature });
const bundleName = `catalog-${releaseVersion}.prdb`;
const bundlePath = path.join(updatesDir, bundleName);
fs.writeFileSync(bundlePath, bundle);
const sha256 = createHash("sha256").update(bundle).digest("hex");

const latest = {
  schema: 1,
  product: PRODUCT,
  version: releaseVersion,
  publishedAt,
  dataVersions: signedPayload.dataVersions,
  records: signedPayload.records,
  bundleUrl: `https://raw.githubusercontent.com/${REPOSITORY}/main/updates/${bundleName}`,
  sha256,
  size: Buffer.byteLength(bundle),
  signatureAlgorithm: signedPayload.signatureAlgorithm
};
fs.writeFileSync(path.join(updatesDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(JSON.stringify({ releaseVersion, bundleName, sha256, bytes: latest.size, records: latest.records }));
