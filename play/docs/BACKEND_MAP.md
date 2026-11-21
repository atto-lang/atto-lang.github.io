# What actually compiles and runs at /play/?

The GitHub Pages `/play/` release vendors **`atto_compiler.wasm` from `atto-lang/atto-source.rs`**: a separate **Rust** AttoLang compiler cross-compiled to `wasm32-unknown-unknown`. The exact reviewed source head/tree, compiler binary SHA-256, and guest ABI are in `play/public/atto_compiler.receipt.json`. A browser compiler Worker runs that first Wasm module; a different disposable browser Worker executes the **guest Wasm** it emits from `.atto` source. There is no compilation server, JavaScript source evaluator, Wasmtime inside the browser or browser-hosted LLVM.

| Repository | What it currently does | Runtime/target |
| --- | --- | --- |
| `atto-lang/atto-source.rs` | Rust source-to-Wasm compiler used by the site | Compiler itself runs as Wasm in a browser Worker, produces guest Wasm32; Pages pins an independently receipted artifact. |
| `atto-lang/atto-source.wasm` | Atto Wasm integration/provenance and guest-runtime verification; `main` documents scope, while feature branches hold verifiers | **Not** a second independent Atto source frontend or the deployed browser compiler. |
| `ores-truffle-oreslang/oreslang-source.wasm` | Node JS bridge to external native LLVM compiler and Clang/LLD | Produces Wasm guest; separately has **native Rust Wasmtime AOT** host and Node pooled Workers. Not the site compiler. |
| `ores-truffle-oreslang/oreslang-source.rs` | Independent Rust/Cranelift compiler | Native object files only at present; **does not** use Wasmtime for actors. |
| `ores-truffle-oreslang/oreslang-source.js` | Experimental source-to-JavaScript/ESM transpiler | Browser/Node JS module Workers for trusted handlers/scalar functions; not Wasm or full actor source compilation. |

The **currently pinned public receipt is `atto.browser.guest.v2`**, with compiler ABI 2. The pinned subset supports classes, scalar actors and enums as documented in `COMPILER_CONTRACT.md`. Actors are isolated as separate `WebAssembly.Instance` objects and private memories **within one disposable tenant Web Worker**, not as one Worker per actor. This is not general actor-to-actor messaging, resumable tasks, supervisor CONTROL, or full AttoLang support. Unpublished compiler candidates (including actor-pipeline v3) require independent source/guest verification and explicit approval before a new binary, receipt or runner is shipped.

## Intended, unshipped architecture

```
UI -> Rust compiler-as-Wasm Worker -> validated guest Wasm32
   -> tenant A Web Worker -> actor A1: own Wasm Instance, memory, bounded heap/frame arena
                          -> actor A2: separate Wasm Instance, memory, heap/frame arena
   -> tenant B Web Worker -> actor B1: own Wasm Instance, memory, heap/frame arena
```

The **32-bit offsets** in Wasm32 linear memory remain 32-bit even on a 64-bit device. One module instance with multiple arenas is only logically separated; separate `WebAssembly.Instance`/private memories give an actual Wasm memory boundary. The browser engine's implicit Wasm call stack is **not** itself a compiler-owned actor stack. Synchronous non-cooperating execution blocks its Worker; `Worker.terminate()` kills all actors inside that tenant Worker. A browser Worker is not an OS tenant sandbox.

The pinned v2 subset has basic actor source lowering, bounded mailboxes, private actor Wasm instances and tenant-worker cancellation; **general actor-to-actor transport, resumable source continuations, comprehensive generation fencing, supervised restart and cross-backend feature parity are still unproved**. Passing host-substrate tests or parsing newer syntax is insufficient. The new `oreslang-source.wasm` browser tenant host prototype is a **trusted-fixture reference only**; its C-generated Wasm test is not Atto-compiled source proof. See [compiler contract](COMPILER_CONTRACT.md).

**Canonical operator and public compiler drift:** The approved target ([atto-spec #143](https://github.com/atto-lang/atto-spec/pull/143), [#151](https://github.com/atto-lang/atto-spec/pull/151)) reserves `%` but **does not reserve both caret spellings**: statement-leading `^ value;` is return, contiguous signed integer `a ^^ b` is bitwise XOR, and Boolean XOR is `Xor(bool,bool)`. Integer shifts use `<<<`/`>>>` with checked counts 0..63; `<<`/`>>` are typed I/O. The **pinned public compiler still incorrectly accepts infix single `^`** (confirmed by executing the actual browser compiler in [playground draft #198](https://github.com/atto-lang/atto-lang.github.io/pull/198)). It must not be promoted as current language parity. The host is prepared to report future checked-shift `panic_code=7`, but the pinned Wasm binary is not updated. Do not substitute JavaScript host emulation or preview-only syntax for executable compiler evidence.