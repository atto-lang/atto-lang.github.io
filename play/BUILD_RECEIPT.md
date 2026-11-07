# AttoLang public playground asset receipt

These are static browser assets copied from `atto-lang/atto-playground` head `94fdc87fbfc4ad95f0e554b77e8f27bdc6730f69` (atto-playground#5) for the AttoLang website's `/play/` route.

The compiler is `play/public/atto_compiler.wasm`, SHA-256 `10262395ecb10b42f1526af4bb52367c05b170f4c77e43f5a9119d0d88da5a72`. It was built from `atto-lang/atto-source.rs` head `6f10c513e10ca6903319d9585ffed006dbe0c18b` with rustc 1.85.1 for wasm32-unknown-unknown. The same digest was produced on macOS arm64 and by hosted Ubuntu CI ([run 42338075610](https://github.com/atto-lang/atto-source.rs/actions/runs/42338075610)); see `play/public/atto_compiler.receipt.json`.

The public site contains only browser runtime assets and example programs. It has no compiler source, CI tokens, backend service, secrets or private repository data.

The compiler supports a documented subset of AttoLang, not the full language; see `play/docs/COMPILER_CONTRACT.md`. These are staging tests. They are not proof of a deployed HTTPS endpoint or of Firefox/WebKit parity.
