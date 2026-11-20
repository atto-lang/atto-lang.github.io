# Playground compiler contract (v2)

The playground ships `public/atto_compiler.wasm`. It is built from [atto-lang/atto-source.rs](https://github.com/atto-lang/atto-source.rs) at the commit named in `public/atto_compiler.receipt.json`. It is a real AttoLang-to-WebAssembly compiler that itself runs as WebAssembly:

- No server compiles user source.
- No JavaScript evaluates user source.
- No LLVM runs in the page.

## Compiler identity and execution target

The browser downloads the `atto-lang/atto-source.rs` **Rust** compiler built
for `wasm32-unknown-unknown`. `compiler-worker.js` runs this compiler *inside*
a browser Web Worker using the browser's native `WebAssembly` API, producing
a second Wasm module. `runner-worker.js` executes that **guest** module in
another disposable browser Worker. This is not Wasmtime: Wasmtime is a
separate, native Rust embedding runtime used experimentally in
`oreslang-source.wasm/aot-host` outside browsers.

Other repositories have different roles: `oreslang-source.wasm` is currently
an external native LLVM-to-Clang Wasm compilation bridge with Node Worker
and native Wasmtime host prototypes; `oreslang-source.rs` is an independent
Rust/Cranelift native object compiler (no Wasmtime dependency or browser
Wasm32 target); `oreslang-source.js` transpiles subsets to JavaScript/ESM
with trusted browser/Node Worker references. None is the vendored Pages
compiler.

The currently checked-in and published receipt explicitly identifies guest
ABI `atto.browser.guest.v2` and compiler ABI 2, built from `atto-source.rs` main
`71fcdf98877e9d78213f12ff3cb037846f7466b0` (tree
`596fa66e64d357acdbbaa72e0e55fca0b00997e8`, rustc 1.85.1). The build is
reproducible: rebuilding the previous pin `865c835c` with the same command
reproduces its published digest `b7c5e86d…` byte for byte.

**Executable language examples (23 of 43 language previews).** The pinned compiler compiles
and the tenant Worker executes these examples, each with an exact stdout and
return oracle in `example-backend-profile.json` that
`tests/pinned-preview-admission.test.mjs` executes: boolean-operators,
borrow-checking, callable-body-styles, closures-functors, data-shapes,
defer-recover, diamond-inheritance, fib-match, function-pipeline, generators, guard,
lambdas, lexical-scope-pure, match-types-is, match-values, modules, result-option,
result-option-end, routine, state-containers, traits-interfaces, trap and
visibility-modifiers. The oracle equals atto-source.rs's independent
`tests/playground-preview-audit.mjs` oracle for all 22. `state-containers`
uses the Worker-local state lease ABI v1 (`src/state-runtime.js`, granted to
the tenant's main instance only, never to actor instances).

These 22 verified programs are now presented under the regular **Examples** picker
section, not under a preview-only section. Their checked-in source files keep
`examples/preview/` paths to preserve the exact compiler/source oracle and
release allowlist during this UI graduation. Compile and Execute work; Format
and Check format remain disabled until the pinned formatter can parse them.
This is browser-executable subset support, **not** a claim of Java/LLVM/.NET
or full-language parity. The other 20 remain explicitly syntax-only previews. The broad
`lambdas` design source is retained as `lambdas-advanced.atto`; the executable
`lambdas.atto` covers only bounded nonescaping direct-call lambdas.
Higher-order arguments, returned closures and wildcard lambdas still reject.

The other 20 previews (suspends/task/await, channels, actor state and
pipelines, supervisors, effects, general lambdas, ownership
containers, namespaces/imports, rx, NIO, mutexes, use/using/with) are still
rejected with positioned diagnostics and no artifact. As of 2026-11-16 the
Java reference executes 7 of the 42 previews as written and the LLVM backend
admits none, so these remaining previews have no backend to match yet.

This pin does not support general actor-to-actor source messages or resumable
suspensions. A future v3 compiler/runner upgrade must be tested
and approved independently; changing a receipt label or copying an
unapproved private binary never establishes compatibility or authorizes release.

**Release boundary:** A candidate compiler is not a public release. Require a reviewed compiler+runner release, approved digest, Chromium guest execution, protected publication and live HTTPS postflight before changing pinned compiler bytes on the public site.

Current v2 topology: **one browser Worker per tenant run, multiple
private `WebAssembly.Instance` objects per Worker (one per actor)**,
each with its own Wasm32 linear memory and actor-private globals. Compiler-
managed bounded suspended stacks/continuations are **future** work. A single instance with
several arenas provides logical ownership but not a separate memory
isolation boundary. Browser engine call stacks are not independently
bounded per actor; a synchronous runaway actor can force the parent
to terminate its entire tenant Worker, including its healthy actors.
Browser Workers alone are not OS sandboxes for mutually hostile tenants.

**Language drift:** current AttoLang policy reserves `%`, `^`, and `^^`,
while some Boolean-operator candidate branches propose `^^` as XOR. Resolve
the syntax conflict through the shared specification and executed negative
source→no-artifact tests. Do not infer an artifact's operator behavior from
stale prose or advertise cross-backend parity before it is verified.

## Integrity

`scripts/vendor-compiler.sh` writes the compiler's SHA-256 and size to both the receipt and `src/compiler-pin.js`. The compiler worker fetches `atto_compiler.wasm?sha256=<prefix>`, so a cached copy from an older deploy is never reused. It then hashes the bytes and refuses to run a compiler that does not match the pin. The tests check the pin against the receipt and confirm that a one-bit change is rejected.

A WebAssembly engine trap inside the compiler instance would leave its state undefined. `createCompiler` therefore refuses further calls on an instance that trapped, and the page uses a fresh compiler worker for every run anyway. The compiler's resource limits are listed in atto-source.rs `README.md` under "Resource limits". Each limit is a diagnostic, never a trap.

## Canonical trap-to-Result migration (not yet published)

The normative [trap-to-Result contract](https://github.com/atto-lang/atto-spec/blob/main/language/trap-result-v1.md) supersedes the earlier `trap`-to-`Option` experiments. A normal `T` produces `Result<T, Error>`; an existing `Result<T,E>` remains one `Result<T,E'>` with checked error joining; `Option<T>` produces `Result<Option<T>, Error>`. Caught ordinary `throw Error` becomes `Err(Error)`, not `None`. `raise`, `panic`, cancellation, and fatal host conditions bypass `trap`.

**Publication boundary:** The publicly pinned browser compiler currently executes the older Option-returning `examples/preview/trap.atto` source, backed by an executable oracle. That pinned behavior is historically accurate but **does not conform** to the new language contract. The separate `examples/preview/trap-result.atto` file is a **syntax-only proposal** and must not be marked executable until the compiler, runner, conformance suite, Wasm guest tests, and public release admission are approved together. Historical candidate receipts and published hashes are evidence of older behavior, never proof of the new Result contract. Do not alter pinned compiler bytes or silently run a compiler that lowers the obsolete contract.

## Language subset

The compiler adds no syntax of its own:

- **Syntax** follows the reference compiler (`oreslang-source.java` `docs/grammar.ebnf` / `Parser.java`).
- **`int`** follows the LLVM backend and spec chapter 17: signed 64-bit with checked arithmetic, where overflow is a panic.

| Area | Admitted |
| --- | --- |
| Declarations | `[pub] fnc` / `routine`, `: T` or `-> T`, brace body; parameters `int a`, `int mut a`; arity overloads |
| Entry point | zero-argument `main` returning `int` or `void` |
| Types | `int`, `bool` / `boolean`, `void` |
| Bindings | `val` / `const` (immutable), `let` (reassignable); `name: T`, `T name` or inferred |
| Control flow | `if … then … elif … else … fi`, brace form closed by `fi`, `while … do … done`, `loop { }`, `for (let i = 0; i < n; i++)`, `break`, `continue` |
| Expressions | `+ - *`, `< <= > >=`, `eq neq == !=`, `!`, ternary, `,` / `\|` in conditions (both sides are evaluated), `And` / `Or` / `Xor` |
| Output | `stdio.print` / `stdio.println` of `int`, `bool`, string literals and objects |
| Classes | `[pub] define class Name as … end`: fields, one `constructor`, private-by-default methods, `pub static fnc` called as `Name.f()`, `new Name(…)`, moves |
| Actors | `define actor Name as … end`: `let` state, `receive(ActorMail<int\|bool> mail): void`, `spawn Name()`, `ref.send(v)` |
| Enums | `define enum Name as A B end` (the oreslang-source.llvm v1 design spelling; Java does not parse it yet) |

The full rules are in atto-source.rs `README.md`. Each one was checked against the Java reference compiler.

### Canonical lambda syntax — design target, not a playground feature

The canonical AttoLang lambda spelling is **`|x| -> expression`**, including typed forms such as `|int x| -> x + 1` and functional-pipeline callbacks such as `users |> filter(|user| -> user.active)`. Elixir-style `& &1` captures and implicit numbered placeholders are **not** canonical AttoLang lambdas.

This is a **language-design target** under [specification draft PR #70](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/70), with positive/negative [conformance fixtures in draft PR #745](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/745). The **currently pinned browser compiler rejects lambdas**. Neither these examples nor formatter-only tests imply that any compiler has emitted a working strict-AOT closure; do not add them to runnable playground presets or claim Java/LLVM/WASM/Forge/.NET parity without independently executed guest evidence.

## Deferred cleanup and recovery preview (executable)

The `preview/defer-recover` sample illustrates the proposed AttoLang unwind
contract. Since pin `71fcdf98` (atto-source.rs PR #231) the public compiler
executes it: the guest uses Wasm exception-handling tags, imports only
`print_str`/`print_newline`, passes runner memory admission, and returns 63 after
printing the eight cleanup/recovery lines recorded in its oracle. **Format** and
**Check format** remain disabled.

The proposed semantics deliberately separate three channels: `throw Error`
is offered to ordinary typed `catch` clauses along the dynamic caller chain
and may reach an eligible `recover` callback only after escaping matching
catches; `raise Error` skips ordinary `catch` and caller-side `trap` and
goes to a registered `recover` callback after cleanup; `panic` and
cancellation are never locally recoverable and must reach the supervisor or
terminal owner. A `defer` registers LIFO exactly-once cleanup and does not
execute until scope exit/unwind. Recovery callbacks must either return the
failed invocation's typed value or explicitly delegate with a one-shot
`c.next()` cursor; they never resume the failing statement. Normal success
runs defers, not recover callbacks.

Execution of this one preview is not a claim of complete unwind semantics
(cancellation, cross-actor supervision) or of Java/LLVM parity.

See [the versioned exception unwind contract](https://github.com/atto-lang/atto-spec/pull/23)
and the source-only regression checks. Future admission requires executed
guest Wasm tests for normal returns, escaped throws, explicit raises,
LIFO cleanup, nested catch precedence, callback LIFO/cursor single-use,
panic/cancel bypass, failure suppression and actor ownership.

## Boolean expression language example (browser-executable subset)

The `preview/boolean-operators.atto` source compiles and executes with the
pinned Rust/Wasm compiler and has an exact 12-line stdout oracle. This bounded
fixture exercises short-circuiting `&&` and `||`, the browser-v2 compatibility
functions `And`, `Or`, `Xor`, their tested variadic forms and array-argument
forms. **`^^` remains reserved**, and the uppercase infix word forms appear
only as commented-out design examples; they are not compiler support claims.
General operator typing, other backends and effects need their own conformance
fixtures. Unsupported source must still produce a positioned `E_*` diagnostic
without an executable artifact; the runner must never substitute another guest.

## Generator language example (bounded browser-executable subset)

The executable language showcase includes a compiled and executed generator with explicit declarations:

```atto
fnc *gen count_to(int limit): Generator<int> {
  for (let i = 1; i <= limit; i++) do
    yield i;
  done
}

fnc *gen count_with_zero(int limit): Generator<int> {
  yield 0;
  yield* count_to(limit);
}
```

The `*gen` marker declares generator semantics, and `Generator<int>` is the yielded-item type. `yield value;` emits one item, while **`yield* source;`** lazily delegates to every element of another generator or compatible iterable without yielding the iterable object itself. The example emits `0, 1, 2, 3, 4`, hence the sum `10`. `yield*` is a single contiguous spelling; `yield *source` is **not** delegation.

Proposed semantic invariants for compiler/backend conformance:
- `yield*` is legal only inside a `*gen` function; both forms of yield in ordinary functions must be rejected.
- The delegated expression must implement the compatible iterator contract, and its element type must be assignable to the enclosing `Generator<T>` item type. Delegating scalars or incompatible item types is a compile-time error.
- Delegation is lazy, uses the existing iterator, and neither materializes a collection nor yields the iterator object.
- Exhaustion resumes the outer generator after the `yield*` statement; nested delegation follows the same rule.
- On early exit, cancellation, error or panic, delegated iterator cleanup must occur exactly once, with no double close or leaked actor resources. Errors and cancellation propagate rather than being silently swallowed.
- The synchronous `yield*` form must reject asynchronous iteration; a separate async-generator design is required.

The pinned Rust/Wasm compiler **does** compile and execute the bounded
`generators.atto` fixture, including `yield*`, and returns 10 with stdout
`10\\n`. The browser formatter still does not support its syntax, so Format
and Check format stay disabled. Lazy exhaustion, early close, cancellation
and other backends remain distinct conformance obligations; the executable
fixture does not establish those broader properties.

## Compile/Execute preview controls and release boundary

All 22 verified language examples and the remaining 20 syntax-only
language previews have visible **Compile** and **Execute** buttons. Compile uses a disposable Rust/Wasm compiler worker and never
executes a guest; on success it enables the Wasm inspector/download. Execute
compiles the **current editor contents** and runs the generated Wasm only on
success. Both enforce the worker deadline and clear stale artifacts on every
source change. A structured `E_*` diagnostic and disabled artifact download
mean that this source **does not compile** with the published compiler.

These controls make a syntax-only preview testable, **not automatically runnable**.
They never substitute an example output, rewrite unsupported source into a
trivial program, fall back to a remote compilation service, or promote an
unapproved private compiler binary. Each preview needs exact-source native
and wasm32 Rust compiler parity, actual guest execution, and a reviewed
release receipt before being classified as supported.

## Compiler ABI v2

The compiler has no imports and memory capped at 64 MiB. It exports:

- `abi_version()`, which returns 2
- `memory`, `input_ptr()` and `input_capacity()` (64 KiB of UTF-8)
- `compile(length)`, which returns 0 on success
- `result_ptr()` and `result_length()`, which are 0 after an error
- `error_ptr()`, a NUL-terminated `E_CODE: message`
- `error_line_number()` and `error_column_number()`

`src/compiler.js` checks the ABI version and output bounds. It copies the result out before the next compile.

### Versioned actor ABI handshake (v3 is not executable)

The pinned compiler still emits `atto.browser.guest.v2`. Legacy guest Wasm without the custom section `atto.actor.abi` and explicitly tagged `02 00` guests stay on the synchronous v2 runtime. A compiled module marked exactly `03 00` is recognized as **proposed v3** and rejected with `E_GUEST_ABI_UNSUPPORTED` before a guest instance is instantiated. Duplicate, truncated, trailing-byte, and unknown-version markers fail closed with `E_GUEST_ABI`. Browser, disposable Node workers, persistent Node sessions, and legacy actor worker entrypoints must all enforce this boundary.

This is version negotiation and safety hardening, **not** an implementation of resumable actor execution, compiler-lowered suspension, owned continuation frames, or instruction budgets. The draft `atto-platform-conformance` ABI v3 contract must pass real compiled-Atto execution tests before v3 can be enabled.

## Guest contract `atto.browser.guest.v2`

- **Exports:** `main: () -> i64` and `panic_code: mut i32` (1 = integer overflow, 2 = division by zero, which is reserved, 3 = object heap exhausted). `memory` is exported only for string literals or classes, and with classes it is a fixed 1 MiB. Programs with actors also export `actor_init` and `actor_receive`, and carry an `atto.actors` custom section of type names.
- **Imports:** only from module `atto`: `print_i64`, `print_bool`, `print_str` and `print_newline`, plus `actor_spawn` and `actor_send` for programs with actors. `src/guest.js` refuses any other import, validates the actor table, and caps stdout at 64 KiB.

### TenantVM: one worker per tenant, multiple actors per worker (v2 subset)

`src/runner-worker.js` is the tenant's *single* execution Web Worker for each playground run. When a guest has actors, `src/actor-host.js` grants `actor_spawn` and `actor_send`:

- Each `spawn` creates an actor record inside the tenant worker. After `main` completes, the tenant scheduler creates a **distinct `WebAssembly.Instance`** for every actor, using the same verified `WebAssembly.Module` and **private globals and mailbox**. Declared Wasm memories are independently instantiated, never shared across actors. The currently pinned compiler may omit memory for scalar-only actor modules. It does **not** launch additional actor workers.
- Mailboxes use monotonically increasing sequence numbers starting at 0. The worker processes one message per actor per round-robin pass, yielding to the event loop every 32 messages. Same-tenant actors share a worker thread, **not their mutable Wasm memory**; actor method execution remains single-threaded/cooperative for this guest ABI.
- Limits: 16 actors per tenant run, at most 10,000 outstanding messages per actor (`E_ACTOR_LIMIT`, `E_MAILBOX_FULL`). Only `main` may spawn/send from guest v2; the trusted Node session host can admit follow-up messages after `main` returns. This is **not yet** fully general actor-to-actor messaging, async/supervision or persistent multi-program tenant scheduling.
- The run completes when `main` returns and all queued actor mail is drained. Output from `main` precedes actor output; actor mail is handled in fair round-robin order.
- A trapping or panicking actor is terminated locally: its subsequent mail is discarded and rejected in persistent sessions, while healthy siblings continue draining. The tenant run reports the first fault (`E_PANIC: … in actor Name#n`) after healthy mail completes. The parent terminates the **entire tenant worker** on Stop or deadline, including a non-cooperative Wasm loop.
- `play/node/tenant-vm.mjs` exposes `runTenantWasm({tenantId, wasm, timeoutMs})`, creating a single Node.js `worker_threads` V8 isolate for that tenant invocation. It runs the **same guest module, tenant scheduler and import allowlist** through `play/node/tenant-worker.mjs`. Separate calls use separate workers; this is not a durable tenant registry.

### Experimental actor-pipe v3 host ABI (not yet emitted by the Atto compiler)

The host contains an **opt-in experimental** actor-forwarding path for future Wasm32 guest modules. It is not part of `atto.browser.guest.v2`, is not generated by the pinned Rust compiler, does not make dropdown previews executable, and is **not** source-compiled Atto parity. Only a module containing exactly one `atto.pipeline.v1` custom section with one payload byte `01` may request the additional `atto.actor_link(i32 source_ref, i32 target_ref)` and `atto.actor_emit(i64 value)` imports. Without that exact marker, either import is rejected. The marker is a version declaration, not proof of compiler provenance or type correctness.

- `actor_link` is available to **main only** before mailbox draining. Actor references are tenant-local and validated; each actor has at most one incoming and one outgoing link. Self-links, duplicate/conflicting links, cycles, invalid targets, and topology changes after draining starts are rejected.
- `actor_emit` is available only to the **currently executing actor receive turn**, through a closure bound to its private Wasm instance; a guest cannot specify the source ActorRef. Calls from main, initialization, another actor, or outside the current turn fail. Only signed i64 mail is available in this host ABI; emitted language-level type compatibility still needs authenticated compiler/guest metadata.
- Emissions are staged in a per-turn host buffer and admitted atomically to the downstream FIFO mailbox **only after** the Wasm receive handler returns successfully and its memory budget is checked. Traps, dead destinations, full mailboxes, invalid values, or exceeded budgets discard the uncommitted turn and fault the source actor rather than silently losing accepted messages. On terminal fault, all undeliverable queued mail for that actor is released immediately (even while healthy siblings continue), without reusing its strictly monotonic sequence watermark. This is **fail-fast admission**, not suspension-based backpressure.
- Each actor remains a separate Wasm instance with private memory and mailbox in one tenant worker. Independent pipelines have no global output order. Priority supervisor CONTROL, cancellation, typed emission metadata, generation-fenced pipeline handles and zero-copy sharing require separately specified contracts.

The tests use independently assembled real WebAssembly modules to exercise this ABI and independent Wasm instances. They are **host ABI tests, not `.atto` guest compiler tests**. The Rust compiler still needs to lower the pipeline AST, typed `emit`, `actor_link`, and version marker to genuine source-compiled Wasm and pass exact-head browser tests before the preview can become runnable.

### Unpublished native Atto-to-Wasm v3 pipeline compiler candidate

Source-compiled actor pipes have now passed **private exact-tree verification** at `atto-lang/atto-source.rs` PR #79, source head `7845b01cf66c28d710ab764b8f18c53b0a62321e`, tree `448cbacee5628b62823d730eb3d097f2bf8bb5ee`. The temporary private carrier PR #25 in `zed-pkg-test/oreslang-private-pr-validation-20261012` mirrored all 275 Git blobs with per-blob SHA verification and achieved identical source tree SHA. CI run `43520562756` passed Rust native, wasm32 compilation, 280 conformance checks, 244 native/wasm byte comparisons and Chromium E2E.

The compiler candidate SHA-256, size and source/carrier provenance are recorded in `play/release-candidates/2026-11-13-actor-pipeline-v3-rust-wasm.json`. The independently built compiler artifact remains private and **is not the pinned browser compiler**. With a locally downloaded, verified `atto_compiler.wasm`, run:

```sh
cd play
npm run verify:actor-pipe-candidate -- /path/to/atto_compiler.wasm
```

This applies the same pre-compilation `admitWasm32Memory` quotas and memory-import rejection as the production worker (including the 1 MiB guest binary cap), then uses the actual production `actor-host.js` / `guest.js` to compile and execute real `.atto` source: two independent Parse → Validate → Sink chains should print 42 twice, while int-to-bool emission should print true. It also refuses malformed output-to-input links and top-level emit. A read-only production-main Pages-artifact probe at `049caee49caea0c0de6a7ad255f75b2261b0f40e` passed those same scenarios with six and three private actor instances respectively.

None of this authorizes public compiler disclosure or production rollout. The candidate has `public_disclosure_approved: false`. Source PR review, explicit digest approval, approved release workflow, full browser smoke, deployment receipt, and live HTTPS postflight remain mandatory. Java/GraalVM, LLVM, .NET, and Forge actor-pipeline runtime parity is independent work.

### Persistent Node TenantVM sessions (host API, guest v2)

`play/node/tenant-session.mjs` exposes `createTenantSession({ tenantId, timeoutMs })` and `createTenantRegistry({ maxTenants, timeoutMs })`. A tenant's single Node `worker_threads` worker lives until explicit `close()`, a guest failure, or a command deadline. The worker compiles the guest exactly once, invokes `main()`, instantiates and initializes its actors once, drains initial mail, and retains those actor Wasm instances for subsequent host-admitted messages.

```js
import { createTenantRegistry } from './node/tenant-session.mjs';
const tenants = createTenantRegistry({ maxTenants: 8, timeoutMs: 3000 });
const tenant = tenants.open('customer-42');
try {
  const start = await tenant.start(verifiedGuestWasm); // Uint8Array
  if (!start.ok) throw new Error(start.message);
  const actor = start.actorHandles[0]; // tenant-scoped opaque host handle
  const reply = await tenant.send(actor, 5n); // signed i64; actor state persists
  if (!reply.ok) throw new Error(reply.message);
} finally {
  await tenants.close('customer-42');
}
```

The API uses a `WeakMap` of actual host handle objects: guessed handles, handles from another tenant, and handles from an older generation are rejected even if their numeric actor index matches. The worker enforces FIFO sequence numbers and bounded pending mail while preserving each actor's private Wasm instance. Only one host RPC may be in flight per session. Execution deadlines terminate the entire tenant worker, so an infinite-loop actor cannot continue running after timeout.

This is **one guest module per session**, not durable multi-program loading; the guest v2 ABI does not yet support actor-origin sends, dynamic post-main spawn, recoverable supervisor control, true stack suspension, or zero-copy transfer across tenant boundaries. Host-local object identity is not an authentication boundary for remotely supplied tenant messages; production routing must authenticate requests before exposing a session. These Node V8 workers are not OS sandboxes for arbitrary untrusted JavaScript.


Before guest execution, `src/wasm-memory-admission.js` inspects the actual binary and rejects memory64, shared or unbounded memory, multi-memory, and Wasm32 memory declarations above **16 pages (1 MiB)**. `src/actor-host.js` also checks exported actor memory immediately after initialization and each completed receive; the latter is post-call accounting, not instruction-level isolation. Scalar-only ABI v2 modules can have no linear memory. Runtime-configurable actor heaps and stack budgets require the future guest ABI, rather than silently raising this quota.

Each guest run uses a fresh worker with a 3-second deadline; compilation has its own 10-second deadline. Neither a browser worker nor Node `worker_threads` is an OS-level security sandbox for hostile tenants. Node workers have access to host process APIs; browser worker internals are browser-dependent rather than a portable V8-isolate guarantee. The host must not grant tenant code arbitrary JavaScript evaluation, filesystem, unrestricted network or raw cross-tenant references. Production untrusted tenants require a stronger external process/sandbox boundary. Cross-tenant actor messaging, generation-fenced ActorRef routing, capability revocation, actor-owned arenas with bounded stacks, and priority supervisor control are tracked as future guest-runtime contracts, not implied by this v2 subset.

## Verified compiler candidate — pending independent binary disclosure

*Historical:* when this section was written the shipped compiler was pinned
to `865c835c7f343a2bb00b5b73a6010825f57be794`; it is now `71fcdf98`, which
includes these features.
The separately tested Atto Rust compiler candidate combines functional `|>`,
executable `Option<int>`/`Result<int,string>`, a nested
`Option<Result<int,string>>` subset, and typed postfix `?`
propagation. Source commit `f38c75126b6cbb9c88d8dfa7af40ee4468a1dc06`,
exact Git tree `ae6e13dddb5aac9428bf779bdc1960370408539b`.
The private carrier run [43480008534](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/43480008534)
executed 5 Rust tests, 259 conformance cases (223 native-vs-Wasm comparisons),
real Wasm compiler and guest builds and Chromium compiler/worker tests.

The reviewed *candidate* receipt is in
`release-candidates/2026-11-13-rust-wasm.json`.
Its SHA-256 is `d972139661920b4dbcb9c51a18bf48705f539727b1468929d618a27998ef6971`,
size 324278 bytes. The candidate was built by the alternate private carrier
using an exact-blob tree mirror, not directly by the source-org runner, whose
Actions job could not be admitted. Optional Java differential checks were
not run. A release reviewer must verify source/tree/artifact provenance and
public binary disclosure eligibility independently.

To reproduce the candidate-only checks locally without modifying the
public asset:

```sh
# Extract the reviewed workflow artifact to a local private directory first.
npm --prefix play run verify:candidate -- /path/to/atto_compiler.wasm
```

The check rejects digest/size/ABI/import mismatches and executes the real
Result/Option and function-pipeline preview files, `?` early-return
paths, and an explicitly rejected `trap` example against the actual
candidate compiler and generated Wasm guests. It does **not** change
`public/atto_compiler.wasm`, `src/compiler-pin.js`, or labels in the
dropdown. The public release remains subject to the
`approved-playground-pages.yml` workflow's administrative
`ATTO_PUBLIC_COMPILER_SHA256` approval, explicit affirmative
`workflow_dispatch`, exact source/test proof and Pages governance checks.
A candidate manifest, green PR CI, or normal merge **does not deploy**
or authorize disclosure of this compiler binary.

### Node tenant termination and registry fencing

The disposable Node `runTenantWasm` host does not report a completed execution, timeout or transport failure until its `worker_threads` termination receipt resolves. If worker termination cannot be verified, it rejects with `E_TENANT_TERMINATION` rather than treating a live worker as safely stopped. The persistent `createTenantSession` host uses the same termination barrier for shutdown, fatal RPC errors and deadlines. `createTenantRegistry.close` and `closeAll` keep tenant IDs reserved until termination is confirmed, reject opens while a bulk close is in progress, and preserve IDs on unverified termination. These controls fence process-local tenant identity reuse; they do not confer an OS-level hostile-code sandbox.

### Historical Option-returning ordinary-throw/typed-trap compiler candidate (not conformant; not published)

The subsequent Rust compiler candidate is at source commit
`7de13bb4e909ad7a7d0fdfff4687a3925d7698f7`, exact source Git tree
`fe821c368702312f0d741df6a8d04ddd6adfc7ab`. The private
[token-free exact-tree build](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/43490405946)
executed 13 Rust tests, 278 conformance cases, 242 native/Wasm comparisons,
and Chromium with real ordinary Error unwinding and caller-side `trap`.
Generator frontend admission and `yield*` syntax is NOT generator execution:
the compiler must still reject generator continuations in this release.

The generated compiler candidate is 337446 bytes with SHA-256
`12219b1dd7aed9f51611d20df6dd39994af8832dee9e96bc1b89f17607224a1e`,
ABI v2, no compiler imports. Metadata-only receipt:
`release-candidates/2026-11-13-rust-wasm-trap.json`.
To verify the *actual* candidate bytes against the existing Result/Option and
`|>` previews, the exact `trap` preview (including `Some(Err)`), ordinary
`throw Error(...)` -> `None` **under obsolete candidate semantics, not the current language contract**, `?`, and checked-panic bypass:

```sh
node play/tools/verify-compiler-candidate.mjs \
  /private/path/atto_compiler.wasm \
  2026-11-13-rust-wasm-trap.json
```

The previous candidate retains its own manifest and default verifier mode,
so it cannot be accidentally tested as the new compiler. The command does
**not** edit `public/atto_compiler.wasm`, `src/compiler-pin.js`, or mark
previews executable. Neither a private carrier build nor this metadata-only
PR authorizes public release. Governance requires independent artifact
review, an approved public compiler SHA, explicit protected-main
`workflow_dispatch`, and independent deployment-environment approval.

## Static release and disclosure gate

The reviewed static Pages artifact must be built by `scripts/package-pages.mjs`. The playground binary-disclosure workflow ships only its explicitly allowlisted browser assets (HTML, CSS, JS including actor workers, examples, compiler and formatter receipts and Wasm, and this contract) plus a separately allowlisted set of already-rendered AttoLang documentation pages, diagrams, and styles. The documentation list is fixed and validated before packaging; the workflow never copies arbitrary Jekyll output or source directories. The packager rejects symlinked inputs and staging directories, requires a verified Jekyll build of the documentation, limits asset sizes, rejects active HTML and SVG in that publication set, verifies compiler Wasm has no imports, enforces matching pinned digest, receipt and bytes, and emits per-file SHA-256 plus the source commit in `release-manifest.json`. It cannot be pointed at arbitrary source directories.

The Pages workflow is **not an auto-publisher**: deployment requires `workflow_dispatch` from `main`, affirmative binary-disclosure confirmation, and an administrator-managed GitHub Actions repository variable `ATTO_PUBLIC_COMPILER_SHA256` matching the workflow input, compiler receipt and actual bytes. It tests the actual staged site with Chromium before publishing. A green CI run alone does **not** imply permission to disclose compiler Wasm; independent review and GitHub Pages hosting eligibility are additional gates.

The earlier M0 guest restriction requiring exactly the type/function/export/code sections cannot apply to v2: `atto.browser.guest.v2` intentionally permits bounded stdout imports, memory for string literals and objects, and the bounded actor capabilities. The v2 guest runner instead enforces `guestImports()`'s allowlist, an i64 `main` entrypoint, a 1 MiB module-size ceiling, bounded output and a hard worker deadline.

## Example dropdown and boolean migration

The canonical boolean operator spelling is **`&&` (AND), `||` (OR), and `^^` (XOR)**. Single `&` / `|` and comma are **not** canonical boolean operator spellings. The currently pinned compiler still accepts the legacy condition-only `,` and `|` grammar; this compatibility behavior is **not** the target language design. Its supported `And(a,b)`, `Or(a,b)`, and `Xor(a,b)` functions are used in the runnable Conditions sample until a verified compiler upgrade lands. Uppercase infix `AND`, `OR`, `XOR` are language-design candidates, **not** supported lexer tokens here. Do not infer short-circuit behavior from the function variants: arguments evaluate before the call.

The **Language previews** dropdown contains illustrative `.atto` sources in `examples/preview/`, covering operators, generators, async iterators, tasks/await, match, `use`/`using`/`with`, closures and functor-style objects, functional and actor pipelines, supervisors, `trap` expressions, Result/Option, channels and Rx interop. Those sources are **not compiled or executable** in this pinned browser compiler. Some proposed grammar and API spellings require design and backend conformance before stabilization. The editor labels every preview, and the compiler remains fail-closed (no guest Wasm on rejection). Do not count visual presence as executed feature coverage.

The **Closures and functors** preview uses the bounded *direct-call scalar capture* profile in [Rust source compiler PR #134](https://github.com/atto-lang/atto-source.rs/pull/134): a nonescaping expression-body lambda captures an immutable scalar, and a separate class with an explicit `.call()` method behaves as a functor. The private exact-source Rust + wasm32 test executed the combined `closures-functors-direct.atto` guest with expected result **84** (365 conformance cases passed, 328 native/Wasm artifact comparisons). **This evidence applies to the candidate source only:** the presently pinned public compiler binary is unchanged and must continue treating the menu item as non-executable. Escaping/returned `Fnc<int,int>` closures, callable values, Wasm indirect tables and actor-crossing captures are **not implemented** by that milestone. Publication requires separate independent approval, binary digest pinning, complete browser tests and secure Pages release gates.

While a built-in language preview is selected, Run, Format and Check format are disabled. Keyboard shortcuts are guarded independently, and a change back to a runnable or custom program restores the controls. Preview code is treated only as text; selecting it does not create or execute guest Wasm. Copy a preview with **Custom +** to experiment, but unsupported source will still fail closed.


### Actor pipeline syntax preview (not admitted by the pinned browser compiler)

The actor-pipeline dropdown sample illustrates two **proposed actor composition** forms:
`spawn Parse() | spawn Validate() | spawn Sink()` and
`spawn Parse() pipe spawn Validate() pipe spawn Sink()`.
Here `pipe` is a keyword for linking actors, while single `|` has the same actor-composition meaning in this context; neither is boolean OR or the function pipeline operator `|>`. Both examples spawn separate Parse → Validate → Sink chains: the symbolic `|` pipeline receives 41 and should print 42; the keyword `pipe` pipeline receives 42 and should print 43. These distinct values make the intended outputs individually identifiable but do not establish either compiler or runtime conformance. Order across the two *independent* pipelines is not specified. FIFO applies within each mailbox, not as a promise of global ordering. Send admission, backpressure, failure propagation, lifecycle and completion semantics must be verified on a runtime that actually implements actor pipelines. The pinned browser compiler currently implements only direct actor `spawn` and `send`, not `emit` forwarding or either actor-composition spelling; these samples remain non-executable previews. The cosmetic editor highlights `pipe`, but highlighting and source-only tests are not compiler conformance.

### Source-only language previews (additional examples)

The **trap expression** preview demonstrates caller-side `trap checked_id(5)`, not the invalid `trap "message"` statement and not a required `trap fnc` declaration. A regular `fnc checked_id(...): Result<int, String>` returns a `Result` normally; `trap checked_id(...)` wraps **the whole expression** in `Option<Result<int, String>>`. Normal `Ok` and `Err` values yield `Some(Ok(...))` and `Some(Err(...))` respectively. The separate `trap checked_or_throw(13)` call demonstrates an ordinary `throw Error(...)` crossing a helper boundary and becoming the outer `None`; `raise`, `panic`, cancellation and fatal host failures bypass `trap`. No automatic flattening and no implicit `Err` → `None` conversion are permitted. An `unwrap()` panic on `Err` or `None` also bypasses `trap`.

### Bounded channel + task completion (preview-only)

The `preview/channel-bounded` sample intentionally uses `val producer = task { return await produce(ch); };` where `produce` returns `void`. The proposed language contract is that the awaited `void` completion is valid as the operand of a return from a void task; the task handle represents completion (conceptually `Future<void>`) rather than a data payload. The subsequent `await producer;` is the join point. When implementing this syntax, the parser, type checker and all backends must agree on `return await` for both value-returning and void-returning functions, including errors and cancellation. **The browser compiler does not implement or validate this contract.**

The channel has capacity two and the producer writes three integers. The consumer must start draining before joining the producer; joining first may deadlock when the third send waits for capacity. The example is deliberately a *happy path*: it reads exactly three values and closes the channel after the last write, giving `1 + 2 + 3 = 6`. Producer failure/cancellation before closure can leave the consumer waiting; early close and failure propagation from `readch` are not demonstrated and must have separately specified Option/Result and cancellation behavior before claiming robust runtime semantics. Static preview tests guard the source shape and non-executable UI status only; runtime tests against each compiler/backend are still required.

These previews are **not executable** in the pinned Wasm compiler. The unit tests assert the example contract text; the Chromium E2E suite tests that **every** preview remains non-runnable and cannot export stale guest Wasm. Neither test establishes execution or backend conformance of `trap` itself. APIs and spellings require actual compiler/runtime parity before being described as supported. Unbounded channel buffering still requires actor and tenant quotas. This release changes no browser compiler binary, receipt or digest pin.

### Result / Option function styles and boundaries

The **Result / Option — brace functions** and **Result / Option — end functions** previews share the same logic. The latter uses `fnc f(...) -> Type`, a newline-delimited body, and `end`. The optional `::` separator marks the boundary explicitly and is necessary before removing the newline in compact source. The formatter preserves an explicit `::` but does **not** automatically minify or infer a missing separator in ambiguous code.

Both examples remain non-executable in the pinned browser compiler. The separately pinned browser formatter is tested against both source files. A dropdown change revokes stale guest Wasm synchronously through a selection-start callback; only a completed editor source load emits an input event.

## Additional module, namespace, actor-receiver, stdio and product-type syntax previews

Six additional **non-executable** language previews are included in the playground catalog:

- **Modules:** `define module` names a module and `pub` controls exported members. Cross-file imports use the canonical `import * as Name from "./file.atto";` syntax (the old `import module Name from` spelling is transitional). Package imports use `import * as name from pkg "package.name";`, and selective imports use comma-separated names like `import span, tracer as trace from pkg "core.telemetry";`, without braces. Dotted export paths such as `import telemetry.span as span from pkg "core";` bind static exports only. Grammar acceptance alone does not establish linked guest execution. The single-file preview does not prove package-root `+` resolution.
- **Namespaces:** `use namespace storefront;` is a file-root namespace declaration identifying the current source, **not** an open import or wildcard lookup. It appears before `import` declarations, names are flat, and separately imported modules remain qualified (e.g. `math.square(7)`).
- **Declared actors and receiver methods:** `use namespace actor_receiver_demo;`, `declare actor Foo1;` and `declare actor Foo2;` show multiple nominal actors in one file, with target out-of-line `mtd (mut self: Foo1)` / `mtd (self: Foo2)` receiver forms. The exact separate `mtd` grammar and linker dispatch are still **proposed / unverified** for the pinned browser compiler. Actor state is sealed behind `self.handle_state(critical-read/critical-write ...)`; external actor references communicate using mailbox `send()` (admission, not execution completion), not synchronous receiver calls. Linked implementations and `receive` handlers are deliberately absent.
- **Stdio:** `stdio.in`, `stdio.out` and `stdio.err` model channel endpoints; `readch` suspends, `writech` sends and `stdio.in.stream()` is an alternative consumer. Encoding and EOF behavior are not claimed by this preview.
- **Traits and interfaces:** an interface is a required-method contract, while a trait illustrates reusable method behavior. Composition spelling, conflicts and precedence remain unverified.
- **Inheritance and diamond resolution (syntax preview):** `Root` is inherited by `Left` and `Right`, which each explicitly override `describe()`. `Diamond extends Left, Right implements Named, Greeter` must provide its own `override describe()`; otherwise the unqualified lookup is a compile-time `E_AMBIGUOUS_MEMBER`, never a silently chosen left/right/C3 winner. Conversely, a single `Root.origin()` declaration inherited along two paths is not itself ambiguous. An interface contributes requirements, while a trait may contribute a default implementation. The **candidate** Rust compiler now admits and executes this exact source, but the **public pinned compiler does not**; Java/LLVM backend semantics and source grammars remain incomplete as described below.
- **Struct, record, tuple, Pair and Entry:** named and positional products and key/value associations are contrasted. Record literals and Pair/Entry constructor spelling are illustrative, **not parser-verified**; equality, mutability and nominal/structural distinctions require backend-conformance tests.

The `use-using-with.atto` preview now uses `import span from pkg "core.telemetry";` and `import sleep from pkg "std.time";`, followed by `using span("playground.demo") as current_span`, `with timeout(2000)` and `await sleep(1)`. This example remains **syntax only**: the browser compiler does not link these packages, execute cleanup on every exit, or preserve the scope across guest suspension. A passing catalog/highlighter test must not be taken as successful compilation or runtime evidence.

Each is a release-allowlisted `.atto` sample. The browser intentionally disables Run, Format and Check Format for these previews: they are not passing source-to-Wasm fixtures. Before any example is promoted, verify grammar, positive/negative compiler diagnostics and cross-backend semantics.

### Diamond inheritance preview: backend evidence and promotion gates (2026-11-15)

The reviewed playground example is `play/examples/preview/diamond-inheritance.atto`, Git blob `05814acb37c0335c03294875b870560a2839031d`. That same exact Git blob is checked into draft source-contract branches for Rust, Wasm, Java and LLVM. This is **source parity**, not executable-language parity.

| Backend | Executed evidence | Still unavailable |
| --- | --- | --- |
| Rust and Rust-built wasm32 compiler | [Source PR #137](https://github.com/atto-lang/atto-source.rs/pull/137); [full 413-blob exact Git-tree runner](https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43757809387) passed 128 native Rust tests, 391 guest cases, 354 native/Wasm byte comparisons and 11 Chromium checks; exact sample output `Ada / hello / root / diamond resolved` and three negative diamond mutations passed | General base-typed runtime virtual dispatch, upcasts, base constructor chaining, inherited private members, approved public browser Wasm artifact |
| Java/GraalVM reference | [JVM test PR #3119](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3119); [JDK 25 private executed test](https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43758701399), 6/6 passed: base-typed override dispatch, diamond origin behavior, static lookup, ambiguity/arity rejection | Exact preview's `override` keyword and trait default body grammar; no exact-preview guest execution or Native Image evidence |
| LLVM native reference | [Native compiler PR #1835](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1835); [real LLVM/Clang 19 private run](https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43760108733): 36 class method cases and 36 ASan/UBSan cases passed; O0/O2 guest exit 42; exact preview rejected with zero LLVM IR | Class inheritance/multiple inheritance, trait defaults, qualified statics, parent layouts and runtime virtual dispatch; rejecting source is not backend execution parity |
| Wasm project `atto-source.wasm` | [Verifier PR #11](https://github.com/atto-lang/atto-source.wasm/pull/11) checks the actual Rust-built wasm32 compiler and generated guest Wasm | Separate native frontend does not exist in this repo; public binary release/pin remains pending |

**Promotion rule:** do not enable Run/Format for this preview or publish candidate compiler bytes until reviewed public release and receipt pinning, actual deployed-browser checks and unresolved language/dispatch compatibility decisions are complete. A zero-step Actions runner failure is not a test; isolated source grammar checks are not compiled guest parity.

## Additional effects, concurrency and explicit-export syntax previews

Ten further **non-executable** .atto previews illustrate the intended
language design: effect rows, lexical scoping / pure functions, suspends,
NIO reactor architecture, mutexes and scoped locks, mutable actor-state
containers, early-exit guard, lambdas, routine, and explicit exports /
visibility declarations. These are *not*
parser-positive or runtime conformance fixtures. The pinned browser compiler
does not execute them, and the pinned formatter is also disabled for previews.

- **Lexical scope and purity:** The lexical-scope-pure preview demonstrates a
  closure capturing an immutable definition-site binding while a nested block
  shadows its name, plus `pure fnc` arithmetic. `pure` is intended to prohibit
  observable I/O, shared-state mutation and impure transitive calls; the
  source implementation has now passed an **unpublished candidate** Rust
  native/Wasm32 run at atto-source.rs PR #136 (source head
  `e48b7d203c870000ca17337aeaa87506928a2ff1`), including the exact
  playground program, its four output lines, positive/negative purity and
  capture fixtures, and a direct Chromium browser check of those features. The [private exact-tree run](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43762451915) completed 379
  conformance checks (0 failures), 342 native-vs-Wasm comparisons, 29
  Wasm ABI checks, and real Chromium E2E checks. The audited purity
  checker uses exhaustive typed expression, statement, binary-operator,
  builtin and string-helper matches so new effects cannot silently bypass
  validation; negative fixtures reject nested I/O,
  transitive impure calls, heap-allocating string concatenation and
  oversized captures. The public compiler now executes this preview (pin
  `71fcdf98`, output 42, 42, 2, 42). Preview Format remains disabled
  because the pinned formatter does not support preview syntax.
  Printing happens only in the ordinary `main`, outside pure functions.
  An independently built and SHA-verified **private, unapproved** candidate
  is recorded in `release-candidates/2026-11-15-lexical-pure-rust-wasm.json`.
  It was produced from source `e48b7d203c870000ca17337aeaa87506928a2ff1`
  and exact tree `8fb5e66fb6c74dff817112a1847d67fcba6ba51f` by the
  [private test carrier](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43762451915)
  with 379 conformance passes, 342 native/Wasm byte comparisons, browser E2E,
  and 0 compiler host imports. Its artifact remains private and expires after
  seven days. To verify the independently retrieved bytes **without installing**:
  `cd play && npm run verify:candidate -- /path/to/atto_compiler.wasm 2026-11-15-lexical-pure-rust-wasm.json`.
  This verifies the exact dropdown source, intended output, and negative
  `E_PURE`/`E_CAPTURE`/`E_UNSUPPORTED` cases. Metadata and successful
  private CI do not authorize public binary disclosure or deployment.

  **Reference semantics audit (November 15, 2026):** Java/GraalVM
  [OwnershipAndClosureTest](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/a88353e68c9160ba0f33b25038c07a0a0188ca17/src/test/java/dev/oreslang/OwnershipAndClosureTest.java)
  proves a *broader* closure contract, including escaping lambdas with mutable
  captured state; this Rust/Wasm direct-call scalar profile intentionally
  rejects those, rather than pretending to implement the Java heap/lifetime
  model. Java
  [EffectContracts](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/a88353e68c9160ba0f33b25038c07a0a0188ca17/src/main/java/dev/oreslang/types/EffectContracts.java)
  treats observational purity as an effect-set upper bound (and may allow
  allocation and failure effects); current Java source parser does not establish
  executable `pure fnc` spelling. LLVM
  [FunctionEffects](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/blob/762d6c7fb8a562eb0c00a422cf9d3102af2339fc/src/main/cpp/oreslang/types/FunctionEffects.hpp)
  represents state reads/writes, I/O, allocation, suspension, FFI and failures
  as separate bits and rejects unknown effect bits. The LLVM effect-bit utility
  is **not** proof that the LLVM frontend executes this page's source.
  The Rust/Wasm compiler takes a conservative **pure subset** (direct scalar
  effect-free calculations, resolved pure-call cycles and immutable definition-
  site captures); it refuses mutable/escaping closures, effects in unreachable
  branches, unknown calls and heap-allocating concatenation.
  Tests at Rust source PR #136 compare these shared invariants (not broad
  Java/LLVM source-syntax parity) on native Rust, genuine wasm32 and Chromium.
- **Effects and suspension:** The using io, suspend signature expresses an
  effect upper bound rather than granting capabilities. throws(Error),
  raises(Error) and panics(Error) remain distinct contracts. suspends marks
  a callable whose continuation may yield; mutable actor-state loans and
  synchronous lock guards cannot be retained across an admitted suspension.
- **NIO reactor:** The validated native foundation is host-side. The
  NioReactor and TcpListener APIs are **proposals**, not a shipped
  std.nio guest library. Cancellation, descriptor reuse and actor restart
  must use fenced, exactly-once completions.
- **Mutexes and actor state:** The Mutex<T> / lock_async() guest spelling
  is illustrative. A scoped logical lease must be released on every exit;
  acquisition cannot park an actor carrier. The sealed actor state container
  is read or modified solely through self.handle_state(critical-read ...)
  or self.handle_state(critical-write ...); the example does not read
  self.count directly, even during initialization.
- **Guard and callable identity:** The guard condition { failure_exit; } form is the **shared guard-v1**
  early-exit statement without an else clause, distinct from a match arm's when guard. The Java
  reference treats routine as direct-call-only and still allows recursion.
  The desired *nonrecursive-only* restriction remains a compiler design
  change, not a guarantee furnished by the preview.
- **Exports and visibility:** export pub Foo; appears before Foo, and
  export pub[pkg] class Bar; appears after Bar. The scopes of internal,
  protected, final and external require compiler, linker and foreign-ABI
  tests before implementation parity can be claimed.

CI compares the dropdown, preview runtime set, release allowlist and actual
.atto preview-file inventory. Browser E2E tests iterate all preview options
and verify that Run, Format and Check Format remain disabled. Only the pinned
compiler can validate a copied preview in Custom mode. A preview sample is not
evidence that another backend accepts its syntax or enforces its semantics.

**Additional closure hardening:** The constructor-argument traversal of the
Rust/Wasm direct-lambda converter is exhaustive. A local lambda with the same
name as a global function is invoked using its immutable definition-site
capture even when nested in `new Class(...)`; passing a lambda itself to
`new Class(...)` is rejected with `E_UNSUPPORTED`. The updated compiler
passed 379 conformance tests and 342 native/Wasm comparisons. The private
artifact-producing run rejects the previous website receipt as expected;
the exact updated website receipt subsequently passed a real private
compiler-to-playground binary bridge. [Clean-target rebuild and source-CI
parity run 43765019531](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43765019531)
also reproduced the compiler SHA-256 byte-for-byte and executed the original
actor trace-refinement tests. Candidate verification now checks constructor
capture and unsupported closure escape against real compiled guests. This is
evidence for review, not independent approval or public disclosure permission.

### Current merged lexical/pure and class-mtd compiler candidate (unpublished)

The exact compiler source [PR #136](https://github.com/atto-lang/atto-source.rs/pull/136)
now has head `ae442e00850a6c392d0767b16942e0d8b7fbe636`, Git tree
`abb4d53742d8c38f348f74246edc1c6e3ffce69d`. It incorporates the
upstream callable-body/class-`mtd` parser changes while retaining `pure fnc`
checks and immutable definition-site lambda captures. The private carrier
[artifact-producing run 43767052099](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43767052099)
verified 381 conformance cases, 344 native/Wasm byte comparisons, real
Chromium guest execution, 28 actor trace-refinement tests, 29 actor ABI checks,
and clean-target reproducibility for compiler SHA-256
`32a7a0021cf52453ed3161e3a020661076d047a4d44fb8c0c48066fef0028938`
(516,282 bytes, zero host imports). Its first integration bridge correctly
rejected the older website receipt. The following
[successful private exact-site bridge 43767355471](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/43767355471)
executed against the updated receipt and validated the **actual private**
compiler Wasm bytes and the real constructor-capture regression. The
source/tree and compiled digest are unchanged; the candidate receipt now pins
the **successful** private artifact. This is still not release approval.

This remains a **private, unapproved** compiler candidate. Source independent
review, source-org runner admission, private-branch governance and an explicit
binary-disclosure approval must precede any public compiler pin or Run/Format
activation. None was granted by this metadata update.

## Closures, functors and lambdas — release-blocked preview

The `preview/lambdas` example illustrates (1) a direct noncapturing
lambda, (2) a lexical closure escaping from `make_adder`, (3) a class
with an explicit `.call(...)` method, and (4) a higher-order function
receiving a `fnc(int) => int` callable value. Its expected output is a
design illustration, not a current guest-execution receipt.

The pinned public `atto_compiler.wasm` in this repository predates
the callable-signature and direct-lambda milestones. The
`closures-functors-compiler-gate.test.mjs` test executes that **actual
pinned compiler**, requires the complete example to fail with a
compiler-owned diagnostic and **zero guest Wasm**, then verifies a
known scalar guest still produces 42.

The Rust compiler's development branch provides a much narrower
direct-only path: one noncapturing local lambda or one immutable scalar
capture per function, lowered to a private direct Wasm call. A class
`.call(...)` method is an ordinary method invocation; it is **not**
proof that instances are implicitly callable. The richer example
requires owned escaping closure environments, typed first-class
callable arguments/returns, checked indirect Wasm dispatch, stale
handle and generation safety, and guest tests on native and wasm32
compiler builds. Its Run/Format/Check controls stay disabled until
those features and the reviewed public compiler artifact are available.

Java/Graal reference examples support lexical closures, while LLVM
functor type-rule and experimental runtime components do not prove
native guest parity for the full callable contract. No unreviewed
compiler binary, receipt, SHA pin, protected release setting or
deployment workflow should be changed to make this preview appear runnable.

## Explicit ownership operators — verified candidate, pinned-public preview

The dropdown entry **Borrow checking: borrow! / copy! / take! / share!** remains
**non-executable in the public playground**. The pinned public compiler is an
older Wasm build; the draft Rust/Wasm compiler candidate is not the published
artifact. The `PREVIEW_EXAMPLES` gate keeps Run, Format and Check Format disabled
until a reviewed artifact is explicitly approved, promoted and verified in
Chromium. The playground preview is not itself proof of the pinned compiler's
support.

The canonical *prefix* syntax has **no required operand parentheses**:

- `borrow! owner`: scoped immutable loan; multiple read loans can coexist.
- `borrow! mut owner`: exclusive mutable loan; no overlapping readers, writers
  or owner transfer. `borrow_mut!` is **not** an AttoLang operator.
- `copy! value`: copy an explicitly copyable value, not an arbitrary class.
- `take! owner`: move a named owner, invalidating subsequent owner uses.
- `share! value`: share only values with verified shareability; no unguarded
  mutable aliases or automatic cross-actor sharing.

Parenthesized *grouped operands* such as `copy!(value)` remain accepted for
compatibility, but `copy! value` is the canonical spelling. The parser treats
each operator as a prefix unary expression, not as a named function call.

[Draft compiler PR #139](https://github.com/atto-lang/atto-source.rs/pull/139)
implements a **bounded native Rust/browser-Wasm subset**: lexical class loans,
exclusive non-final scalar field mutation, scalar copying/sharing, explicit
moves and no-artifact diagnostics for unsupported owned-handle escapes.
This is not a general borrow/region inference system, full `Arc<T>`, `Box<T>`,
`Send`/`Atomic<T>` admission policy, or ownership across `await`/`select`
suspension points. Classes cannot be cloned/shared without proven capabilities.

The positive fixture prints `84`, `43` and returns `63`. The exact-source
private [exact-tree verification run](
https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43760982948
) verified **417 source blobs and the reconstructed Git tree**, **398 passing
conformance cases**, **361 native/Wasm byte comparisons**, real Chromium
browser/worker E2E, five executable ownership guest programs and 34
no-artifact negative ownership cases. Both `while` conditions and `for`
conditions/update clauses reject ownership transfers from pre-existing locals,
because these expressions may execute repeatedly. A `for` initializer executes
only once and may transfer ownership under the usual rules. No binary, receipt
pin, public deployment or disclosure approval is changed by this preview.

Loans cannot escape their owning scope, nor cross suspension or actor
boundaries without independently proved safe-frame and transfer semantics.
Invalid cases remain commented out in the example. Any future runnable
promotion requires exact source and blob provenance, immutable compiler SHA-256,
the complete native/Wasm conformance suite, Chromium worker tests, independent
review, the approved Pages workflow and live HTTPS postflight.

### Ownership containers: Arc / Send / Atomic / Box (source-only proposal)

The `preview/borrow-arc-send-atomic-box` dropdown example teaches *proposed* `Box<T>`
unique ownership, `Arc<T>` shared ownership, `Atomic<T>` synchronization,
and `Send` transfer bounds. It is **not** validated by the pinned browser
compiler: allocation, reference counting, atomic orderings, generic bounds
and actor/worker transfer semantics remain separate implementation tasks.

The other `preview/borrow-checking` example demonstrates a **restricted**
ownership-operator subset with private native/Wasm candidate evidence. That
candidate remains unpublished and does **not** prove the container APIs in
this proposal. Both previews keep Run, Format, and Check Format disabled.
Neither preview changes public compiler binaries, SHA pins, disclosure approval
or the protected Pages release workflow. Rejected move/borrow examples remain
commented out in the proposed container teaching sample.

## Worker-local state guest admission hardening (independent draft)

A separately reviewed host admission update requires all three `atto` imports
`state_register(i32)`, `state_enter(i32,i32)`, and `state_leave(i64)` together.
State imports cannot mix with actor or pipeline protocols. In the disposable
browser Worker, state pointers must be aligned and within the actual private,
exported, bound guest memory (at most 1 MiB); missing/oversized/shared memory,
replayed tickets, conflicting leases and leaked critical tickets fail closed.
This does **not** add cross-Worker shared memory, suspension, or production
compiler support beyond the separately pinned and approved compiler artifact.
