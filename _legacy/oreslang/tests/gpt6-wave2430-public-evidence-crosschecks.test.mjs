import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const discovery = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const original = JSON.parse(readFileSync(
  new URL("../public/language/draft-2026-10-14/features.json", import.meta.url), "utf8"
));
const SOURCE_REPOS = new Map([
  ["Java/GraalVM implementation", "oreslang-source.java"],
  ["LLVM implementation", "oreslang-source.llvm"],
  ["AttoLang formatter", "oreslang-format"],
]);

// Only static publication evidence. This is not a compiler or release certification.
function validatePublication(index, matrix) {
  assert.match(index, /^# AttoLang$/m);
  const entries = index.split(/\r?\n/).filter(line => line.startsWith("- ["));
  assert.ok(entries.length > SOURCE_REPOS.size);
  for (const line of entries) {
    const match = /^- \[([^\]]+)\]\(([^)\s]+)\): (.+)$/.exec(line);
    assert.ok(match, "malformed discovery link: " + line);
    const [, , rawUrl] = match;
    const url = new URL(rawUrl);
    assert.equal(url.protocol, "https:");
    assert.ok(["ores-truffle-oreslang.github.io", "github.com"].includes(url.hostname));
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(url.port, "");
  }
  // A new source label with a different name must not evade per-label checks.
  const sectionStart = index.indexOf("\n## Source and verification\n");
  const sectionEnd = index.indexOf("\n## Reliability notice\n", sectionStart + 1);
  assert.ok(sectionStart !== -1 && sectionEnd > sectionStart, "source section delimiters");
  const sourceRows = index.slice(sectionStart, sectionEnd).split(/\r?\n/)
    .filter(line => line.startsWith("- "));
  assert.equal(sourceRows.length, SOURCE_REPOS.size, "no undeclared or duplicated source claims");
  assert.ok(sourceRows.every(line => line.startsWith("- [")), "no unlinked source claims");
  for (const [label, name] of SOURCE_REPOS) {
    const hits = entries.filter(line => line.startsWith("- [" + label + "]("));
    assert.equal(hits.length, 1, "exactly one source entry: " + label);
    assert.ok(hits[0].includes("](https://github.com/ores-truffle-oreslang/" + name + ")"));
    assert.match(hits[0], /\*\*Private repository\*\*/);
  }
  assert.match(index, /All backend support explicitly not-verified/);
  assert.match(index, /Do not infer stable syntax or cross-backend parity/);
  assert.match(index, /zero compiler-verified/);
  // A contradictory promotion elsewhere in the discovery text must not
  // override the correctly scoped private-source rows.
  assert.doesNotMatch(index, /\*\*Public repository\*\*|(?:all|five) backends? (?:are )?(?:fully )?(?:verified|supported)|(?:native )?compiler (?:executed|certified)/iu);
  assert.match(index, /does not imply that AI services crawl, index, train on/);

  assert.equal(matrix.schema_version, 1);
  assert.equal(matrix.status, "documentation-draft");
  assert.equal(matrix.normative, false);
  assert.equal(matrix.release_tag, null);
  assert.ok(Array.isArray(matrix.backend_keys) && matrix.backend_keys.length >= 4);
  assert.equal(new Set(matrix.backend_keys).size, matrix.backend_keys.length);
  assert.ok(Array.isArray(matrix.features) && matrix.features.length > 0);
  assert.equal(new Set(matrix.features.map(row => row.id)).size, matrix.features.length);
  for (const row of matrix.features) {
    assert.equal(row.design_status, "described", "design-only: " + row.id);
    assert.ok(/not established|not implied/u.test(row.notes),
      "feature note must carry uncertainty: " + row.id);
    assert.deepEqual(Object.keys(row.support).sort(), [...matrix.backend_keys].sort(),
      "support keys of " + row.id);
    for (const status of Object.values(row.support)) assert.equal(status, "not-verified");
  }
  assert.equal(matrix.examples.public_verified_sources, 0);
  assert.equal(matrix.examples.has_verified_compilation, false);
  assert.equal(matrix.examples.verification_scope, "historical-source-integrity-only");
  assert.equal(matrix.examples.inventory_url,
    "https://github.com/" + matrix.examples.repository + "/blob/" +
    matrix.examples.inventory_commit + "/" + matrix.examples.inventory_path);
  // Do not permit a safe-sounding description to accompany a swapped link.
  const matrixRows = entries.filter(line => line.startsWith("- [Feature support matrix]("));
  assert.equal(matrixRows.length, 1);
  assert.equal(matrixRows[0],
    "- [Feature support matrix](https://ores-truffle-oreslang.github.io/language/draft-2026-10-14/features.json): All backend support explicitly not-verified by this publication");
  const inventoryRows = entries.filter(line =>
    line.startsWith("- [Historical example source inventory]("));
  assert.equal(inventoryRows.length, 1);
  assert.ok(inventoryRows[0].includes("](" + matrix.examples.inventory_url + ")"));
  assert.match(inventoryRows[0], /zero compiler-verified/u);
}

