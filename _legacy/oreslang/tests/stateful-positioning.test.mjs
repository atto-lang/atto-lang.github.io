import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const about = readFileSync(new URL("../src/pages/about.astro", import.meta.url), "utf8");

test("homepage leads with the stateful-applications motivation and core influences", () => {
  for (const concept of [
    "stateless REST APIs", "WebSocket servers", "gaming backends",
    "UIs", "state machines for distributed coordination", "message queues",
    "development servers", "Erlang", "Rust", "Microsoft Orleans",
    "fault-tolerant actors", "hot upgrades"
  ]) {
    assert.ok(home.includes(concept), "homepage missing " + concept);
  }
  assert.ok(home.indexOf('id="stateful-applications"') < home.indexOf('id="about"'));
  assert.ok(home.includes('href="/language/"'));
});

test("About page explains language influences, native goals, and both name meanings", () => {
  for (const concept of [
    "WebSocket servers", "gaming backends", "UIs",
    "state machines for distributed coordination", "message queues",
    "development", "Erlang", "Rust", "Microsoft Orleans",
    "ahead-of-time (AOT)", "native binaries", "fault-tolerant actors",
    "hot upgrades", "Italian", "Japanese", "Attō"
  ]) {
    assert.ok(about.includes(concept), "About missing " + concept);
  }
  assert.ok(about.includes("AttoLang was formerly known as Oreslang."));
});

test("marketing copy qualifies performance ambitions and backend-specific runtime goals", () => {
  for (const [label, rawPage] of [["homepage", home], ["About", about]]) {
    const page = rawPage.replace(/\s+/gu, " ");
    assert.ok(page.includes("performance ambition is to exceed Erlang's throughput"), label);
    assert.ok(page.includes("10× speed and one-tenth compute figures are design targets, not measured results"), label);
    assert.ok(page.includes("no controlled, like-for-like Erlang comparison establishes them"), label);
    assert.ok(page.includes("type and memory safety goals"), label);
    assert.ok(page.includes("full ahead-of-time (AOT) compilation"), label);
    assert.ok(page.includes("native binaries"), label);
    assert.ok(page.includes("zero-GC execution"), label);
    assert.ok(page.includes("fault-tolerant actors"), label);
    assert.ok(page.includes("better hot upgrades"), label);
    assert.ok(!page.includes("We can deliver"), label);
  }
});
