import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(
  new URL("../public/language/draft-2026-10-14/features.json", import.meta.url), "utf8"
));

function validateDiscovery(text, data) {
  assert.match(text, /^# AttoLang$/mu);
  assert.match(text, /All backend support explicitly not-verified/u);
  assert.match(text, /Do not infer stable syntax or cross-backend parity/u);
  assert.match(text, /Select a compiler release\/commit/u);
  assert.match(text, /zero compiler-verified/u);
  assert.match(text, /features\.json/u);

  assert.equal(data.schema_version, 1);
  assert.equal(data.reference_id, "draft-2026-10-14");
  assert.equal(data.status, "documentation-draft");
  assert.equal(data.normative, false);
  assert.equal(data.release_tag, null);
  assert.match(data.evidence_policy, /No entry may be marked supported solely/u);
  assert.ok(Array.isArray(data.backend_keys) && data.backend_keys.length >= 4);
  assert.equal(new Set(data.backend_keys).size, data.backend_keys.length);
  assert.ok(data.backend_keys.every((key) => /^[a-z][a-z0-9-]+$/u.test(key)));
  assert.ok(Array.isArray(data.features) && data.features.length >= 10);
  const ids = data.features.map((feature) => feature.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate feature ID");
  for (const feature of data.features) {
    assert.match(feature.id, /^[a-z][a-z0-9-]+$/u);
    assert.ok(typeof feature.name === "string" && feature.name.length > 0);
    assert.equal(feature.design_status, "described");
    assert.deepEqual(Object.keys(feature.support).sort(), [...data.backend_keys].sort(),
      feature.id + " backend registry mismatch");
    for (const backend of data.backend_keys)
      assert.equal(feature.support[backend], "not-verified",
        feature.id + "/" + backend + " must not promote without compiler proof");
  }

  const examples = data.examples;
  assert.equal(examples.public_verified_sources, 0);
  assert.equal(examples.has_verified_compilation, false);
  assert.equal(examples.verification_scope, "historical-source-integrity-only");
  assert.ok(Number.isSafeInteger(examples.known_sources) && examples.known_sources > 0);
  assert.match(examples.inventory_commit, /^[0-9a-f]{40}$/u);
  assert.ok(examples.inventory_url.includes("/blob/" + examples.inventory_commit + "/"),
    "inventory URL must bind the stated immutable commit");
  assert.ok(text.includes(examples.inventory_url), "discovery index must link the pinned inventory");

  for (const label of ["Java/GraalVM implementation", "LLVM implementation", "AttoLang formatter"]) {
    const lines = text.split("\n").filter((line) => line.includes(label));
    assert.equal(lines.length, 1, label + " must occur once");
    assert.match(lines[0], /^- \[[^\]]+\]\(https:\/\/github\.com\/ores-truffle-oreslang\//u);
    assert.ok(lines[0].includes("**Private repository**"), label + " is not public evidence");
  }
}

test("public discovery index agrees with the immutable unverified feature manifest", () => {
  validateDiscovery(index, manifest);
});

test("manifest policy rejects capability promotion, duplicate evidence and registry drift", () => {
  const mutations = [
    (m) => { m.normative = true; },
    (m) => { m.status = "released"; },
    (m) => { m.release_tag = "v1.0"; },
    (m) => { m.evidence_policy = "Every feature is supported"; },
    (m) => { m.backend_keys.push(m.backend_keys[0]); },
    (m) => { m.backend_keys[0] = "__proto__"; },
    (m) => { m.features.push(structuredClone(m.features[0])); },
    (m) => { m.features[0].support[m.backend_keys[0]] = "supported"; },
    (m) => { delete m.features[0].support[m.backend_keys[0]]; },
    (m) => { m.features[0].support.unregistered = "not-verified"; },
    (m) => { m.features[0].design_status = "implemented"; },
    (m) => { m.examples.public_verified_sources = 1; },
    (m) => { m.examples.has_verified_compilation = true; },
    (m) => { m.examples.inventory_url = m.examples.inventory_url.replace(m.examples.inventory_commit, "f".repeat(40)); }
  ];
  for (const [indexOfMutation, mutate] of mutations.entries()) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => validateDiscovery(index, changed), undefined,
      "manifest mutation " + indexOfMutation + " bypassed fail-closed discovery gate");
  }

  for (const replacement of [
    ["**Private repository**", "**Public repository**"],
    ["All backend support explicitly not-verified", "All backend support verified"],
    ["zero compiler-verified", "all compiler-verified"],
    ["Select a compiler release/commit", "Trust design examples"]
  ]) {
    assert.ok(index.includes(replacement[0]));
    assert.throws(() => validateDiscovery(index.replace(replacement[0], replacement[1]), manifest),
      undefined, "index mutation " + replacement[0] + " bypassed policy");
  }
});
