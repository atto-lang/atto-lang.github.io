import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("AttoLang is the public site brand across primary discovery surfaces", () => {
  assert.match(source("src/pages/index.astro"), /title="AttoLang — isolation-first systems programming"/u);
  assert.match(source("src/pages/index.astro"), /class="hero-equation-name">AttoLang<\/span>/u);
  assert.match(source("src/components/SiteNav.astro"), /aria-label="AttoLang home"><img class="brand-logo" src="\/attolang-wordmark\.svg"/u);
  assert.match(source("src/layouts/BaseLayout.astro"), /property="og:site_name" content="AttoLang"/u);
  assert.match(source("src/layouts/BaseLayout.astro"), /class="footer-brand" href="\/" aria-label="AttoLang home"><img class="brand-logo"/u);
  assert.match(source("public/llms.txt"), /^# AttoLang$/mu);
  assert.match(source("src/pages/rss.xml.ts"), /<title>AttoLang engineering logs<\/title>/u);
  assert.match(source("src/pages/comparisons.astro"), /Compare AttoLang with/u);
});

test("editorial pages do not expose the former display name", () => {
  for (const path of [
    "src/pages/index.astro",
    "src/pages/how-it-works.astro",
    "src/pages/examples.astro",
    "src/pages/language/index.astro",
    "src/pages/paradigms.astro",
    "src/pages/philosophy.astro",
    "src/pages/problem-spaces.astro",
    "src/pages/comparisons.astro",
    "src/pages/performance.astro",
    "src/pages/erlang-rust-oreslang.astro",
    "src/pages/links.astro",
    "src/pages/licenses.astro",
    "src/data/engineering-logs.mjs",
    "src/data/comparisons.mjs",
  ]) {
    assert.doesNotMatch(source(path), /\b(?:Oreslang|OresLang)\b/u, path);
  }
});

test("historical product name appears only in an explicit migration note", () => {
  const about = source("src/pages/about.astro");
  assert.match(about, /AttoLang was formerly known as Oreslang/u);
  assert.equal((about.match(/\bOreslang\b/gu) ?? []).length, 1);
});

test("existing GitHub URLs, internal routes, and compatibility identifiers stay intact", () => {
  assert.match(source("src/pages/index.astro"), /href="\/erlang-rust-oreslang\/"/u);
  assert.match(source("src/pages/index.astro"), /https:\/\/github\.com\/ores-truffle-oreslang\/oreslang-source\.java/u);
  assert.match(source("src/layouts/BaseLayout.astro"), /oreslang-theme/u);
});
