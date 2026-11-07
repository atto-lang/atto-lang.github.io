# AttoLang public playground asset receipt

These are static browser assets copied from `atto-lang/atto-playground` head `3ae7c893e09017ecfb51c80d8e4cdc3ebbdbf547` for the official AttoLang website `/play/` route. Source-to-Wasm guest correctness is verified by compiler and browser CI in that repository. Compiler artifact: `play/public/atto_compiler.wasm`, SHA-256 `678db18c065d7517e6224ca3ea2e4d59c26e0e7d653e966d15ca1ce4a1328fd8`.

The public site contains browser runtime assets only: no native compiler source, CI tokens, backend service, secrets or private repository data. The compiler is an explicitly restricted scalar M0 bootstrap; it is not full AttoLang conformance.

Deploy `/play/` from this public website once the repository's Pages configuration is enabled, and verify browser execution on the live origin before publication claims.
