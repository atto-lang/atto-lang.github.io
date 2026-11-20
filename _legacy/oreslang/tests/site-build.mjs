import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";
import { htmlAttribute, siteTags, validatedSiteUrl } from "./site-url-policy.mjs";

const root = join(process.cwd(), "dist");
const origin = "https://ores-truffle-oreslang.github.io";
function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const pathname = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(pathname) : [pathname];
  });
}
const files = allFiles(root);
const pages = files.filter((file) => file.endsWith(".html"));
const markup = new Map(pages.map((file) => [
  "/" + relative(root, file).split(sep).join("/").replace(/index\.html$/u, ""),
  readFileSync(file, "utf8"),
]));
const ids = new Map([...markup.entries()].map(([pathname, html]) => [
  pathname,
  new Set([...html.matchAll(/\bid="([^"]+)"/gu)].map((m) => m[1])),
]));
const attr = htmlAttribute;
function asDistFile(pathname) {
  const segments = decodeURIComponent(pathname).split("/");
  if (segments.includes("..") || segments.includes("\0")) throw new Error("Unexpected path " + pathname);
  const clean = segments.filter(Boolean).join("/");
  const candidate = join(root, clean);
  return !clean || !extname(candidate) ? join(candidate, "index.html") : candidate;
}
function pagePath(file) {
  return "/" + relative(root, file).split(sep).join("/").replace(/index\.html$/u, "");
}

test("all static HTML pages exist and contain no duplicate IDs", () => {
  assert.ok(pages.length >= 15, "Unexpectedly few generated pages");
  for (const [route, html] of markup) {
    assert.match(html, /<html\b/iu, route + " missing root HTML");
    const count = [...html.matchAll(/\bid="([^"]+)"/gu)].length;
    assert.equal(ids.get(route).size, count, route + " duplicate element IDs");
  }
});

test("all local site links and assets resolve, including cross-page fragments", () => {
  let checked = 0;
  for (const [route, html] of markup) {
    for (const tag of siteTags(html)) {
      const tagName = /^<([a-z][a-z0-9-]*)/iu.exec(tag)?.[1].toLowerCase();
      // A base element silently changes how every relative URL resolves.
      assert.notEqual(tagName, "base", route + " unexpected HTML base element");
      const extra = { form: ["action"], video: ["poster"], object: ["data"] };
      for (const field of ["href", "src", ...(extra[tagName] ?? [])]) {
        const raw = attr(tag, field);
        if (!raw) continue;
        let target;
        try { target = validatedSiteUrl(raw, origin + route, field); }
        catch (error) { throw new Error(route + " invalid " + field + "=" + raw + ": " + error.message); }
        if (target.origin !== origin) continue;
        const local = asDistFile(target.pathname);
        assert.ok(existsSync(local), route + " broken " + field + "=" + raw);
        if (target.hash && local.endsWith(".html")) {
          const hash = decodeURIComponent(target.hash.slice(1));
          if (hash) {
            const otherRoute = pagePath(local);
            assert.ok(ids.get(otherRoute)?.has(hash), route + " broken anchor " + raw);
          }
        }
        checked++;
      }
    }
  }
  assert.ok(checked >= 80, "Expected meaningful local-link coverage, got " + checked);
  console.log("Resolved " + checked + " local href/src references across " + pages.length + " generated pages");
});

test("every generated HTML route has exactly one canonical sitemap entry", () => {
  const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, "Duplicate sitemap entries");
  const canonicalPaths = new Set(locs.map((url) => new URL(url).pathname));
  for (const route of markup.keys()) {
    assert.ok(canonicalPaths.has(route), "Missing route in sitemap: " + route);
  }
});


test("brand raster assets are real local PNGs with expected dimensions", () => {
  for (const [name, width, height] of [
    ["attolang-black.png", 1100, 283],
    ["attolang-white.png", 1100, 283],
    ["attolang-social.png", 1200, 630],
    ["attolang-icon-180.png", 180, 180],
  ]) {
    const path = join(root, "brand", name);
    assert.ok(existsSync(path), "Missing rendered brand asset " + path);
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 1000 && bytes.length < 2_000_000, name + " invalid size");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", name + " PNG signature");
    assert.equal(bytes.readUInt32BE(16), width, name + " width");
    assert.equal(bytes.readUInt32BE(20), height, name + " height");
  }
  assert.ok(existsSync(join(root, "favicon.svg")));
  assert.ok(existsSync(join(root, "brand", "attolang-social.svg")));
});

test("every public page has canonical social sharing imagery", () => {
  for (const [route, html] of markup) {
    assert.match(html, /<meta property="og:image" content="https:\/\/ores-truffle-oreslang\.github\.io\/brand\/attolang-social\.png"/u,
      route + " missing OG preview");
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/u,
      route + " missing large Twitter card");
    assert.match(html, /<meta name="twitter:image" content="https:\/\/ores-truffle-oreslang\.github\.io\/brand\/attolang-social\.png"/u,
      route + " missing Twitter preview");
  }
  assert.ok(markup.has("/brand/"), "Brand downloads page missing");
  assert.match(markup.get("/"), /"alternateName":\["Oreslang","OresLang"\]/u,
    "Historical name structured data must be limited to the official homepage");
});

test("deployment manifest binds the generated site to the exact Git revision and seven local assets", () => {
  const receipt = JSON.parse(readFileSync(join(root, "deployment-manifest.json"), "utf8"));
  assert.equal(receipt.schema_version, 1);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(receipt.git_commit_sha, /^[0-9a-f]{40}$/u);
  assert.equal(receipt.git_commit_sha, sha);
  const expected = new Map([
    ["/", "index.html"], ["/brand/", "brand/index.html"],
    ["/logs/9/", "logs/9/index.html"], ["/rss.xml", "rss.xml"],
    ["/brand/attolang-social.png", "brand/attolang-social.png"],
    ["/brand/attolang-icon-180.png", "brand/attolang-icon-180.png"],
    ["/favicon.svg", "favicon.svg"],
  ]);
  assert.deepEqual(Object.keys(receipt.assets).sort(), [...expected.keys()].sort());
  for (const [url, path] of expected) {
    const bytes = readFileSync(join(root, path));
    assert.equal(receipt.assets[url].bytes, bytes.length, url + " byte length");
    assert.equal(receipt.assets[url].sha256,
      createHash("sha256").update(bytes).digest("hex"), url + " SHA-256");
  }
});
