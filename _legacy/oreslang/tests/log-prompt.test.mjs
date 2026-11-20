import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const component = read("../src/components/LogPrompt.astro");
const log1 = read("../src/pages/logs/1.astro");
const log2 = read("../src/pages/logs/2.astro");
const css = read("../src/styles/logs.css");

test("native disclosure preserves article heading hierarchy and a single prompt data source", () => {
  assert.match(component, /<details class="log-prompt-disclosure">/);
  assert.match(component, /<summary class="log-prompt-summary">/);
  assert.match(component, /<PromptHeading class="log-prompt-heading">/);
  assert.match(component, /headingTag = "span"/);
  assert.match(component, /headingTag\?: "h1" \| "span"/);
  const log6 = read("../src/pages/logs/6.astro");
  const log7 = read("../src/pages/logs/7.astro");
  for (const page of [log6, log7]) {
    assert.match(page, /<h1\b/);
    assert.match(page, /<LogPrompt[^>]*headingTag="span"/);
  }
  assert.match(component, /<span class="log-prompt-word">prompt<\/span>/);
  assert.match(component, /class="log-prompt-glimmer" aria-hidden="true">\{prompt\}/);
  assert.match(component, /class="log-prompt-full-text">\{prompt\}/);
  assert.equal((component.match(/\{prompt\}/g) || []).length, 2);
  assert.doesNotMatch(component, /<script|onclick=|onkeydown=|aria-expanded=/);
});

test("both published logs use the reusable prompt disclosure without duplicated text", () => {
  for (const [file, number] of [[log1, 1], [log2, 2]]) {
    assert.match(file, /import LogPrompt from "\.\.\/\.\.\/components\/LogPrompt\.astro"/);
    assert.match(file, /const prompt = "[^\n]+";/);
    assert.match(file, /<LogPrompt prompt=\{prompt\}/);
    assert.equal((file.match(/<LogPrompt /g) || []).length, 1);
    assert.doesNotMatch(file, /class="log-prompt-glimmer"|class="log-prompt-full-text"/);
    assert.match(file, new RegExp("Engineering log \/ 00" + number));
    assert.match(file, /Alex Mills/);
  }
});

test("expansion uses cross-browser grid tracks, not Chromium-only intrinsic-size animation", () => {
  assert.match(css, /\.log-prompt-disclosure::details-content\s*\{[^}]*display:\s*grid;/);
  assert.match(css, /\.log-prompt-disclosure::details-content\s*\{[^}]*grid-template-rows:\s*0fr;/);
  assert.match(css, /\.log-prompt-disclosure\[open\]::details-content\s*\{[^}]*grid-template-rows:\s*1fr;/);
  assert.match(css, /content-visibility\s+\.9s\s+allow-discrete/);
  assert.match(css, /\.log-prompt-reveal\s*\{[^}]*min-height:\s*0;/);
  assert.match(css, /\.log-prompt-reveal\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.log-prompt-reveal-inner\s*\{[^}]*padding:/);
  assert.doesNotMatch(css, /^\s*interpolate-size:/m);
  assert.doesNotMatch(css, /^\s*height:\s*auto;/m);
});

test("focus, touch target and reduced-motion constraints remain intact", () => {
  assert.match(css, /\.log-prompt-summary\s*\{[^}]*cursor:\s*pointer;/);
  assert.match(css, /\.log-prompt-summary:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /\.log-prompt-toggle\s*\{[^}]*width:\s*45px;[^}]*height:\s*45px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.log-prompt-disclosure::details-content\s*\{ transition:\s*none;/);
  assert.match(css, /\.log-prompt-glimmer\s*\{[^}]*opacity:\s*\.23;/);
});
