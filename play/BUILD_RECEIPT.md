# AttoLang Rust/Wasm browser compiler provenance

This is a human-readable **candidate integration** receipt for `atto-lang/atto-lang.github.io`, not a compiler release approval or a claim that a Draft PR has been merged/deployed. The authoritative machine-readable artifact receipt is [`play/public/atto_compiler.receipt.json`](public/atto_compiler.receipt.json); CI must validate the actual binary bytes.

## Pinned browser compiler artifact

- Source repository: `atto-lang/atto-source.rs`
- Source commit: `d392c6ee24e5bc38a91c7a42658847ce2d805a2e`
- Exact source tree: `5574de1318d96ed397161d81b86891dd136b92d6`
- Toolchain: `rustc 1.85.1 (4eb161250 2025-03-15)`
- Target: `wasm32-unknown-unknown`
- Compiler ABI: `2`; guest ABI: `atto.browser.guest.v2`
- Binary: `play/public/atto_compiler.wasm`
- Binary size: `2030087` bytes
- Binary SHA-256: `c68efbdd0e2ee64a8650d0aafeafb66b7d4730683fea506c27838202ad1a9b27`

The browser verifies the published compiler bytes against `play/src/compiler-pin.js` and the structured receipt. A mismatch must fail closed, not fall back to a JavaScript language evaluator or a canned output.

At runtime, **one disposable tenant Web Worker** hosts the tenant's actor execution boundary. Actor instances receive separate private `WebAssembly.Instance` objects, not a dedicated Web Worker per actor. These restrictions are part of the pinned guest-v2 host profile; they are not proof of hostile-tenant isolation across all native backends.

## Compiler-backed examples and testing

The current executable/diagnostics-only memberships and expected stdout/return values are defined by `play/example-backend-profile.json`; derive counts from that file instead of copying a stale number into release notes. `play/tests/pinned-preview-admission.test.mjs` must compile every advertised executable source with the actual pinned Wasm compiler, run the emitted guest Wasm, compare exact output, and verify that other language-preview samples are rejected with positioned diagnostics and **no** executable artifact.

The pull request's `AttoLang PR build, test and security` workflow must complete with real executed Node/Wasm and Chromium tests, staged-asset checks, and verification of the proposed merge commit. A source-only catalog test or an observation-only public-site check does **not** establish deployment or successful guest execution of this candidate.

## Experimental compiler work is not released

The evolving `atto-lang/atto-source.rs#470` list-based SelectPlan implementation is stacked on the unreleased `#262` async runtime. That experimental branch is **not** the pinned browser compiler. Its Rust, wasm32, Node and Chromium tests must pass on the actual current head before any repin. No keyed `from_map`, full cancellation/ownership enforcement, or cross-backend parity is claimed by this website receipt.

**Security:** `play/public/atto_compiler.wasm` is publicly accessible once published through GitHub Pages. Never copy unpublished private source into a cross-org runner without independent source-export authorization, and never substitute a skipped, cancelled or zero-step CI job for successful test execution.
