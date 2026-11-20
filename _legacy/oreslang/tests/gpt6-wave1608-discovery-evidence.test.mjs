import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const index = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");

// This is a static publication-contract test, never a compiler test.
function safeDiscovery(text) {
  const lines = text.split("\n");
  const privateSources = [
    "Java/GraalVM implementation",
    "LLVM implementation",
    "AttoLang formatter",
  ];
  return /^# AttoLang$/mu.test(text)
    && privateSources.every(label => {
      const sourceLines = lines.filter(line => line.includes(label));
      return sourceLines.length === 1
        && sourceLines[0].startsWith("- [")
        && sourceLines[0].includes("**Private repository**");
    })
    && text.includes("All backend support explicitly not-verified")
    && text.includes("Do not infer stable syntax or cross-backend parity")
    && text.includes("Select a compiler release/commit");
}

test("public AI discovery does not promote private or speculative compiler support", () => {
  assert.equal(safeDiscovery(index), true);
  for (const [before, after] of [
    ["**Private repository**", "**Public repository**"],
    ["All backend support explicitly not-verified", "All backend support verified"],
    ["Do not infer stable syntax or cross-backend parity", "Syntax and parity are guaranteed"],
    ["Select a compiler release/commit", "Trust any example on the site"],
  ]) {
    assert.ok(index.includes(before), before);
    assert.equal(safeDiscovery(index.replace(before, after)), false, "mutation: " + before);
  }
});


test("duplicate public-source promotions cannot hide behind the original private entry", () => {
  for (const sourceLabel of [
    "Java/GraalVM implementation",
    "LLVM implementation",
    "AttoLang formatter",
  ]) {
    assert.equal(safeDiscovery(index + "\n- " + sourceLabel +
      ": **Public repository**; all backends verified\n"), false,
      "duplicate public claim: " + sourceLabel);
    const original = index.split("\n").find(line => line.includes(sourceLabel));
    assert.ok(original, "source entry exists");
    assert.equal(safeDiscovery(index + "\n" + original + "\n"), false,
      "duplicate private entry: " + sourceLabel);
  }
});

test("the public discovery index distinguishes examples, draft specification and native evidence", () => {
  assert.match(index, /Examples[^\n]+verify every sample against a specific compiler version/u);
  assert.match(index, /Draft, not a released language specification/u);
  assert.match(index, /LLVM implementation[^\n]+not public evidence of native backend support/u);
  assert.match(index, /zero compiler-verified/u);
});
