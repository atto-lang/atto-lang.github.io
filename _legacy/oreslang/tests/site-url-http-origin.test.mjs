import test from "node:test";
import assert from "node:assert/strict";
import { validatedSiteUrl } from "./site-url-policy.mjs";

const publicBase = "https://ores-truffle-oreslang.github.io/examples/";
test("public pages reject all external HTTP navigation and resource links", () => {
  for (const field of ["href", "src", "poster", "action"]) {
    for (const url of ["http://example.org/", "HTTP://example.org/login", "http://localhost:4321/"]) {
      assert.throws(() => validatedSiteUrl(url, publicBase, field), /Insecure external HTTP/, field + ":" + url);
    }
    assert.equal(validatedSiteUrl("https://example.org/", publicBase, field).protocol, "https:");
  }
});
test("local HTTP preview permits only same-origin loopback links", () => {
  const local = "http://localhost:4321/examples/";
  assert.equal(validatedSiteUrl("/logs/1/", local, "href").origin, "http://localhost:4321");
  assert.equal(validatedSiteUrl("http://localhost:4321/logs/1/", local, "src").origin, "http://localhost:4321");
  for (const url of ["http://localhost:4322/", "http://127.0.0.1:4321/", "http://example.org/"]) {
    assert.throws(() => validatedSiteUrl(url, local), /Insecure external HTTP/);
  }
});
