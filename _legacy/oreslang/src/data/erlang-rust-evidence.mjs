/**
 * Fail-closed reading of the public, non-normative feature snapshot.
 * No compiler implementation or conformance status is inferred from design prose.
 * A row without directly applicable draft entries is NOT "unsupported": it is unassessed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { matrixRows } from "./erlang-rust-matrix.mjs";

// Astro relocates bundled modules under dist; resolve the tracked public source from the build root.
const sourcePath = resolve(process.cwd(), "public/language/draft-2026-10-14/features.json");
const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));

export const evidenceSource = Object.freeze({
  referenceId: snapshot.reference_id,
  date: snapshot.updated,
  normative: snapshot.normative,
  href: "/language/draft-2026-10-14/features.json",
});

export const backendNames = Object.freeze({
  "java-graalvm": "Java / GraalVM",
  llvm: "LLVM",
  dotnet: ".NET",
  wasm: "WASM",
});

/**
 * Map comparison claims to ONLY the entries actually covered by the public draft.
 * Empty means NOT ASSESSED, not "unsupported" or "does not exist".
 */
export const rowDraftFeatureIds = Object.freeze({
  "type-system": [
    "generics-and-type-aliases",
    "structural-typing"
  ],
  "hot-reload": [],
  "build-system": [
    "modules-and-visibility"
  ],
  "borrow-checking": [
    "ownership-borrows"
  ],
  "memory-safety": [
    "ownership-borrows",
    "actor-isolation"
  ],
  "garbage-collection": [],
  "compressed-addressing": [],
  "soft-real-time": [],
  "hard-real-time": [],
  "aot-jit": [
    "platform-targets"
  ],
  "native-single-binaries": [],
  "target-architectures": [],
  "lambdas": [],
  "mobile-phones": [],
  "desktop-apps": [],
  "actor-system": [
    "actor-isolation",
    "actor-supervision"
  ],
  "functional-programming": [],
  "adts": [
    "matching-and-patterns",
    "records-tuples-entries"
  ],
  "data-oriented": [],
  "data-oriented-design": [],
  "gpus": [],
  "distributed": [],
  "carrier-grade-linux": [],
  "embedded-systems": [],
  "fpga-asic": [],
  "websockets": [],
  "rtc-signaling": [],
  "top-five": [],
  "stack-traces": [],
  "high-load-performance": [],
  "concurrency-model": [
    "actor-isolation",
    "async-channels-select"
  ],
  "nonblocking-io": [],
  "ffi-abi": [],
  "packages-modules": [
    "modules-and-visibility"
  ]
});

function fail(message) { throw new Error("Comparison evidence: " + message); }
if (snapshot.normative !== false || snapshot.status !== "documentation-draft" || snapshot.release_tag !== null) {
  fail("source is no longer an unverified documentation draft; re-review promotion policy");
}
const publicEntries = new Map(snapshot.features.map(entry => [entry.id, entry]));
if (publicEntries.size !== snapshot.features.length) fail("duplicate public feature");
const backendKeys = snapshot.backend_keys;
if (backendKeys.length !== 4 || backendKeys.some(key => !backendNames[key])) fail("unknown backend");
if (Object.keys(rowDraftFeatureIds).length !== matrixRows.length) fail("row mapping count does not match comparison");
const known = new Set(matrixRows.map(row => row.id));
for (const [id, featureIds] of Object.entries(rowDraftFeatureIds)) {
  if (!known.has(id)) fail("orphan mapping: " + id);
  if (new Set(featureIds).size !== featureIds.length) fail("repeated mapping: " + id);
  for (const featureId of featureIds) if (!publicEntries.has(featureId)) fail("missing public feature: " + featureId);
}
export const matrixRowEvidence = Object.fromEntries(matrixRows.map(row => {
  const featureIds = rowDraftFeatureIds[row.id];
  const entries = featureIds.map(id => publicEntries.get(id));
  const backends = backendKeys.map(key => {
    // Any future promotion requires manual publication of exact compiler build and conformance
    // evidence. Fail closed: never treat an unfamiliar source value as a verified feature.
    const statuses = entries.map(entry => entry.support[key]);
    if (statuses.some(status => status !== "not-verified")) {
      fail("support status requires evidence policy review for " + row.id + " / " + key);
    }
    return {
      key, label: backendNames[key],
      status: entries.length ? "not-verified" : "not-assessed",
      labelText: entries.length ? "Not verified" : "Not assessed in public snapshot",
    };
  });
  return [row.id, {
    id: row.id, coverage: entries.length ? "included" : "not-assessed",
    features: entries.map(entry => ({id:entry.id, name:entry.name})),
    backends
  }];
}));

/**
 * Publication promotion gates:
 * design -> partial -> tested -> production-verified requires independent, traceable
 * evidence for each backend (compiler commit, source hash, real executed test/run URL,
 * behavioral scope, limitations; production additionally needs operational evidence).
 * This module deliberately publishes none of those levels until the evidence exists.
 */
export const promotionRequirements = Object.freeze([
  "Exact backend and compiler/runtime revision",
  "Source input identity and conformance case",
  "Executed build and test logs with results, not just a passing website build",
  "Behavioral scope, known limitations and rollback or failure observations",
  "For production: independently reviewed deployment/recovery evidence",
]);
