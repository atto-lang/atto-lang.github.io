/**
 * Public, conservative support inventory. No source repo contents are copied here.
 * A target is a *candidate for evaluation*, never a claim of supported compilation.
 *
 * The primary draft deliberately has no OS/CPU-specific conformance verdict.
 * Do not turn 'not assessed' into 'unsupported', or 'design described' into 'tested'.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "public/language");
const draft = JSON.parse(readFileSync(resolve(root, "draft-2026-10-14/features.json"), "utf8"));
const ledger = JSON.parse(readFileSync(resolve(root, "backend-target-evidence.json"), "utf8"));

export const supportSource = Object.freeze({
  draftUrl: "/language/draft-2026-10-14/features.json",
  ledgerUrl: "/language/backend-target-evidence.json",
  reference: draft.reference_id,
  updated: draft.updated
});

export const backendTracks = Object.freeze([
  { id: "java-graalvm", name: "Java / GraalVM", description: "Guest interpreter / JIT and separate Native Image packaging concerns." },
  { id: "llvm", name: "LLVM", description: "Native-code AOT direction; each target triple requires its own executed evidence." },
  { id: "dotnet", name: ".NET", description: "Managed and potential native paths, subject to runtime and platform-specific verification." },
  { id: "wasm", name: "WebAssembly", description: "Host capabilities differ across browser and WASI deployment." }
]);

// Evaluation targets, not a statement that compiler or runtime support exists.
export const targetProfiles = Object.freeze([
  { id: "graal-linux-x64", backend: "java-graalvm", label: "Linux x86-64", architecture: "x86-64", os: "Linux", delivery: "Hosted VM / Native Image candidate" },
  { id: "graal-linux-arm64", backend: "java-graalvm", label: "Linux AArch64", architecture: "AArch64", os: "Linux", delivery: "Hosted VM / Native Image candidate" },
  { id: "llvm-linux-x64", backend: "llvm", label: "Linux x86-64", architecture: "x86-64", os: "Linux", delivery: "Native executable candidate" },
  { id: "llvm-linux-arm64", backend: "llvm", label: "Linux AArch64", architecture: "AArch64", os: "Linux", delivery: "Native executable candidate" },
  { id: "llvm-linux-riscv64", backend: "llvm", label: "Linux RISC-V 64", architecture: "riscv64", os: "Linux", delivery: "Research target / requires toolchain proof" },
  { id: "llvm-macos-arm64", backend: "llvm", label: "macOS Apple Silicon", architecture: "AArch64", os: "macOS", delivery: "Native executable candidate" },
  { id: "llvm-windows-x64", backend: "llvm", label: "Windows x86-64", architecture: "x86-64", os: "Windows", delivery: "Native executable candidate" },
  { id: "dotnet-windows-x64", backend: "dotnet", label: "Windows x86-64", architecture: "x86-64", os: "Windows", delivery: "Managed / Native AOT candidate" },
  { id: "wasm-browser-32", backend: "wasm", label: "Browser wasm32", architecture: "wasm32", os: "Browser", delivery: "Browser host APIs / bounded capabilities" },
  { id: "wasm-wasi-32", backend: "wasm", label: "WASI wasm32", architecture: "wasm32", os: "WASI", delivery: "WASI host interfaces / bounded capabilities" }
]);

export const targetGates = Object.freeze([
  { id: "build", label: "Compile / link", details: "A source-identified program compiles and links on the exact target." },
  { id: "execute", label: "Execute", details: "A compiled guest program runs and returns checked results." },
  { id: "abi", label: "Memory / ABI", details: "Pointer width, FFI, layout, ownership and failure boundaries are checked." },
  { id: "actors", label: "Actor semantics", details: "Typed mail, ownership, supervision, cancellation and isolation execute." },
  { id: "package", label: "Package", details: "Runtime dependencies, install, startup and single-file claims are measured." }
]);

// Only these two source repositories currently have a reviewed public compiler
// identity. A new backend must receive an explicit provenance-policy review,
// not a regex wildcard admitting any GitHub repository.
export const compilerSourceByBackend = Object.freeze({
  "java-graalvm": "ores-truffle-oreslang/oreslang-source.java",
  llvm: "ores-truffle-oreslang/oreslang-source.llvm",
  dotnet: null,
  wasm: null
});

export const proofStages = Object.freeze([
  { id: "design", name: "Designed", requirement: "Published specification and constraints. A design is not backend implementation." },
  { id: "implemented", name: "Implemented", requirement: "Exact compiler/runtime revision, source identity and reviewed implementation scope." },
  { id: "tested", name: "Tested", requirement: "Executed, passing exact-source build and behavioral logs for the target and feature." },
  { id: "production-verified", name: "Production verified", requirement: "Independent review plus deployment, recoverability and limitations evidence." }
]);

function fail(msg) { throw new Error("Target proof ledger: " + msg); }
const ids = new Set(backendTracks.map(b => b.id));
const profiles = new Set(targetProfiles.map(t => t.id));
const gates = new Set(targetGates.map(g => g.id));
if (draft.normative !== false || draft.status !== "documentation-draft" || draft.release_tag !== null) {
  fail("public reference changed; independent publication policy review required");
}
if (ids.size !== 4 || ids.size !== draft.backend_keys.length ||
    draft.backend_keys.some(id => !ids.has(id))) fail("public draft backend mismatch");
if (profiles.size !== targetProfiles.length || targetProfiles.some(t => !ids.has(t.backend))) {
  fail("ambiguous or orphaned target profile");
}
if (gates.size !== targetGates.length) fail("duplicate verification gate");

export const draftBackendStatus = Object.freeze(backendTracks.map(backend => {
  const feature = draft.features.find(f => f.id === "platform-targets");
  if (!feature || feature.support[backend.id] !== "not-verified") {
    fail("draft backend status changed; explicit proof review required");
  }
  return { ...backend, draftStatus: "Not verified" };
}));

/**
 * Safe publication boundary. A future promoted record may be accepted ONLY with
 * immutable source identity, a bounded scope, independent review and (for tests)
 * executed evidence; this validator checks structure, NOT remote log authenticity.
 * Exact run contents must still be independently reviewed before merging the PR.
 */
