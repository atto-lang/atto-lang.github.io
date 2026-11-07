# AttoLang public playground asset receipt

The browser UI and runtime shipped by this website's `/play/` route are synchronized with `atto-lang/atto-playground` `main` at exact commit `4340d40a85378946baf337487baae7759a05e576`. That merge preserved the tested feature-head file tree `8a20d13759ca94fb7a6f82e1d8252af32f0d0a29` (GitHub comparison reported no file differences). The public mirror includes the accessible editor, diagnostic/Wasm tabs, compiler integrity checks, restricted guest imports and worker cancellation behavior.

The compiler artifact is `play/public/atto_compiler.wasm`, SHA-256 `91209eac9d875e3574d5f87a9a2e6e46f7622daa1169b79d31213f31ad78b657` (146384 bytes). It was built from `atto-lang/atto-source.rs` head `061dc2f308239357bd9c6bc3bcefdb50c6ddff2d` and tree `72b481cd385034b0b5d1d40ae7fe9ce4beaa9e27`, with rustc 1.85.1 for wasm32-unknown-unknown. Compiler provenance is in `play/public/atto_compiler.receipt.json`. The browser worker checks the compiler digest against `play/src/compiler-pin.js`.

The website's release staging allowlist explicitly includes `src/editor.js` and `src/ui.js`. Source tests include editor helpers and Chromium UI/E2E; the website's release workflow additionally retests the staged `/play/` files. Treat test results as verified only when an exact commit has nonzero executed job steps and successful outcomes.

This public mirror contains static browser assets and examples, not compiler source, backend services or secrets. The compiler supports only the documented language subset, not full AttoLang. Successful repository tests do not prove a public HTTPS deployment, Firefox/WebKit parity, or independently approved public release.

**Security:** `play/public/atto_compiler.wasm` is already in a *public* GitHub repository. The manual Pages workflow and administrator-pinned SHA-256 gate Pages deployment; they cannot retroactively prevent visitors from reading committed files. An administrator must configure the protected `github-pages` environment and separately authorize the exact digest before any Pages workflow dispatch.
