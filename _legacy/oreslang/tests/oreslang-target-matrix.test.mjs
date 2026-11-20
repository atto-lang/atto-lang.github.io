import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  draftBackendStatus, targetProfiles, targetGates, targetSupportRows,
  supportSource, proofStages, proofCount, executedProofCount, compilerSourceByBackend, validateProofLedger
} from "../src/data/oreslang-target-matrix.mjs";

const draft = JSON.parse(readFileSync(new URL("../public/language/draft-2026-10-14/features.json", import.meta.url), "utf8"));
const ledger = JSON.parse(readFileSync(new URL("../public/language/backend-target-evidence.json", import.meta.url), "utf8"));
const page = readFileSync(new URL("../src/pages/erlang-rust-oreslang.astro", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/erlang-rust-matrix.css", import.meta.url), "utf8");

test("four backend tracks are derived from the actual published draft without promoting claims", () => {
  assert.deepEqual(draftBackendStatus.map(b => b.id), draft.backend_keys);
  assert.deepEqual(draftBackendStatus.map(b => b.draftStatus), Array(4).fill("Not verified"));
  assert.equal(supportSource.reference, draft.reference_id);
  assert.equal(supportSource.updated, draft.updated);
  assert.equal(supportSource.draftUrl, "/language/draft-2026-10-14/features.json");
  assert.equal(supportSource.ledgerUrl, "/language/backend-target-evidence.json");
  assert.equal(draft.normative, false);
});

test("target inventory cannot masquerade as validated CPU architectures or shipped targets", () => {
  assert.equal(targetProfiles.length, 10);
  assert.equal(targetSupportRows.length, 10);
  assert.equal(targetGates.length, 5);
  assert.equal(new Set(targetProfiles.map(x => x.id)).size, 10);
  assert.equal(new Set(targetGates.map(x => x.id)).size, 5);
  assert.deepEqual(targetGates.map(x => x.id), ["build", "execute", "abi", "actors", "package"]);
  for (const row of targetSupportRows) {
    assert.ok(draft.backend_keys.includes(row.backend));
    assert.ok(row.architecture && row.os && row.delivery);
    assert.equal(row.gates.length, 5);
    for (const gate of row.gates) {
      assert.equal(gate.status, "not-assessed");
      assert.equal(gate.label, "Not assessed");
      assert.equal(gate.proofUrl, null);
      assert.equal(gate.reviewUrl, null);
    }
  }
  assert.equal(proofCount, 0);
  assert.equal(executedProofCount, 0);
  assert.deepEqual(validateProofLedger(ledger), []);
});

test("proof promotion requires exact source identity, independent review and executed evidence", () => {
  const valid = {
    target_id: "llvm-linux-x64", gate_id: "execute", stage: "implemented",
    compiler_commit: "a".repeat(40), compiler_tree_sha: "c".repeat(40), source_sha256: "b".repeat(64),
    compiler_commit_url: "https://github.com/ores-truffle-oreslang/oreslang-source.llvm/commit/" + "a".repeat(40),
    review_pr_url: "https://github.com/ores-truffle-oreslang/ores-truffle-oreslang.github.io/pull/61",
    scope: "Host-only smoke: this does not imply guest-language parity"
  };
  const entries = (records) => ({ ...ledger, records });
  assert.deepEqual(validateProofLedger(entries([valid])), [valid]);
  assert.throws(() => validateProofLedger(entries([{ ...valid, executed_run_url: "https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/123" }])), /unexpected evidence fields for promotion stage/u);
  assert.throws(() => validateProofLedger(entries([{ ...valid, source: "<script>" }])), /unexpected evidence fields for promotion stage/u);
  assert.throws(() => validateProofLedger(entries([{ ...valid, stage: "tested" }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...valid, stage: "production-verified" }])), /passing exact-head compiler run/u);
  const tested = {
    ...valid, stage: "tested",
    executed_run_url: "https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/123456",
    executed_result: "passed",
    executed_head_sha: "a".repeat(40), executed_tree_sha: "c".repeat(40),
    executed_test_count: 12
  };
  assert.deepEqual(validateProofLedger(entries([tested])), [tested]);
  assert.throws(() => validateProofLedger(entries([{ ...tested, stage: "production-verified" }])), /production operational review/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_result: "queued" }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_test_count: 0 }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_test_count: 1.25 }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_head_sha: "d".repeat(40) }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_tree_sha: "e".repeat(40) }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, compiler_tree_sha: "e".repeat(40) }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_run_url: "https://github.com/ores-stack/test-carrier/actions/runs/123456" }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, compiler_commit_url: "https://github.com/orestra/fake/commit/" + "a".repeat(40) }])), /compiler commit link mismatch/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, target_id: "graal-linux-x64" }])), /compiler commit link mismatch/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, target_id: "dotnet-windows-x64" }])), /backend has no approved compiler-source identity/u);
  assert.equal(compilerSourceByBackend.llvm, "ores-truffle-oreslang/oreslang-source.llvm");
  assert.equal(compilerSourceByBackend["java-graalvm"], "ores-truffle-oreslang/oreslang-source.java");
  assert.equal(compilerSourceByBackend.dotnet, null);
  assert.equal(compilerSourceByBackend.wasm, null);
  assert.throws(() => validateProofLedger(entries([{ ...tested, executed_run_url: "https://example.com/pass" }])), /passing exact-head compiler run/u);
  assert.throws(() => validateProofLedger(entries([tested, tested])), /duplicate target\/gate/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, target_id: "fake-linux-x64" }])), /unknown target\/gate/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, compiler_commit: "c".repeat(40) }])), /compiler commit link mismatch/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, compiler_commit_url: "javascript:alert(1)" }])), /compiler commit link mismatch/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, review_pr_url: "https://github.com/example/fake/pull/1" }])), /independent website publication review/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, source_sha256: "nope" }])), /immutable source\/tree\/input identity/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, compiler_tree_sha: "nope" }])), /immutable source\/tree\/input identity/u);
  assert.throws(() => validateProofLedger(entries([{ ...tested, stage: "verified" }])), /unrecognized promotion stage/u);
  assert.throws(() => validateProofLedger({ ...ledger, public_draft: "untrusted", records: [] }), /invalid schema/u);
});

test("reader sees evidence levels, sources and a keyboard-scrollable 50-cell matrix", () => {
  assert.deepEqual(proofStages.map(x => x.id), ["design", "implemented", "tested", "production-verified"]);
  for (const fragment of [
    'id="backend-targets"', 'id="synthesis-target-title"',
    "targetSupportRows.map", "targetGates.map",
    'class="synthesis-target-scroller" role="region"',
    'aria-label="AttoLang target architecture and verification status matrix"',
    "{proofCount} of {targetSupportRows.length * targetGates.length}", "executedProofCount", "gate.proofLabel",
    'class="synthesis-target-stages"', "proofStages.map",
    "candidate evaluation profiles, not a supported-platform list",
    "All results are readable without JavaScript",
    "No per-target conformance is inferred"
  ]) assert.ok(page.includes(fragment), "missing UI fragment: " + fragment);
  for (const fragment of [
    ".synthesis-target-scroller:focus-visible", "overflow-x: auto",
    ".synthesis-target-table tbody th", "@media (max-width: 650px)",
    "@media print"
  ]) assert.ok(css.includes(fragment), "missing accessible CSS: " + fragment);
});
