import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dist = join(process.cwd(), "dist");
const siteOrigin = "https://ores-truffle-oreslang.github.io";
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith(".html") ? [file] : [];
});
const routeOf = (file) => "/" + relative(dist, file).split(sep).join("/").replace(/index\.html$/u, "");
const canonical = (route) => new URL(route, siteOrigin).href;

function structuredDataScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter((match) => /(?:^|\s)type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json(?=\s|$))/iu.test(match[1]))
    .map((match) => match[2]);
}

test("JSON-LD sink census catches quoted, unquoted and case-varied script tags", () => {
  for (const opener of [
    '<script type="application/ld+json">',
    "<SCRIPT TYPE='application/ld+json'>",
    "<script type=application/ld+json>",
    '<script type = "application/ld+json" data-source="site">',
  ]) {
    const sample = opener + '{"@type":"TechArticle"}' + "</script>";
    assert.equal(structuredDataScripts(sample).length, 1, "missed sink: " + opener);
    assert.equal(structuredDataScripts(sample + sample).length, 2,
      "duplicate sink slipped through: " + opener);
  }
  assert.equal(structuredDataScripts('<script type="module">alert(1)</script>').length, 0);
});

test("rendered JSON-LD is parseable, script-safe and bound to the canonical route", () => {
  const pages = walk(dist);
  assert.ok(pages.length >= 15, "site build must produce a meaningful set of pages");
  let articles = 0;
  for (const file of pages) {
    const route = routeOf(file);
    const scripts = structuredDataScripts(readFileSync(file, "utf8"));
    assert.ok(scripts.length <= 1, route + " has duplicate JSON-LD sinks");
    if (route === "/") assert.equal(scripts.length, 1, "homepage needs WebSite structured data");
    if (route === "/logs/5/") assert.equal(scripts.length, 1, "engineering log needs TechArticle structured data");
    for (const raw of scripts) {
      assert.ok(raw.trim().length > 0, route + " contains empty structured data");
      assert.ok(!raw.includes("<"), route + " contains an unescaped HTML/script opener");
      let data;
      try { data = JSON.parse(raw); }
      catch (error) { throw new Error(route + " has invalid emitted JSON-LD: " + error.message); }
      assert.equal(data["@context"], "https://schema.org", route);
      if (data["@type"] === "WebSite") {
        assert.equal(route, "/", "WebSite structured data must be homepage-only");
        assert.equal(data.name, "AttoLang");
        assert.equal(data.url, canonical("/"));
        assert.deepEqual(data.alternateName, ["Oreslang", "OresLang"]);
      } else {
        assert.equal(data["@type"], "TechArticle", route + " unexpected structured data type");
        assert.notEqual(route, "/", "TechArticle cannot be homepage structured data");
        assert.equal(data.mainEntityOfPage, canonical(route), route + " wrong JSON-LD canonical");
        assert.ok(typeof data.headline === "string" && data.headline.trim(), route + " missing headline");
        assert.ok(typeof data.description === "string" && data.description.trim(), route + " missing description");
        for (const key of ["datePublished", "dateModified"]) {
          assert.match(data[key], /^\d{4}-\d{2}-\d{2}/u, route + " invalid " + key);
        }
        assert.ok(Date.parse(data.dateModified) >= Date.parse(data.datePublished),
          route + " article modification precedes publication");
        articles++;
      }
    }
  }
  assert.ok(articles >= 1, "expected executed checks against built TechArticle pages");
});

function safePublishedClaims(index, matrix) {
  if (typeof index !== "string" || !matrix || typeof matrix !== "object") return false;
  // A private-source label on a malicious redirect URL is still a disclosure.
  const privateSourceLinks = [
    ["Java/GraalVM implementation", "https://github.com/ores-truffle-oreslang/oreslang-source.java"],
    ["LLVM implementation", "https://github.com/ores-truffle-oreslang/oreslang-source.llvm"],
    ["AttoLang formatter", "https://github.com/ores-truffle-oreslang/oreslang-format"],
  ];
  const lines = index.split("\n");
  const sourcesPrivate = privateSourceLinks.every(([label, expectedUrl]) => {
    const entries = lines.filter((line) => line.startsWith("- [" + label + "]("));
    return entries.length === 1
      && entries[0].startsWith("- [" + label + "](" + expectedUrl + "): **Private repository**")
      && !/\bpublic repository\b/iu.test(entries[0]);
  });
  const backends = matrix.backend_keys;
  const features = matrix.features;
  const canonicalBackends = ["java-graalvm", "llvm", "dotnet", "wasm"];
  const exactDraftEvidencePolicy = "No entry may be marked supported solely because of design prose, a source-file hash, or unit tests of the documentation harness.";
  return sourcesPrivate
    && index.includes("All backend support explicitly not-verified")
    && index.includes("Do not infer stable syntax or cross-backend parity")
    && !/^\s*All backend support verified\b/imu.test(index)
    && !/^\s*All backends? (?:verified|certified|supported)\b/imu.test(index)
    && matrix.schema_version === 1
    && matrix.reference_id === "draft-2026-10-14"
    && matrix.evidence_policy === exactDraftEvidencePolicy
    && matrix.status === "documentation-draft"
    && matrix.normative === false
    && matrix.release_tag === null
    && Array.isArray(backends) && backends.length === canonicalBackends.length
    && canonicalBackends.every((backend, index) => backends[index] === backend)
    && Array.isArray(features) && features.length >= 10
    && new Set(features.map((feature) => feature.id)).size === features.length
    && features.every((feature) => feature && typeof feature === "object"
      && feature.design_status === "described"
      && feature.support && typeof feature.support === "object"
      && !Array.isArray(feature.support)
      && Object.keys(feature.support).length === backends.length
      && Object.keys(feature.support).every((key) => backends.includes(key))
      && backends.every((backend) => feature.support[backend] === "not-verified"))
    && matrix.examples?.repository === "ores-truffle-oreslang/oreslang-demos"
    && matrix.examples?.verification_scope === "historical-source-integrity-only"
    && matrix.examples?.public_verified_sources === 0
    && matrix.examples?.has_verified_compilation === false;
}

