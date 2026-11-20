import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const article = read("src/pages/logs/7.astro");
const index = read("src/pages/logs/index.astro");
const previous = read("src/pages/logs/6.astro");
const promptComponent = read("src/components/LogPrompt.astro");

const getAttribute = (tag, name) => {
  const match = tag.match(new RegExp(name + '="([^"]*)"', "u"));
  return match?.[1] ?? null;
};

test("Log 007 has a unique page h1, article metadata and accessible prompt", () => {
  assert.equal((article.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(article, /<LogPrompt[^>]+headingTag="span"/u);
  assert.match(promptComponent, /headingTag\?: "h1" \| "span"/u);
  assert.match(promptComponent, /<PromptHeading class="log-prompt-heading">/u);
  assert.match(article, /article=\{\{ published: "2026-10-14", modified: "2026-10-14"/u);
  assert.match(article, /<article class="log-article prose"/u);
});

test("All table-of-contents anchors map to unique semantic sections", () => {
  const links = [...article.matchAll(/<a href="#([^"]+)">/gu)].map((x) => x[1]);
  const ids = [...article.matchAll(/<section class="log-section" id="([^"]+)">/gu)].map((x) => x[1]);
  assert.equal(links.length, 11);
  assert.equal(new Set(ids).size, ids.length, "Duplicate section IDs");
  assert.deepEqual(links, ids, "TOC and article sections must match in order");
});

test("All three image references are local, responsive, and have descriptive alt text", () => {
  const images = [...article.matchAll(/<img\b[^>]*>/gu)].map((x) => x[0]);
  assert.equal(images.length, 3);
  assert.equal((article.match(/<figcaption>/gu) ?? []).length, 3);
  assert.match(article, /img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto;/u);
  for (const tag of images) {
    const src = getAttribute(tag, "src");
    const alt = getAttribute(tag, "alt");
    assert.ok(src?.startsWith("/logs/7/"), "Non-local image source: " + src);
    assert.ok(!src.includes(".."), "Path traversal in image source: " + src);
    assert.ok(alt && alt.length >= 45, "Missing or uninformative alt: " + src);
    assert.equal(getAttribute(tag, "loading"), "lazy");
    assert.equal(getAttribute(tag, "decoding"), "async");
    assert.ok(Number(getAttribute(tag, "width")) > 0);
    assert.ok(Number(getAttribute(tag, "height")) > 0);
    assert.ok(existsSync(join(root, "public", src.slice(1))), "Image missing: " + src);
  }
});

test("SVG diagrams are standalone, accessible, well nested and have no executable or external content", () => {
  const files = [
    "public/logs/7/compiler-architecture.svg",
    "public/logs/7/incremental-invalidation.svg",
    "public/logs/7/wasm-profiles.svg",
  ];
  for (const file of files) {
    const svg = read(file);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/u);
    assert.match(svg, /<title id="title">[^<]+<\/title>/u);
    assert.match(svg, /<desc id="desc">[^<]+<\/desc>/u);
    assert.match(svg, /role="img"/u);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image|iframe)\b/iu);
    assert.doesNotMatch(svg, /\bon(?:load|click|error|mouseover)\s*=/iu);
    assert.doesNotMatch(svg, /(?:https?:)?\/\/(?!www\.w3\.org\/2000\/svg)/iu);
    assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/iu);

    const stack = [];
    const tags = [...svg.matchAll(/<\/?[A-Za-z][^<>]*>/gu)].map((x) => x[0]);
    assert.ok(tags.length >= 10, "Diagram unexpectedly empty: " + file);
    for (const tag of tags) {
      const name = tag.match(/^<\/?([A-Za-z][\w.:-]*)/u)?.[1];
      assert.ok(name, "Unrecognized XML tag: " + tag);
      if (tag.startsWith("</")) {
        assert.equal(stack.pop(), name, "Mismatched SVG end tag in " + file);
      } else if (!tag.endsWith("/>")) {
        stack.push(name);
      }
    }
    assert.deepEqual(stack, [], "Unclosed SVG tags in " + file);
    assert.match(svg, /<\/svg>$/u);
  }
});

test("AttoLang code samples are Astro-safe and diagrams work on narrow screens", () => {
  const codeBlocks = [...article.matchAll(/<pre\b[^>]*><code>([\s\S]*?)<\/code><\/pre>/gu)].map((m) => m[1]);
  assert.ok(codeBlocks.length >= 3);
  for (const code of codeBlocks) {
    assert.doesNotMatch(code, /[{}]/u, "Astro code text must escape brace tokens");
  }
  assert.match(article, /pub fnc calculate\(int x\) : int &#123;/u);
  assert.match(article, /&#125;<\/code><\/pre>/u);
  assert.equal((article.match(/class="log7-diagram-scroller"/gu) ?? []).length, 3);
  assert.equal((article.match(/tabindex="0"/gu) ?? []).length >= 3, true);
  assert.equal((article.match(/View full-size diagram/gu) ?? []).length, 3);
  assert.match(article, /min-width: 880px;/u);
  assert.match(article, /overflow-x: auto;/u);
});

test("Log 007 is discoverable and adjacent articles link correctly", () => {
  assert.match(index, /engineeringLogs\.map\(/u);
  assert.ok(engineeringLogs.some((entry) => entry.number === 7));
  assert.equal(engineeringLogs[0].number, 10);
  assert.match(article, /href="\/logs\/8\/"/u);
  assert.match(previous, /href="\/logs\/7\/"/u);
  assert.match(article, /href="\/logs\/6\/"/u);
  assert.match(article, /href="\/logs\/"/u);
  assert.match(article, /href="https:\/\/rustc-dev-guide\.rust-lang\.org\//u);
});
