# AttoLang Technical Papers

This directory contains the published AttoLang white-paper series.

- Public landing page: https://atto-lang.github.io/whitepapers/
- Publication version: 0.1
- Initial publication date: 2026-11-08
- Repository: https://github.com/atto-lang/atto-lang.github.io

## Authored papers

1. [Language Design and Philosophy](01-language-design.md)
2. [Compiler Architecture](02-compiler-architecture.md)
3. [Memory Ownership and Zero-GC Execution](03-memory-ownership-and-zero-gc.md)
4. [Actor Runtime and Concurrency](04-actor-runtime-and-concurrency.md)
5. [Portable AOT and Backends](05-portable-aot-and-backends.md)

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
