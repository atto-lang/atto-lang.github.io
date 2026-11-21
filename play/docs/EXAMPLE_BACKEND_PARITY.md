# Playground examples: Rust/Wasm admission and AttoLang backend parity audit

Status: **compatibility ledger, not a parity certification** (updated 2026-11-21).

The checked-in `play/example-backend-profile.json` accounts for every published
`.atto` example. `play/tests/example-backend-profile.test.mjs` makes a missing,
misclassified or accidentally published preview a test failure. The existing
`play/tests/compiler.test.mjs` is the separate **execution** gate for the nine
runnable examples; it compiles with the pinned `atto-source.rs` WebAssembly
compiler and executes generated guest Wasm where applicable.

## Which compiler is actually running?

- `public/atto_compiler.receipt.json` is the only authoritative identity for
  the shipped browser compiler. At this audit it names Rust source HEAD
  `71fcdf98877e9d78213f12ff3cb037846f7466b0`, compiler ABI 2, and guest
  ABI `atto.browser.guest.v2`. Tests re-read the receipt; this prose is
  historical, **not** a live source pin.
- The page compiles in a compiler Web Worker. A separate **tenant** Web Worker
  executes the emitted guest. For browser-v2 actors, each actor is a separate
  `WebAssembly.Instance` with private linear memory **inside the same tenant
  Worker**, not a separate Web Worker per actor.
- `atto-source.wasm` is an integration/backend repository, **not** a second
  interchangeable browser compiler. Its default branch only documents scope;
  draft branches contain additional verifiers and host integrations.
- Java/GraalVM, LLVM-native, Forge and .NET Oreslang backends are independent
  implementations. Acceptance by any one backend does not establish AttoLang
  semantic parity or browser support.

## Published browser sample tiers

| Tier | Examples | Proof/constraint |
| --- | --- | --- |
| Executable scalar/object | hello, fib, primes, conditions, classes | Pinned compiler + guest execution under `compiler.test.mjs` |
| Executable browser-v2 compatibility | actors, enums | Runtime uses v2 actor ABI; enum spelling tracks an LLVM design form not established in Java |
| Expected guest panic | overflow | Checked signed-i64 overflow, never a silent wrap |
| Expected compilation rejection | error | Immutable `val` reassignment must produce a diagnostic **and no guest artifact** |
| Executable language examples (regular **Examples** menu) | 33 of 132 `examples/preview/*.atto` source files (`expect: "exec"`) | Pinned compiler + guest execution with exact stdout/return oracle under `pinned-preview-admission.test.mjs`; source paths retained for byte-identical oracle; Format stays disabled |
| **Syntax-only previews** | The other 99 `examples/preview/*.atto` files | Compile and Execute report the compiler's positioned diagnostic and never produce an artifact; Format stays disabled |

The six focused type previews (`Dyn<T>`, `Box<T>`, `Arc<T>`, proposed
`Sends<T>`, `Atomic<T>`, and `Weak<T>`/`Pin<T>`) are **syntax-only**, with
explicit invalid examples. Their constructors, dynamic-dispatch representation,
sender-capability projections, refcount lifecycle and cross-tenant admission
have **no verified public browser/compiler contract**. In particular,
`Sends<T>` is a design candidate distinct from `Send`/`Sendable` bounds,
`Serializable`, and an actor declaration's `sends` clause. None is implicitly
promoted to the 33 executable preview samples.

Eight additional **diagnostic-only ownership tutorials** demonstrate the
target rules for `Borrow<T>` and named `lt!` lifetimes, exclusive `mut` loans,
suspension boundaries, `Sendable` versus `Serializable`, deep freezing,
`copy!!` graph cloning and scoped `RwLock<T>` guards. These are TEACHING
PROPOSALS: a pinned compiler diagnostic is expected, not evidence that a
runtime supports their syntax or semantics. The bare `Borrow<T>` lifetime
shorthand, generic bounds and any lock callback API must be ratified and
compiler-verified separately; no preview grants cross-tenant permissions.
They add no executable examples and modify no vendor compiler artifact.

The actor sample is deliberately marked **legacy compatibility**, because
direct `self.total` access is not the canonical sealed actor-state contract.
Do not infer shared state, RW-lock fairness, asynchronous cancellation, or
per-actor OS/Worker isolation from that example.

## Cross-backend semantics to preserve when implementing each preview

