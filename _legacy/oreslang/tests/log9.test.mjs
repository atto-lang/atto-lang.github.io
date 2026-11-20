import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const article = read("src/pages/logs/9.astro");
const previous = read("src/pages/logs/8.astro");
const inventory = JSON.parse(read("src/data/engineering-log-examples.json"));

test("Orleans article is registered with honest date and metadata", () => {
  assert.ok(engineeringLogs.some((entry) => entry.number === 9));
  assert.equal(engineeringLogs.find((entry) => entry.number === 9).title, "What AttoLang learns from Microsoft Orleans");
  assert.match(article, /<h1>What AttoLang learns from Microsoft Orleans<\/h1>/u);
  assert.match(article, /published: "2026-11-01", modified: "2026-11-02", author: "Alex Mills"/u);
  assert.match(article, /href="\/logs\/8\/"/u);
  assert.match(article, /href="\/logs\/"/u);
  assert.match(previous, /href="\/logs\/9\/"/u);
});

test("every navigation anchor has a distinct section in the same order", () => {
  const toc = article.split('<aside class="log-toc"')[1]?.split("</aside>")[0];
  assert.ok(toc);
  const targets = [...toc.matchAll(/href="#([^"]+)"/gu)].map((m) => m[1]);
  const sections = [...article.matchAll(/<section class="log-section" id="([^"]+)"/gu)].map((m) => m[1]);
  assert.ok(targets.length >= 8);
  assert.equal(new Set(sections).size, sections.length);
  assert.deepEqual(targets, sections);
});

test("virtual actor illustration is explicitly unverified and Astro-safe", () => {
  assert.match(article, /define virtual actor Cart as/u);
  assert.match(article, /illustrative design syntax, not compiler-verified AttoLang/u);
  assert.match(article, /this article describes design direction, not a verified implementation/u);
  assert.match(article, /&#123;/u);
  assert.match(article, /&#125;/u);
  const blocks = [...article.matchAll(/<pre\b[^>]*><code>([\s\S]*?)<\/code><\/pre>/gu)];
  assert.equal(blocks.length, 2);
  for (const [, code] of blocks) assert.doesNotMatch(code, /[{}]/u);
  const examples = inventory.examples.filter((item) => item.log === 9);
  assert.deepEqual(examples.map((item) => item.ordinal), [1, 2]);
  for (const example of examples) {
    assert.equal(example.source, "src/pages/logs/9.astro");
    assert.equal(example.status, "illustrative");
    assert.equal(example.compilerVerified, false);
    assert.equal(example.verificationRun, null);
    assert.deepEqual(example.verifiedBackends, []);
  }
});

test("Orleans attribution and nuanced delivery semantics are prominent", () => {
  assert.match(article, /href="https:\/\/learn\.microsoft\.com\/en-us\/dotnet\/orleans\/grains\/grain-identity"/u);
  assert.match(article, /href="https:\/\/learn\.microsoft\.com\/en-us\/dotnet\/orleans\/implementation\/messaging-delivery-guarantees"/u);
  assert.match(article, /at-most-once message delivery without retries by default/u);
  assert.match(article, /A stable key is not itself durable storage/u);
  assert.match(article, /Microsoft Orleans is a Microsoft project, not an AttoLang component/u);
});

test("Orleans persistence and distribution risks are accurately called out", () => {
  assert.ok(article.includes("application code must explicitly trigger writes after changes"));
  assert.ok(article.includes("default eventually consistent directory can permit duplicate activations"));
  assert.ok(article.includes("Orleans 10 introduces a strongly consistent in-cluster directory as a preview feature"));
  assert.ok(article.includes("A key is an address, not a bearer credential"));
  assert.ok(article.includes("every remote dispatch must validate authorization independently"));
  assert.ok(article.includes("cycles of awaited requests between grains can deadlock"));
  assert.ok(article.includes("cleanup callbacks cannot be assumed to run"));
  assert.ok(article.includes("canonical-key collision attempts"));
});
