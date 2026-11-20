import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languageProgress } from "../src/data/language-progress.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../src/pages/index.astro");
const philosophy = read("../src/pages/philosophy.astro");
const css = read("../src/styles/technical.css");

test("historical progress themes are complete, stable and shared", () => {
  assert.equal(languageProgress.length, 12);
  assert.equal(new Set(languageProgress.map((t) => t.id)).size, 12);
  assert.equal(new Set(languageProgress.map((t) => t.label)).size, 12);
  for (const theme of languageProgress) {
    assert.match(theme.id, /^[a-z][a-z0-9-]*$/u);
    for (const field of ["label", "shift", "response", "forward"]) {
      assert.ok(typeof theme[field] === "string" && theme[field].length >= 10, theme.id + "." + field);
    }
  }
  const sharedImport = 'import { languageProgress } from "../data/language-progress.mjs";';
  assert.ok(home.includes(sharedImport));
  assert.ok(philosophy.includes(sharedImport));
  assert.ok(home.includes("languageProgress.map((theme) =>"));
  assert.ok(philosophy.includes("languageProgress.map((theme, index) =>"));
});

test("homepage checklist links to detail without pretending to certify finished features", () => {
  assert.ok(home.includes('class="language-shifts-checklist"'));
  assert.ok(home.includes('href="/philosophy/#language-progress"'));
  assert.ok(home.includes('aria-labelledby="language-shifts-home-title"'));
  assert.ok(home.includes("not finished AttoLang features"));
  assert.ok(!home.includes("{theme.shift}") && !home.includes("{theme.response}"));
});

test("philosophy distinguishes historical context, direction and verification", () => {
  assert.ok(philosophy.includes('id="language-progress"'));
  assert.ok(philosophy.includes('id={`progress-${theme.id}`}'));
  for (const field of ["shift", "response", "forward"]) assert.ok(philosophy.includes("{theme." + field + "}"));
  assert.ok(philosophy.includes("did not all begin in 2010–2022"));
  assert.ok(philosophy.includes("not a conformance matrix"));
  for (const href of ["/language/", "/how-it-works/", "/performance/"]) {
    assert.ok(philosophy.includes('href="' + href + '"'));
  }
});

test("the responsive checklist and detail cards have scoped CSS", () => {
  for (const selector of [".language-shifts-checklist", ".language-progress-grid", ".language-progress-card", ".language-shifts-home .progress-caveat"]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.ok(css.includes("@media (max-width: 750px)"));
});
