import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const site = "https://ores-truffle-oreslang.github.io";
const read = (p) => readFileSync(join(dist, p), "utf8");
const pagePaths = Array.from({ length: 10 }, (_, i) => "logs/" + (i + 1) + "/index.html");
const pages = pagePaths.map(read);
const archive = read("logs/index.html");
const sitemap = read("sitemap.xml");

function attribute(tag, name) {
  const found = tag.match(new RegExp("(?:^|\\s)" + name + '="([^"]*)"', "u"));
  return found?.[1] ?? null;
}

function localOutput(pathname) {
  if (pathname.includes("\0")) throw new Error("NUL in URL");
  const clean = decodeURIComponent(pathname);
  const relative = clean.replace(/^\/+/, "");
  if (relative.split("/").includes("..")) throw new Error("Path traversal: " + pathname);
  const p = join(dist, relative);
  return clean.endsWith("/") || extname(p) === "" ? join(p, "index.html") : p;
}

test("archive, sitemap, and canonical origin agree on all ten routes", () => {
  const hrefs = [...archive.matchAll(/href="\/logs\/(\d+)\/"/gu)].map((m) => Number(m[1]));
  assert.deepEqual(hrefs.slice(0, 10), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (let n = 1; n <= 10; n++) {
    assert.ok(sitemap.includes("<loc>" + site + "/logs/" + n + "/</loc>"));
  }
  assert.equal(new Set(hrefs).size, 10);
});

for (const [i, html] of pages.entries()) {
  const n = i + 1;
  test("rendered log " + n + " has semantic HTML, indexable metadata and correct article JSON-LD", () => {
    assert.match(html, /<html\b[^>]*lang="en"/u);
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gu)];
    assert.equal(h1s.length, 1, "One article title");
    assert.ok(h1s[0][1].replace(/<[^>]*>/g, "").trim().length >= 20);
    const canonical = site + "/logs/" + n + "/";
    const linkTags = [...html.matchAll(/<link\b[^>]*>/gu)].map((m) => m[0]);
    assert.ok(linkTags.some((t) => attribute(t, "rel") === "canonical" && attribute(t, "href") === canonical));
    const metaTags = [...html.matchAll(/<meta\b[^>]*>/gu)].map((m) => m[0]);
    assert.ok(metaTags.some((t) => attribute(t, "name") === "description" && (attribute(t, "content") ?? "").length >= 60));
    assert.ok(metaTags.some((t) => attribute(t, "property") === "og:url" && attribute(t, "content") === canonical));
    assert.ok(metaTags.some((t) => attribute(t, "property") === "og:type" && attribute(t, "content") === "article"));
    const jsonScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)]
      .filter((m) => attribute(m[1], "type") === "application/ld+json");
    assert.equal(jsonScripts.length, 1, "Exactly one TechArticle JSON-LD");
    const schema = JSON.parse(jsonScripts[0][2]);
    assert.equal(schema["@type"], "TechArticle");
    assert.equal(schema.mainEntityOfPage, canonical);
    assert.equal(schema.author?.name, "Alex Mills");
    assert.match(schema.datePublished, /^\d{4}-\d{2}-\d{2}$/u);
    assert.match(schema.dateModified, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(schema.dateModified >= schema.datePublished);
    assert.ok((schema.headline ?? "").length > 20);
    assert.ok(html.includes('class="log-entry-header"'));
    assert.ok(html.includes('class="log-entry-footer"'));
    assert.ok(html.includes('class="log-prompt-disclosure"'));
  });

  test("rendered log " + n + " resolves contents anchors, local URLs and image assets", () => {
    const toc = html.match(/<aside\b[^>]*class="log-toc"[^>]*>([\s\S]*?)<\/aside>/u)?.[1];
    assert.ok(toc, "Missing contents sidebar");
    const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map((m) => m[1]);
    const seen = new Set(ids);
    assert.equal(seen.size, ids.length, "Duplicate HTML ids");
    const links = [...toc.matchAll(/href="#([^"]+)"/gu)].map((m) => m[1]);
    assert.ok(links.length >= 5);
    for (const id of links) assert.ok(seen.has(id), "Missing anchor " + id);
    const tags = [...html.matchAll(/<(?:a|link|img|script)\b[^>]*>/gu)].map((m) => m[0]);
    for (const tag of tags) {
      for (const key of ["href", "src"]) {
        const url = attribute(tag, key);
        if (!url || url.startsWith("#")) continue;
        assert.ok(!/^javascript:|^data:text\/html/i.test(url), "Unsafe URL: " + url);
        if (!url.startsWith("/")) continue;
        const pathname = new URL(url, site).pathname;
        assert.ok(existsSync(localOutput(pathname)), "Unresolved " + key + " in log " + n + ": " + url);
      }
    }
    for (const match of html.matchAll(/<img\b[^>]*>/gu)) {
      const tag = match[0];
      assert.ok(attribute(tag, "alt") !== null, "Image is missing alt text");
      assert.ok(Number(attribute(tag, "width")) > 0, "Image width absent");
      assert.ok(Number(attribute(tag, "height")) > 0, "Image height absent");
    }
    assert.ok(!/(\sonclick|\sonload|\sonerror)\s*=/iu.test(html), "Inline event handler in generated page");
  });
}

test("all ten pages are non-empty and static build contains the three log 7 diagrams", () => {
  for (const path of pagePaths) assert.ok(read(path).length > 1200, "Unexpectedly empty " + path);
  for (const name of ["compiler-architecture", "incremental-invalidation", "wasm-profiles"]) {
    assert.ok(existsSync(join(dist, "logs/7/" + name + ".svg")), "Missing diagram " + name);
  }
});

test("all rendered blog code samples are focusable when horizontally scrollable", () => {
  for (const [index, html] of pages.entries()) {
    const codeBlocks = [...html.matchAll(/<pre\b[^>]*>/gu)].map((match) => match[0]);
    for (const block of codeBlocks) {
      assert.ok(/\btabindex="0"/u.test(block),
        "Log " + (index + 1) + " has a keyboard-inaccessible pre element: " + block);
    }
  }
});
