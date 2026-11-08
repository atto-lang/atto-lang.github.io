---
title: "Portable AOT: One Language Across Multiple Execution Backends"
permalink: /whitepapers/05-portable-aot-and-backends.html
---

# Portable AOT: One Language Across Multiple Execution Backends

**Technical Papers · Paper 05 · Version 0.1 · 8 November 2026**  
**Status:** Target architecture and conformance methodology; not a certification of parity across all named backends.

## Abstract

Ahead-of-time compilation is often associated with one target architecture or runtime. AttoLang's ambition is broader: one language contract should be realizable across native machine code, managed-runtime integration, and WebAssembly environments. Achieving this requires a shared semantic core, carefully bounded target adapters, stable ABI contracts, and a conformance process that tests observable guest behavior.

This paper describes the architecture and the evidence needed to support portability claims. It deliberately distinguishes the multi-backend target from the narrower browser/Wasm compiler path that is publicly documented today.

## 1. What portability requires

A source program is portable only when the receiving target can implement its required language and runtime capabilities. Compilation alone is not enough. The program's types, arithmetic, ownership, effects, scheduling, error behavior, and externally visible results must remain compatible.

A portability claim should state its scope:

- Which language subset is supported?
- Which compiler and runtime version are involved?
- Which target triple and ABI are used?
- Which host capabilities are required?
- Which features are unsupported?
- Which conformance fixtures have actually executed?
- Which test receipts refer to the exact source head?

Without these details, "runs on five backends" is too vague to be meaningful.

## 2. Intended backend families

The architectural program includes five backend families:

| Backend family | Intended integration |
|---|---|
| Java / GraalVM | JVM integration and native-image compilation |
| LLVM | Native machine-code generation and platform toolchains |
| .NET NativeAOT | Native compilation through the .NET toolchain |
| WebAssembly | Browser and server-side Wasm execution |
| Forge / Cranelift | AOT or runtime code generation through a Cranelift-based backend |

Each backend has different constraints. JVM and .NET have managed object models and host services; LLVM exposes lower-level control over native layouts and calling conventions; Wasm constrains imports and memory access through a module interface; Cranelift has its own IR and target-lowering model.

The shared language contract must sit above these differences.

## 3. Shared semantics, replaceable implementations

The compiler architecture should centralize decisions that define the language and isolate target-specific mechanisms behind narrow interfaces.

Examples of shared semantics include:

- Integer width, overflow, and comparison behavior.
- Evaluation order and short-circuiting (or explicit eager evaluation).
- Binding and referent mutability.
- Ownership transfer and borrow validity.
- Suspension and cancellation.
- Actor message admission and ordering.
- Error and panic behavior.

Examples of target-specific mechanisms include register allocation, stack layout, calling conventions, native system calls, Wasm imports, runtime thread integration, and platform packaging.

The boundary is not always obvious. Memory layout and scheduling can affect observable behavior, so the specification must identify which properties are abstract and which are part of the conformance contract.

## 4. AOT and runtime dynamism

AOT compilation moves code generation before program execution. It benefits from statically known types, callable targets, object layouts, and effect contracts. Unrestricted reflection, arbitrary dynamic loading, runtime-generated code, and open-ended dynamic dispatch complicate this model.

AttoLang's design should therefore make dynamic capabilities explicit and bounded. Generic specialization, hygienic macros, and compile-time transformation can offer extensibility without requiring arbitrary runtime code generation. Where runtime JIT is allowed for untrusted or dynamic workloads, it should be described as a separately governed execution mode rather than presented as evidence of static AOT.

AOT does not eliminate the need for runtime services. Scheduling, timers, I/O readiness, actor mailboxes, memory admission, and capability checks may remain runtime responsibilities even when guest code is fully compiled ahead of time.

## 5. ABI and runtime boundaries

Every backend needs a documented ABI contract covering symbol naming, calling convention, value representation, aggregate layout, error propagation, memory ownership, thread safety, and version negotiation.

Host implementations should expose minimal primitives. Language-level libraries and semantics should remain in canonical AttoLang source where possible, rather than being reimplemented differently in Java, C#, or another host language.

