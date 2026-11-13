# Playground compiler contract (v2)

The playground ships `public/atto_compiler.wasm`. It is built from [atto-lang/atto-source.rs](https://github.com/atto-lang/atto-source.rs) at the commit named in `public/atto_compiler.receipt.json`. It is a real AttoLang-to-WebAssembly compiler that itself runs as WebAssembly:

- No server compiles user source.
- No JavaScript evaluates user source.
- No LLVM runs in the page.

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

## Guest contract `atto.browser.guest.v2`

- **Exports:** `main: () -> i64` and `panic_code: mut i32` (1 = integer overflow, 2 = division by zero, which is reserved, 3 = object heap exhausted). `memory` is exported only for string literals or classes, and with classes it is a fixed 1 MiB. Programs with actors also export `actor_init` and `actor_receive`, and carry an `atto.actors` custom section of type names.
- **Imports:** only from module `atto`: `print_i64`, `print_bool`, `print_str` and `print_newline`, plus `actor_spawn` and `actor_send` for programs with actors. `src/guest.js` refuses any other import, validates the actor table, and caps stdout at 64 KiB.

### TenantVM: one worker per tenant, multiple actors per worker (v2 subset)

`src/runner-worker.js` is the tenant's *single* execution Web Worker for each playground run. When a guest has actors, `src/actor-host.js` grants `actor_spawn` and `actor_send`:

- Each `spawn` creates an actor record inside the tenant worker. After `main` completes, the tenant scheduler creates a **distinct `WebAssembly.Instance`** for every actor, using the same verified `WebAssembly.Module` and **private linear memory, globals and mailbox**. It does **not** launch additional actor workers.
- Mailboxes use monotonically increasing sequence numbers starting at 0. The worker processes one message per actor per round-robin pass, yielding to the event loop every 32 messages. Same-tenant actors share a worker thread, **not their mutable Wasm memory**; actor method execution remains single-threaded/cooperative for this guest ABI.
- Limits: 16 actors per tenant run, at most 10,000 outstanding messages per actor (`E_ACTOR_LIMIT`, `E_MAILBOX_FULL`). Only `main` may spawn/send from guest v2; the trusted Node session host can admit follow-up messages after `main` returns. This is **not yet** fully general actor-to-actor messaging, async/supervision or persistent multi-program tenant scheduling.
- The run completes when `main` returns and all queued actor mail is drained. Output from `main` precedes actor output; actor mail is handled in fair round-robin order.
- A panicking actor fails the tenant run as `E_PANIC: … in actor Name#n` and stops further actor execution. The parent terminates the **entire tenant worker** on Stop or deadline, including a non-cooperative Wasm loop.
- `play/node/tenant-vm.mjs` exposes `runTenantWasm({tenantId, wasm, timeoutMs})`, creating a single Node.js `worker_threads` V8 isolate for that tenant invocation. It runs the **same guest module, tenant scheduler and import allowlist** through `play/node/tenant-worker.mjs`. Separate calls use separate workers; this is not a durable tenant registry.

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

## Static release and disclosure gate

The reviewed static Pages artifact must be built by `scripts/package-pages.mjs`. The playground binary-disclosure workflow ships only its explicitly allowlisted browser assets (HTML, CSS, JS including actor workers, examples, compiler and formatter receipts and Wasm, and this contract) plus a separately allowlisted set of already-rendered AttoLang documentation pages, diagrams, and styles. The documentation list is fixed and validated before packaging; the workflow never copies arbitrary Jekyll output or source directories. The packager rejects symlinked inputs and staging directories, requires a verified Jekyll build of the documentation, limits asset sizes, rejects active HTML and SVG in that publication set, verifies compiler Wasm has no imports, enforces matching pinned digest, receipt and bytes, and emits per-file SHA-256 plus the source commit in `release-manifest.json`. It cannot be pointed at arbitrary source directories.

The Pages workflow is **not an auto-publisher**: deployment requires `workflow_dispatch` from `main`, affirmative binary-disclosure confirmation, and an administrator-managed GitHub Actions repository variable `ATTO_PUBLIC_COMPILER_SHA256` matching the workflow input, compiler receipt and actual bytes. It tests the actual staged site with Chromium before publishing. A green CI run alone does **not** imply permission to disclose compiler Wasm; independent review and GitHub Pages hosting eligibility are additional gates.

The earlier M0 guest restriction requiring exactly the type/function/export/code sections cannot apply to v2: `atto.browser.guest.v2` intentionally permits bounded stdout imports, memory for string literals and objects, and the bounded actor capabilities. The v2 guest runner instead enforces `guestImports()`'s allowlist, an i64 `main` entrypoint, a 1 MiB module-size ceiling, bounded output and a hard worker deadline.

## Example dropdown and boolean migration

The canonical boolean operator spelling is **`&&` (AND), `||` (OR), and `^^` (XOR)**. Single `&` / `|` and comma are **not** canonical boolean operator spellings. The currently pinned compiler still accepts the legacy condition-only `,` and `|` grammar; this compatibility behavior is **not** the target language design. Its supported `And(a,b)`, `Or(a,b)`, and `Xor(a,b)` functions are used in the runnable Conditions sample until a verified compiler upgrade lands. Uppercase infix `AND`, `OR`, `XOR` are language-design candidates, **not** supported lexer tokens here. Do not infer short-circuit behavior from the function variants: arguments evaluate before the call.

The **Language previews** dropdown contains seventeen illustrative `.atto` sources in `examples/preview/`, covering operators, generators, async iterators, tasks/await, match, `use`/`using`/`with`, functional and actor pipelines, supervisors, `trap` expressions, Result/Option, channels and Rx interop. Those sources are **not compiled or executable** in this pinned browser compiler. Some proposed grammar and API spellings require design and backend conformance before stabilization. The editor labels every preview, and the compiler remains fail-closed (no guest Wasm on rejection). Do not count visual presence as executed feature coverage.

While a built-in language preview is selected, Run, Format and Check format are disabled. Keyboard shortcuts are guarded independently, and a change back to a runnable or custom program restores the controls. Preview code is treated only as text; selecting it does not create or execute guest Wasm. Copy a preview with **Custom +** to experiment, but unsupported source will still fail closed.


### Source-only language previews (additional examples)

The **trap expression** preview demonstrates caller-side `trap checked_id(5)`, not the invalid `trap "message"` statement and not a required `trap fnc` declaration. A regular `fnc checked_id(...): Result<int, String>` returns a `Result` normally; `trap checked_id(...)` wraps **the whole expression** in `Option<Result<int, String>>`. Normal `Ok` and `Err` values yield `Some(Ok(...))` and `Some(Err(...))` respectively. Only an uncaught ordinary `throw` becomes the outer `None`; `raise`, `panic`, cancellation and fatal host failures bypass `trap`. No automatic flattening and no implicit `Err` → `None` conversion are permitted. An `unwrap()` panic on `Err` or `None` also bypasses `trap`.

### Bounded channel + task completion (preview-only)

The `preview/channel-bounded` sample intentionally uses `val producer = task { return await produce(ch); };` where `produce` returns `void`. The proposed language contract is that the awaited `void` completion is valid as the operand of a return from a void task; the task handle represents completion (conceptually `Future<void>`) rather than a data payload. The subsequent `await producer;` is the join point. When implementing this syntax, the parser, type checker and all backends must agree on `return await` for both value-returning and void-returning functions, including errors and cancellation. **The browser compiler does not implement or validate this contract.**

The channel has capacity two and the producer writes three integers. The consumer must start draining before joining the producer; joining first may deadlock when the third send waits for capacity. The example is deliberately a *happy path*: it reads exactly three values and closes the channel after the last write, giving `1 + 2 + 3 = 6`. Producer failure/cancellation before closure can leave the consumer waiting; early close and failure propagation from `readch` are not demonstrated and must have separately specified Option/Result and cancellation behavior before claiming robust runtime semantics. Static preview tests guard the source shape and non-executable UI status only; runtime tests against each compiler/backend are still required.

These previews are **not executable** in the pinned Wasm compiler. The unit tests assert the example contract text; the Chromium E2E suite tests that **every** preview remains non-runnable and cannot export stale guest Wasm. Neither test establishes execution or backend conformance of `trap` itself. APIs and spellings require actual compiler/runtime parity before being described as supported. Unbounded channel buffering still requires actor and tenant quotas. This release changes no browser compiler binary, receipt or digest pin.
