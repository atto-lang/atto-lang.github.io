---
layout: whitepaper
title: "AttoLang Technical Papers — Publication Status"
permalink: /whitepapers/STATUS.html
---

# White-paper publication status

**Snapshot:** 2026-11-10 · Series 0.4 · Public site deployed

| Paper | Status | Evidence boundary |
|---|---|---|
| 01 Language Design and Philosophy | Published (design) | Design overview; not a full normative specification |
| 02 Compiler Architecture | Published (design) | Conceptual pipeline plus public browser compiler ABI and receipt |
| 03 Memory Ownership and Zero-GC | Published (design) | Design requirements; current browser bump heap does not reclaim objects |
| 04 Actor Runtime and Concurrency | Published (design) | Public browser Web Worker actor subset; broader runtime features remain separate |
| 05 Portable AOT and Backends | Published (design) | Five-backend target architecture; no blanket parity claim |
| 06 Type System and Static Guarantees | Published (design) | Design summary; type-form availability varies by compiler and backend |
| 07 ExecutionContext and Scheduling | Published (design) | Runtime architecture; complete scheduling and storage parity unproven |
| 08 Durable Actors and Hot Upgrades | Published (design) | Target lifecycle protocol; end-to-end recovery not certified |
| 09 Multi-Tenant Isolation and Security | Published (design) | Security model; no blanket production sandbox certification |
| 10 Performance and Conformance | Published (design) | Measurement methodology; no benchmark numbers or parity assertion |
| 11 Async Programming and Structured Concurrency | Published (design) | Task lifecycle design and guest conformance requirements; backend completion unproven |

## Evidence labels

- **Specified:** a normative contract is documented.
- **Designed:** an architecture or design has been proposed.
- **Implemented:** source code contains the implementation.
- **Host-tested:** host-side tests execute the implementation.
- **Guest-executed:** a compiled AttoLang program runs in the target runtime.
- **Backend-conformant:** relevant shared fixtures pass on the named backend.
- **Production-validated:** operational evidence demonstrates the property in deployment.
- **Not executed:** no meaningful test execution occurred.
- **Unsupported:** the implementation explicitly rejects or does not provide the capability.

## Explicit non-claims

This publication does not assert that every AttoLang feature is implemented in every compiler, that zero-GC execution has been achieved end to end, that durable actor lifecycle and hot upgrades are complete, that all tenant-isolation controls are production-certified, or that Java/GraalVM, LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift have full semantic parity.

It also does not assert that Web Workers are an operating-system sandbox or that the public playground compiler implements the full language.

## Visual and editorial audit

The editorial audit and figure inventory are documented in [AUDIT.md](AUDIT.md).

All eleven technical papers now embed a source-controlled SVG architecture figure and declare the shared responsive `whitepaper` layout. The diagrams communicate conceptual relationships and must not be read as proof that every depicted runtime component is implemented. The released HTML is rendered by GitHub Pages; later candidate revisions require their own exact-head Jekyll test.

## Publication and validation receipt

The series is live at [atto-lang.github.io/whitepapers/](https://atto-lang.github.io/whitepapers/). Its initial eleven-paper deployment used commit `28625f0021b003487f02297bf11f8b8d79482e8f`, tree `8cc1783197c1057af931a411aa368caf0185da58`. The post-merge validation and Pages deployment runs are linked in the [editorial audit](AUDIT.md).

A public paper is not thereby a backend-conformance result. Feature-level claims require separate source, guest execution, and conformance receipts.

## Primary public evidence

- `../play/docs/COMPILER_CONTRACT.md` — browser subset, compiler ABI, guest ABI, actor execution contract, and limitations.
- `../play/public/atto_compiler.receipt.json` — browser compiler source head/tree, toolchain, target, ABI versions, digest, and size.
- `../play/examples/` — public source examples included with the playground.

## Next publication work

The next research papers should cover the canonical standard library, compile-time generics and macros, browser/worker execution, and mobile/desktop integration. Every new implementation claim must cite exact source revisions and executed evidence.
