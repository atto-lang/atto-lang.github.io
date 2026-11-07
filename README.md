# atto-lang.github.io

Official AttoLang documentation, language reference, tutorials, and ecosystem website.

## Project scope

Language documentation, learning material, and public ecosystem navigation.

## Development and validation

Use checked-in site build and publishing workflows for validation. Keep language claims tied to the canonical specification and tested backend support.

## Status

This is a statement of intended scope, not a claim of completed implementation or production readiness. Source, CI, and checked-in examples are authoritative for actual supported features and commands.

## Ecosystem

- [AttoLang organization](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Interactive browser playground

The static route `/play/` is implemented on branch `feat/atto-wasm-playground-page-20261106` and is intended to be published at [AttoLang Playground](https://atto-lang.github.io/play/) once the site branch is merged and GitHub Pages is configured. It ships a real browser-hosted Wasm compiler and a separate compiled guest Wasm module. The initial subset is restricted to signed 32-bit integer scalar programs; do not advertise full compiler parity. The public route includes both Node WebAssembly guest tests and a real Chromium browser test.

Authoritative compiler and source review: [atto-lang/atto-playground PR #1](https://github.com/atto-lang/atto-playground/pull/1). Do not infer a live URL solely from this README; verify the deployment first.
