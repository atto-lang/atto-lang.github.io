import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const figures = [
  "01-semantic-layers.svg",
  "02-compiler-pipeline.svg",
  "03-memory-ownership.svg",
  "04-actor-runtime.svg",
  "05-backend-conformance.svg",
  "06-type-guarantees.svg",
  "07-execution-context.svg",
  "08-hot-upgrade.svg",
  "09-tenant-security.svg",
  "10-performance-evidence.svg", "11-structured-concurrency.svg"
];
const slugs = [
  "01-language-design", "02-compiler-architecture",
  "03-memory-ownership-and-zero-gc", "04-actor-runtime-and-concurrency",
  "05-portable-aot-and-backends", "06-type-system-and-static-guarantees",
  "07-execution-context-and-scheduling", "08-durable-actors-and-hot-upgrades",
  "09-multi-tenant-isolation-and-security", "10-performance-and-conformance", "11-async-programming-and-structured-concurrency"
];
const required = [
  "whitepapers/index.html", "whitepapers/README.md", "whitepapers/STATUS.md", "whitepapers/AUDIT.md",
  "scripts/check-whitepapers-build.mjs", ".github/workflows/whitepapers.yml",
  "_layouts/whitepaper.html", "whitepapers/assets/css/whitepapers.css",
  ...figures.map(name => "whitepapers/assets/" + name),
  ...slugs.map(slug => "whitepapers/" + slug + ".md")
];
for (const file of required) {
  assert.ok(existsSync(resolve(root, file)), "missing required publication file: " + file);
}
const mdFiles = required.filter(file => file.endsWith(".md"));
const permalinks = new Set();
for (const file of mdFiles) {
  const body = readFileSync(resolve(root, file), "utf8");
  assert.ok(body.startsWith("---\n"), file + ": missing Jekyll front matter");
  const closing = body.indexOf("\n---\n", 4);
  assert.ok(closing >= 0, file + ": unterminated Jekyll front matter");
  const front = body.slice(4, closing);
  assert.ok(front.includes("title:"), file + ": front matter has no title");
  assert.ok(front.includes("layout: whitepaper"), file + ": shared paper layout missing");
  const line = front.split("\n").find(value => value.startsWith("permalink:"));
  assert.ok(line, file + ": front matter has no permalink");
  const permalink = line.slice("permalink:".length).trim();
  assert.ok(!permalinks.has(permalink), "duplicate permalink: " + permalink);
  permalinks.add(permalink);
  const fences = body.split("\n").filter(value => value.startsWith("```")).length;
  assert.equal(fences % 2, 0, file + ": unbalanced fenced code blocks");
  if (slugs.some(slug => file.includes(slug))) {
    assert.ok(body.includes("Status:**") || body.includes("Status:"), file + ": missing status declaration");
    const match = body.match(/<img[^>]+src="\/whitepapers\/assets\/([^"]+)"[^>]*>/);
    assert.ok(match, file + ": missing architecture figure");
    assert.ok(match[0].includes(" alt=\"") && !match[0].includes('alt=""'), file + ": figure needs descriptive alt text");
    assert.ok(match[0].includes('loading="lazy"') && match[0].includes('decoding="async"'), file + ": figure should load lazily");
    assert.ok(existsSync(resolve(root, "whitepapers/assets", match[1])), file + ": figure file missing");
    assert.ok(body.includes('href="/whitepapers/assets/' + match[1] + '"') && body.includes('Open full-size diagram (SVG)'), file + ": missing accessible full-size figure link");
  }
  for (const [, href] of body.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#|data:)/i.test(href)) continue;
    const clean = href.split("#")[0].split("?")[0];
    if (!clean) continue;
    let target = resolve(dirname(resolve(root, file)), decodeURIComponent(clean));
    if (!existsSync(target) && clean.endsWith(".html")) target = target.slice(0, -5) + ".md";
    assert.ok(existsSync(target), file + ": broken relative source link: " + href);
  }
}
for (const name of figures) {
  const svg = readFileSync(resolve(root, "whitepapers/assets", name), "utf8");
  assert.ok(svg.includes("<svg ") && svg.includes('role="img"'), name + ": SVG lacks image role");
  assert.ok(svg.includes("<title ") && svg.includes("<desc "), name + ": SVG needs accessible title and description");
  assert.ok(!/<script\b|<foreignObject\b|(?:href|xlink:href)\s*=|<[^>]+\bon[a-z]+\s*=|javascript\s*:/i.test(svg), name + ": active or external SVG content is prohibited");
}
const page = readFileSync(resolve(root, "whitepapers/index.html"), "utf8");
assert.ok(page.toLowerCase().startsWith("<!doctype html>"));
assert.ok(page.includes('href="/whitepapers/assets/css/whitepapers.css"'));
for (const slug of slugs) assert.ok(page.includes(slug + ".html"), "landing page missing paper link: " + slug);
const layout = readFileSync(resolve(root, "_layouts/whitepaper.html"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/whitepapers.yml"), "utf8");
assert.ok(workflow.includes("actions/jekyll-build-pages@v1.0.13") && workflow.includes("node scripts/check-whitepapers-build.mjs"), "workflow must run the actual Jekyll build and rendered-output check");
assert.ok(layout.includes("{{ content }}") && layout.includes("whitepapers.css"), "shared layout must render content and shared styles");
assert.ok(layout.includes('class="wp-skip-link" href="#paper-content"') && layout.includes('rel="canonical"'), "paper layout must support skip links and canonical URLs");
const accessibleCSS = readFileSync(resolve(root, "whitepapers/assets/css/whitepapers.css"), "utf8");
assert.ok(accessibleCSS.includes("a:focus-visible") && accessibleCSS.includes(".wp-figure figcaption a"), "keyboard focus and diagram links need styles");
assert.ok(page.includes("distinguish language design goals from implemented behavior"));
assert.ok(page.includes("Eleven authored papers") && page.includes("11-async-programming-and-structured-concurrency.html"), "landing page must index paper 11");
assert.ok(page.includes("Topics for subsequent editions · Papers 12–15") && !page.includes("Papers 11–15"), "roadmap must not include a published paper");
assert.ok(page.includes('class="wp-skip-link" href="#main-content"') && page.includes('id="main-content"'), "landing page must support keyboard skip navigation");
const paperReadLinks = [...page.matchAll(/Read paper \d{2} ↗/g)];
assert.equal(paperReadLinks.length, slugs.length, "each paper must have a distinct accessible link label");
const paper11 = readFileSync(resolve(root, "whitepapers/11-async-programming-and-structured-concurrency.md"), "utf8");
assert.ok(paper11.includes("Cancellation is a protocol") && paper11.includes("Backend conformance matrix"), "paper 11 must cover cancellation protocol and conformance");
const audit = readFileSync(resolve(root, "whitepapers/AUDIT.md"), "utf8");
assert.ok(audit.includes("Graphics inventory") && audit.includes("Remaining publication gates"), "audit report should document diagrams and publication gates");
console.log("PASS: " + required.length + " files, " + mdFiles.length + " Markdown documents, " +
  figures.length + " accessible SVGs, unique permalinks, local links, and landing-page navigation.");
