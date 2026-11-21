# Canonical checked arithmetic, division, operators and trap in /play

**Status: draft proposal only.** This is the website's release-admission map, not evidence that the pinned public browser compiler, every Atto backend, or NativeAOT can execute the current language rules.

## Required normative contract

- Canonical `.atto` portable `int` arithmetic is signed 64-bit, checked on every intermediate `+`, `-`, `*`, unary `-` (see [spec #144](https://github.com/atto-lang/atto-spec/pull/144) and [owner decisions #151](https://github.com/atto-lang/atto-spec/pull/151)).
- `int / int` yields `float`; do **not** silently truncate to an integer. The exact float/IEEE rounding and division-by-zero policy still needs a versioned shared fixture.
- Statement-leading `^ expression;` is return; integer `a ^^ b` is bitwise XOR; Boolean XOR uses `Xor(bool,bool)`. There is no infix single `^` (see [spec #143](https://github.com/atto-lang/atto-spec/pull/143)).
- Triple-angle `<<<` and `>>>`, plus `ashr`, are i64 shifts with **checked** count 0..63. Double-angle `<<`/`>>` are typed I/O, not shifts.
- Canonical `trap expression` yields `Result<T,Error>`, preserves existing `Result` layers, catches only an ordinary `throw`, and must not catch `panic`, `raise`, cancellation or host implementation faults. The published playable `trap.atto` is a **legacy pinned Option-based ABI demonstration** only. The separate `trap-result.atto` remains the canonical syntax-only preview until the browser compiler is actually rebuilt and reviewed.

## Source owners and nonduplicative implementation work

| Path | Current review candidate | What is NOT yet proven |
| --- | --- | --- |
| `atto-source.rs` (also compiler used by public /play) | [#411](https://github.com/atto-lang/atto-source.rs/pull/411) canonical `^/^^` and [#439](https://github.com/atto-lang/atto-source.rs/pull/439) checked i64 | Browser/native exact-head build, wasm32 compiler execution, checked shifts; obsolete [#334](https://github.com/atto-lang/atto-source.rs/pull/334) operator/masking behavior must not return |
| `atto-source.java` | [#66](https://github.com/atto-lang/atto-source.java/pull/66) checked arithmetic and floating-division guest tests | Current Graal guest and import-graph proof |
| `atto-source.net` | [#191](https://github.com/atto-lang/atto-source.net/pull/191) bounded actual direct CIL floating result; [#117](https://github.com/atto-lang/atto-source.net/pull/117) C#-lowered compiled Result preview | Exact CoreCLR and NativeAOT guest runs; production direct CIL Result lowering |
| `atto-source.llvm` | [#49](https://github.com/atto-lang/atto-source.llvm/pull/49) canonical caret/XOR | Current main integration and actual native guest artifacts |
| `atto-source.js` | [#46](https://github.com/atto-lang/atto-source.js/pull/46) caret/XOR and [#69](https://github.com/atto-lang/atto-source.js/pull/69) checked i64 | Non-overlapping combined transpiler test runs and shift-count admission |
| `atto-source.forge` | [#102](https://github.com/atto-lang/atto-source.forge/pull/102) caret/XOR and [#107](https://github.com/atto-lang/atto-source.forge/pull/107) arithmetic boundary | Full native compiler parity and exact-head execution |
| `atto-source.cranelift` | [#39](https://github.com/atto-lang/atto-source.cranelift/pull/39) scalar XOR and [#74](https://github.com/atto-lang/atto-source.cranelift/pull/74) i64 guest corpus | Operator supersession/integration and real JIT guest receipts |
| `atto-source.wasm` | [#51](https://github.com/atto-lang/atto-source.wasm/pull/51) Result/trap gate | The actual browser source-to-Wasm compiler lives in `atto-source.rs`; this is **not** a second independent frontend |
| `atto-source.hdl` | Hardware-target subset | `float` and general exception/actor semantics may be explicitly unsupported; fail closed instead of inventing synthesizable behavior |
| `atto-source.atto` and `atto-source.realtime` | Bootstrap-only repositories | No working self-hosted or real-time compiler to certify |

Shared execution/evidence owners: [atto-platform-conformance #235](https://github.com/atto-lang/atto-platform-conformance/pull/235) checked i64, [#236](https://github.com/atto-lang/atto-platform-conformance/pull/236) all-backend evidence index, [#68](https://github.com/atto-lang/atto-platform-conformance/pull/68) canonical trap-to-Result. The competing legacy [conformance #520](https://github.com/atto-lang/atto-platform-conformance/pull/520) `Option<Result>` trap ABI must be reconciled rather than accepted as canonical.

## /play admission rules

The public vendor receipt `play/public/atto_compiler.receipt.json` pins the shipped **Rust-authored Wasm compiler**, not the latest unmerged Rust source. An example is only classified `exec` if the exact pinned binary compiles the exact checked-in source and its actual guest Wasm output matches the oracle. All new canonical contract examples remain `preview-only` (syntax + expected target semantics) until a reviewed rebuild, source/tree/artifact SHA validation, native/wasm32 compiler parity and actual browser guest test evidence.

A canonical regression test now checks the current pinned compiler **cannot silently accept and execute** integer truncation for `5 / 2` in an `int` function, infix `^` as XOR, Boolean `^^`, or masked `1 <<< 64`. Incorrect execution must **fail the release gate**; an honest `E_...` diagnostic with no Wasm artifact is acceptable during migration. Do not rewrite these tests to expect the superseded language semantics or label unsupported examples runnable.

**Approval and CI:** Source-organization Actions jobs have often failed before steps. An unexecuted job is `NOT_EXECUTED`. Cross-org private-source transfer requires the exact reviewed allowlist; do not reuse stale carrier URLs as authorization. All linked implementation PRs remain distinct and unmerged pending their own exact-head compiler and guest runs.

## Executable standalone named calls, not package linking

The existing, already-executable `play/examples/preview/function-pipeline.atto`
now demonstrates **both** `twice(21)` returning 42 through a named helper
and a composed `|>` chain returning 121. Its pinned Wasm oracle must check
exact output `42\\n121\\n` and return `121`, with a real compiled
WebAssembly guest (never a JavaScript reimplementation or canned result).
A separate focused guest test checks that overflow in a callee, an eager
ignored call argument and an eager unused `val` cannot silently wrap,
disappear or produce a successful value; compile-time rejection with a
structured overflow diagnostic and no emitted Wasm is allowed where static
analysis proves the failure.

Shared source fixture owner: [conformance #233](https://github.com/atto-lang/atto-platform-conformance/pull/233)
adds the standalone typed-formal, nested direct call and checked-evaluation
cases. [Cranelift #72](https://github.com/atto-lang/atto-source.cranelift/pull/72)
remains a **trusted JIT draft**, not a hosted Wasm compiler. This playground
does not import files, synthesize a package graph, or substitute native
Cranelift for the pinned Rust/Wasm compiler.

**Do not mark the edited preview executed on this PR head until its real
vendored Rust/Wasm guest test, full site suite and release gates run.**
No compiler bytes or receipt pins are changed by this source-only candidate.
