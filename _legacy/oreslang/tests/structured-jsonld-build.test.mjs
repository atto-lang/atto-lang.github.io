import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const pathname = join(directory, entry.name);
    return entry.isDirectory() ? walk(pathname) : [pathname];
  });
}

function structuredScripts(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)];
  return scripts.filter(([, attributes]) =>
    /\btype\s*=\s*["']application\/ld\+json["']/iu.test(attributes)
  ).map(([, , contents]) => contents);
}

function inspectMarkup(html, route) {
  const blocks = structuredScripts(html);
  const parsed = [];
  for (const [index, contents] of blocks.entries()) {
    assert.ok(!contents.includes("<"), route + " JSON-LD " + index + " contains an unescaped HTML opener");
    // An isolated "-->" is safe inside script raw text once literal "<" is escaped.
    const json = JSON.parse(contents);
    assert.equal(json["@context"], "https://schema.org", route + " schema context");
    assert.ok(json["@type"] === "WebSite" || json["@type"] === "TechArticle",
      route + " unexpected JSON-LD schema type");
    if (json["@type"] === "TechArticle") {
      assert.ok(typeof json.headline === "string" && json.headline.length > 0, route + " headline");
      assert.ok(typeof json.datePublished === "string" && json.datePublished.length > 0, route + " publication date");
      assert.ok(typeof json.mainEntityOfPage === "string", route + " canonical URL absent");
      const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/iu);
      assert.ok(canonical, route + " canonical tag absent");
      assert.equal(json.mainEntityOfPage, canonical[1], route + " JSON-LD canonical mismatch");
    }
    parsed.push(json);
  }
  return parsed;
}

test("every rendered JSON-LD script is parseable, HTML-safe and canonical-bound", { skip: !existsSync(dist) }, () => {
  let website = 0, articles = 0;
  const pages = walk(dist).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length >= 15, "the site build must produce representative pages");
  for (const file of pages) {
    const route = "/" + relative(dist, file).split(sep).join("/");
    const html = readFileSync(file, "utf8");
    const data = inspectMarkup(html, route);
    for (const entry of data) {
      if (entry["@type"] === "WebSite") {
        website++;
        assert.equal(entry.name, "AttoLang");
        assert.deepEqual(entry.alternateName, ["Oreslang", "OresLang"]);
      } else articles++;
    }
  }
  assert.equal(website, 1, "only the home page may publish the WebSite descriptor");
  assert.ok(articles >= 1, "no rendered TechArticle JSON-LD inspected");
});

test("rendered-script safety oracle rejects breakout, malformed JSON and mismatched canonical", () => {
  const article = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "safe",
    datePublished: "2026-11-07",
    mainEntityOfPage: "https://ores-truffle-oreslang.github.io/logs/5/"
  };
  const wrap = (payload) =>
    '<link rel="canonical" href="https://ores-truffle-oreslang.github.io/logs/5/">' +
    '<script type="application/ld+json">' + payload + '</script>';
  assert.equal(inspectMarkup(wrap(JSON.stringify(article)), "/fixture").length, 1);
  for (const dangerous of [
    { ...article, headline: '</script><script>alert(1)</script>' },
    { ...article, headline: '<svg onload=alert(1)>' },
    { ...article, headline: '<!-- attacker -->' }
  ]) {
    assert.throws(() => inspectMarkup(wrap(JSON.stringify(dangerous)), "/mutant"),
      "raw HTML/script breakout must fail even when parsing terminates before the guard");
    const encoded = JSON.stringify(dangerous).replace(/</g, "\\u003c");
    assert.deepEqual(inspectMarkup(wrap(encoded), "/escaped"), [dangerous]);
  }
  assert.throws(() => inspectMarkup(wrap('{"@context":'), "/broken"), SyntaxError);
  const wrong = { ...article, mainEntityOfPage: "https://attacker.example/" };
  assert.throws(() => inspectMarkup(wrap(JSON.stringify(wrong)), "/mismatched"), /canonical mismatch/);
});
