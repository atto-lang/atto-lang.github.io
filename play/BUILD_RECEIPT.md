# AttoLang public playground asset receipt

These are static browser assets copied from `atto-lang/atto-playground` head `980f94468c259ce968254ddf33998f1ebfad13a1` for the official AttoLang website `/play/` route. Source-to-Wasm guest correctness is verified by compiler and browser CI in that repository. Compiler artifact: `play/public/atto_compiler.wasm`, SHA-256 `678db18c065d7517e6224ca3ea2e4d59c26e0e7d653e966d15ca1ce4a1328fd8`.

The public site contains browser runtime assets only: no native compiler source, CI tokens, backend service, secrets or private repository data. The compiler is an explicitly restricted scalar M0 bootstrap; it is not full AttoLang conformance.

Deploy `/play/` from this public website once the repository's Pages configuration is enabled, and verify browser execution on the live origin before publication claims.

## E2E provenance

The source repository head `980f94468c259ce968254ddf33998f1ebfad13a1` passed 11/11 compiler tests and 14/14 real Chromium UI E2E scenarios in [GitHub Actions run 42334418650](https://github.com/atto-lang/atto-playground/actions/runs/42334418650). Public website CI reexecutes the shipped compiler and browser suite from this independently committed site tree. The compiler Wasm Git blob remains identical across source and site (`d22d5e297b03ef3d49b426a319711689e0ad1a42`). These are staging tests, not proof of a deployed HTTPS endpoint, Firefox/WebKit parity, or full canonical Atto semantics.
