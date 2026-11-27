# Contract conformance playground: implementation and admission matrix

**Status:** source documentation / proposal-specific preview, not multi-backend certification (2026-11-20).

The five `/play/` contract galleries are explicitly **syntax-only**. They teach target
conformance obligations and include comment-only `INVALID:` counterexamples.
The published SHA-pinned Rust/Wasm browser compiler currently rejects those five
galleries with positioned diagnostics; this means **unsupported syntax**,
not proof that the semantics of every counterexample have been checked.

## Conformance domains and proof obligations

| Domain | Valid target shape | Required rejection | Current playground status |
| --- | --- | --- | --- |
| Class/struct | `define class/struct ... implements Interface, Trait` | missing or private method; signature/effect/ownership mismatch; ambiguous trait default; wrong nominal owner | Target-only gallery; separate executable `traits-interfaces.atto` verifies a bounded class subset |
| Actor | `define actor ... implements Interface, Trait` | missing members, non-Sendable messages, ActorRef escape, forged supervisor CONTROL, cross-turn state access | Target-only gallery; real actor-method conformance requires independent guest evidence |
| Module | `define contract C`; `define module M conforms C` | wrong contract kind, missing/private export, incompatible field binding, wrong signature | Target-only gallery; separate executable `modules.atto` demonstrates only simple named-module dispatch |
| Static class | `define static contract C`; `define class D implements static C` | instance/static confusion, inaccessible static member, invalid inherited requirement, actor static storage | Target-only gallery; no static-field runtime claim |
| Namespace | `declare/define namespace` with type-only members | runtime declarations, nested namespace, conflicting namespace/module name, implicit import/reexport | Target-only gallery, distinct from file `use namespace` |

Conformance requires **positive compiler acceptance and guest execution** and
**negative compiler rejection before code generation**, each on exact source and
compiler SHA with nonzero test steps. A parser failure on a target feature cannot
be counted as a typechecker conformance pass. Tests must cover nominal imports,
visibility, inheritance, effect signatures, ownership, module ABI invalidation,
and actor isolation wherever they apply.

## Evidence boundaries and related work

- **Pinned website compiler:** the `play/public/atto_compiler.receipt.json`
  artifact and `pinned-preview-admission.test.mjs` own publication identity.
  Two existing samples, `traits-interfaces.atto` and `modules.atto`,
  compile and run with exact stdout/return oracles. New browser regression
  tests additionally exercise missing/private/type-mismatched interface
  methods and invalid module member access on this bounded subset.
- **Rust compiler main:** [atto-source.rs #369](https://github.com/atto-lang/atto-source.rs/pull/369)
  and [#374](https://github.com/atto-lang/atto-source.rs/pull/374)
  are merged; their historical scoped receipts cover bounded class abstract
  trait validation and stateless actor-local method guest execution.
  These are **not** proof of general actor/struct instance ABI, state, cross-file
  links, generic/effect conformance, or updated shipped browser compiler.
- **Normative work:** draft [atto-spec #105](https://github.com/atto-lang/atto-spec/pull/105)
  (class/actor/struct implements), draft
  [atto-platform-conformance #89](https://github.com/atto-lang/atto-platform-conformance/pull/89)
  (29 portable cases still marked NOT_EXECUTED), and
  [#509](https://github.com/atto-lang/atto-platform-conformance/pull/509)
  (actor/namespace receiver contract) remain separate proof gates.
- **Java:** [#908](https://github.com/atto-lang/atto-source.java/pull/908)
  (module/static category separation), [#1061](https://github.com/atto-lang/atto-source.java/pull/1061)
  (signature-only static contracts), and [#507](https://github.com/atto-lang/atto-source.java/pull/507)
  (type-only namespaces) are unmerged; do not treat PR descriptions as
  successfully integrated `main` behavior.
- **LLVM:** existing Java #908 references limited explicit rejection in an
  LLVM companion, **not** native runtime contract lowering. Verify on a fresh
  LLVM current-head fixture before promoting.
- **Forge, .NET, atto-source.wasm, Cranelift, JS and other maintained backends:**
  no equivalent **exact-head compiled contract acceptance/rejection receipt**
  was established in this audit. Treat them as **UNVERIFIED**, not as passed
  or necessarily unsupported.

The `/play/` integration only updates source examples, dropdown/category
metadata, admission profile and publishing allowlist. There is no compiler
re-pinning, actor runtime change, privileged import or release authorization.

## Next acceptance gates

1. Run the **exact current PR head** full Node suite, Chromium browser E2E,
   Wasm guest execution and proposed merge-commit integration.
2. Verify the browser's five new target previews always yield positioned
   diagnostics **without a Wasm artifact**, then recover to a verified valid program.
3. Expand the shared conformance corpus with real positive and negative
   compiler execution per backend (including inherited/ambiguous methods,
   out-of-line receivers, imports and visibility).
4. Reconcile overlapping implementation PRs with the normative spec before
   independent review, merge and public release.
