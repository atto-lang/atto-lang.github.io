import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const script = read("../public/editor-themes.js");
const palettes = read("../src/styles/editor-themes.css");
const pickerTemplate = read("../src/components/EditorThemePicker.astro");
const example = read("../src/components/OresCode.astro");
const homepage = read("../src/pages/index.astro");
const examplesPage = read("../src/pages/examples.astro");
const philosophy = read("../src/pages/philosophy.astro");
const log = read("../src/components/Log1Content.astro");
const layout = read("../src/layouts/BaseLayout.astro");

const six = ["vscode", "intellij", "sublime", "zed", "emacs", "vim"];

function panel(key) {
  const picker = {
    value: "vscode",
    addEventListener(type, callback) {
      assert.equal(type, "change");
      this.change = callback;
    },
  };
  return {
    dataset: { codeKey: key, editorTheme: "vscode" },
    picker,
    querySelector(query) {
      assert.equal(query, "[data-code-theme-picker]");
      return picker;
    },
  };
}

function mount({ path = "/", panels = [panel("a"), panel("b")], prior = {}, brokenStorage = false } = {}) {
  const stored = new Map(Object.entries(prior));
  const document = {
    querySelectorAll(query) {
      assert.equal(query, "[data-code-editor]");
      return panels;
    },
  };
  const localStorage = {
    getItem(key) {
      if (brokenStorage) throw new Error("private browser");
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      if (brokenStorage) throw new Error("private browser");
      stored.set(key, value);
    },
  };
  runInNewContext(script, { document, localStorage, location: { pathname: path } });
  return { panels, stored };
}

test("six named themes are selectable and each defines the full semantic syntax palette", () => {
  for (const theme of six) {
    assert.ok(pickerTemplate.includes('["' + theme + '",'), "picker option " + theme);
    const block = palettes.split('.code-editor[data-editor-theme="' + theme + '"] {')[1]?.split("\n}")[0];
    assert.ok(block, "missing " + theme + " palette");
    for (const token of ["--ed-bg", "--ed-bar", "--ed-fg", "--ed-keyword", "--ed-comment", "--ed-string", "--ed-number", "--ed-type", "--ed-symbol", "--ed-operator"]) {
      assert.ok(block.includes(token + ":"), theme + " missing " + token);
    }
  }
  assert.equal((pickerTemplate.match(/<option /g) || []).length, 1); // mapped from six values
  assert.ok(pickerTemplate.includes("aria-label"));
});

test("each editor changes independently and saves its own selection", () => {
  const { panels, stored } = mount();
  panels[0].picker.value = "intellij";
  panels[0].picker.change();
  assert.equal(panels[0].dataset.editorTheme, "intellij");
  assert.equal(panels[1].dataset.editorTheme, "vscode");
  assert.equal(stored.get("oreslang-editor-theme:/:a"), "intellij");
  assert.equal(stored.has("oreslang-editor-theme:/:b"), false);
  for (const theme of six) {
    panels[1].picker.value = theme;
    panels[1].picker.change();
    assert.equal(panels[1].dataset.editorTheme, theme);
  }
  assert.equal(panels[0].dataset.editorTheme, "intellij");
  assert.equal(stored.get("oreslang-editor-theme:/:b"), "vim");
});

test("page and panel selection is restored independently, without changing the site theme", () => {
  const { panels, stored } = mount({
    path: "/examples/",
    prior: {
      "oreslang-theme": "navy",
      "oreslang-editor-theme:/examples/:a": "sublime",
      "oreslang-editor-theme:/:b": "emacs",
    },
  });
  assert.equal(panels[0].dataset.editorTheme, "sublime");
  assert.equal(panels[0].picker.value, "sublime");
  assert.equal(panels[1].dataset.editorTheme, "vscode");
  panels[0].picker.value = "zed";
  panels[0].picker.change();
  assert.equal(stored.get("oreslang-theme"), "navy");
  assert.equal(stored.get("oreslang-editor-theme:/examples/:a"), "zed");
});

test("invalid saved or user-supplied themes fall back to VS Code safely", () => {
  const { panels } = mount({ prior: { "oreslang-editor-theme:/:a": "not-a-theme" } });
  assert.equal(panels[0].dataset.editorTheme, "vscode");
  panels[0].picker.value = "invalid";
  panels[0].picker.change();
  assert.equal(panels[0].dataset.editorTheme, "vscode");
  assert.equal(panels[0].picker.value, "vscode");
});

test("theme switching remains usable when localStorage is blocked", () => {
  const { panels } = mount({ brokenStorage: true });
  panels[0].picker.value = "emacs";
  panels[0].picker.change();
  assert.equal(panels[0].dataset.editorTheme, "emacs");
});

test("picker is available on homepage, standalone examples, traces and both log snippets", () => {
  assert.ok(example.includes("EditorThemePicker"));
  assert.ok(example.includes("data-code-key={caption}"));
  assert.ok(homepage.includes("<OresCode"));
  assert.ok(examplesPage.includes("<OresCode"));
  assert.ok(homepage.includes('data-code-key="home-runtime-trace"'));
  assert.ok(philosophy.includes('data-code-key="philosophy-runtime-trace"'));
  assert.equal((log.match(/data-code-editor/g) || []).length, 2);
  assert.ok(layout.includes('import "../styles/editor-themes.css"'));
  assert.ok(layout.includes('src="/editor-themes.js"'));
  assert.ok(palettes.includes(".code-editor .tok-keyword"));
  assert.ok(palettes.includes(".log-article .code-editor.log-code-editor pre"));
});
