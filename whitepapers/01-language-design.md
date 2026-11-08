---
title: "AttoLang: Language Design and Philosophy"
permalink: /whitepapers/01-language-design.html
---

# AttoLang: Language Design and Philosophy

**Technical Papers · Paper 01 · Version 0.1 · 8 November 2026**  
**Status:** Research and architecture paper; not a declaration that every described feature is implemented.

## Abstract

AttoLang is being designed as a general-purpose language for systems and application software whose semantics should remain understandable across different execution environments. Its architectural direction combines explicit control over mutation and effects, static type and ownership rules, structured concurrency, actors, and ahead-of-time (AOT) compilation. The ambition is to let one source language target native platforms, managed runtimes, and WebAssembly without silently changing program meaning.

This paper introduces the design principles behind that ambition. It explains the problems the language is intended to address, the role of explicitness, the distinction between language guarantees and runtime services, and the evidence required before a portability or safety claim can be made.

## 1. The problem space

Modern software is routinely split across environments: native processes, managed runtimes, browser workers, mobile devices, and distributed services. Developers often encounter different languages, memory models, concurrency abstractions, build systems, and operational assumptions at each boundary.

A language can reduce that fragmentation only if it defines more than a common syntax. It needs a stable semantic contract for values, ownership, effects, concurrency, failures, and resource lifetimes. A compiler backend must implement that contract rather than inventing a local interpretation.

AttoLang's design therefore focuses on a small number of system-wide questions:

- What does a declaration mean, and when can a value be mutated?
- Which operations can suspend, and which must remain synchronous?
- Who owns a value or resource, and when may it be reclaimed?
- What state may an actor access, and what may cross a message boundary?
- Which behavior is guaranteed by the language, and which depends on the host?
- How can independent backends be shown to implement the same semantics?

## 2. Design principles

### 2.1 Explicitness over hidden behavior

The language aims to make consequential behavior visible in source and type contracts. Mutation, suspension, ownership transfer, sharing, and resource acquisition should not be inferred from incidental runtime behavior.

Explicitness is not a goal of maximal verbosity. It is a way to make program behavior reviewable and compiler-checkable.

### 2.2 Immutable bindings by default

An immutable binding is the default model. Reassignment requires an explicit mutable binding, such as `let`, according to the relevant language contract. Binding mutability is distinct from mutability of the object or resource referred to by a binding.

This distinction matters for API design, concurrency, and reasoning about aliasing. A stable name does not by itself prove that the referent is immutable or exclusively owned.

### 2.3 No implicit semantic conversions

The design rejects implicit conversions that obscure data loss, representation changes, or backend-specific behavior. It also avoids operator overloading as a way to keep the meaning of built-in operators predictable. Unsupported operators and constructs should produce diagnostics rather than be silently reinterpreted.

### 2.4 Effects should be visible

Synchronous functions and potentially suspending functions are distinct. The current design uses `suspends` to declare that a function may suspend. A critical section must not itself suspend; a suspending operation may acquire a critical section only where the contract explicitly permits acquisition to wait before entering the non-suspending body.

This is intended to prevent code from accidentally holding a lock or actor turn while yielding execution.

### 2.5 Concurrency should have ownership boundaries

Tasks, threads, and actors are different abstractions. Structured concurrency gives tasks an explicit parent/child lifecycle; actors provide isolated state and message-oriented access; operating-system threads provide independently scheduled execution resources. Treating these as interchangeable creates subtle lifetime and synchronization errors.

### 2.6 Portability is a semantic obligation

A program compiling on several targets is not enough. The same accepted program should have consistent observable behavior, including errors, overflow, evaluation order, ownership effects, and concurrency rules. Backend differences must be deliberate, documented, and covered by conformance fixtures.

## 3. A compact source-language example

The following example illustrates a simple function and immutable local binding in the currently documented browser subset:

```atto
pub fnc main(): int {
  val answer = 6 * 7;
  stdio.println(answer);
  return answer;
}
```

The example is intentionally modest. It demonstrates a real subset, not the complete language. The browser compiler's supported grammar and rejected constructs are enumerated in the [public playground compiler contract](../play/docs/COMPILER_CONTRACT.md).

