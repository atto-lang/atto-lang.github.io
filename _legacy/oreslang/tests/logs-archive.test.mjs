import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const index = read("src/pages/logs/index.astro");
const pages = Array.from({ length: 10 }, (_, i) => read(`src/pages/logs/${i + 1}.astro`));
const contents = Array.from({ length: 10 }, (_, i) =>
  i < 5 ? read(`src/components/Log${i + 1}Content.astro`) : ""
);
const prompts = read("src/components/LogPrompt.astro");
const archiveEntries = engineeringLogs.map((entry) => [null, String(entry.number), entry.title]);
const normalize = (value) => value.replace(/\s+/gu, " ").trim().toLowerCase();

test("archive lists each of the ten log articles once, newest first", () => {
  assert.deepEqual(archiveEntries.map((m) => Number(m[1])), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(new Set(archiveEntries.map((m) => m[1])).size, 10);
  assert.match(index, /engineeringLogs\.map\(/u);
  assert.match(index, /src\/data\/engineering-logs|\.\.\/\.\.\/data\/engineering-logs/u);
});

for (let n = 1; n <= 10; n++) {
  test(`Log ${String(n).padStart(3, "0")} has one meaningful h1, metadata and an accessible prompt`, () => {
    const source = pages[n - 1];
    const headings = [...source.matchAll(/<h1\b[^>]*>([^<]+)<\/h1>/gu)];
    assert.equal(headings.length, 1, "Exactly one semantic article title");
    const title = archiveEntries.find((e) => Number(e[1]) === n)?.[2];
    assert.ok(title, "Index must contain the article");
    assert.equal(normalize(headings[0][1]), normalize(title));
    assert.match(source, /<LogPrompt\b[^>]*headingTag="span"/u);
    assert.match(source, /article=\{\{\s*published: "\d{4}-\d{2}-\d{2}",\s*modified: "\d{4}-\d{2}-\d{2}",\s*author: "Alex Mills"/u);
    assert.match(source, /<time datetime="\d{4}-\d{2}/u);
    assert.match(source, /<article class="log-article prose"/u);
    assert.match(source, /<nav class="log-breadcrumb"/u);
  });

  test(`Log ${n} table-of-contents anchors resolve to ordered unique sections`, () => {
    const source = pages[n - 1];
    const toc = source.split('<aside class="log-toc"')[1]?.split("</aside>")[0];
    assert.ok(toc, "Missing table of contents");
    const targets = [...toc.matchAll(/href="#([^"]+)"/gu)].map((m) => m[1]);
    const body = source + contents[n - 1];
    const sections = [...body.matchAll(/<section\b[^>]*\bid="([^"]+)"/gu)].map((m) => m[1]);
    assert.ok(targets.length >= 5, "Unexpectedly few TOC links");
    assert.equal(new Set(sections).size, sections.length, "Duplicate section ids");
    assert.deepEqual(targets, sections, "TOC and semantic sections disagree");
  });

  test(`Log ${n} footer preserves previous, next and archive navigation`, () => {
    const footer = pages[n - 1].split('<nav class="log-entry-footer"')[1];
    assert.ok(footer, "Missing article footer");
    assert.match(footer, /href="\/logs\/"/u);
    if (n > 1) assert.ok(footer.includes(`href="/logs/${n - 1}/"`), "Missing previous article");
    if (n < 9) assert.ok(footer.includes(`href="/logs/${n + 1}/"`), "Missing next article");
  });
}

test("prompt headings default to presentation-only content", () => {
  assert.match(prompts, /headingTag = "span"/u);
  assert.match(prompts, /<details class="log-prompt-disclosure">/u);
  assert.match(prompts, /<summary class="log-prompt-summary">/u);
});

test("canonical domain, robots and sitemap remain consistent", () => {
  assert.match(read("astro.config.mjs"), /site: "https:\/\/ores-truffle-oreslang\.github\.io"/u);
  assert.match(read("public/robots.txt"), /Sitemap: https:\/\/ores-truffle-oreslang\.github\.io\/sitemap\.xml/u);
  assert.match(read("src/pages/sitemap.xml.ts"), /import\.meta\.glob\("\.\/\*\*\/\*\.astro"\)/u);
});

test("catalog dates, titles and author never drift from article metadata", () => {
  assert.equal(engineeringLogs.length, pages.length);
  assert.deepEqual(engineeringLogs.map((entry) => entry.number), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (const entry of engineeringLogs) {
    const source = pages[entry.number - 1];
    const match = source.match(/article=\{\{\s*published: "([^"]+)",\s*modified: "([^"]+)",\s*author: "([^"]+)"/u);
    assert.ok(match, "Missing metadata in log " + entry.number);
    assert.deepEqual(match.slice(1), [entry.published, entry.modified, entry.author]);
    assert.ok(!Number.isNaN(Date.parse(entry.published)), "Invalid date for log " + entry.number);
    assert.ok(entry.modified >= entry.published, "Modified date precedes published date");
    assert.ok(entry.summary.length >= 65, "Summary too short for log " + entry.number);
    assert.equal(new Set(engineeringLogs.map((e) => e.number)).size, engineeringLogs.length);
  }
});
