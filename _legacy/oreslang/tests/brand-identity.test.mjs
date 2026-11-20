import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const home = read("src/pages/index.astro");
const nav = read("src/components/SiteNav.astro");
const layout = read("src/layouts/BaseLayout.astro");

function astroFiles(dir) {
  return readdirSync(new URL("../" + dir + "/", import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? astroFiles(path) : path.endsWith(".astro") ? [path] : [];
    });
}

test("AttoLang is the visible site identity in navigation, hero, metadata and discovery", () => {
  assert.match(nav, /aria-label="AttoLang home"><img class="brand-logo" src="\/attolang-wordmark\.svg"/u);
  assert.match(home, /title="AttoLang — isolation-first systems programming"/u);
  assert.match(home, /class="display-word"><img class="brand-logo" src="\/attolang-wordmark\.svg" alt="AttoLang"/u);
  assert.match(home, /class="hero-equation-name">AttoLang<\/span>/u);
  assert.match(layout, /property="og:site_name" content="AttoLang"/u);
  assert.match(layout, /class="footer-brand" href="\/" aria-label="AttoLang home"><img class="brand-logo"/u);
  assert.match(layout, /title="AttoLang Engineering Logs"/u);
  assert.match(layout, /alternateName: \["Oreslang", "OresLang"\]/u);
  assert.match(read("src/pages/rss.xml.ts"), /AttoLang engineering logs/u);
  assert.match(read("public/llms.txt"), /^# AttoLang\s*$/mu);
  assert.match(read("src/pages/language/index.astro"), /AttoLang language reference/u);
});

test("pages and components no longer advertise the previous product name", () => {
  for (const path of [
    ...astroFiles("src/pages").filter((path) => path !== "src/pages/about.astro"),
    ...astroFiles("src/components"),
    ...astroFiles("src/layouts"),
  ]) {
    // The one historical-name alias in home-page structured data is intentional.
    const source = path === "src/layouts/BaseLayout.astro"
      ? read(path).replace(/^\s*alternateName: \["Oreslang", "OresLang"\],?\s*$/mu, "")
      : read(path);
    assert.doesNotMatch(source, /\bOresLang\b|\bOreslang\b/u,
      path + " retains a legacy public-facing brand reference");
  }
});

test("the marketing rename preserves stable URLs, grammar IDs and preferences", () => {
  assert.match(home, /href="\/erlang-rust-oreslang\/"/u);
  assert.match(layout, /localStorage\.getItem\("oreslang-theme"\)/u);
  assert.match(read("src/components/OresCode.astro"), /"oreslang"/u);
  assert.match(read("public/llms.txt"),
    /https:\/\/ores-truffle-oreslang\.github\.io\//u);
  assert.match(read("src/pages/links.astro"),
    /https:\/\/github\.com\/ores-truffle-oreslang\/oreslang-source\.java/u);
});
