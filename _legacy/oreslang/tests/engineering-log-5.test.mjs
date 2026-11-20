import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../src/pages/logs/index.astro");
const log4 = read("../src/pages/logs/4.astro");
const log5 = read("../src/pages/logs/5.astro");
const body = read("../src/components/Log5Content.astro");

test("log 5 is indexed newest-first and navigable from log 4", () => {
  assert.ok(index.includes("engineeringLogs.map("));
  assert.ok(engineeringLogs.some((entry) => entry.number === 5));
  assert.ok(engineeringLogs.findIndex((entry) => entry.number === 5) < engineeringLogs.findIndex((entry) => entry.number === 4));
  assert.ok(log4.includes('href="/logs/5/"'));
  assert.ok(log5.includes('href="/logs/4/"'));
  assert.ok(log5.includes('href="/logs/"'));
});

test("log 5 follows the article layout and its table of contents resolves", () => {
  assert.ok(log5.includes('import "../../styles/logs.css"'));
  assert.ok(log5.includes("LogPrompt prompt={prompt}"));
  assert.ok(log5.includes("Log5Content"));
  assert.ok(log5.includes('datetime="2026-10-13"'));
  assert.ok(log5.includes("Alex Mills"));
  assert.ok(log5.includes('aria-label="Engineering log #5"'));
  const ids = ["positioning", "first-run", "github", "search-ai", "distribution",
    "llm-discovery", "canonical-corpus", "agent-context", "architectural-ai",
    "community", "metrics", "plan", "oreslang", "closing"];
  for (const id of ids) {
    assert.ok(log5.includes('href="#' + id + '"'), "TOC link for " + id);
    assert.ok(body.includes('id="' + id + '"'), "body section for " + id);
  }
});

test("log 5 covers open-source marketing, AI tooling, verifiability and ethics", () => {
  for (const term of ["open-source", "README", "license", "CONTRIBUTING",
    "SEO", "llms.txt", "AGENTS.md", "MCP", "compiler", "CI", "community",
    "activation", "retention", "90-day", "AttoLang", "purchased stars"]) {
    assert.ok(body.toLowerCase().includes(term.toLowerCase()), "missing " + term);
  }
  assert.ok(body.includes('class="log-table-scroll" role="region" tabindex="0"'));
  assert.ok(body.includes('https://developers.google.com/search/docs/fundamentals/seo-starter-guide'));
});

test("log 5 distinguishes training exposure from reliable inference-time retrieval", () => {
  for (const phrase of ["pretraining", "fine-tuning", "Stack Overflow", "GitHub",
    "package registries", "search-time knowledge", "workspace context",
    "tool-grounded knowledge", "no public page", "magic pretraining",
    "no universal way", "released docs", "backend", "AGENTS.md",
    "copilot-instructions.md", "llms.txt", "OAI-SearchBot", "GPTBot",
    "ChatGPT-User", "search_language_docs", "oreslang_check",
    "MCP", "compiler", "held-out tasks", "architectural recipes"]) {
    assert.ok(body.toLowerCase().includes(phrase.toLowerCase()), "missing LLM/AEO topic: " + phrase);
  }
});

test("log 5 includes grounding, crawl, and tooling references with no fake deployment claims", () => {
  for (const source of [
    "https://developers.google.com/search/docs/appearance/ai-features",
    "https://developers.openai.com/api/docs/bots",
    "https://llmstxt.org/",
    "https://modelcontextprotocol.io/specification/2025-11-25/server/resources",
  ]) {
    assert.ok(body.includes(source), "missing reference: " + source);
  }
  assert.ok(body.includes("design proposal"));
  assert.ok(body.includes("not an assertion that the services are already available"));
  assert.ok(engineeringLogs.find((entry) => entry.number === 5)?.summary.includes("versioned AttoLang references"));
  assert.ok(log5.includes("before code generation"));
});

test("log 5 security, provenance and generated semantics are auditable", () => {
  const sitemapSource = read("../src/pages/sitemap.xml.ts");
  const robots = read("../public/robots.txt");
  const llms = read("../public/llms.txt");
  const layout = read("../src/layouts/BaseLayout.astro");
  assert.ok(robots.includes("Sitemap: https://ores-truffle-oreslang.github.io/sitemap.xml"));
  assert.ok(robots.includes("User-agent: *"));
  assert.ok(llms.startsWith("# AttoLang"));
  assert.ok(llms.includes("not a complete or versioned language specification"));
  assert.ok(llms.includes("https://ores-truffle-oreslang.github.io/logs/5/"));
  assert.ok(llms.includes("does not imply that AI services crawl"));
  assert.ok(sitemapSource.includes('import.meta.glob("./**/*.astro")'));
  assert.ok(sitemapSource.includes('Content-Type": "application/xml; charset=utf-8"'));
  assert.ok(layout.includes("'@type': 'TechArticle'"));
  assert.ok(layout.includes('mainEntityOfPage: canonical.href'));
  assert.ok(layout.includes("articleJsonLd"));
  assert.ok(log5.includes('article={{ published: "2026-10-13", modified: "2026-10-14", author: "Alex Mills" }}'));
  assert.ok(log5.includes('Updated <time datetime="2026-10-14"'));
  assert.ok(body.includes('href="/sitemap.xml"'));
  assert.ok(body.includes('href="/robots.txt"'));
  assert.ok(body.includes('href="/llms.txt"'));

  for (const term of [
    "provenance ledger", "compiler build identity", "prompt injection",
    "restricted filesystem", "nonprivileged identity", "read-only",
    "data-handling", "do not publish confidential", "held-out prompts",
    "formal proof", "selected settings", "complete released AttoLang language specification"
  ]) {
    assert.ok((body + llms).toLowerCase().includes(term.toLowerCase()), "missing audit protection: " + term);
  }
  const ids = [...body.matchAll(/<section id="([^"]+)" class="log-section">/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, "all section anchors must be unique");
  for (const id of ids) {
    assert.ok(log5.includes('href="#' + id + '"'), "TOC must link to " + id);
  }
});
