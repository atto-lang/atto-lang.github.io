# AttoLang public playground mirror candidate — actor state containers

The playground source is synchronized with the canonical private [atto-playground PR #46](https://github.com/atto-lang/atto-playground/pull/46), head `3825331bb59b5b8b365e74c094e7ab97fc638bc1`, for the listed runtime-facing editor, tests, examples, and compiler assets. The compiler itself is built from [atto-source.rs PR #47](https://github.com/atto-lang/atto-source.rs/pull/47), exact source head `1b01117dbbdb5e58e4fa01d61319b61928e0578e` and source tree `cebe289d1561cf78ab517282bb8ccd85d82f024e`.

- Compiler SHA-256: `985e3a992a25e1993d64434a02e719ab2993fb9da9ac9262aae9170e5c18e9e7`
- Compiler size: `260994` bytes
- Compiler ABI v2; guest ABI `atto.browser.guest.v2`; zero compiler host imports
- Canonical Counter: explicit `state { let int total = 0; }` and synchronous `handle_state(critical-write |s| -> { ... })`
- Tested in source compiler exact-head native Rust, native/Wasm conformance and real Chromium Worker E2E; private playground CI executed receipt validation, browser E2E and release staging
- This is a review candidate. Source CI or a public-site PR is **not** evidence that GitHub Pages was deployed.
- Independent review and the repository's public compiler SHA approval / binary-disclosure controls are required before publication. A public Git branch or PR containing this artifact discloses its binary bytes even before Pages deployment; treat this proposed mirror as a public disclosure.

The browser/compiler checks enforce borrow scopes only for the non-reentrant single-Worker actor subset. This is not evidence of a general shared-memory reader/writer lock or parity with the Java/LLVM compilers.
