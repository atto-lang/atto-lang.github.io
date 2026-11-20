import test from "node:test";
import assert from "node:assert/strict";
import { decodeUrlAttribute, htmlAttribute, validatedSiteUrl } from "./site-url-policy.mjs";

const base = "https://ores-truffle-oreslang.github.io/examples/";

test("safe local, https, query, mail and telephone links remain supported", () => {
  for (const raw of [
    "/", "/logs/9/", "../how-it-works/", "#examples",
    "/search/?q=a&amp;sort=asc", "https://developer.mozilla.org/en-US/",
    "https://ores-truffle-oreslang.github.io/brand/attolang-social.png",
  ]) {
    assert.ok(validatedSiteUrl(raw, base, "href") instanceof URL, raw);
  }
  assert.equal(validatedSiteUrl("mailto:hello@example.org", base, "href").protocol, "mailto:");
  assert.equal(validatedSiteUrl("tel:+10005550100", base, "href").protocol, "tel:");
  assert.equal(decodeUrlAttribute("/?q=foo&amp;bar"), "/?q=foo&bar");
});

test("reject executable and inline-data URLs, including HTML-entity encoded schemes", () => {
  for (const raw of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6a;avascript&#x3a;alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html,<h1>unsafe</h1>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.org/123",
    "filesystem:https://example.org/tmp",
    "unknown:payload",
    "java&#x09;script:alert(1)",
    "java&Tab;script:alert(1)",
    "java&NewLine;script:alert(1)",
    "https://user:password@example.org/private",
  ]) {
    assert.throws(() => validatedSiteUrl(raw, base, "href"),
      /Unsafe|unsupported|Credential|control/u, raw);
  }
});

test("non-navigation resource attributes reject mailto, tel and executable schemes", () => {
  for (const field of ["src", "poster", "action"]) {
    for (const raw of ["mailto:hello@example.org", "tel:+10005550100",
      "data:image/svg+xml,<svg/>", "javascript:alert(1)"]) {
      assert.throws(() => validatedSiteUrl(raw, base, field),
        /Unsafe or unsupported/u, field + "=" + raw);
    }
  }
});

test("browser-normalized controls and invalid URL attributes fail closed", () => {
  for (const raw of [" javascript:alert(1)", "\nhttps://example.org",
    "https://example.org\r\n", "java\u0000script:foo", "&#x0a;javascript:foo",
    "https://example.org/\u007f", "https://example.org/\u0001"]) {
    assert.throws(() => validatedSiteUrl(raw, base, "href"), /Unsafe/u);
  }
  assert.throws(() => decodeUrlAttribute("a".repeat(8193)), /oversized/u);
  assert.throws(() => decodeUrlAttribute(null), /Invalid/u);
});

test("HTML link reader handles single-quoted and unquoted attributes without missing unsafe links", () => {
  assert.equal(htmlAttribute("<a HREF='javascript:alert(1)'>", "href"), "javascript:alert(1)");
  assert.equal(htmlAttribute("<a href=javascript:alert(1)>", "href"), "javascript:alert(1)");
  assert.equal(htmlAttribute("<a href=\"&#106;avascript:alert(1)\">", "href"),
    "&#106;avascript:alert(1)");
  assert.equal(htmlAttribute("<img src='/brand/attolang-icon-180.png'>", "src"),
    "/brand/attolang-icon-180.png");
  assert.equal(htmlAttribute("<a title='hello'>", "href"), null);
});
