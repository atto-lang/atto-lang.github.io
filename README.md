# atto-lang.github.io

Official AttoLang documentation, language reference, tutorials, and ecosystem website.

## Project scope

Language documentation, learning material, and public ecosystem navigation.

## Technical papers

The [AttoLang Technical Papers](https://atto-lang.github.io/whitepapers/) provide versioned technical explanations of language design, compiler architecture, memory ownership, actor concurrency, and portable AOT. Each paper separates documented implementation evidence from design goals and planned capabilities.

## Development and validation

Use checked-in site build and publishing workflows for validation. Keep language claims tied to the canonical specification and tested backend support.

## Status

This is a statement of intended scope, not a claim of completed implementation or production readiness. Source, CI, and checked-in examples are authoritative for actual supported features and commands.

## Ecosystem

- [AttoLang organization](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Interactive browser playground

The static route /play/ is implemented on the main branch and is published at [AttoLang Playground](https://atto-lang.github.io/play/). It ships a real browser-hosted Wasm compiler and a separate compiled guest Wasm module. It compiles a documented AttoLang subset; do not advertise full compiler parity. The public route includes Node WebAssembly guest tests and real Chromium browser tests.

The [playground compiler contract](play/docs/COMPILER_CONTRACT.md) describes the supported subset, compiler and guest ABIs, actor worker behavior, and security constraints.

## User-created programs and editor highlighting

The /play/ editor has a **Custom +** selector for saving up to 30 named programs in this browser's same-origin localStorage (64 KiB per program), with explicit Save/overwrite and Delete controls. Saved programs are not submitted to a server or synced between browser profiles/domains. The native textarea retains keyboard and assistive access while a noninteractive text-only overlay colorizes code tokens; this is not a full semantic formatter or substitute for the compiler.

## Canonical Rust Wasm formatter

The /play/ route offers **Format** and **Check format** actions powered by the Rust formatter built as a separate, import-free Wasm binary. See play/public/oreslang_format.receipt.json for the source and SHA-256. Formatting is local, uses a disposable worker, and only applies source edits on success. Check format never changes code. The formatter is not a compiler or type checker.
