import test from "node:test";
import assert from "node:assert/strict";
import { siteTags, htmlAttribute, validatedSiteUrl } from "./site-url-policy.mjs";

const base = "https://ores-truffle-oreslang.github.io/";

test("attribute lexer selects real URL after quoted decoys and quoted greater-than", () => {
  const markup = [
    "<a data-note='href=/safe/ > still-data' HREF=&#x6a;avascript:alert(1)>",
    '<img alt="src=/safe/ > fake" sRc="data:image/svg+xml,evil">',
    '<source data-desc="src=/safe/ <a href=/fake/>" src=/images/ok.svg>',
    "<link title='href=/safe/' href=https://example.org/path>",
    "<script data-note='src=/safe/ >' SRC='java&#115;cript:alert(1)'></script>",
  ].join("\n");
  const tags = [...siteTags(markup)];
  assert.equal(tags.length, 5);
  for (const [index, field] of ["href", "src", "src", "href", "src"].entries()) {
    const value = htmlAttribute(tags[index], field);
    assert.ok(value, "required real URL absent in " + tags[index]);
    if (index === 2 || index === 3) {
      assert.ok(validatedSiteUrl(value, base, field) instanceof URL);
    } else {
      assert.throws(() => validatedSiteUrl(value, base, field), /Unsafe|unsupported/u);
    }
  }
});

test("duplicate first attribute wins while malformed markup fails closed", () => {
  for (const [markup, expected] of [
    ['<a href="/first" href="javascript:bad">', "/first"],
    ['<a HrEf="javascript:bad" href="/second">', "javascript:bad"],
    ['<a data-note="href=/fake/" href=/actual>', "/actual"],
    ["<a href = '/space' data-href=/not-real>", "/space"],
    ['<a data-note="src=javascript:bad">', null],
  ]) {
    assert.equal(htmlAttribute(markup, "href"), expected);
  }
  for (const bad of [
    '<a data-x="unterminated href=javascript:bad>',
    '<img alt="x" <source src=javascript:bad>',
    "<source data-q='broken >",
  ]) {
    assert.throws(() => [...siteTags(bad)], /Unterminated|Malformed/u);
  }
});

test("URL attribute schemes distinguish anchors from embeddable resources", () => {
  for (const value of ["mailto:team@example.org", "tel:+15550123"]) {
    assert.ok(validatedSiteUrl(value, base, "href") instanceof URL);
    assert.throws(() => validatedSiteUrl(value, base, "src"), /Unsafe|unsupported/u);
  }
  for (const url of ["javascript&colon;alert(1)", "&#106;avascript:alert(1)",
    "data:text/html,evil", "file:///etc/passwd", "blob:https://example.org/id"]) {
    assert.throws(() => validatedSiteUrl(url, base), /Unsafe|unsupported/u);
  }
});
