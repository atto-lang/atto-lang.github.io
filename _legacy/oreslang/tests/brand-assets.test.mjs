import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("AttoLang favicon uses the current monochrome design, not the retired orange/brown mark", () => {
  const svg = read("public/favicon.svg");
  assert.match(svg, /viewBox="0 0 64 64"/u);
  assert.match(svg, /aria-label="AttoLang favicon"/u);
  assert.match(svg, /fill="#080b0e"/u);
  assert.match(svg, /stroke="#ffffff"/u);
  assert.doesNotMatch(svg, /#6b472f|#ff6a00/iu);
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|\bhref\s*=/iu);
});

test("social artwork uses the canonical wordmark path and exposes discoverable absolute metadata", () => {
  const social = read("public/social-preview.svg");
  const mainLogo = read("public/attolang-wordmark.svg");
  const path = mainLogo.match(/<path\b[^>]*\/>/su)?.[0];
  assert.ok(path, "canonical AttoLang wordmark path must exist");
  assert.ok(social.includes(path.replace('fill="#000"', 'fill="#ffffff"')));
  assert.match(social, /viewBox="0 0 1200 630"/u);
  assert.doesNotMatch(social, /<script|<image|<foreignObject|\bhref\s*=/iu);
  const layout = read("src/layouts/BaseLayout.astro");
  assert.match(layout, /new URL\("\/brand\/attolang-social\.png", Astro\.site\)\.href/u);
  assert.match(layout, /content="image\/png"/u);
  for (const name of ["og:image", "og:image:type", "og:image:alt", "twitter:image", "twitter:image:alt"]) {
    assert.ok(layout.includes(name), name + " must appear in layout");
  }
  assert.match(layout, /summary_large_image/u);
});