A guest ABI must also define which imports are permitted. The public browser compiler illustrates a narrow capability boundary: the Wasm guest imports selected output operations and, for actor programs, bounded actor host operations. The browser runner checks imports and enforces execution deadlines.

## 6. WebAssembly as a concrete portable target

The public playground ships a Rust compiler built for `wasm32-unknown-unknown`. That compiler executes locally in the browser and emits a separate guest Wasm module. Its compiler ABI and guest ABI are versioned independently. The artifact receipt identifies the exact source head, source tree, toolchain, target, ABI versions, SHA-256 digest, and artifact size.

This is a useful example of reproducible compiler artifact provenance and constrained guest capabilities. It is not evidence that the same source subset currently has equivalent native LLVM, Java/GraalVM, .NET NativeAOT, or Forge/Cranelift behavior.

See the [public compiler contract](../play/docs/COMPILER_CONTRACT.md) and [compiler receipt](../play/public/atto_compiler.receipt.json).

## 7. Conformance: the center of portability

A shared fixture suite should define programs and expected outcomes independent of any one backend. Each fixture should specify:

- Accepted or rejected source.
- Expected diagnostic code and source location where applicable.
- Expected return value and output.
- Expected runtime panic or failure.
- Required runtime capabilities.
- Resource bounds and timeout.
- Whether the result is deterministic or permits explicitly unordered interleaving.

The same fixture should be executed against each supported backend. The harness should record compiler head, runtime head, toolchain, target, fixture version, workflow run, attempt number, executed steps, result, and receipt digest.

A test should be classified accurately:

- **Host-tested:** implementation code ran in a host test process.
- **Guest-executed:** a compiled AttoLang program ran in the target runtime.
- **Backend-conformant:** the relevant shared fixtures passed for that backend.
- **Not executed:** no meaningful guest test ran.
- **Unsupported:** the backend explicitly rejects the feature by contract.

Zero-step workflows are not test passes. Host-only tests do not prove guest behavior. A green result from an earlier source head does not validate a later candidate head.

## 8. Differential and adversarial testing

Differential testing compares the same source fixture across reference and candidate implementations. It is especially valuable for evaluation order, checked arithmetic, move errors, diagnostics, actor mail ordering, and cancellation races.

Adversarial tests should generate malformed, deeply nested, oversized, and boundary-valued inputs. They should mutate positive fixtures and verify that every accepted result is a valid artifact and every rejected result is a controlled diagnostic. Runtime tests should include capability violations, invalid imports, resource exhaustion, and deadline enforcement.

## 9. What counts as a portability claim

A credible public statement should be scoped, for example:

> "The documented browser subset compiles to WebAssembly under compiler ABI v2 and executes under guest ABI v2 in the public playground."

A statement such as "AttoLang has full semantic parity across five AOT backends" requires exact-head guest execution and conformance receipts for the same relevant language features on every named backend. Until that evidence exists, the paper should describe the five-backend architecture as a goal and list backend support as verified, partial, unsupported, or not executed.

## 10. Current status and next proof points

The public browser/Wasm route has a published compiler contract, artifact receipt, supported examples, and tests. The contract expressly narrows the supported language subset and records divergent or unsupported constructs. It is therefore the strongest public example in this paper series of an evidence-backed compiler target.

The other backend families remain part of the architectural target. Their implementation and parity must be assessed independently against exact commits and guest-level tests. This paper does not infer completion from repository existence, host tests, or design documents.

## Conclusion

Portable AOT requires a common semantic contract and disciplined evidence. Backend-specific code generation is expected; backend-specific language meaning is not. The path to portability is a shared fixture corpus, narrow runtime ABIs, reproducible artifacts, and honest reporting of what has actually executed on each target.

## References

- [Public browser compiler contract](../play/docs/COMPILER_CONTRACT.md)
- [Browser compiler artifact receipt](../play/public/atto_compiler.receipt.json)
- [Public playground examples](../play/examples/)
- [AttoLang organization](https://github.com/atto-lang)
