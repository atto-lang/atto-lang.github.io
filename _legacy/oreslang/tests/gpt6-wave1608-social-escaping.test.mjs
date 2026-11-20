import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const layout = readFileSync(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
const homepageEscape = String.raw`.replace(/</g, "\\u003c")`;
const articleEscape = String.raw`.replace(/</g, '\\u003c')`;

test("home and article JSON-LD always escape literal script terminators", () => {
  assert.match(layout, /const websiteJsonLd = home \? JSON\.stringify\(/u);
  assert.match(layout, /const articleJsonLd = article \? JSON\.stringify\(/u);
  assert.ok(layout.includes(homepageEscape), "home JSON-LD escaped");
  assert.ok(layout.includes(articleEscape), "article JSON-LD escaped");
  assert.ok(layout.includes('set:html={websiteJsonLd}'));
  assert.ok(layout.includes('set:html={articleJsonLd}'));
});


test("JSON-LD has precisely two script sinks, each bound to its escaped serialization", () => {
  const scripts = layout.split("\n")
    .filter(line => line.includes('type="application/ld+json"'))
    .map(line => line.includes("set:html={articleJsonLd}") ? "articleJsonLd"
      : line.includes("set:html={websiteJsonLd}") ? "websiteJsonLd" : null)
    .sort();
  assert.deepEqual(scripts, ["articleJsonLd", "websiteJsonLd"]);
  assert.equal(layout.split(homepageEscape).length - 1, 1,
    "home JSON-LD must have one explicit escape");
  assert.equal(layout.split(articleEscape).length - 1, 1,
    "article JSON-LD must have one explicit escape");
});

test("mixed-case end tags, HTML comments and SVG payloads cannot break JSON-LD script context", () => {
  const payloads = [
    "</ScRiPt><script>alert('x')</script>",
    "<!--<script>bad()</script>-->",
    "<svg onload=alert(1)>",
    "<script\\u2028type='text/javascript'>alert(1)</script>",
    "<\\u2028\\u2029&",
  ];
  for (const hostile of payloads) {
    const serialized = JSON.stringify({ headline: hostile }).replace(/</g, String.fromCharCode(92) + "u003c");
    assert.equal(serialized.includes("<"), false, "unescaped < in JSON-LD");
    assert.deepEqual(JSON.parse(serialized), { headline: hostile });
  }
});

test("escaping preserves JSON meaning while blocking script-tag breakouts", () => {
  const hostile = '</script><script>alert("owned")</script>\u2028';
  const serialized = JSON.stringify({ headline: hostile }).replace(/</g, "\\u003c");
  assert.ok(!serialized.includes("</script>"));
  assert.ok(!serialized.includes("<script>"));
  assert.deepEqual(JSON.parse(serialized), { headline: hostile });
  assert.equal(JSON.stringify({ headline: hostile }).includes("</script>"), true);
});
