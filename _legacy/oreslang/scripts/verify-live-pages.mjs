import assert from "node:assert/strict";

import { createHash } from "node:crypto";

const origin = "https://ores-truffle-oreslang.github.io";
const expectedSha = process.argv[2]?.toLowerCase();
assert.match(expectedSha ?? "", /^[0-9a-f]{40}$/u,
  "Pass exact deployed Git commit SHA to verify-live-pages.mjs");
const get = async (path, type) => {
  const response = await fetch(origin + path, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { "Cache-Control": "no-cache" },
  });
  assert.equal(response.status, 200, "HTTP status for " + path);
  assert.ok(response.headers.get("content-type")?.includes(type),
    path + " content-type: " + response.headers.get("content-type"));
  return new Uint8Array(await response.arrayBuffer());
};
const read = (buffer) => new TextDecoder().decode(buffer);
const manifest = JSON.parse(read(await get("/deployment-manifest.json", "application/json")));
assert.equal(manifest.schema_version, 1);
assert.equal(manifest.git_commit_sha, expectedSha, "Live Pages serves a stale/wrong source revision");
const expectedPaths = ["/", "/brand/", "/logs/9/", "/rss.xml",
  "/brand/attolang-social.png", "/brand/attolang-icon-180.png", "/favicon.svg"];
assert.deepEqual(Object.keys(manifest.assets).sort(), [...expectedPaths].sort());
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const verified = new Map();
for (const path of expectedPaths) {
  const mime = path.endsWith(".png") ? "image/png" :
    path.endsWith(".svg") ? "svg" :
    path.endsWith(".xml") ? "xml" :
    path.endsWith("/") ? "text/html" : "application/octet-stream";
  const bytes = await get(path, mime);
  assert.equal(bytes.length, manifest.assets[path]?.bytes, path + " byte size mismatch");
  assert.equal(digest(bytes), manifest.assets[path]?.sha256,
    path + " differs from source-built SHA-256 receipt");
  verified.set(path, bytes);
}
const home = read(verified.get("/"));
assert.match(home, /AttoLang/u);
assert.match(home, /attolang-wordmark\.svg/u);
assert.match(home, /og:image" content="https:\/\/ores-truffle-oreslang\.github\.io\/brand\/attolang-social\.png"/u);
const brand = read(verified.get("/brand/"));
assert.match(brand, /AttoLang/u);
const log9 = read(verified.get("/logs/9/"));
assert.match(log9, /What AttoLang learns from Microsoft Orleans/u);
const rss = read(verified.get("/rss.xml"));
assert.match(rss, /AttoLang engineering logs/u);
assert.equal([...rss.matchAll(/<item>/gu)].length, 10, "Live RSS must list ten articles");
const png = verified.get("/brand/attolang-social.png");
assert.ok(png.length > 1000 && png.length < 2_000_000, "Social card size");
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
assert.equal(view.getUint32(16), 1200);
assert.equal(view.getUint32(20), 630);
const icon = verified.get("/brand/attolang-icon-180.png");
assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
const iview = new DataView(icon.buffer, icon.byteOffset, icon.byteLength);
assert.equal(iview.getUint32(16), 180);
assert.equal(iview.getUint32(20), 180);
const favicon = read(verified.get("/favicon.svg"));
assert.match(favicon, /AttoLang favicon/u);
assert.doesNotMatch(favicon, /#6b472f|#ff6a00/iu);
console.log("Verified exact live AttoLang Pages release SHA " + expectedSha + ": home, brand, log 9, RSS and asset SHA-256");
