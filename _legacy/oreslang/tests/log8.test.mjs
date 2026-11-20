import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const article = read("src/pages/logs/8.astro");
const inventory = JSON.parse(read("src/data/engineering-log-examples.json"));

test("Log 008 has the correct title and is indexed in the canonical registry", () => {
  assert.equal(engineeringLogs.find((entry) => entry.number === 8)?.title, "Actors are not lambdas");
  assert.match(article, /<h1>Actors are not lambdas<\/h1>/u);
  assert.match(article, /article=\{\{ published: "2026-10-16", modified: "2026-10-16", author: "Alex Mills" \}\}/u);
  assert.match(article, /href="\/logs\/7\/"/u);
  assert.match(article, /href="\/logs\/"/u);
});

test("Article distinguishes closures and actor state without promising durability or parallel execution", () => {
  assert.match(article, /closures may be stateful, and actors may be stateless/u);
  assert.match(article, /in-memory state is not automatically durable state/u);
  assert.match(article, /at most one native thread executes that actor/u);
  assert.match(article, /actor-owned <code>state<\/code>/u);
  assert.match(article, /<code>critical<\/code>/u);
  assert.match(article, /function is smaller, more direct/u);
});

test("All conceptual diagrams are recorded as unverified, accessible illustrations", () => {
  const blocks = [...article.matchAll(/<pre tabindex="0"><code>/gu)];
  const tracked = inventory.examples.filter((entry) => entry.log === 8);
  assert.equal(blocks.length, 2);
  assert.deepEqual(tracked.map((entry) => entry.ordinal), [1, 2]);
  for (const entry of tracked) {
    assert.equal(entry.source, "src/pages/logs/8.astro");
    assert.equal(entry.validationClass, "non-compiler-artifact");
    assert.equal(entry.compilerVerified, false);
    assert.deepEqual(entry.verifiedBackends, []);
  }
});
