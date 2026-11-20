import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sha = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
  encoding: "utf8", timeout: 10000, maxBuffer: 4096,
}).trim().toLowerCase();
assert.match(sha, /^[0-9a-f]{40}$/u, "Exact Git HEAD required for release");
if (process.env.GITHUB_SHA && process.env.GITHUB_EVENT_NAME !== "pull_request") {
  assert.equal(sha, process.env.GITHUB_SHA.toLowerCase(),
    "Checkout must match workflow event SHA; refuse stale or synthetic mismatch");
}
const dist = join(process.cwd(), "dist");
const paths = [
  ["/", "index.html"],
  ["/brand/", "brand/index.html"],
  ["/logs/9/", "logs/9/index.html"],
  ["/rss.xml", "rss.xml"],
  ["/brand/attolang-social.png", "brand/attolang-social.png"],
  ["/brand/attolang-icon-180.png", "brand/attolang-icon-180.png"],
  ["/favicon.svg", "favicon.svg"],
];
const assets = {};
for (const [url, file] of paths) {
  const bytes = await readFile(join(dist, file));
  assert.ok(bytes.length > 100, "Empty deployment asset " + file);
  assets[url] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}
const manifest = { schema_version: 1, git_commit_sha: sha, assets };
await writeFile(join(dist, "deployment-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n", { flag: "w" });
console.log("Generated immutable AttoLang deployment manifest for " + sha);
