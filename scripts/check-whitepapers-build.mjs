import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ASSETS } from "../.github/scripts/package-playground.mjs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), process.env.ATTO_RENDERED_SITE_ROOT || "_site");
const slugs = [
  "01-language-design", "02-compiler-architecture",
  "03-memory-ownership-and-zero-gc", "04-actor-runtime-and-concurrency",
  "05-portable-aot-and-backends", "06-type-system-and-static-guarantees",
  "07-execution-context-and-scheduling", "08-durable-actors-and-hot-upgrades",
  "09-multi-tenant-isolation-and-security", "10-performance-and-conformance",
  "11-async-programming-and-structured-concurrency"
];
const required = [
  "whitepapers/index.html",
  "whitepapers/README.html",
  "whitepapers/STATUS.html",
  "whitepapers/AUDIT.html",
  "whitepapers/assets/css/whitepapers.css",
  ...slugs.map(slug => "whitepapers/" + slug + ".html"),
  ...[
    "01-semantic-layers.svg", "02-compiler-pipeline.svg",
    "03-memory-ownership.svg", "04-actor-runtime.svg",
    "05-backend-conformance.svg", "06-type-guarantees.svg",
    "07-execution-context.svg", "08-hot-upgrade.svg",
    "09-tenant-security.svg", "10-performance-evidence.svg",
    "11-structured-concurrency.svg"
  ].map(file => "whitepapers/assets/" + file)
];
for (const path of required) {
  assert.ok(existsSync(resolve(root, path)), "Jekyll output missing: " + path);
}
const index = readFileSync(resolve(root, "whitepapers/index.html"), "utf8");
assert.ok(index.includes("Eleven authored papers"), "landing page count not rendered");
assert.ok(index.includes("Papers 12–15"), "planned papers range is stale");
assert.ok(index.includes('href="#main-content"') && index.includes('id="main-content"'), "index skip link not rendered");
for (const slug of slugs) {
  const html = readFileSync(resolve(root, "whitepapers", slug + ".html"), "utf8");
  assert.ok(html.includes("<!doctype html>"), slug + ": document shell missing");
  assert.ok(html.includes('<article class="wp-article" id="paper-content">'), slug + ": shared layout not applied");
  assert.ok(html.includes("<figure class=\"wp-figure\">"), slug + ": figure not rendered");
  assert.ok(html.includes("<img "), slug + ": figure image missing");
  assert.ok(html.includes('href="#paper-content"') && html.includes('rel="canonical"'), slug + ": skip link or canonical URL missing");
  assert.ok(html.includes("Open full-size diagram (SVG)") && html.includes('href="/whitepapers/assets/'), slug + ": full-size diagram link missing");
  assert.ok(!html.includes("{{ content }}") && !html.includes("{{ page.title"), slug + ": unresolved Liquid template");
}
const css = readFileSync(resolve(root, "whitepapers/assets/css/whitepapers.css"), "utf8");
assert.ok(css.includes("@media(max-width:680px)") && css.includes("prefers-reduced-motion"), "responsive/reduced-motion rules missing");
// The rendered Jekyll tree is also what the legacy Pages branch publisher
// would expose. Validate its *actual output*, not just the exclusion syntax.
// The protected release packager separately enforces the stricter allowlist.
const documentation = readdirSync(resolve(process.cwd(), "play/docs"))
  .filter(name => name.endsWith(".md"));
for (const name of documentation) {
  if (ASSETS.includes("docs/" + name)) continue; // reviewed public compiler contract
  for (const outputName of [name, name.replace(/\\.md$/i, ".html")]) {
    assert.ok(!existsSync(resolve(root, "play/docs", outputName)),
      "Unapproved internal documentation in Jekyll output: " + outputName);
  }
}
console.log("PASS: Jekyll output excludes unapproved internal playground docs.");

console.log("PASS: Jekyll rendered " + required.length + " required assets, 11 paper pages using the shared layout, figure markup, CSS and landing page.");
