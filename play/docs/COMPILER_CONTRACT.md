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
| Expressions | `+ - * %`, `< <= > >=`, `eq neq == !=`, `!`, ternary, `,` / `\|` in conditions, `And` / `Or` / `Xor` |
| Output | `stdio.print` / `stdio.println` of `int`, `bool` and string literals |

Anything else is rejected with an `E_*` diagnostic, and a rejected program produces no artifact. That includes:

- `int / int`, whose result type is undecided (spec S-25)
- strings as values, floats and sized integers
- classes, actors, `match`, imports and lambdas

## Compiler ABI v2

The compiler has no imports and memory capped at 64 MiB. It exports:

- `abi_version()`, which returns 2
- `memory`, `input_ptr()` and `input_capacity()` (64 KiB of UTF-8)
- `compile(length)`, which returns 0 on success
- `result_ptr()` and `result_length()`, which are 0 after an error
- `error_ptr()`, a NUL-terminated `E_CODE: message`
- `error_line_number()` and `error_column_number()`

`src/compiler.js` checks the ABI version and output bounds. It copies the result out before the next compile.

## Guest contract `atto.browser.guest.v1`

- **Exports:** `main: () -> i64`, `panic_code: mut i32` (1 = integer overflow, 2 = division by zero), and `memory` only when string literals are printed.
- **Imports:** only from module `atto`: `print_i64`, `print_bool`, `print_str` and `print_newline`. `src/guest.js` refuses any other import and caps stdout at 64 KiB.

Each guest runs in a fresh worker with a 3-second deadline, which ends infinite loops. Compilation has its own 10-second deadline, because the first run includes downloading the compiler. A timeout message names the phase that exceeded its deadline. A browser worker is not OS-level isolation, so the host must never grant other imports.

## Static release and disclosure gate

The reviewed static Pages artifact must be built by `scripts/package-pages.mjs`. Only the **18 enumerated browser assets** (HTML, CSS, JS, six examples, compiler receipt, compiler Wasm and this contract) are shipped. The packager rejects symlinked inputs and staging directories, limits asset sizes, verifies compiler Wasm has no imports, enforces matching pinned digest, receipt and bytes, and emits per-file SHA-256 plus the source commit in `release-manifest.json`. It cannot be pointed at arbitrary source directories.

The Pages workflow is **not an auto-publisher**: deployment requires `workflow_dispatch` from `main`, affirmative binary-disclosure confirmation, and an administrator-managed GitHub Actions repository variable `ATTO_PUBLIC_COMPILER_SHA256` matching the workflow input, compiler receipt and actual bytes. It tests the actual staged site with Chromium before publishing. A green CI run alone does **not** imply permission to disclose compiler Wasm; independent review and GitHub Pages hosting eligibility are additional gates.

The earlier M0 guest restriction requiring exactly the type/function/export/code sections cannot apply to v2: `atto.browser.guest.v1` intentionally permits bounded stdout imports and memory for string literals. The v2 guest runner instead enforces `guestImports()`'s allowlist, an i64 `main` entrypoint, a 1 MiB module-size ceiling, bounded output and a hard worker deadline.
