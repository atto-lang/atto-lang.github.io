import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Evaluate the exact JavaScript expressions from the Astro frontmatter.
// Merely reproducing a safe .replace() in the test would not test the deployed
// serializer: a future source regression could pass that weaker oracle.
const layout = readFileSync(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
const guardOf = { websiteJsonLd: "home", articleJsonLd: "article" };
function extract(name) {
  const guard = guardOf[name];
  assert.ok(guard, "only the two reviewed JSON-LD sinks are allowed");
  const re = new RegExp("const " + name + " = " + guard +
    "\\s*\\?\\s*([\\s\\S]*?)\\s*:\\s*null;", "u");
  const match = re.exec(layout);
  assert.ok(match, "missing expression for " + name);
  assert.equal(layout.match(re)?.length, 2, "single recognized expression");
  return match[1];
}
function context(overrides = {}) {
  return {
    home: true,
    article: { published: "2026-11-07", modified: "2026-11-07", author: "Atto Author" },
    title: "AttoLang",
    description: "AttoLang compiler and actor docs",
    canonical: { href: "https://atto.example/article" },
    Astro: { site: new URL("https://atto.example/") },
    URL,
    ...overrides
  };
}
function render(name, vars, expression = extract(name)) {
  return runInNewContext(
    guardOf[name] + " ? (" + expression + ") : null", context(vars),
    { timeout: 1000 });
}
function assertSerialized(name, vars) {
  const value = render(name, vars);
  assert.equal(typeof value, "string", name + " must serialize");
  assert.equal(value.includes("<"), false, name + " must not include a literal <");
  assert.equal(value.toLowerCase().includes("</script"), false);
  return JSON.parse(value);
}
const hostile = [
  "</ScRiPt><script>alert('breakout')</script>",
  "<!--</script>--><svg/onload=alert(1)>",
  "<iframe srcdoc='<script>owned()</script>'>",
  "<math><mtext></script></mtext></math>",
  "\u0000\u0008\u001b</script>",
  "\u2028\u2029</script>",
  "emoji 💥 \uD800 <sCrIpT>",
  "quoted \"slash \\/ newline \n </script>",
  "<script\r\n>evil()</script>",
  "&lt;/script&gt; < /script>"
];

test("Astro JSON-LD sink inventory rejects duplicate, redirected or unbound outputs", () => {
  const binding = [...layout.matchAll(
    /<script type="application\/ld\+json" set:html=\{([A-Za-z]+)\} \/>/gu
  )].map(m => m[1]).sort();
  assert.deepEqual(binding, ["articleJsonLd", "websiteJsonLd"]);
  function valid(template) {
    const values = [...template.matchAll(
      /<script type="application\/ld\+json" set:html=\{([A-Za-z]+)\} \/>/gu
    )].map(m => m[1]).sort();
    return values.length === 2 && values.join("|") === "articleJsonLd|websiteJsonLd";
  }
  assert.equal(valid(layout), true);
  assert.equal(valid(layout.replace("set:html={articleJsonLd}",
    "set:html={websiteJsonLd}")), false);
  assert.equal(valid(layout.replace("set:html={articleJsonLd}",
    "set:html={rawArticleJsonLd}")), false);
  assert.equal(valid(layout + '\n<script type="application/ld+json" set:html={unsafe} />'),
    false);
});

test("real article expression round-trips hostile headline, description and author bytes", () => {
  let count = 0;
  let seed = 0x5eedcafe;
  function next() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
  const payloads = [...hostile];
  for (let i = 0; i < 64; i++) {
    let payload = "";
    for (let j = 0; j < 6; j++) payload += hostile[next() % hostile.length];
    payloads.push(payload);
  }
  for (const payload of payloads) {
    const decoded = assertSerialized("articleJsonLd", {
      title: payload, description: payload,
      article: { published: "2026-11-07", modified: "2026-11-07", author: payload }
    });
    assert.equal(decoded.headline, payload);
    assert.equal(decoded.description, payload);
    assert.equal(decoded.author.name, payload);
    assert.equal(decoded["@type"], "TechArticle");
    count++;
  }
  assert.equal(count, 74);
});

test("website expression is executed and escapes any newly introduced literal markup", () => {
  const original = extract("websiteJsonLd");
  const needle = '"AttoLang is an evolving isolation-first, actor-oriented systems programming language."';
  assert.ok(original.includes(needle), "expected fixed description for controlled mutation");
  for (const payload of hostile) {
    const mutated = original.replace(needle, JSON.stringify(payload));
    const output = render("websiteJsonLd", {}, mutated);
    assert.equal(output.includes("<"), false);
    assert.equal(JSON.parse(output).description, payload);
  }
  const regular = assertSerialized("websiteJsonLd", {});
  assert.equal(regular["@type"], "WebSite");
  assert.equal(regular.name, "AttoLang");
});

test("negative control proves removing the source escape reintroduces a script breakout", () => {
  for (const name of ["articleJsonLd", "websiteJsonLd"]) {
    let expr = extract(name);
    const payload = "</ScRiPt><script>owned()</script>";
    if (name === "websiteJsonLd") {
      const needle = '"AttoLang is an evolving isolation-first, actor-oriented systems programming language."';
      assert.ok(expr.includes(needle));
      expr = expr.replace(needle, JSON.stringify(payload));
    }
    const marker = ".replace(/</g,";
    const pos = expr.lastIndexOf(marker);
    assert.ok(pos > 0, "source must escape '<' before inserting raw script HTML");
    const safe = render(name, { title: payload, description: payload }, expr);
    const broken = render(name, { title: payload, description: payload }, expr.slice(0, pos));
    assert.equal(safe.includes("<"), false);
    assert.equal(broken.includes("</ScRiPt>"), true);
  }
});

test("JSON-LD false guards produce no script data", () => {
  assert.equal(render("websiteJsonLd", { home: false }), null);
  assert.equal(render("articleJsonLd", { article: null }), null);
});
