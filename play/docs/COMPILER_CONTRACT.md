# Playground compiler contract (v2)

The playground ships `public/atto_compiler.wasm`. It is built from [atto-lang/atto-source.rs](https://github.com/atto-lang/atto-source.rs) at the commit named in `public/atto_compiler.receipt.json`. It is a real AttoLang-to-WebAssembly compiler that itself runs as WebAssembly:

- No server compiles user source.
- No JavaScript evaluates user source.
- No LLVM runs in the page.

## Integrity

`scripts/vendor-compiler.sh` writes the compiler's SHA-256 and size to both the receipt and `src/compiler-pin.js`. The compiler worker fetches `atto_compiler.wasm?sha256=<prefix>`, so a cached copy from an older deploy is never reused. It then hashes the bytes and refuses to run a compiler that does not match the pin. The tests check the pin against the receipt and confirm that a one-bit change is rejected.

A trap inside the compiler instance would leave its state undefined. `createCompiler` therefore refuses further calls on an instance that trapped, and the page uses a fresh compiler worker for every run anyway. The compiler's resource limits are listed in atto-source.rs `README.md` under "Resource limits". Each limit is a diagnostic, never a trap.

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

### Actors in Web Workers

`src/runner-worker.js` runs `main`. When a guest has actors, `src/actor-host.js` grants `actor_spawn` and `actor_send`:

- Each `spawn` starts one dedicated Web Worker (`src/actor-worker.js`) with a private copy of the module. Actor state lives in that instance's globals, so actors share no memory.
- `send` posts mail with sequence numbers from 0. The actor worker handles mail strictly in order and reports each completion. The host rejects out-of-order or unexpected replies.
- Limits: 16 actors per run and 10,000 messages per actor (`E_ACTOR_LIMIT`, `E_MAILBOX_FULL`). Actors cannot spawn or send.
- The run ends when `main` has returned and every mailbox has drained, which matches the Java reference. Output from different actors may interleave in any order.
- A panicking actor fails the run as `E_PANIC: … in actor Name#n` and stops receiving mail.
- Stop and the 3-second deadline terminate the runner worker, which ends every actor worker it owns.

Each guest runs in a fresh worker with a 3-second deadline, which ends infinite loops. Compilation has its own 10-second deadline, because the first run includes downloading the compiler. A timeout message names the phase that exceeded its deadline. A browser worker is not OS-level isolation, so the host must never grant other imports.

## Static release and disclosure gate

The reviewed static Pages artifact must be built by `scripts/package-pages.mjs`. The playground binary-disclosure workflow ships only its explicitly allowlisted browser assets (HTML, CSS, JS including actor workers, examples, compiler and formatter receipts and Wasm, and this contract) plus a separately allowlisted set of already-rendered AttoLang documentation pages, diagrams, and styles. The documentation list is fixed and validated before packaging; the workflow never copies arbitrary Jekyll output or source directories. The packager rejects symlinked inputs and staging directories, requires a verified Jekyll build of the documentation, limits asset sizes, rejects active HTML and SVG in that publication set, verifies compiler Wasm has no imports, enforces matching pinned digest, receipt and bytes, and emits per-file SHA-256 plus the source commit in `release-manifest.json`. It cannot be pointed at arbitrary source directories.

The Pages workflow is **not an auto-publisher**: deployment requires `workflow_dispatch` from `main`, affirmative binary-disclosure confirmation, and an administrator-managed GitHub Actions repository variable `ATTO_PUBLIC_COMPILER_SHA256` matching the workflow input, compiler receipt and actual bytes. It tests the actual staged site with Chromium before publishing. A green CI run alone does **not** imply permission to disclose compiler Wasm; independent review and GitHub Pages hosting eligibility are additional gates.

The earlier M0 guest restriction requiring exactly the type/function/export/code sections cannot apply to v2: `atto.browser.guest.v2` intentionally permits bounded stdout imports, memory for string literals and objects, and the bounded actor capabilities. The v2 guest runner instead enforces `guestImports()`'s allowlist, an i64 `main` entrypoint, a 1 MiB module-size ceiling, bounded output and a hard worker deadline.

## Example dropdown and boolean migration

The canonical boolean operator spelling is **`&&` (AND), `||` (OR), and `^^` (XOR)**. Single `&` / `|` and comma are **not** canonical boolean operator spellings. The currently pinned compiler still accepts the legacy condition-only `,` and `|` grammar; this compatibility behavior is **not** the target language design. Its supported `And(a,b)`, `Or(a,b)`, and `Xor(a,b)` functions are used in the runnable Conditions sample until a verified compiler upgrade lands. Uppercase infix `AND`, `OR`, `XOR` are language-design candidates, **not** supported lexer tokens here. Do not infer short-circuit behavior from the function variants: arguments evaluate before the call.

The **Language previews** dropdown contains ten illustrative `.atto` sources in `examples/preview/`: operators, generators, async iterators, suspending tasks/await, match guards, typed `is` matches, `use`/`using`/`with`, function `|>` pipelines, actor `|` pipes and `define supervisor` mailbox ping-pong. Those sources are **not compiled or executable** in this pinned browser compiler. Some proposed grammar and API spellings require design and backend conformance before stabilization. The editor labels every preview, and the compiler remains fail-closed (no guest Wasm on rejection). Do not count visual presence as executed feature coverage.
