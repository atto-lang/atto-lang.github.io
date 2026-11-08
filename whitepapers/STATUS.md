---
title: "AttoLang Technical Papers — Publication Status"
permalink: /whitepapers/STATUS.html
---

# White-paper publication status

**Snapshot:** 2026-11-08 · Initial series 0.1

| Paper | Status | Evidence boundary |
|---|---|---|
| 01 Language Design and Philosophy | Authored | Design overview; not a full normative specification |
| 02 Compiler Architecture | Authored | Conceptual pipeline plus public browser compiler ABI and receipt |
| 03 Memory Ownership and Zero-GC | Authored | Design requirements; current browser bump heap does not reclaim objects |
| 04 Actor Runtime and Concurrency | Authored | Public browser Web Worker actor subset; broader runtime features remain separate |
| 05 Portable AOT and Backends | Authored | Five-backend target architecture; no blanket parity claim |

## Explicit non-claims

This publication does not assert that every AttoLang feature is implemented in every compiler, that zero-GC execution has been achieved end to end, that actor heaps and deterministic reclamation are integrated across all targets, or that Java/GraalVM, LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift have full semantic parity.

It also does not assert that Web Workers are an operating-system sandbox or that the public playground compiler implements the full language.

## Primary public evidence

- ../play/docs/COMPILER_CONTRACT.md — browser subset, compiler ABI, guest ABI, actor execution contract, and limitations.
- ../play/public/atto_compiler.receipt.json — browser compiler source head/tree, toolchain, target, ABI versions, digest, and size.
- ../play/examples/ — public source examples included with the playground.

## Next publication work

The next papers should be grounded in the canonical language specification and exact backend implementations, with current code references and executed test receipts. Priority topics are the type system, ExecutionContext and scheduling, durable actors and hot upgrades, tenant isolation, and performance/conformance methodology.
