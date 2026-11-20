import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { engineeringLogs } from "../src/data/engineering-logs.mjs";

const dist = join(process.cwd(), "dist");
const origin = "https://ores-truffle-oreslang.github.io";
const read = (relative) => readFileSync(join(dist, relative), "utf8");

test("the deployed log inventory is identical to the canonical engineering log catalog", () => {
  const expected = engineeringLogs.map(({ number }) => number).sort((a, b) => a - b);
  assert.ok(expected.length > 0, "Refuse an empty public engineering log catalog");
  assert.equal(new Set(expected).size, expected.length, "Duplicate published log number");
  const actual = readdirSync(join(dist, "logs"), { withFileTypes: true })
    .filter((dir) => dir.isDirectory() && /^[1-9]\d*$/u.test(dir.name))
    .map((dir) => Number(dir.name)).sort((a, b) => a - b);
  assert.deepEqual(actual, expected, "Published archive has missing or unregistered log routes");

  const sitemap = read("sitemap.xml");
  const feed = read("rss.xml");
  const archive = read("logs/index.html");
  const index = read("index.html");
  for (const number of expected) {
    const article = "logs/" + number + "/index.html";
    assert.ok(existsSync(join(dist, article)), "Missing published article " + number);
    const html = read(article);
    assert.match(html, /<h1\b/iu, "Missing semantic title in log " + number);
    assert.match(html, /<script\b[^>]*type="application\/ld\+json"/iu,
      "Missing article structured data in log " + number);
    const url = origin + "/logs/" + number + "/";
    assert.ok(sitemap.includes("<loc>" + url + "</loc>"),
      "Missing article sitemap URL: " + number);
    assert.ok(feed.includes("<guid isPermaLink=\"true\">" + url + "</guid>"),
      "Missing RSS entry for article " + number);
    assert.ok(archive.includes('href="/logs/' + number + '/"'),
      "Missing article in archive " + number);
  }
  assert.ok(index.includes('href="/logs/"'), "Homepage lacks log archive navigation");
  console.log("VERIFIED_PUBLISHED_LOGS count=" + expected.length);
});

test("latest RSS item and feed metadata track the newest canonical log", () => {
  const latest = engineeringLogs[0];
  assert.ok(latest && Number.isSafeInteger(latest.number) && latest.number > 0);
  const feed = read("rss.xml");
  assert.ok(feed.includes("<title>AttoLang engineering logs</title>"));
  const items = [...feed.matchAll(/<item>[\s\S]*?<\/item>/gu)].map(m => m[0]);
  assert.equal(items.length, engineeringLogs.length);
  assert.ok(items[0].includes(origin + "/logs/" + latest.number + "/"),
    "RSS newest item must match the latest published log");
});
