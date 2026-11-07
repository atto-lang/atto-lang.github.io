# Playground compiler contract (v2)

The playground ships `public/atto_compiler.wasm`. It is built from [atto-lang/atto-source.rs](https://github.com/atto-lang/atto-source.rs) at the commit named in `public/atto_compiler.receipt.json`. It is a real AttoLang-to-WebAssembly compiler that itself runs as WebAssembly:

- No server compiles user source.
- No JavaScript evaluates user source.
- No LLVM runs in the page.

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

Each guest runs in a fresh worker with a 3-second deadline, which ends infinite loops. A browser worker is not OS-level isolation, so the host must never grant other imports.