The language's broader design includes functions, routines, classes, actors, enums, records and other type forms. Their admission and exact semantics must be checked against the canonical specification and the relevant compiler/backend, not inferred from this example.

## 4. A language is a contract, not a feature checklist

A syntax form becomes a dependable language feature only when its rules are defined precisely. For example, documenting actors requires decisions about identity, message ownership, mailbox ordering, termination, failure, restart, resource limits, and the treatment of messages already in flight.

Likewise, documenting a type requires its representation, equality behavior, ownership behavior, serialization boundary, and ABI representation where applicable. These details are essential when multiple compiler backends are expected to agree.

AttoLang's public materials should distinguish at least four layers:

1. **Language semantics:** source-level rules that every conforming implementation must preserve.
2. **Compiler behavior:** parsing, type checking, diagnostics, lowering, and artifact generation.
3. **Runtime behavior:** scheduling, memory, actors, I/O, and host integration.
4. **Platform behavior:** operating-system, browser, VM, and deployment constraints.

A guarantee at one layer does not automatically establish a guarantee at another.

## 5. Intended users and use cases

The design is relevant to systems programmers who need explicit resource control, application developers who want structured concurrency, and platform engineers who need one programming model across heterogeneous deployment targets.

Potential applications include native services, command-line tools, actor-based services, browser applications, embedded language runtimes, and distributed systems. These are intended use cases, not a claim that every target or library is production-ready today.

## 6. Relationship to other language families

AttoLang draws on established ideas rather than treating any one existing language as a template. Rust demonstrates the value of static ownership and explicit borrowing. ML-family languages demonstrate expressive algebraic data types and type-driven design. Erlang and Orleans demonstrate actor-oriented service architectures and supervision concepts. Go, Kotlin, and other languages demonstrate practical structured or coroutine-based concurrency. C, C++, and LLVM-based toolchains demonstrate the importance of explicit ABI and native compilation boundaries.

The relevant comparison is not a feature-count contest. It is whether a coherent semantic model can combine useful parts of these traditions without inheriting their hidden assumptions or creating inconsistent behavior across targets.

## 7. Non-goals and trade-offs

AttoLang should not promise that every program can be compiled to every backend, that all dynamic behavior can be statically resolved, or that a language-level actor is automatically an operating-system security boundary.

AOT compilation constrains runtime dynamism. Static ownership constrains aliasing and value movement. Explicit effects constrain where suspension may occur. Actor isolation constrains what state and behavior can cross messages. These constraints are deliberate trade-offs: they make resource behavior more inspectable, but can require more explicit program structure.

## 8. Implementation status and evidence

The public browser playground is a real compiler path, but it intentionally implements only a documented subset. Its contract describes the accepted syntax, ABI, guest imports, execution limits, and actor-host behavior. It explicitly lists unsupported constructs and backend divergences. See the [compiler contract](../play/docs/COMPILER_CONTRACT.md) and the [public playground source](https://github.com/atto-lang/atto-lang.github.io/tree/main/play).

This paper describes design principles. It does not certify full-language implementation, native AOT support, zero-GC execution, or cross-backend parity.

## 9. Open questions

The evolving specification must continue to settle representation and equality rules, generic and macro boundaries, effect checking, exception and cancellation cleanup, ownership across FFI, and the exact guarantees expected from each backend. Every resolved decision should have a normative specification section and positive and negative conformance fixtures.

## Conclusion

AttoLang's central proposition is that portability should be built on explicit semantics. Syntax can be shared cheaply; reliable behavior cannot. The language must make important effects visible, define ownership and concurrency boundaries, and require evidence from each implementation that claims conformance.

## References

- [AttoLang public playground compiler contract](../play/docs/COMPILER_CONTRACT.md)
- [AttoLang organization](https://github.com/atto-lang)
- [AttoLang public website repository](https://github.com/atto-lang/atto-lang.github.io)

---

*Version note: this paper is a versioned design overview. For implementation claims, consult the linked contract, exact source revision, executable fixtures, and CI receipts.*