test("published AI discovery and backend matrix fail closed under claim-promotion mutations", () => {
  const index = readFileSync(join(dist, "llms.txt"), "utf8");
  const matrix = JSON.parse(readFileSync(join(dist, "language/draft-2026-10-14/features.json"), "utf8"));
  assert.equal(safePublishedClaims(index, matrix), true, "published artifacts contain an unsupported public verification claim");

  for (const [from, to] of [
    ["**Private repository**", "**Public repository**"],
    ["All backend support explicitly not-verified", "All backend support verified"],
    ["Do not infer stable syntax or cross-backend parity", "All backends are certified"],
  ]) {
    assert.ok(index.includes(from), "missing mutation marker " + from);
    assert.equal(safePublishedClaims(index.replace(from, to), matrix), false, from);
  }
  assert.equal(safePublishedClaims(index.replace("**Private repository**", "**Private repository**; **Public repository**"), matrix), false,
    "conflicting private/public source entry");
  assert.equal(safePublishedClaims(index.replace(
    "https://github.com/ores-truffle-oreslang/oreslang-source.llvm",
    "https://attacker.invalid/repo"), matrix), false, "private repository link was substituted");
  assert.equal(safePublishedClaims(index.replace(
    "https://github.com/ores-truffle-oreslang/oreslang-format",
    "https://github.com/ores-truffle-oreslang/oreslang-format?redirect=https://attacker.invalid"), matrix),
    false, "private repository link received an unreviewed redirect suffix");
  const duplicate = index.split("\n").find((line) => line.startsWith("- [LLVM implementation]("));
  assert.ok(duplicate);
  assert.equal(safePublishedClaims(index + "\n" + duplicate, matrix), false, "duplicate source listing");

  assert.equal(safePublishedClaims(index + "\nAll backend support verified\n", matrix), false,
    "contradictory appended verification claim");
  assert.equal(safePublishedClaims(index.replace("**Private repository**", "**Private repository**; public repository"), matrix), false,
    "case-varied public source promotion");
  for (const mutate of [
    (x) => { x.schema_version = 2; },
    (x) => { x.reference_id = "released-2026-11"; },
    (x) => { x.evidence_policy = "All compiler backends have been independently verified."; },
    (x) => { x.examples.verification_scope = "compiled-guest-parity"; },
    (x) => { x.examples.repository = "unreviewed/example-source"; },
    (x) => { x.features[0].design_status = "implemented"; },
    (x) => {
      const prior = x.backend_keys[0];
      x.backend_keys[0] = "unapproved-backend";
      for (const feature of x.features) {
        feature.support["unapproved-backend"] = feature.support[prior];
        delete feature.support[prior];
      }
    },
    (x) => { x.normative = true; },
    (x) => { x.status = "released"; },
    (x) => { x.release_tag = "v1.0.0"; },
    (x) => { x.examples.public_verified_sources = 1; },
    (x) => { x.examples.has_verified_compilation = true; },
    (x) => { x.features[0].support[x.backend_keys[0]] = "supported"; },
    (x) => { x.features.push(structuredClone(x.features[0])); },
    (x) => { x.backend_keys.push(x.backend_keys[0]); },
    (x) => { x.features[0].support.forge = "supported"; },
    (x) => { x.features[0].support.forge = "not-verified"; },
    (x) => { delete x.features[0].support[x.backend_keys[0]]; },
    (x) => { x.features[0].support[x.backend_keys[0]] = "verified"; },
  ]) {
    const altered = structuredClone(matrix);
    mutate(altered);
    assert.equal(safePublishedClaims(index, altered), false, "claim mutation accepted: " + mutate.toString());
  }
});
