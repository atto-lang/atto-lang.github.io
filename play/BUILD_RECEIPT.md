# AttoLang public playground asset receipt

The original website `/play/` browser UI and runtime baseline was synchronized with `atto-lang/atto-playground` `main` at exact commit `75d1eca52301237b73bbf79e8465922fe7b1505a` (merge of atto-playground#26). The baseline files were byte-identical at that release; subsequent website changes must be reviewed separately and are not covered by that historical mirror claim. The release adds classes, actors and enums: each spawned actor runs in its own dedicated Web Worker (`src/actor-host.js`, `src/actor-worker.js`) with a private Wasm instance, a bounded mailbox and the run deadline.

The compiler artifact is `play/public/atto_compiler.wasm`, SHA-256 `b7c5e86d8b25a67cc1ea3200b08e088c4022b9d9f8599ba7b87b1253f6822860` (253921 bytes). It was built from `atto-lang/atto-source.rs` head `865c835c7f343a2bb00b5b73a6010825f57be794` (merged as atto-source.rs#29) and tree `6520a246849366dfdeb77eaba24956f56dc18713`, with rustc 1.85.1 for wasm32-unknown-unknown. The hosted CI run of that head rebuilt the same digest byte for byte. Compiler provenance is in `play/public/atto_compiler.receipt.json`, and the browser worker checks the digest against `play/src/compiler-pin.js`.

The release staging allowlist (`.github/scripts/package-playground.mjs`) explicitly includes the actor host and actor worker scripts and the three new examples. Source tests include the actor host unit tests and Chromium E2E for classes, enums and actors in real Web Workers; the website's release workflow additionally retests the staged `/play/` files. Treat test results as verified only when an exact commit has nonzero executed job steps and successful outcomes.

This public mirror contains static browser assets and examples, not compiler source, backend services or secrets. The compiler supports only the documented language subset, not full AttoLang. Successful repository tests do not prove Firefox/WebKit parity.

**Security:** `play/public/atto_compiler.wasm` is in a *public* GitHub repository, and this site is served by GitHub Pages directly from `main`, so merging this change publishes it.

## Language preview catalog amendment (2026-11-12)

Nine additional language-design examples are explicitly **source-only previews**. Preview selection disables Run. The pinned browser compiler binary, digest pin, receipt, guest ABI and worker isolation are unchanged. The conditions sample now uses browser-supported `And()` and `Or()` named functions instead of teaching legacy comma/pipe conditional tokens. This website delta requires its own CI and staged-asset review; it does not establish compiler support for the preview grammar or canonical boolean symbols.
