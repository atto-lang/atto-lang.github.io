---
title: "Performance Engineering and Cross-Backend Conformance"
permalink: /whitepapers/10-performance-and-conformance.html
---

# Performance Engineering and Cross-Backend Conformance

**Technical Papers · Paper 10 · Version 0.1 · 8 November 2026**  
**Status:** Measurement and verification methodology. No benchmark result or full-backend parity claim is made by this paper.

## Abstract

Performance claims are meaningful only when the workload, environment, compiler revision, runtime, and measurement method are reproducible. Portability claims require a similarly disciplined approach: the same source-level contract must be tested on the actual target execution environment. This paper defines a measurement and conformance framework for AttoLang, with particular attention to avoiding false positives from host-only tests, zero-step CI jobs, stale receipts, and incomparable benchmark setups.

## 1. Separate correctness from performance

Correctness and performance are related but distinct. A faster implementation that changes overflow behavior, message ordering, cancellation semantics, or ownership safety is not a valid optimization.

The process should therefore have two gates:
1. A semantic gate verifies that the implementation is conformant for the tested feature set.
2. A performance gate measures the conformant implementation against a defined baseline.

Performance comparisons should not begin by assuming two backends implement identical semantics. First establish what behavior is being compared.

## 2. Define the workload

A benchmark must describe the workload well enough for another engineer to reproduce it. Include:
- Source fixture and generator version.
- Input distribution and dataset size.
- Warm-up policy and number of measured iterations.
- Concurrency level and actor/task topology.
- Memory limits and queue quotas.
- I/O mode and whether results include filesystem or network latency.
- Timeout and cancellation settings.
- Expected outputs and semantic assertions.

A microbenchmark may isolate one operation, but macrobenchmarks are needed to understand interactions among allocation, scheduling, messaging, and I/O.

## 3. Compilation metrics

Compilation performance should be reported separately from guest execution. Useful measurements include cold compile time, warm incremental compile time, parser throughput, semantic-analysis time, optimization time, code-generation time, link time, peak compiler memory, object size, executable size, and cache effectiveness.

Every result should identify the exact compiler source head and tree, toolchain version, target triple, build mode, optimization level, flags, and host hardware. Compilation caches must be controlled and disclosed.

A compiler running inside the browser as Wasm should be measured separately from a native compiler process. The host and guest boundaries affect both latency and resource use.

## 4. Runtime metrics

Runtime measurements should be selected according to the program's behavior. Examples include:
- Throughput and operations per second.
- Median, p95, p99, and maximum observed latency.
- Allocation rate and peak live memory.
- Reclaimed bytes and time-to-reclamation where reclamation exists.
- Task scheduling and wake-up latency.
- Context switches and carrier utilization.
- Mailbox admission and delivery latency.
- Queue depth and backpressure duration.
- Cancellation and shutdown latency.
- Failure recovery and restart time.

A zero-GC claim requires allocation and reclamation measurements that demonstrate the intended lifetime mechanism. A fixed heap that never reclaims objects is not evidence of deterministic reclamation.

## 5. Benchmark fairness across backends

A fair comparison must use equivalent program semantics and equivalent optimization goals. It should disclose whether a target uses JIT warm-up, profile-guided optimization, native-image compilation, runtime compilation, or interpreter execution.

The measurement should distinguish:
- Compiler startup.
- Build and link time.
- Runtime startup.
- Warm-up and steady-state execution.
- Host-runtime overhead.
- Guest computation.
- I/O and external service latency.

For managed runtimes, record GC configuration and pauses. For native targets, record allocator, thread, and OS settings. For Wasm, record runtime implementation, fuel or deadline policy, and host imports. Avoid comparing a warmed-up managed runtime to a cold native executable without explaining the difference.

## 6. Statistical reporting

Performance numbers vary. Report sample size, distribution, variance, and confidence intervals where appropriate. Use stable hardware, isolate noisy processes, repeat runs, and publish raw data where possible.

Avoid cherry-picking a best run. A result should include failed and outlier observations or explain the exclusion rule. Pin hardware model, kernel, runtime version, and compiler options when the numbers are intended for public comparison.

## 7. Conformance fixtures

