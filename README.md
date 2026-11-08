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

The static route `/play/` is implemented on branch `feat/atto-wasm-playground-page-20261106` and is intended to be published at [AttoLang Playground](https://atto-lang.github.io/play/) once the site branch is merged and GitHub Pages is configured. It ships a real browser-hosted Wasm compiler and a separate compiled guest Wasm module. It compiles a documented AttoLang subset (functions, recursion, checked 64-bit `int`, `bool`, `if`/`while`/`for`/`loop`, `stdio.println`) with syntax from the reference compiler; do not advertise full compiler parity. The public route includes both Node WebAssembly guest tests and a real Chromium browser test.

Authoritative compiler and source review: [atto-lang/atto-playground PR #1](https://github.com/atto-lang/atto-playground/pull/1). Do not infer a live URL solely from this README; verify the deployment first.


## User-created programs and editor highlighting

The `/play/` editor now has a **Custom +** selector for saving up to 30 named programs in this browser's same-origin localStorage (64 KiB per program), with explicit Save/overwrite and Delete controls. Saved programs are not submitted to a server or synced between browser profiles/domains. The native textarea retains keyboard and assistive access while a noninteractive, text-only overlay colorizes code tokens using Oreslang formatter-aligned lexical conventions; this is not a full semantic formatter or substitute for the compiler.


## Canonical Rust Wasm formatter

`/play/` now offers **Format** and **Check format** actions powered by the real `oreslang-format` Rust crate built as a separate, import-free 198230-byte Wasm binary; see `play/public/oreslang_format.receipt.json` for the exact source and SHA-256. Formatting is local, uses a disposable worker, and only applies source edits on success. **Check format** never changes code. The compiler and its public release digest are unchanged. The formatter is not a compiler/type-checker.

## Repository ownership and contribution routing

**Belongs here:** Public AttoLang language marketing pages, learning content, link/navigation, Pages publishing and the public /play integration boundary.

**Belongs elsewhere:** Canonical language semantics, private compiler source, and the standalone playground implementation have separate repository owners; commercial hosting is outside this public marketing repository. Do not disclose private repository inventory through public documentation.

**Security and portability boundary:** Never publish private code, test secrets or outdated unverified backend claims. Guard production release with immutable asset receipts, CSP, source provenance, approval and post-deploy verification.

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
