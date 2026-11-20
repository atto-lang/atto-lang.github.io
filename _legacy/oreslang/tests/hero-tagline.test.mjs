import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const palettes = readFileSync(new URL("../src/styles/themes.css", import.meta.url), "utf8");

test("the homepage intro is immediately followed by the exact, stylized tagline", () => {
  const intro = home.indexOf('class="hero-copy"');
  const equation = home.indexOf('class="hero-tldr"');
  const aside = home.indexOf('class="hero-note"');
  assert.ok(intro >= 0 && equation > intro && aside > equation);
  const markup = home.slice(home.indexOf('<p class="hero-tldr">'), home.indexOf("</p>", equation) + 4);
  const renderedText = markup.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(renderedText, "In short, AttoLang = ~(erlang + rust)");
  for (const token of ["hero-equation-name", "hero-equation-operator", "hero-equation-language"]) {
    assert.ok(markup.includes(token));
  }
});

test("identity badge uses responsive mono type and the existing semantic theme tokens", () => {
  assert.ok(css.includes(".hero-equation {"));
  assert.ok(css.includes('"IBM Plex Mono"'));
  assert.ok(css.includes("font: 600 clamp(.79rem, 1.55vw, 1.01rem)"));
  assert.ok(css.includes("var(--accent-border)"));
  assert.ok(css.includes("var(--accent-glow)"));
  assert.ok(css.includes("var(--orange)"));
  assert.ok(css.includes("flex-wrap: wrap"));
  for (const theme of ["dark", "navy", "light"]) {
    assert.ok(palettes.includes('html[data-theme="' + theme + '"]'));
  }
});
