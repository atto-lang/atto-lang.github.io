import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const article = read("src/pages/logs/10.astro");
const previous = read("src/pages/logs/9.astro");

test("Log 010 is the newest registered article and links to its neighbours", () => {
  assert.equal(engineeringLogs[0].number, 10);
  assert.equal(engineeringLogs[0].title, "explaining attolang to my dad");
  assert.match(article, /<h1>explaining attolang to my dad<\/h1>/u);
  assert.match(article, /published: "2026-11-03", modified: "2026-11-03", author: "Alex Mills"/u);
  assert.match(article, /href="\/logs\/9\/"/u);
  assert.match(article, /href="\/logs\/"/u);
  assert.match(previous, /href="\/logs\/10\/"/u);
});

test("Log 010 keeps backend claims explicitly unverified", () => {
  assert.match(article, /href="\/language\/draft-2026-10-14\/features\.json"/u);
  assert.match(article, /public feature status<\/a> still marks backend support as unverified/u);
});
