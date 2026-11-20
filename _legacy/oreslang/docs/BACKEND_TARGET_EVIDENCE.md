# AttoLang backend/architecture evidence protocol

This public site lists **candidate evaluation profiles**, not supported release triples. The source of truth is the non-normative [draft feature inventory](../public/language/draft-2026-10-14/features.json). Its four backend tracks are `java-graalvm`, `llvm`, `dotnet`, `wasm`; their public support status remains `not-verified`.

## Interpretation

- **Not assessed**: No independently reviewed public record for the exact backend, OS, CPU/host and behavior. It does **not** mean impossible, unsupported or failing.
- **Designed**: A public design specification exists; it says nothing about runtime implementation.
- **Implemented**: A reviewed, immutable compiler/runtime source commit and narrowly bounded implementation scope exist. Still **not** executed conformance.
- **Tested**: Above, plus source-identified executed, passing guest-behavior or native-target tests on an exact target. A workflow failing at runner admission or recording zero executed test steps **does not qualify**.
- **Production verified**: Above, plus independently reviewed rollout, recovery/rollback, resource limits, and operational evidence with explicit scope.

A passing marketing build, GitHub file SHA alone, green infrastructure-only checks, vendor compiler marketing page, or an unrelated language's native build cannot promote AttoLang conformance. A backend-level status never certifies an individual CPU/OS target.

## Gates per candidate target

1. **Compile/link**: source and build inputs, exact compiler tree and effective target triple, artifact identity.
2. **Execute**: checked guest behavior, expected output and negative cases, executed steps and logs.
3. **Memory/ABI**: pointer size, layout, bounds/offset overflow, native boundary lifetime, FFI, cleanup.
4. **Actor semantics**: message schema, request/message concurrency, state loan exclusivity, supervision, cancellation, isolation.
5. **Package**: dependencies, loader ABI, static/dynamic linkage, signed distribution, reproducible startup and rollback.

Each gate is independent: a native host smoke test is not guest-language execution; a Linux x86-64 run does not imply Windows, RISC-V, WebAssembly or .NET parity. Browser wasm32 and WASI wasm32 are different hosts.

## Publication workflow

1. Agree on a public capability/target profile and an executable conformance case. Do not put private source, secret outputs, cross-org mirrors, user tokens or unreviewed compiler detail into the public repository.
2. Build the **exact Git tree** using the authorized CI environment. If runner admission fails, classify it as unexecuted. Any use of a different funded CI organization requires separately authorized private destination and proof that the mirrored tree matches the source; do not infer that from a passing workflow.
3. Record immutable `compiler_commit`, matching `compiler_commit_url`, `compiler_tree_sha` (exact Git tree), `source_sha256` (guest input), `scope`, `target_id`, `gate_id`, promotion `stage`, and an independently reviewed public website PR (`review_pr_url`). The website only accepts GraalVM evidence tied to `ores-truffle-oreslang/oreslang-source.java` and LLVM evidence tied to `ores-truffle-oreslang/oreslang-source.llvm` until a separate review explicitly authorizes more repositories. Unapproved .NET/WASM source provenance stays unassessed.
4. For `tested` or higher, require `executed_run_url` on the approved compiler repository, `executed_result: "passed"`, `executed_head_sha` equal to `compiler_commit`, `executed_tree_sha` equal to `compiler_tree_sha`, and an integer `executed_test_count` of at least one. These values are claims to audit, **not self-authenticating evidence**. The public validator intentionally rejects arbitrary cross-organization carrier URLs. If funding requires a private cross-org mirror, first verify authorized private destination and identical source/mirror Git trees independently. Never publish private source through this public site. Report guest scope, negative cases, environment and limitations.
5. For production, include `operational_review_url` and `operational_scope` after independent deployment and recovery audit.
6. Independently audit evidence before merging. The static `validateProofLedger` validator catches malformed, conflicting, out-of-scope and cross-backend records but **cannot verify actual GitHub logs, exact-tree inputs, the true executed test count, or review approval**. Human review of upstream commit, tree, CI steps and result is mandatory. Published record totals are distinct from tested/production execution evidence.
7. Run website unit tests, Astro check/build, links, Chromium/Firefox/WebKit accessibility and visual checks, and verify the deployed page and evidence JSON after GitHub Pages deployment.

Current [machine-readable ledger](../public/language/backend-target-evidence.json) deliberately contains **zero** verified entries. The comparison page renders **0 of 50** individual target/gate records; this is the honest publicly assessed coverage, not a claim that AttoLang has no implementation. The website does not presently perform automated cross-repository conformance collection or attestations.
