import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matrixRows } from "../src/data/erlang-rust-matrix.mjs";
import {
  evidenceSource, matrixRowEvidence, backendNames,
  rowDraftFeatureIds, promotionRequirements
} from "../src/data/erlang-rust-evidence.mjs";

const page = readFileSync(new URL("../src/pages/erlang-rust-oreslang.astro", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/erlang-rust-matrix.css", import.meta.url), "utf8");
const snapshot = JSON.parse(readFileSync(new URL("../public/language/draft-2026-10-14/features.json", import.meta.url), "utf8"));

test("every comparison row has four fail-closed statuses sourced from the public feature draft", () => {
  assert.equal(evidenceSource.referenceId, snapshot.reference_id);
  assert.equal(evidenceSource.date, snapshot.updated);
  assert.equal(evidenceSource.normative, false);
  assert.equal(Object.keys(matrixRowEvidence).length, matrixRows.length);
  assert.deepEqual(Object.keys(backendNames), snapshot.backend_keys);
  for (const row of matrixRows) {
    const evidence = matrixRowEvidence[row.id];
    assert.ok(evidence, row.id);
    assert.equal(evidence.backends.length, 4);
    assert.deepEqual(evidence.backends.map(x => x.key), snapshot.backend_keys);
    assert.deepEqual(evidence.features.map(x => x.id), rowDraftFeatureIds[row.id]);
    for (const backend of evidence.backends) {
      assert.equal(backend.status, evidence.features.length ? "not-verified" : "not-assessed");
      assert.ok(!/verified|tested|supported/iu.test(backend.labelText) || backend.labelText === "Not verified");
    }
  }
});

test("missing public snapshot entries are unassessed rather than called unsupported", () => {
  for (const id of ["hot-reload","gpus","ffi-abi","high-load-performance","carrier-grade-linux"]) {
    const entry = matrixRowEvidence[id];
    assert.equal(entry.coverage, "not-assessed");
    assert.ok(entry.backends.every(x => x.labelText === "Not assessed in public snapshot"));
  }
  for (const id of ["type-system","actor-system","borrow-checking","concurrency-model"]) {
    assert.equal(matrixRowEvidence[id].coverage, "included");
    assert.ok(matrixRowEvidence[id].backends.every(x => x.labelText === "Not verified"));
  }
  for (const id of ["compressed-addressing", "nonblocking-io", "embedded-systems", "fpga-asic", "mobile-phones", "desktop-apps"]) {
    assert.equal(matrixRowEvidence[id].coverage, "not-assessed", id + " should not claim public verification");
    assert.ok(matrixRowEvidence[id].backends.every((x) => x.labelText === "Not assessed in public snapshot"));
  }
  // No independent CPU-triple, single-file native packaging or ECS lowering proof is
  // present in the public draft, regardless of the platform-targets umbrella entry.
  for (const id of ["data-oriented-design", "native-single-binaries", "target-architectures"]) {
    assert.equal(matrixRowEvidence[id].coverage, "not-assessed");
    assert.deepEqual(rowDraftFeatureIds[id], []);
    assert.ok(matrixRowEvidence[id].backends.every((x) => x.status === "not-assessed"));
  }
  assert.equal(matrixRowEvidence["memory-safety"].coverage, "included");
  assert.ok(matrixRowEvidence["memory-safety"].backends.every((x) => x.labelText === "Not verified"));
  assert.ok(promotionRequirements.length >= 4);
});

test("examples clarify Erlang OTP, Rust Tokio and AttoLang illustrative contract", () => {
  for (const x of ["actor-walkthrough", "erlangExample", "rustExample", "oresExample",
    "gen_server", "tokio::sync", "rt copy", "NOT ATTOLANG SOURCE SYNTAX",
    "not valid or compiler-verified AttoLang syntax", "critical-write",
    "Per-backend evidence", "Not assessed", "What would qualify as partial"]) {
    assert.ok(page.includes(x), x);
  }
  assert.ok(!page.includes("Each actor handles messages one at a time on its execution lane"));
  for (const x of [".synthesis-verification", ".synthesis-example-grid", ".synthesis-proof-policy"]) {
    assert.ok(css.includes(x), x);
  }
});
