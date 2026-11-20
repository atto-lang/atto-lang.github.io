import test from "node:test";
import assert from "node:assert/strict";
import { decodeUrlAttribute, validatedSiteUrl } from "./site-url-policy.mjs";

const base = "https://ores-truffle-oreslang.github.io/examples/";

test("bidi overrides, marks and isolates cannot hide a destination", () => {
  const directional = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x2066, 0x2067, 0x2068, 0x2069];
  for (const scalar of directional) {
    const ch = String.fromCodePoint(scalar);
    for (const value of ["/download/" + ch + "safe", "/download/&#x" + scalar.toString(16) + ";safe",
      "https://example.test/" + ch + "safe"]) {
      assert.throws(() => validatedSiteUrl(value, base, "href"),
        /Unsafe whitespace or control character/u, JSON.stringify(value));
      assert.throws(() => validatedSiteUrl(value, base, "src"),
        /Unsafe whitespace or control character/u, JSON.stringify(value));
    }
  }
});

test("Unicode text, percent-encoded UTF-8, and ordinary entities remain allowed", () => {
  for (const value of ["/café/", "/caf%C3%A9/", "/a&amp;b", "/hello?x=1&amp;y=2",
    "https://example.test/résumé", "#fragment"]) {
    assert.ok(validatedSiteUrl(value, base, "href") instanceof URL, value);
  }
  assert.equal(decodeUrlAttribute("/x&#x202e;y"), "/x\u202ey");
});