A conformance fixture should be backend-neutral and self-describing. At minimum, record:
- Fixture identifier and version.
- Source text and feature tags.
- Expected acceptance or rejection.
- Expected diagnostic code and position where relevant.
- Expected stdout, return value, or panic.
- Resource limits and timeout.
- Determinism classification.
- Required capabilities.
- Known target-specific exclusions.

Positive fixtures test supported behavior. Negative fixtures ensure that unsupported or unsafe constructs are rejected. Boundary fixtures test limits immediately below, at, and above their thresholds.

## 8. Evidence classes

CI reports should classify evidence accurately:

| Class | What it proves |
|---|---|
| Runner admission | The runner was admitted; zero-step jobs prove no code execution. |
| Preflight | Environment and prerequisites were checked. |
| Host test | Host-side implementation code ran. |
| Source compilation | The compiler accepted or rejected a source fixture. |
| Guest execution | A compiled guest program executed in the target runtime. |
| Native linking | The target artifact linked successfully. |
| Differential test | Two or more implementations agreed on the tested observable result. |
| Backend conformance | A defined fixture set passed on the named backend. |
| Production validation | An operational deployment demonstrated the property. |

A successful workflow summary is not enough. Record exact head SHA, Git tree identity, workflow run ID, run attempt, job ID, executed step names and outcomes, toolchain, target, fixture set, and receipt digest.

## 9. Differential testing

Differential testing compares independent implementations using the same input corpus. It is especially useful for parser acceptance, diagnostics, arithmetic, evaluation order, overload resolution, ownership rejection, actor behavior, and runtime failure semantics.

The reference implementation must itself be versioned and its known divergences documented. A disagreement is a finding to investigate, not automatically evidence that the newer backend is wrong. Canonical specification rules decide the expected result.

Generated programs and fuzzed inputs can extend fixture coverage, but every minimized finding should become a permanent regression fixture.

## 10. Negative testing and fail-closed behavior

The suite should verify not only that valid source compiles, but also that invalid source cannot produce a usable artifact. Mutations should target token boundaries, nesting, type annotations, ownership operations, effects, imports, and backend capability declarations.

For guest runtimes, invalid imports, forged handles, out-of-bounds memory, quota exhaustion, infinite loops, and cancellation races should be tested under the target runtime's actual enforcement mechanism.

A test that rejects an invalid program at the host API does not prove the guest module cannot reach the same behavior through another entry point.

## 11. Receipts and artifact identity

A conformance receipt should bind the result to exact inputs: source revision, Git tree, compiler revision, runtime revision, ABI version, toolchain, target, fixture digest, configuration, and execution results. Binary artifacts should include cryptographic digests and size.

If the PR head changes, old receipts do not validate the new head unless the relevant source and configuration are proven identical by tree/blob comparison and the test design explicitly permits reuse. A job with \`steps=[]\` or \`steps=null\` should be classified as a runner-admission failure, not a test pass.

## 12. Publication requirements for performance claims

Every public chart should include the tested code revision, environment, workload, sample count, measurement method, and uncertainty. Avoid statements like "fastest" or "zero overhead" without a reproducible comparison and clearly defined scope.

Claims should be scoped to the exact feature and backend. For example, "this actor fixture sustains X messages per second on this runtime revision and machine" is more useful than an unsupported statement that AttoLang actors are faster than another platform.

## 13. Current status

This paper establishes a methodology, not benchmark results. The public playground contract and artifact receipt provide a concrete example of compiler provenance and a constrained guest execution contract. They do not establish performance parity or complete conformance across the planned Java/GraalVM, LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift targets.

## Conclusion

A performance claim is only as trustworthy as its workload and measurement. A portability claim is only as trustworthy as its exact-head guest evidence. AttoLang should make both reproducible: pin artifacts, run shared fixtures, classify evidence honestly, and publish raw methodology alongside summary results.

## References

- [Public compiler contract](../play/docs/COMPILER_CONTRACT.md)
- [Public compiler artifact receipt](../play/public/atto_compiler.receipt.json)
- [AttoLang platform conformance repository](https://github.com/atto-lang/atto-platform-conformance)
