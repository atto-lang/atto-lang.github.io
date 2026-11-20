import test from "node:test";
import assert from "node:assert/strict";
import { htmlAttribute, siteTags, validatedSiteUrl } from "./site-url-policy.mjs";

const base = "https://ores-truffle-oreslang.github.io/examples/";
const unsafe = [
  ["iframe", "src"], ["embed", "src"], ["object", "data"],
  ["form", "action"], ["video", "poster"], ["audio", "src"],
  ["track", "src"],
];

test("the HTML sink scanner recognizes executable and navigational non-anchor tags", () => {
  for (const [name, attribute] of unsafe) {
    for (const payload of ["javascript:alert(1)", "data:text/html,evil",
      "javascript&colon;alert(1)"]) {
      const markup = "<" + name + ' title="quoted > ' + name + '" ' + attribute + '="' + payload + '">';
      const tags = [...siteTags(markup)];
      assert.equal(tags.length, 1, name + " was not scanned");
      const value = htmlAttribute(tags[0], attribute);
      assert.equal(value, payload, markup);
      assert.throws(() => validatedSiteUrl(value, base, attribute),
        /Unsafe|unsupported/u, markup);
    }
  }
});

test("ordinary HTTPS and local links in extended tags remain allowed", () => {
  for (const [name, attribute] of unsafe) {
    for (const url of ["/brand/attolang-icon-180.png", "https://example.org/file.svg"]) {
      const [tag] = [...siteTags("<" + name + " " + attribute + '="' + url + '">')];
      assert.ok(validatedSiteUrl(htmlAttribute(tag, attribute), base, attribute)
        instanceof URL, name + " " + url);
    }
  }
});

test("base href is detected and cannot silently hide behind quoted attributes", () => {
  const markup = '<a data-note="<base href=/not-real/>" href="/real/"></a>'
    + '<BASE data-x=" > " href="https://attacker.invalid/">';
  const tags = [...siteTags(markup)];
  assert.equal(tags.length, 2);
  assert.equal(htmlAttribute(tags[0], "href"), "/real/");
  assert.match(tags[1], /^<BASE\b/u);
  assert.equal(htmlAttribute(tags[1], "href"), "https://attacker.invalid/");
});

test("malformed extended opening tags are rejected instead of skipped", () => {
  for (const html of [
    '<iframe title="broken src=javascript:alert(1)>',
    '<object data="/safe" <embed src="javascript:bad">',
    "<form action='/safe' title='unterminated>",
  ]) {
    assert.throws(() => [...siteTags(html)], /Malformed|Unterminated/u);
  }
});