test("discovery links and feature matrix agree on the draft-only evidence boundary", () => {
  validatePublication(discovery, original);
});

test("forged public source entries, credentials, or insecure link origins are rejected", () => {
  for (const mutated of [
    discovery.replace("**Private repository**", "**Public repository**"),
    discovery.replace("https://github.com/ores-truffle-oreslang/oreslang-source.java",
      "http://github.com/ores-truffle-oreslang/oreslang-source.java"),
    discovery.replace("https://github.com/ores-truffle-oreslang/oreslang-source.java",
      "https://attacker.example/oreslang-source.java"),
    discovery.replace("https://github.com/ores-truffle-oreslang/oreslang-source.java",
      "https://user:secret@github.com/ores-truffle-oreslang/oreslang-source.java"),
    discovery + "\n- [LLVM implementation](https://github.com/ores-truffle-oreslang/oreslang-source.llvm): **Public repository**\n",
    discovery.replace("## Source and verification\n",
      "## Source and verification\n- [Rust backend](https://github.com/ores-truffle-oreslang/oreslang-source.rs): **Public repository**; compiler verified\n"),
    discovery.replace("https://github.com/ores-truffle-oreslang/oreslang-source.java",
      "https://github.com/ores-truffle-oreslang/oreslang-source.java#verified"),
    discovery.replace("https://github.com/ores-truffle-oreslang/oreslang-source.java",
      "https://github.com:8443/ores-truffle-oreslang/oreslang-source.java"),
    discovery.replace("## Source and verification\n",
      "## Source and verification\n- [Java mirror](https://github.com/ores-truffle-oreslang/oreslang-source.java): **Private repository**; verified native source\n"),
  ]) assert.throws(() => validatePublication(mutated, original));
});

test("each backend promotion, draft-to-normative upgrade, or invented verified example is rejected", () => {
  const mutationCases = [
    m => { m.status = "released"; },
    m => { m.normative = true; },
    m => { m.release_tag = "v1.0.0"; },
    m => { m.examples.public_verified_sources = 1; },
    m => { m.examples.has_verified_compilation = true; },
    m => { m.examples.verification_scope = "compiled-verified"; },
    m => { m.examples.inventory_commit = "a".repeat(40); },
    m => { m.backend_keys.push(m.backend_keys[0]); },
    m => { m.features.push({ ...m.features[0] }); },
  ];
  for (const key of original.backend_keys) mutationCases.push(m => { m.features[0].support[key] = "supported"; });
  for (const [i, mutate] of mutationCases.entries()) {
    const next = structuredClone(original);
    mutate(next);
    assert.throws(() => validatePublication(discovery, next), "mutation " + i);
  }
});

test("feature status cannot be promoted by a missing or extra backend field", () => {
  const missing = structuredClone(original);
  delete missing.features[0].support[missing.backend_keys[0]];
  assert.throws(() => validatePublication(discovery, missing));
  const extra = structuredClone(original);
  extra.features[0].support["unverified-new-backend"] = "supported";
  assert.throws(() => validatePublication(discovery, extra));
});

test("swapped feature-matrix and historical inventory links are rejected", () => {
  const featureUrl = "https://ores-truffle-oreslang.github.io/language/draft-2026-10-14/features.json";
  for (const altered of [
    discovery.replace(featureUrl,
      "https://ores-truffle-oreslang.github.io/language/draft-2026-10-14/features.json.bak"),
    discovery.replace(featureUrl,
      "https://ores-truffle-oreslang.github.io/language/draft-2026-10-14/verified.json"),
    discovery.replace("- [Feature support matrix]", "- [Feature support matrix (verified)]"),
    discovery.replace("zero compiler-verified", "one compiler-verified"),
    discovery.replace(matrixInventoryUrl(original), "https://github.com/ores-truffle-oreslang/oreslang-demos/blob/main/ai/examples.manifest.json"),
  ]) {
    assert.throws(() => validatePublication(altered, original));
  }
});

function matrixInventoryUrl(matrix) {
  return matrix.examples.inventory_url;
}

test("contradictory evidence promotions and implicit implementation claims fail closed", () => {
  for (const claim of [
    "\n## Release notes\nAll backends are fully verified.\n",
    "\n## Release notes\n**Public repository**\n",
    "\n## Release notes\nNative compiler certified\n",
  ]) assert.throws(() => validatePublication(discovery + claim, original));

  const falselyDescribed = structuredClone(original);
  falselyDescribed.features[0].design_status = "implemented";
  assert.throws(() => validatePublication(discovery, falselyDescribed));

  const noUncertainty = structuredClone(original);
  noUncertainty.features[0].notes = "Compiled and supported on all targets";
  assert.throws(() => validatePublication(discovery, noUncertainty));
});
