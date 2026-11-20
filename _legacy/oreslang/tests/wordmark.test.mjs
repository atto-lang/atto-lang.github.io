import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("AttoLang wordmark is self-contained, scalable and light/dark ready", () => {
  const dark = source("public/attolang-wordmark.svg");
  const light = source("public/attolang-wordmark-light.svg");
  assert.match(dark, /<svg[^>]+viewBox="0 0 1100 283"/u);
  assert.match(dark, /<path fill="#000" fill-rule="evenodd"/u);
  assert.match(light, /<path fill="#fff" fill-rule="evenodd"/u);
  assert.equal(light, dark.replace('fill="#000"', 'fill="#fff"'));
  for (const markup of [dark, light]) {
    assert.doesNotMatch(markup, /<script|<image|<foreignObject|\bhref\s*=/iu);
  }
});

test("home, global navigation, footer and README all display the same wordmark", () => {
  for (const path of ["src/pages/index.astro", "src/components/SiteNav.astro", "src/layouts/BaseLayout.astro"]) {
    assert.match(source(path), /<img class="brand-logo" src="\/attolang-wordmark\.svg"/u, path);
  }
  const readme = source("README.md");
  assert.match(readme, /public\/attolang-wordmark\.svg/u);
  assert.match(readme, /public\/attolang-wordmark-light\.svg/u);
  assert.match(readme, /alt="AttoLang"/u);
  const theme = source("src/styles/themes.css");
  assert.match(theme, /\.brand-logo \{[^}]+filter: invert\(1\)/su);
  assert.match(theme, /html\[data-theme="light"\] \.brand-logo \{ filter: none; \}/u);
});
