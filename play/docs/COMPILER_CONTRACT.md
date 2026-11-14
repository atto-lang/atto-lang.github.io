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

The receipt pinned here explicitly identifies guest ABI
`atto.browser.guest.v1`. A newer **upstream**, not yet published, Rust
compiler supports actor guest ABI v2: its actor imports, exports, data
transport and worker lifecycle cannot be assumed compatible with the
currently shipped v1 runner. Do **not** simply update a receipt's
`guest_abi` field or copy unapproved private binaries. A reviewed
compiler+runner+release upgrade, browser execution receipts and
independent disclosure authorization are required first.

Target future topology: **one browser Worker per trusted tenant, multiple
private `WebAssembly.Instance` objects per Worker (one per actor)**,
each with its own Wasm32 linear memory, actor heap/arena and
compiler-managed bounded stack/continuations. A single instance with
several arenas provides logical ownership but not a separate memory
isolation boundary. Browser engine call stacks are not independently
bounded per actor; a synchronous runaway actor can force the parent
to terminate its entire tenant Worker, including its healthy actors.
Browser Workers alone are not OS sandboxes for mutually hostile tenants.

**Language drift:** this pinned v1 compiler admits the historical `%`
operator in the subset table below. Current AttoLang semantics reserve
`%`, `^`, and `^^`. Treat v1 as a historical compatibility slice,
not compiler conformance; promote an updated compiler with negative
source→no-artifact tests before advertising full parity.

## Integrity

`scripts/vendor-compiler.sh` writes the compiler's SHA-256 and size to both the receipt and `src/compiler-pin.js`. The compiler worker fetches `atto_compiler.wasm?sha256=<prefix>`, so a cached copy from an older deploy is never reused. It then hashes the bytes and refuses to run a compiler that does not match the pin. The tests check the pin against the receipt and confirm that a one-bit change is rejected.

A WebAssembly engine trap inside the compiler instance would leave its state undefined. `createCompiler` therefore refuses further calls on an instance that trapped, and the page uses a fresh compiler worker for every run anyway. The compiler's resource limits are listed in atto-source.rs `README.md` under "Resource limits". Each limit is a diagnostic, never a trap.

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

## Boolean gate syntax preview (not admitted by the pinned browser compiler)

The runnable browser subset currently admits the binary `And(a, b)`, `Or(a, b)`, and `Xor(a, b)` compatibility functions. The `boolean-operators.atto` dropdown sample is **preview-only**: infix `&&` / `||` / `^^`, uppercase word-form operators, variadic `And(a, b, c)` / `Or(a, b, c, d)`, and array-argument `And([a, b, c])` / `Or([a, b, c, d])` / `Xor([a, b])` must not be advertised as executable with the pinned compiler. Array-argument and variadic overloads require explicit type, arity, evaluation and backend-conformance tests before enabling Run.

The repeated `Xor(a, b)` is retained in the preview as requested; it is a binary invocation, **not** evidence that variadic XOR is supported. Preview selection disables Run until the user intentionally switches to Custom source; Custom mode still uses the real compiler and reports unsupported constructs as errors.
Anything else is rejected with an `E_*` diagnostic, and a rejected program produces no artifact. That includes:

- `int / int`, whose result type is undecided (spec S-25), and the removed `%`, `^` and `^^`
- strings as values, floats and sized integers
- `match`, imports, lambdas, inheritance, enum payloads and calling actor methods directly

## Generator syntax preview (not admitted by the pinned browser compiler)

The language-preview dropdown illustrates an explicit generator declaration:

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

Generators should start lazily, resume on iteration, and be closed on exhaustion, early loop exit or cancellation. The pinned Rust/Wasm compiler and formatter **do not currently accept this preview**, and the playground disables Compile, Format and Check format for it. This document specifies intended syntax only, not verified runtime or cross-backend behavior.

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

The current shipped compiler remains pinned to `865c835c7f343a2bb00b5b73a6010825f57be794`.
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

### Latest ordinary-throw/typed-trap compiler candidate (not published)

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
`throw Error(...)` -> `None`, `?`, and checked-panic bypass:

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

The **Language previews** dropdown contains eighteen illustrative `.atto` sources in `examples/preview/`, covering operators, generators, async iterators, tasks/await, match, `use`/`using`/`with`, functional and actor pipelines, supervisors, `trap` expressions, Result/Option, channels and Rx interop. Those sources are **not compiled or executable** in this pinned browser compiler. Some proposed grammar and API spellings require design and backend conformance before stabilization. The editor labels every preview, and the compiler remains fail-closed (no guest Wasm on rejection). Do not count visual presence as executed feature coverage.

While a built-in language preview is selected, Run, Format and Check format are disabled. Keyboard shortcuts are guarded independently, and a change back to a runnable or custom program restores the controls. Preview code is treated only as text; selecting it does not create or execute guest Wasm. Copy a preview with **Custom +** to experiment, but unsupported source will still fail closed.


### Actor pipeline syntax preview (not admitted by the pinned browser compiler)

