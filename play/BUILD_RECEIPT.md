# AttoLang public playground asset receipt

These are static browser assets copied from `atto-lang/atto-playground` head `c901a45529dd37035632606534a14c079900a646` (atto-playground#5) for the AttoLang website's `/play/` route.

The compiler is `play/public/atto_compiler.wasm`, SHA-256 `91209eac9d875e3574d5f87a9a2e6e46f7622daa1169b79d31213f31ad78b657`. It was built from `atto-lang/atto-source.rs` head `061dc2f308239357bd9c6bc3bcefdb50c6ddff2d` with rustc 1.85.1 for wasm32-unknown-unknown. The same digest was produced on macOS arm64 and by hosted Ubuntu CI ([run 42380444053](https://github.com/atto-lang/atto-source.rs/actions/runs/42380444053)); see `play/public/atto_compiler.receipt.json`. The compiler worker verifies this digest (`play/src/compiler-pin.js`) before running the compiler.

The public site contains only browser runtime assets and example programs. It has no compiler source, CI tokens, backend service, secrets or private repository data.

The compiler supports a documented subset of AttoLang, not the full language; see `play/docs/COMPILER_CONTRACT.md`. These are staging tests. They are not proof of a deployed HTTPS endpoint or of Firefox/WebKit parity.
