import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("homepage uses tilde structural match and explicit as binding", () => {
  const source = read("../src/pages/index.astro");
  assert.match(source, /on ~ \{id: string, active: bool\} as a -> \{/u);
  assert.doesNotMatch(source, /on structural \{id: string, active: bool\} a ->/u);
});

test("named structural pattern uses explicit as binding", () => {
  const source = read("../src/pages/examples.astro");
  assert.match(source, /on structural HN as named -> \{/u);
  assert.doesNotMatch(source, /on structural HN named ->/u);
});

test("language design specifies records, structs, classes and limits", () => {
  const source = read("../docs/STRUCTURAL_MATCH_DESIGN.md");
  for (const required of [
    "on ~ {id: string, active: bool} as a",
    "on structural {id: string, active: bool} as a",
    "Records, structs and classes",
    "Extra fields",
    "private or actor-sealed state",
    "not evidence of successful compiler",
  ]) {
    assert.ok(source.includes(required), "missing design contract: " + required);
  }
});
