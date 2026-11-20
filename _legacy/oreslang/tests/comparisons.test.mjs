import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comparisons } from "../src/data/comparisons.mjs";

const page = readFileSync(new URL("../src/pages/comparisons.astro", import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/components/SiteNav.astro", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/comparisons.css", import.meta.url), "utf8");

test("all ten requested ecosystems have complete, unique editorial comparisons", () => {
  assert.deepEqual(comparisons.map(({ id }) => id), [
    "elixir", "erlang", "gleam", "rust", "java", "cpp", "golang", "nodejs", "csharp", "ocaml",
  ]);
  assert.equal(new Set(comparisons.map(({ name }) => name)).size, 10);
  for (const entry of comparisons) {
    assert.match(entry.id, /^[a-z]+$/u);
    for (const key of ["headline", "thesis", "strength", "boundary"]) {
      assert.ok(entry[key].length >= 50, entry.id + " missing " + key);
    }
    assert.equal(entry.benefits.length, 3, entry.id + " must make three specific AttoLang arguments");
    for (const benefit of entry.benefits) {
      assert.ok(benefit.title.length >= 12, entry.id + " missing benefit title");
      assert.ok(benefit.detail.length >= 80, entry.id + " benefit needs explanation");
    }
    assert.equal(entry.angles.length, 5, entry.id + " must cover five technical angles");
    assert.equal(entry.useCases.length, 2, entry.id + " must name two concrete workloads");
    for (const useCase of entry.useCases) {
      assert.ok(useCase.title.length > 12 && useCase.detail.length > 65, entry.id + " use case too shallow");
    }
    for (const angle of entry.angles) {
      assert.ok(angle.topic.length > 3, entry.id + " missing angle topic");
      assert.ok(angle.peer.length >= 50, entry.id + " missing peer strengths");
      assert.ok(angle.oreslang.length >= 100, entry.id + " missing detailed AttoLang design comparison");
      assert.ok(angle.impact.length >= 80, entry.id + " missing practical implications");
    }
    assert.ok(entry.sources.length >= 3, entry.id + " needs multiple primary references");
    for (const source of entry.sources) {
      assert.ok(source.label.trim().length > 3);
      assert.match(source.url, /^https:\/\/[a-z0-9.-]+\//u);
      assert.ok(!source.url.includes("javascript:"));
    }
  }
});

test("comparison views are rendered with a native accessible selector and shareable state", () => {
  assert.match(nav, /label: "comparisons", href: "\/comparisons\/"/u);
  assert.match(nav, /Mobile primary navigation/u);
  assert.match(nav, /Primary navigation/u);
  assert.match(page, /<label for="language-picker">Compare AttoLang with<\/label>/u);
  assert.match(page, /<select id="language-picker"/u);
  assert.match(page, /aria-controls="comparison-content"/u);
  assert.match(page, /<option value=\{comparison.id\}>/u);
  assert.match(page, /data-comparison=\{comparison.id\}/u);
  assert.match(page, /hidden=\{index !== 0\}/u);
  assert.match(page, /panel.hidden = panel.dataset.comparison !== language/u);
  assert.match(page, /url.searchParams.set\("language", language\)/u);
  assert.match(page, /window.addEventListener\("popstate", fromUrl\)/u);
  assert.match(page, /role="status" aria-live="polite"/u);
  assert.match(page, /<h2 id=\{/u);
  for (const marker of ["comparison-thesis", "comparison-benefits", "comparison-impact", "comparison-use-cases", "comparison-use-grid"]) {
    assert.ok(page.includes(marker), "new story component missing " + marker);
    assert.ok(css.includes("." + marker), "styles missing " + marker);
  }
  for (const bind of ["comparison.thesis", "comparison.benefits.map", "angle.impact", "comparison.useCases.map"]) {
    assert.ok(page.includes(bind), "source binding missing " + bind);
  }
  assert.match(css, /\.comparison-panel\[hidden\] \{ display: none !important; \}/u);
  assert.match(css, /@media \(max-width: 650px\)/u);
});

test("comparative language claims are hedged and externally checkable", () => {
  assert.match(page, /Architecture goals, not unverified promises/u);
  assert.match(page, /marks backend support as unverified/u);
  assert.match(page, /href="\/language\/"/u);
  assert.match(page, /href="\/performance\/"/u);
  assert.match(page, /rel="noopener noreferrer"/u);
  assert.match(comparisons.find((x) => x.id === "gleam").strength, /JavaScript/u);
  assert.match(comparisons.find((x) => x.id === "rust").angles[0].peer, /Tokio/u);
  assert.match(comparisons.find((x) => x.id === "rust").thesis, /Rust-like discipline meets Erlang-like recovery/u);
  assert.match(comparisons.find((x) => x.id === "golang").thesis, /share memory by communicating/u);
  assert.match(comparisons.find((x) => x.id === "nodejs").angles[1].peer, /SharedArrayBuffer/u);
  assert.match(comparisons.find((x) => x.id === "java").angles[2].peer, /ZGC/u);
  assert.match(comparisons.find((x) => x.id === "csharp").strength, /Orleans/u);
  assert.match(comparisons.find((x) => x.id === "ocaml").angles[1].peer, /Domains/u);
  for (const entry of comparisons) {
    assert.ok(!/\bguaranteed\s+(?:faster|speedup)\b/iu.test(JSON.stringify(entry)));
  }
});
