import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../public/theme.js", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
const nav = readFileSync(new URL("../src/components/SiteNav.astro", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/themes.css", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

function setup({ selected = "dark", failStorage = false } = {}) {
  let stored = null;
  const buttons = ["dark", "navy", "light"].map((themeChoice) => {
    const attributes = new Map();
    return {
      dataset: { themeChoice },
      attributes,
      addEventListener(event, listener) { if (event === "click") this.click = listener; },
      setAttribute(name, value) { attributes.set(name, value); },
    };
  });
  let menuClosed = false;
  const links = [{
    addEventListener(event, listener) { if (event === "click") this.click = listener; },
    closest() { return { removeAttribute(name) { if (name === "open") menuClosed = true; } }; },
  }];
  const meta = { value: "", setAttribute(name, value) { if (name === "content") this.value = value; } };
  const root = { dataset: { theme: selected } };
  const document = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === "[data-theme-choice]") return buttons;
      if (selector === ".mobile-navigation nav a") return links;
      throw new Error(`Unknown selector: ${selector}`);
    },
    querySelector(selector) { return selector === 'meta[name="theme-color"]' ? meta : null; },
  };
  const localStorage = {
    getItem() { if (failStorage) throw Error("Blocked"); return stored; },
    setItem(key, value) {
      if (failStorage) throw Error("Blocked");
      assert.equal(key, "oreslang-theme");
      stored = value;
    },
  };
  runInNewContext(script, { document, localStorage });
  return { root, buttons, meta, links, get stored() { return stored; }, get menuClosed() { return menuClosed; } };
}

test("dark is the default; only the current choice is pressed", () => {
  const app = setup();
  assert.equal(app.root.dataset.theme, "dark");
  assert.deepEqual(app.buttons.map((b) => b.attributes.get("aria-pressed")), ["true", "false", "false"]);
  assert.equal(app.meta.value, "#080b0e");
});

test("all three theme choices switch instantly and save across pages", () => {
  const app = setup();
  for (const name of ["navy", "light", "dark"]) {
    const button = app.buttons.find((b) => b.dataset.themeChoice === name);
    button.click();
    assert.equal(app.root.dataset.theme, name);
    assert.equal(app.stored, name);
    assert.equal(app.buttons.filter((b) => b.attributes.get("aria-pressed") === "true").length, 1);
    assert.equal(button.attributes.get("aria-pressed"), "true");
  }
});

test("saved theme hydrates buttons before clicking", () => {
  const app = setup({ selected: "light" });
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.buttons[2].attributes.get("aria-pressed"), "true");
  assert.equal(app.meta.value, "#ffffff");
});

test("switcher works when localStorage is unavailable; unknown theme rejected", () => {
  const app = setup({ failStorage: true });
  app.buttons[1].click();
  assert.equal(app.root.dataset.theme, "navy");
  app.buttons[1].dataset.themeChoice = "invalid";
  app.buttons[1].click();
  assert.equal(app.root.dataset.theme, "navy");
});

test("mobile menu closes after following a link", () => {
  const app = setup();
  app.links[0].click();
  assert.equal(app.menuClosed, true);
});

test("each theme defines semantic foreground, accent, background and surfaces", () => {
  for (const name of ["dark", "navy", "light"]) {
    const block = styles.match(new RegExp(`html\\[data-theme="${name}"\\] \\{([^}]+)\\}`))?.[1];
    assert.ok(block, `missing ${name} palette`);
    for (const token of ["--brown", "--orange", "--cream", "--paper", "--surface", "--code-bg", "--page-background"]) {
      assert.match(block, new RegExp(token + ":"));
    }
  }
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /@media \(max-width: 440px\)/);
  assert.match(styles, /overflow-x: auto/);
});

test("brand is mono sans-serif, layout is mobile-aware, and theme buttons are accessible", () => {
  assert.doesNotMatch(globalStyles, /Brush Script|Segoe Script|cursive|skew\(-6deg\)/);
  assert.match(globalStyles, /IBM Plex Mono/);
  assert.match(layout, /name="viewport"/);
  assert.match(layout, /localStorage\.getItem\("oreslang-theme"\)/);
  assert.match(nav, /role="group" aria-label="Color theme"/);
  assert.equal((nav.match(/data-theme-choice="/g) || []).length, 3);
  assert.match(nav, /<details class="mobile-navigation">/);
  assert.match(layout, /src="\/theme\.js"/);
});

test("retired brown preference becomes navy before first paint", () => {
  const inline = layout.split("<script is:inline>")[1]?.split("</script>")[0];
  assert.ok(inline, "pre-paint theme initialization must be inline");
  const root = { dataset: { theme: "dark" } };
  const values = new Map([["oreslang-theme", "brown"]]);
  const storage = {
    getItem(key) { return values.get(key); },
    setItem(key, value) { values.set(key, value); },
  };
  runInNewContext(inline, { document: { documentElement: root }, localStorage: storage });
  assert.equal(root.dataset.theme, "navy");
  assert.equal(values.get("oreslang-theme"), "navy");
});

test("navy uses steel-blue backgrounds and orange syntax keywords", () => {
  const palette = styles.split('html[data-theme="navy"] {')[1]?.split("\n}")[0];
  assert.ok(palette, "navy palette must exist");
  assert.ok(palette.includes("--brown: #13263d"));
  assert.ok(palette.includes("--orange: #ff9d4d"));
  assert.ok(styles.includes(".swatch-navy"));
  assert.ok(styles.includes(".tok-keyword { color: var(--orange); }"));
  assert.ok(!styles.includes('data-theme="brown"'));
  assert.ok(!styles.includes(".swatch-brown"));
  assert.ok(nav.includes('data-theme-choice="navy"'));
  assert.ok(!nav.includes('data-theme-choice="brown"'));
  assert.ok(script.includes('navy: "#13263d"'));
});

test("all homepage section headings and interior hero titles are 33% smaller", () => {
  const desktop = globalStyles.split(".section-heading h2,")[1]?.split("}")[0];
  assert.ok(desktop, "shared desktop headings rule");
  assert.ok(desktop.includes(".page-hero h1"));
  // Source: (2.8rem, 6vw, 5.8rem), scaled to 67%.
  assert.ok(desktop.includes("font-size: clamp(1.876rem, 4.02vw, 3.886rem)"));
  const mobile = styles.split("@media (max-width: 700px) {")[1]?.split("@media (max-width: 440px) {")[0];
  assert.ok(mobile?.includes(".section-heading h2, .page-hero h1 { font-size: clamp(1.5075rem, 6.03vw, 2.546rem)"));
  const smallMobile = styles.split("@media (max-width: 440px) {")[1]?.split("@media (prefers-reduced-motion: reduce)")[0];
  assert.ok(smallMobile?.includes(".section-heading h2, .page-hero h1 { font-size: clamp(1.34rem, 6.03vw, 1.8425rem)"));
  assert.ok(!styles.includes("#about .section-heading h2"));
  assert.ok(!styles.includes("#philosophy .section-heading h2"));
});
