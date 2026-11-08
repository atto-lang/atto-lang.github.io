# White-paper publication status

**Snapshot:** 2026-11-08 · Series 0.2

| Paper | Status | Evidence boundary |
|---|---|---|
| 01 Language Design and Philosophy | Authored | Design overview; not a full normative specification |
| 02 Compiler Architecture | Authored | Conceptual pipeline plus public browser compiler ABI and receipt |
| 03 Memory Ownership and Zero-GC | Authored | Design requirements; current browser bump heap does not reclaim objects |
| 04 Actor Runtime and Concurrency | Authored | Public browser Web Worker actor subset; broader runtime features remain separate |
| 05 Portable AOT and Backends | Authored | Five-backend target architecture; no blanket parity claim |
| 06 Type System and Static Guarantees | Authored | Design summary; type-form availability varies by compiler and backend |
| 07 ExecutionContext and Scheduling | Authored | Runtime architecture; complete scheduling and storage parity unproven |
| 08 Durable Actors and Hot Upgrades | Authored | Target lifecycle protocol; end-to-end recovery not certified |
| 09 Multi-Tenant Isolation and Security | Authored | Security model; no blanket production sandbox certification |
| 10 Performance and Conformance | Authored | Measurement methodology; no benchmark numbers or parity assertion |

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

## Primary public evidence

- `../play/docs/COMPILER_CONTRACT.md` — browser subset, compiler ABI, guest ABI, actor execution contract, and limitations.
- `../play/public/atto_compiler.receipt.json` — browser compiler source head/tree, toolchain, target, ABI versions, digest, and size.
- `../play/examples/` — public source examples included with the playground.

## Next publication work

The next research papers should cover async programming and structured concurrency, the canonical standard library, compile-time generics and macros, browser/worker execution, and mobile/desktop integration. Every new implementation claim must cite exact source revisions and executed evidence.
