---
layout: whitepaper
title: "AttoLang Technical Papers — Editorial Guide"
permalink: /whitepapers/README.html
---

# AttoLang Technical Papers

This directory contains the published AttoLang white-paper series.

- Public landing page: https://atto-lang.github.io/whitepapers/
- Publication version: 0.2
- Initial publication date: 2026-11-08
- Repository: https://github.com/atto-lang/atto-lang.github.io

## Editorial and graphics audit

See [the latest editorial and graphics audit](AUDIT.md) for findings, corrections, figure inventory, and remaining publication gates.

## Authored papers

1. [Language Design and Philosophy](01-language-design.md)
2. [Compiler Architecture](02-compiler-architecture.md)
3. [Memory Ownership and Zero-GC Execution](03-memory-ownership-and-zero-gc.md)
4. [Actor Runtime and Concurrency](04-actor-runtime-and-concurrency.md)
5. [Portable AOT and Backends](05-portable-aot-and-backends.md)
6. [Type System and Static Guarantees](06-type-system-and-static-guarantees.md)
7. [ExecutionContext, Threads, Tasks, and Scheduling](07-execution-context-and-scheduling.md)
8. [Durable Actors, Supervision, and Hot Upgrades](08-durable-actors-and-hot-upgrades.md)
9. [Multi-Tenant Isolation and Security](09-multi-tenant-isolation-and-security.md)
10. [Performance Engineering and Cross-Backend Conformance](10-performance-and-conformance.md)

## Editorial and evidence policy

These papers distinguish design proposals from implemented and verified behavior. Every public claim must be scoped to a specific language subset, backend, runtime, and source revision.

| Label | Meaning |
|---|---|
| Specified | A normative contract is documented. |
| Designed | An architecture or design has been proposed. |
| Implemented | Source code contains the implementation. |
| Host-tested | Host-side tests execute the implementation. |
| Guest-executed | A compiled AttoLang program runs in the target runtime. |
| Backend-conformant | Relevant shared fixtures pass on the named backend. |
| Production-validated | Operational evidence demonstrates the property in deployment. |
| Not executed | No meaningful test execution occurred. |
| Unsupported | The implementation explicitly rejects or does not provide the capability. |

A zero-step workflow is not a test pass. Host-only tests do not prove guest behavior. Successful compilation does not prove runtime correctness. A matching artifact digest proves byte identity, not semantic correctness.

## Update procedure

1. Update the paper version and date.
2. Recheck every source link and implementation statement.
3. Attach exact source commit, source tree, workflow run, and test receipt for newly verified claims.
4. Preserve known limitations and unsupported behaviors.
5. Update the landing page and cross-references.
6. Do not describe a feature as backend-conformant without guest-level evidence for that backend.

## Canonical public implementation reference

The [playground compiler contract](../play/docs/COMPILER_CONTRACT.md) describes the supported browser subset, compiler and guest ABIs, capabilities, and limitations. It is an implementation snapshot for that environment, not the complete language specification.


## Series roadmap

Planned papers include async programming and structured concurrency, the canonical standard library, compile-time generics and macros, browser and Web Worker execution, and mobile/desktop application architecture.

## Diagrams and visual assets

The architecture figures are authored as editable SVG source in `assets/`. Each paper embeds its corresponding figure with descriptive alternative text and a caption. Keep figures conceptual unless the caption identifies a verified implementation detail. SVGs should remain text-based, have an accessible title and description, and avoid external script, font, or image dependencies.

## Documentation validation

`scripts/check-whitepapers.mjs` validates required paper files, front matter, unique permalinks, balanced fenced code blocks, and local Markdown links. The `.github/workflows/whitepapers.yml` workflow runs it on white-paper changes and verifies the checked-out commit is the exact PR head.