The actor-pipeline dropdown sample illustrates two **proposed actor composition** forms:
`spawn Parse() | spawn Validate() | spawn Sink()` and
`spawn Parse() pipe spawn Validate() pipe spawn Sink()`.
Here `pipe` is a keyword for linking actors, while single `|` has the same actor-composition meaning in this context; neither is boolean OR or the function pipeline operator `|>`. Both examples spawn separate Parse → Validate → Sink chains: the symbolic `|` pipeline receives 41 and should print 42; the keyword `pipe` pipeline receives 42 and should print 43. These distinct values make the intended outputs individually identifiable but do not establish either compiler or runtime conformance. Order across the two *independent* pipelines is not specified. FIFO applies within each mailbox, not as a promise of global ordering. Send admission, backpressure, failure propagation, lifecycle and completion semantics must be verified on a runtime that actually implements actor pipelines. The pinned browser compiler currently implements only direct actor `spawn` and `send`, not `emit` forwarding or either actor-composition spelling; these samples remain non-executable previews. The cosmetic editor highlights `pipe`, but highlighting and source-only tests are not compiler conformance.

### Source-only language previews (additional examples)

The **trap expression** preview demonstrates caller-side `trap checked_id(5)`, not the invalid `trap "message"` statement and not a required `trap fnc` declaration. A regular `fnc checked_id(...): Result<int, String>` returns a `Result` normally; `trap checked_id(...)` wraps **the whole expression** in `Option<Result<int, String>>`. Normal `Ok` and `Err` values yield `Some(Ok(...))` and `Some(Err(...))` respectively. Only an uncaught ordinary `throw` becomes the outer `None`; `raise`, `panic`, cancellation and fatal host failures bypass `trap`. No automatic flattening and no implicit `Err` → `None` conversion are permitted. An `unwrap()` panic on `Err` or `None` also bypasses `trap`.

### Bounded channel + task completion (preview-only)

The `preview/channel-bounded` sample intentionally uses `val producer = task { return await produce(ch); };` where `produce` returns `void`. The proposed language contract is that the awaited `void` completion is valid as the operand of a return from a void task; the task handle represents completion (conceptually `Future<void>`) rather than a data payload. The subsequent `await producer;` is the join point. When implementing this syntax, the parser, type checker and all backends must agree on `return await` for both value-returning and void-returning functions, including errors and cancellation. **The browser compiler does not implement or validate this contract.**

The channel has capacity two and the producer writes three integers. The consumer must start draining before joining the producer; joining first may deadlock when the third send waits for capacity. The example is deliberately a *happy path*: it reads exactly three values and closes the channel after the last write, giving `1 + 2 + 3 = 6`. Producer failure/cancellation before closure can leave the consumer waiting; early close and failure propagation from `readch` are not demonstrated and must have separately specified Option/Result and cancellation behavior before claiming robust runtime semantics. Static preview tests guard the source shape and non-executable UI status only; runtime tests against each compiler/backend are still required.

These previews are **not executable** in the pinned Wasm compiler. The unit tests assert the example contract text; the Chromium E2E suite tests that **every** preview remains non-runnable and cannot export stale guest Wasm. Neither test establishes execution or backend conformance of `trap` itself. APIs and spellings require actual compiler/runtime parity before being described as supported. Unbounded channel buffering still requires actor and tenant quotas. This release changes no browser compiler binary, receipt or digest pin.

### Result / Option function styles and boundaries

The **Result / Option — brace functions** and **Result / Option — end functions** previews share the same logic. The latter uses `fnc f(...) -> Type`, a newline-delimited body, and `end`. The optional `::` separator marks the boundary explicitly and is necessary before removing the newline in compact source. The formatter preserves an explicit `::` but does **not** automatically minify or infer a missing separator in ambiguous code.

Both examples remain non-executable in the pinned browser compiler. The separately pinned browser formatter is tested against both source files. A dropdown change revokes stale guest Wasm synchronously through a selection-start callback; only a completed editor source load emits an input event.

## Additional module, namespace, stdio and product-type syntax previews

Five additional **non-executable** language previews are included in the published playground:

- **Modules:** `define module` names a module and `pub` controls exported members. Cross-file imports use explicit `import module Name from "./file.atto";` syntax. The single-file preview does not prove package-root `+` resolution.
- **Namespaces:** `use namespace storefront;` is a file-root namespace declaration identifying the current source, **not** an open import or wildcard lookup. It appears before `import` declarations, names are flat, and separately imported modules remain qualified (e.g. `math.square(7)`).
- **Stdio:** `stdio.in`, `stdio.out` and `stdio.err` model channel endpoints; `readch` suspends, `writech` sends and `stdio.in.stream()` is an alternative consumer. Encoding and EOF behavior are not claimed by this preview.
- **Traits and interfaces:** an interface is a required-method contract, while a trait illustrates reusable method behavior. Composition spelling, conflicts and precedence remain unverified.
- **Struct, record, tuple, Pair and Entry:** named and positional products and key/value associations are contrasted. Record literals and Pair/Entry constructor spelling are illustrative, **not parser-verified**; equality, mutability and nominal/structural distinctions require backend-conformance tests.

Each is a release-allowlisted `.atto` sample. The browser intentionally disables Run, Format and Check Format for these previews: they are not passing source-to-Wasm fixtures. Before any example is promoted, verify grammar, positive/negative compiler diagnostics and cross-backend semantics.
