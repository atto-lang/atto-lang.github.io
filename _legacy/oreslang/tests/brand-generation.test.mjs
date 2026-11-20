import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("brand raster builder uses pinned SVG geometry without external resources", () => {
  const p = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const generator = read("scripts/build-brand-assets.mjs");
  assert.equal(p.scripts.build, "node scripts/build-brand-assets.mjs && astro check && astro build && node scripts/write-deployment-manifest.mjs");
  assert.equal(lock.packages["node_modules/sharp"].version, "0.35.5");
  assert.match(generator, /sharp\(Buffer\.from\(black\)\)/u);
  assert.match(generator, /sharp\(Buffer\.from\(white\)\)/u);
  assert.match(generator, /sharp\(Buffer\.from\(social\)\)/u);
  assert.match(generator, /sharp\(Buffer\.from\(favicon\)\)/u);
  assert.match(generator, /assert\.doesNotMatch\(svg, \/<script/u);
});

test("brand downloads are discoverable with stable source and generated asset names", () => {
  const brand = read("src/pages/brand.astro");
  const files = [
    "/attolang-wordmark.svg",
    "/attolang-wordmark-light.svg",
    "/brand/attolang-black.png",
    "/brand/attolang-white.png",
    "/brand/attolang-social.png",
    "/brand/attolang-icon-180.png",
  ];
  for (const href of files) assert.ok(brand.includes('href="' + href + '"'), href);
  assert.ok(read("src/pages/links.astro").includes('href="/brand/"'));
  assert.ok(read("README.md").includes("brand assets"));
});

test("SEO old-name aliases stay confined to historical migration context", () => {
  const about = read("src/pages/about.astro");
  assert.match(about, /AttoLang was formerly known as Oreslang/u);
  const layout = read("src/layouts/BaseLayout.astro");
  assert.match(layout, /alternateName: \["Oreslang", "OresLang"\]/u);
  assert.match(layout, /name="twitter:card" content="summary_large_image"/u);
  assert.match(layout, /property="og:image:type" content="image\/png"/u);
  assert.match(layout, /new URL\("\/brand\/attolang-social\.png", Astro\.site\)/u);
  assert.match(layout, /rel="apple-touch-icon"/u);
});
