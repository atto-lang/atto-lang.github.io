import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../src/pages/logs/index.astro");
const log1 = read("../src/pages/logs/1.astro");
const log2 = read("../src/pages/logs/2.astro");
const body = read("../src/components/Log2Content.astro");
const promptDisclosure = read("../src/components/LogPrompt.astro");
const nav = read("../src/components/SiteNav.astro");
const layout = read("../src/layouts/BaseLayout.astro");

test("engineering log 2 is indexed, canonical, and navigable from log 1", () => {
  assert.ok(index.includes("engineeringLogs.map("));
  assert.ok(engineeringLogs.some((entry) => entry.number === 2));
  assert.ok(engineeringLogs.findIndex((entry) => entry.number === 2) < engineeringLogs.findIndex((entry) => entry.number === 1), "newest entry first");
  assert.ok(log1.includes('href="/logs/2/"'));
  assert.ok(log2.includes('href="/logs/1/"'));
  assert.ok(log2.includes('href="/logs/"'));
  assert.ok(nav.includes('label: "logs", href: "/logs/"'));
  assert.ok(layout.includes("new URL(Astro.url.pathname, Astro.site)"));
  assert.ok(log2.includes('import "../../styles/logs.css"'));
});

test("log 2 follows article structure, metadata, original-prompt disclosure, and TOC", () => {
  assert.ok(log2.includes('title="Beyond GraalVM and LLVM: AttoLang everywhere'));
  assert.ok(log2.includes('datetime="2026-10-10"'));
  assert.ok(log2.includes("Alex Mills"));
  assert.ok(log2.includes("<LogPrompt prompt={prompt}"));
  assert.ok(promptDisclosure.includes('class="log-prompt-disclosure"'));
  assert.ok(promptDisclosure.includes('class="log-prompt-reveal"'));
  assert.ok(log2.includes("<Log2Content />"));
  assert.ok(log2.includes('aria-label="Engineering log #2"'));
  for (const id of ["three-axes", "runtime-landscape", "platform-matrix",
    "file-headers", "compiler-pipeline", "package-policy", "actor-portability",
    "implementation-status"]) {
    assert.ok(log2.includes('href="#' + id + '"'), "TOC link " + id);
    assert.ok(body.includes('id="' + id + '"'), "matching article anchor " + id);
  }
});

test("log 2 covers portable execution routes and source admission contract", () => {
  for (const term of ["WebAssembly", "WASI", "Android DEX", "iOS", "Cranelift",
    "MLIR", "JavaScript", "C source", "embedded", "browser",
    "actors", "suspends", "capabilities", "targets(A) ⊆ targets(B)",
    "requires(B) ⊆ requires(A)", "import graph", "Typed AttoLang IR"]) {
    assert.ok(body.toLowerCase().includes(term.toLowerCase()), "missing " + term);
  }
  assert.ok(body.includes('import OresCode from "./OresCode.astro"'));
  assert.equal((body.match(/<OresCode /g) || []).length, 2);
  assert.ok(body.includes("// ores:targets=browser,edge-js,android,ios,server"));
  assert.ok(body.includes("// ores:requires=net.client,clock"));
  assert.ok(body.includes("Target architecture, not a depiction of completed AttoLang backend support."));
});

test("log 2 does not misrepresent proposed work as shipping capability", () => {
  assert.ok(body.includes("not accepted by the current"));
  assert.ok(body.includes("the initial <em>opt-in prototype syntax</em>"));
  assert.ok(body.includes("PR #586"));
  assert.ok(body.includes("PR #74"));
  assert.ok(body.includes("require exact-head test validation before merge"));
  assert.ok(body.includes("not an announcement of full browser, iOS, Android, edge or embedded AttoLang support"));
  assert.ok(body.includes("The runtime still has to enforce actual authority"));
  assert.ok(!body.includes("production-ready mobile backend"));
});

test("log 2 has accessible tables and responsive semantic styling", () => {
  assert.equal((body.match(/class="log-table-scroll" role="region" tabindex="0"/g) || []).length, 2);
  assert.ok(body.includes("<figcaption>"));
  assert.ok(body.includes(".log2-axis-grid"));
  assert.ok(body.includes(".log2-output-grid"));
  assert.ok(body.includes("@media(max-width:750px)"));
  assert.ok(body.includes("var(--orange)"));
});