| Surface | Required shared semantics | Status boundary |
| --- | --- | --- |
| `int`, checked arithmetic | signed 64-bit; overflow is a classified panic, not wrapping | Browser executes; Java has a documented legacy overflow divergence |
| Boolean operations | Type-check `bool` and preserve evaluation order. Java recognizes `&&`, `||`, `^^`, and `and/or/xor`; LLVM documents missing executable Boolean lowering. Atto's current source policy **reserves `^^`**, so its spelling is disputed, not canonicalized by the site | Browser `And/Or/Xor` compatibility functions only |
| `pure` and lexical captures | Effect closure must be transitive; forbid ambient I/O, actor-state mutation, untrusted effects, and escaping mutable loans; local-only mutation may be legal | Draft Rust/Java proposals; preview until exact execution and release |
| `borrow!`, `copy!`, `take!`, `share!` | Use unary prefix syntax (`borrow! mut owner`), reject conflicting loans, use-after-take, escapes and suspension across unpinned loans; no C-style pointer `&`/`*` syntax | Rust draft [#139](https://github.com/atto-lang/atto-source.rs/pull/139), browser pin unchanged |
| `define state`, critical leases | Sealed access, multiple readers vs exclusive writer, no unsafe suspension/escaped references, guaranteed release and tenant ownership | Rust draft [#138](https://github.com/atto-lang/atto-source.rs/pull/138) proves only Worker-local synchronous class state; general shared-state runtime unproved |
| Traits and diamond inheritance | Require explicit override for ambiguous inherited members; reject conflicts and wrong signatures; avoid implicit C3 or first-parent resolution | Rust draft [#137](https://github.com/atto-lang/atto-source.rs/pull/137) with executed subset, still not public |
| `trap`, Option/Result, exceptions | Ordinary `throw` can become `None`; never swallow `raise`, `panic`, cancellation or fatal traps. Do not flatten `Option<Result<...>>`. Java's `trap fnc` callable modifier and Atto candidate's `trap expr` are **different surfaces** requiring a canonical spec decision | Restricted Rust candidate; public preview disabled |
| Actors, pipelines and supervisor CONTROL | Typed, bounded, ownership-safe mailboxes; distinct actor state; faithful escalation and cleanup; supervisor CONTROL must not be lost among ordinary messages | Browser-v2 actor subset only; higher-level pipeline/supervision previews stay gated |
| Generators, async, stdio, channels | Exhaustion and cancellation cleanup exactly once, no escaped borrowed state, bounded scheduling; blocking I/O must follow scheduler contract | Partial draft/native proofs, not public full parity |
| Modules, symbols, match and patterns | Nominal/structural type rules, deterministic exhaustive matching, import visibility, ownership and no invalid silent lowering | Feature-by-feature fixtures required before promotion |
| Collection and product literals | Dynamic Map keys (quoted `:`/`=>` or evaluated expression `=>`); static Record fields (`{field: value}` / `(field=value)`); distinct nominal Pair vs Entry; List/Array contextual type; empty `{}`/`[]` require known types; `Map.of_entries` takes Entry items only | Design-only previews; standalone Entry and dynamic Map guest execution unverified |

Reference contracts inspected:
[Java `PURE.md`](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/PURE.md),
[Java `TRAP.md`](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/TRAP.md),
[Java state-container substrate](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/main/docs/STATE_CONTAINER_VIRTUAL_ACTOR_SUBSTRATES.md),
[LLVM Boolean parity](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/blob/main/docs/BOOLEAN_LOGICAL_PARITY.md),
[LLVM borrow alias matrix](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/blob/main/docs/BORROW_ALIAS_MATRIX.md), and
[LLVM backend parity gates](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/blob/main/docs/BACKEND_PARITY_GATES.md).
These contain design targets and sometimes unexecuted or partial implementations;
they are not interchangeable with guest-runtime execution evidence.

## November 20 collection literal reconciliation (syntax only)

The Playground's **Collections: Map entries, Pair, Record, List** sample
(`play/examples/preview/collection-literal-shapes.atto`) and the related
`collections-inline-literals`, `struct-record-pair-entry`, `collection-factories`
and `collections` snippets now follow these candidate decisions:

- A quoted key in `{...}` denotes a **Map** item with either `:` or `=>`; an
  identifier `field:` is a static Record field; `(field=value)` produces the
  same Record shape. Mixed Record/Map items reject.
- `{ "5" => "foo", x => "bar" }` is a `Map<string,string>` when `x` is a
  `string`; `[x]` means a List/Array expression and is **not** a computed-key
  marker. Mutable collection Map keys require a proven stable Hash/Eq contract.
- Standalone `key => value` is an **Entry<K,V>**; `Pair.of` is a distinct nominal
  type. `Map.of_entries` accepts Entries rather than alternating key/value
  arguments or Pair values. The map/entry runtime remains a gated target.
- `[]` and `{}` require a contextual element type / concrete key and value
  types; a nonempty bracket literal defaults to List, while an expected Array
  type selects Array. Tuple is positional, Record is named, Struct is nominal.

These rules are being reconciled in draft Atto spec PRs
[#69](https://github.com/atto-lang/atto-spec/pull/69),
[#116](https://github.com/atto-lang/atto-spec/pull/116),
[#128](https://github.com/atto-lang/atto-spec/pull/128),
[#130](https://github.com/atto-lang/atto-spec/pull/130),
[#131](https://github.com/atto-lang/atto-spec/pull/131),
[#133](https://github.com/atto-lang/atto-spec/pull/133),
[#134](https://github.com/atto-lang/atto-spec/pull/134) and
[#136](https://github.com/atto-lang/atto-spec/pull/136).
They are **not** proof of general compiler, browser guest, formatter or
multi-backend support. `data-shapes.atto` retains its separate previously
verified bounded browser guest oracle and was not rewritten.

## Admission and rollout gate

1. Freeze the exact source blob of the **site example** and its canonical
   positive and negative mutation fixtures. If site and compiler live in
   different repositories, mirror source blobs by exact Git SHA, without
   cross-organization checkout or secrets.
2. Require both native Rust and wasm32 builds of the **same** compiler Git
   tree; assert byte-identical guest modules for the same source. A zero-step
   source-org Actions failure means **NOT EXECUTED**.
3. Execute the compiled guests, including error classification, stdout, actor
   traces, cleanup and ownership negatives. Assert rejected programs produce
   **no guest artifact**. Verify the actual browser Worker path in Chromium,
   including stop/termination and resource limits.
4. Where Ores Java, LLVM, Wasm, Forge or .NET implement the surface, execute
   the **same** source and compare behavior with a versioned contract; report
   absent backends as **UNSUPPORTED / NOT EXECUTED**, not success. Never infer
   parity from a parser accepting a declaration.
5. Before changing a preview into a runnable item, require independent review
   and binary-disclosure authorization, immutable compiler SHA-256 receipt,
   ABI-compatible host/runner upgrade, guarded site packaging, and live HTTPS
   release postflight. **Do not promote draft compiler binaries automatically.**

The inventory test enforces **site classification**; it does not certify these
cross-backend gates. Publish semantic parity only after executed, per-backend
receipts are linked to the actual commit and source/tree hash.

## November 19 reconciled preview catalog (design-only)

The 17 distinct added syntax previews, plus the previously existing channel-operator showcase, are **preview-only** and are **not**
compiled or executed as successful browser guests. They cover annotation overrides,
Result discard and guarded patterns, typed actor messages and once-only unary replies,
channel read/write operators, caret returns, omittable parameters, `susp` spelling,
timer APIs, symbols, defaulted generics, collection factories, binding mutability,
sealed/non-sealed classes, `typeof` exploration, foreign ABI/AOT boundaries,
error capability traits, and enum methods.

Structural List/Tuple **sequence-pattern matching is deliberately deferred** at
user request: no sequence-pattern preview is registered in this change. Ordinary
`List.of(...)` and `Tuple.of(...)` **construction** is a separate, included topic.

The semantics of `@Override`, error capability traits, `typeof!`, `sleep_blocking`,
HTTP reply handling, and `>>` write-side operands still require contract/review
alignment. Cross-backend compilation, AOT linkage and guest execution are
**NOT VERIFIED** by these syntax snippets. Related independently reviewed PRs
#149 (`@Override` on diamond-inheritance) and #143 (error effect capabilities)
remain separate; this preview expansion does not supersede or merge them.

The current main branch separately added verified language previews and systems/actor showcases. This merge preserves those sources, their dropdown labels and admission boundaries instead of overwriting them with a 42-preview-era catalog. The `channel-operators.atto` source remains the main-branch version (`c << 42` writes; `(c >>)` reads), rather than retaining the obsolete reversed operators. That example is listed only once across all manifests.

## Immutable collections gallery — proposal, not shipped compiler support

Six `preview/immutable-*.atto` examples are registered in the syntax-only picker:
`immutable-vector-const`, `immutable-vector-updates`, `immutable-vector-rebinding`,
`immutable-list`, `immutable-map-set`, and `immutable-collection-pipelines`.
They show target `const Vector<int>`, contextual `[]`, original-preserving
`appended` / `updated`, distinct `const`/`val`/`let` binding rights,
`List.prepended`, persistent `Map.updated` and `Set.inserted`, and
functional `map`/`filter`/`reduce` with explicit `|...|` lambda delimiters.

**All six remain `preview-only`:** the public `atto_compiler.wasm` is unchanged
and must reject them with a positioned diagnostic and no executable guest.
Narrow bounded scalar Vector browser/native guest evidence exists separately on
[atto-source.rs #491](https://github.com/atto-lang/atto-source.rs/pull/491)
and [#493](https://github.com/atto-lang/atto-source.rs/pull/493), but their
unmerged stacks do not establish a public compiler pin or general persistent
collections. [atto-spec #195](https://github.com/atto-lang/atto-spec/pull/195)
remains a proposed contract, with all seven normative fixtures `NOT_EXECUTED`.
No actor sharing, deep graph freeze, Map/Set runtime, arbitrary-size vector trie,
Java/LLVM/.NET/Forge parity, deployment, or live HTTPS support is claimed.
