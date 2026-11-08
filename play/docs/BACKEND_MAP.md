# What actually compiles and runs at /play/?

The GitHub Pages `/play/` release vendors **`atto_compiler.wasm` from `atto-lang/atto-source.rs`**: a separate **Rust** AttoLang compiler cross-compiled to `wasm32-unknown-unknown`. The exact reviewed source head/tree, compiler binary SHA-256, and guest ABI are in `play/public/atto_compiler.receipt.json`. A browser compiler Worker runs that first Wasm module; a different disposable browser Worker executes the **guest Wasm** it emits from `.atto` source. There is no compilation server, JavaScript source evaluator, Wasmtime inside the browser or browser-hosted LLVM.

| Repository | What it currently does | Runtime/target |
| --- | --- | --- |
| `atto-lang/atto-source.rs` | Rust source-to-Wasm compiler used by the site | Compiler itself runs as Wasm in a browser Worker, produces guest Wasm32; Pages pins a particular older artifact. |
| `ores-truffle-oreslang/oreslang-source.wasm` | Node JS bridge to external native LLVM compiler and Clang/LLD | Produces Wasm guest; separately has **native Rust Wasmtime AOT** host and Node pooled Workers. Not the site compiler. |
| `ores-truffle-oreslang/oreslang-source.rs` | Independent Rust/Cranelift compiler | Native object files only at present; **does not** use Wasmtime for actors. |
| `ores-truffle-oreslang/oreslang-source.js` | Experimental source-to-JavaScript/ESM transpiler | Browser/Node JS module Workers for trusted handlers/scalar functions; not Wasm or full actor source compilation. |

The **currently pinned public receipt is `atto.browser.guest.v1`**, which does *not* support class/actor/enum execution or per-tenant pooled Wasm actors. The upstream `atto-source.rs` documentation describes a newer **v2 actor ABI**, but the public runner and binary **must be upgraded together** after independent compiler/artifact approval. Do not relabel the existing receipt to v2 or bypass release/disclosure requirements.

## Intended, unshipped architecture

```
UI -> Rust compiler-as-Wasm Worker -> validated guest Wasm32
   -> tenant A Web Worker -> actor A1: own Wasm Instance, memory, bounded heap/frame arena
                          -> actor A2: separate Wasm Instance, memory, heap/frame arena
   -> tenant B Web Worker -> actor B1: own Wasm Instance, memory, heap/frame arena
```

The **32-bit offsets** in Wasm32 linear memory remain 32-bit even on a 64-bit device. One module instance with multiple arenas is only logically separated; separate `WebAssembly.Instance`/private memories give an actual Wasm memory boundary. The browser engine's implicit Wasm call stack is **not** itself a compiler-owned actor stack. Synchronous non-cooperating execution blocks its Worker; `Worker.terminate()` kills all actors inside that tenant Worker. A browser Worker is not an OS tenant sandbox.

Source actor lowering, bounded/typed mailboxes, heap and continuation ownership, generation fencing, cancellation, transport, worker fault isolation, supervised restart and browser-native compiler parity are future milestones, **not current /play/ claims**. The new `oreslang-source.wasm` browser tenant host prototype is a **trusted-fixture reference only**; its C-generated Wasm test is not Atto-compiled source proof. See [compiler contract](COMPILER_CONTRACT.md).

**Release warning:** The older checked-in compiler contract documents `%` as part of the old playground subset, although the current AttoLang language policy reserves `%`, `^`, and `^^`. Treat this as a pinned-compiler compatibility gap requiring a reviewed compiler update and negative guest/CI tests, not an excuse to rewrite semantics at the JS host boundary. The website must not advertise compiler parity until this divergence is removed.