export function validateProofLedger(candidate) {
  if (!candidate || candidate.schema_version !== 1 || candidate.public_draft !== draft.reference_id ||
      !Array.isArray(candidate.records)) fail("invalid schema or public draft link");
  const seen = new Set();
  for (const entry of candidate.records) {
    if (!entry || !profiles.has(entry.target_id) || !gates.has(entry.gate_id)) fail("unknown target/gate");
    const key = entry.target_id + "/" + entry.gate_id;
    if (seen.has(key)) fail("duplicate target/gate");
    seen.add(key);
    if (!["implemented", "tested", "production-verified"].includes(entry.stage)) fail("unrecognized promotion stage");
    // A source-only claim may not smuggle a nominally passing CI URL into the
    // generated UI. Each stage has an explicit, bounded record schema.
    const commonKeys = ["target_id", "gate_id", "stage", "compiler_commit",
      "compiler_tree_sha", "source_sha256", "scope", "review_pr_url",
      "compiler_commit_url"];
    const runKeys = ["executed_run_url", "executed_result", "executed_head_sha",
      "executed_tree_sha", "executed_test_count"];
    const productionKeys = ["operational_review_url", "operational_scope"];
    const allowed = new Set([
      ...commonKeys,
      ...(entry.stage === "implemented" ? [] : runKeys),
      ...(entry.stage === "production-verified" ? productionKeys : [])
    ]);
    if (Object.keys(entry).some(prop => !allowed.has(prop))) {
      fail("unexpected evidence fields for promotion stage");
    }
    if (!/^[a-f0-9]{40}$/u.test(entry.compiler_commit ?? "") ||
        !/^[a-f0-9]{40}$/u.test(entry.compiler_tree_sha ?? "") ||
        !/^[a-f0-9]{64}$/u.test(entry.source_sha256 ?? "")) fail("missing immutable source/tree/input identity");
    if (!/^[A-Za-z0-9 ._:/-]{25,500}$/u.test(entry.scope ?? "")) fail("missing bounded behavioral scope");
    if (!/^https:\/\/github\.com\/ores-truffle-oreslang\/ores-truffle-oreslang\.github\.io\/pull\/[1-9][0-9]*$/u.test(entry.review_pr_url ?? "")) {
      fail("independent website publication review required");
    }
    const backend = targetProfiles.find(profile => profile.id === entry.target_id).backend;
    const sourceRepo = compilerSourceByBackend[backend];
    if (!sourceRepo) fail("backend has no approved compiler-source identity");
    const expectedCommitUrl = "https://github.com/" + sourceRepo + "/commit/" + entry.compiler_commit;
    if (entry.compiler_commit_url !== expectedCommitUrl) fail("compiler commit link mismatch");
    if (entry.stage !== "implemented") {
      const runPrefix = "https://github.com/" + sourceRepo + "/actions/runs/";
      if (typeof entry.executed_run_url !== "string" ||
          !entry.executed_run_url.startsWith(runPrefix) ||
          !/^[1-9][0-9]*$/u.test(entry.executed_run_url.slice(runPrefix.length)) ||
          entry.executed_result !== "passed" ||
          entry.executed_head_sha !== entry.compiler_commit ||
          entry.executed_tree_sha !== entry.compiler_tree_sha ||
          !Number.isSafeInteger(entry.executed_test_count) ||
          entry.executed_test_count < 1) {
        fail("passing exact-head compiler run with executed test count required");
      }
    }
    if (entry.stage === "production-verified" &&
        (!/^https:\/\/github\.com\/(?:ores-truffle-oreslang|orestra)\/[A-Za-z0-9._-]+\/(?:issues|pull)\/[1-9][0-9]*$/u.test(entry.operational_review_url ?? "") ||
        !/^.{30,500}$/u.test(entry.operational_scope ?? ""))) fail("production operational review required");
  }
  return candidate.records;
}

const validatedRecords = validateProofLedger(ledger);
const approved = new Map(validatedRecords.map(entry => [entry.target_id + "/" + entry.gate_id, entry]));

export const targetSupportRows = Object.freeze(targetProfiles.map(profile => ({
  ...profile,
  backendLabel: backendTracks.find(b => b.id === profile.backend).name,
  gates: targetGates.map(gate => {
    const record = approved.get(profile.id + "/" + gate.id);
    return {
      id: gate.id,
      status: record?.stage ?? "not-assessed",
      label: record ? proofStages.find(stage => stage.id === record.stage).name : "Not assessed",
      proofUrl: record?.executed_run_url ?? record?.compiler_commit_url ?? null,
      proofLabel: record ? (record.stage === "implemented" ? "Compiler source" : "Executed tests") : null,
      reviewUrl: record?.review_pr_url ?? null
    };
  })
})));

// Do not report an implemented-only source claim as verified execution.
export const proofCount = validatedRecords.length;
export const executedProofCount = validatedRecords.filter(entry =>
  entry.stage === "tested" || entry.stage === "production-verified").length;
