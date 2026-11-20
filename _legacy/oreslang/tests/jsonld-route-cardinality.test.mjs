import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Build-output proof, intentionally skipped by the pre-build npm test stage.
// CI also invokes npm run test:site:build after astro build.
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "https://ores-truffle-oreslang.github.io";

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function meta(html, property) {
  const tags = [...html.matchAll(/<meta\b([^>]*)>/giu)].map((match) => match[1]);
  const found = tags.filter((attrs) =>
    attrs.match(/\bproperty="([^"]*)"/u)?.[1] === property
  );
  assert.equal(found.length, 1, property + " must have exactly one meta tag");
  const match = found[0].match(/\bcontent="([^"]*)"/u);
  assert.ok(match, property + " must have a quoted content value");
  return match[1];
}

function canonical(html) {
  const links = [...html.matchAll(/<link\b([^>]*)>/giu)].map((match) => match[1]);
  const found = links.filter((attrs) => /\brel="canonical"/u.test(attrs));
  assert.equal(found.length, 1, "must have exactly one canonical link");
  const match = found[0].match(/\bhref="([^"]*)"/u);
  assert.ok(match, "canonical link must have a quoted href");
  assert.ok(match[1].startsWith(origin + "/"), "canonical must stay on the owned origin");
  return match[1];
}

function scripts(html) {
  const isJsonLd = (attrs) => /\btype="application\/ld\+json"/iu.test(attrs);
  const openers = [...html.matchAll(/<script\b([^>]*)>/giu)]
    .filter((match) => isJsonLd(match[1]));
  const paired = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter((match) => isJsonLd(match[1]));
  assert.equal(paired.length, openers.length, "every JSON-LD opener must be closed");
  return paired.map((match) => {
    const raw = match[2];
    assert.ok(!raw.includes("<"), "JSON-LD cannot contain an unescaped literal <");
    const json = JSON.parse(raw);
    assert.equal(json["@context"], "https://schema.org");
    assert.ok(["WebSite", "TechArticle"].includes(json["@type"]));
    return json;
  });
}

function validatePage(html, route) {
  const type = meta(html, "og:type");
  assert.ok(["article", "website"].includes(type), route + " has unexpected OG type");
  const url = canonical(html);
  assert.equal(meta(html, "og:url"), url, route + " OG URL differs from canonical");
  const parsed = scripts(html);
  const articles = parsed.filter((doc) => doc["@type"] === "TechArticle");
  const websites = parsed.filter((doc) => doc["@type"] === "WebSite");
  const isHome = route === "/index.html";

  assert.equal(articles.length, type === "article" ? 1 : 0,
    route + " article pages need exactly one TechArticle and others need none");
  assert.equal(websites.length, isHome ? 1 : 0,
    route + " only the homepage may contain exactly one WebSite");
  assert.equal(parsed.length, articles.length + websites.length,
    route + " unexpected extra JSON-LD blocks");

  if (type === "article") {
    const article = articles[0];
    assert.equal(article.mainEntityOfPage, url, route + " article canonical differs");
    assert.equal(article.datePublished, meta(html, "article:published_time"),
      route + " publication time differs");
    assert.equal(article.dateModified, meta(html, "article:modified_time"),
      route + " modification time differs");
    assert.ok(typeof article.headline === "string" && article.headline.length > 0);
  }
  if (isHome) {
    assert.equal(type, "website");
    assert.equal(websites[0].name, "AttoLang");
    assert.equal(websites[0].url, origin + "/");
  }
  return { type, articles: articles.length, websites: websites.length };
}

test("each built page's structured data matches its own OG type and article dates", {
  skip: !existsSync(dist)
}, () => {
  const pages = walk(dist).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length >= 15, "too few built pages to establish site coverage");
  let articleCount = 0;
  let homeCount = 0;
  for (const file of pages) {
    const route = "/" + relative(dist, file).split(sep).join("/");
    const result = validatePage(readFileSync(file, "utf8"), route);
    articleCount += result.articles;
    homeCount += result.websites;
  }
  assert.ok(articleCount >= 1, "expected at least one real article page");
  assert.equal(homeCount, 1, "expected only one homepage WebSite document");
});

test("deletion, duplicate, type swap and metadata divergence are detected", () => {
  const url = origin + "/logs/5/";
  const article = {
    "@context": "https://schema.org", "@type": "TechArticle",
    headline: "A test article", datePublished: "2026-11-01",
    dateModified: "2026-11-07", mainEntityOfPage: url
  };
  const script = (json) => '<script type="application/ld+json">' +
    JSON.stringify(json).replace(/</gu, "\\u003c") + '</script>';
  const body = [
    '<link rel="canonical" href="' + url + '">',
    '<meta property="og:url" content="' + url + '">',
    '<meta property="og:type" content="article">',
    '<meta property="article:published_time" content="2026-11-01">',
    '<meta property="article:modified_time" content="2026-11-07">'
  ].join("");
  assert.equal(validatePage(body + script(article), "/logs/5/index.html").articles, 1);

  const mutants = [
    body,
    body + script(article) + script(article),
    body + script({ ...article, "@type": "WebSite" }),
    body + script({ ...article, mainEntityOfPage: origin + "/wrong/" }),
    body + script({ ...article, dateModified: "2026-11-08" }),
    body + script({ ...article, datePublished: "2026-10-01" }),
    body.replace('content="article"', 'content="website"') + script(article),
    body + '<meta property="og:type" content="article">' + script(article),
    body.replace('property="og:url"', 'property="bad:url"') + script(article),
    body.replace('content="' + url + '"', 'content="https://evil.example/"') + script(article),
    body + script({ ...article, "@type": "Unknown" }),
    body + script({ ...article, headline: "</script><script>alert(1)</script>" })
      .replace(/\\u003c/gu, "<"),
    body + script(article).replace('application/ld+json', 'application/json')
  ];
  mutants.forEach((html, index) => {
    assert.throws(() => validatePage(html, "/logs/5/index.html"),
      "mutation " + index + " should fail closed");
  });
});
