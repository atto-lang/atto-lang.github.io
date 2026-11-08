# AttoLang Playground Architecture Lab

An interactive, dependency-free static site for the AttoLang playground architecture and evidence-first deployment workflow. It deliberately preserves the Oreslang repository and `.ores` legacy names. Frontend and tests use browser JavaScript and Node.js only; no Python scripts or tools are part of this project.

## Preview

Run `node scripts/serve.mjs` and open `http://127.0.0.1:8088/`. This loopback-only Node static server has no dependencies. The interface does not need external network requests for its seeded views. Browser capability probes and deployed-asset readback require an HTTP(S) origin; `file://` does not support Worker modules. Build artifacts here are a *preview*, not a live deployment.

### Verify

```bash
node scripts/generate-manifest.mjs
node scripts/verify.mjs
node scripts/smoke-node.mjs --out node-host-probe.json
```

`smoke-node.mjs` runs a source-free Wasm host canary in Node worker_threads and prints a machine-readable result. It is **not** an AttoLang compiler-backed receipt. Browser probes likewise compile a tiny source-free Wasm module in a real module Worker and compare separate Wasm memories. Passing does **not** prove actor isolation; two actors sharing one Wasm memory have no automatic engine-enforced memory boundary.

## Contents

- **Overview + architecture**: interactive pipeline selection (Rust-to-Wasm, direct LLVM/Clang Wasm, JavaScript ESM), browser/Node host switch, clickable evidence boundary, per-tenant Worker target.
- **Comparison**: which compiler is actually used, where the binaries execute, Wasmtime/native vs browser Wasm APIs, JS GC limitations.
- **Verification board**: source snapshot, documented vs missing receipt statuses, imported unverified claims, live browser host probes.
- **Provenance**: exact default-branch snapshot SHAs and public browser compiler receipt pin, with optional same-origin browser byte readback.
- **Queue + smoke**: twelve small hardening tasks with local status and four reusable browser/Node/actor/release checklists.
- **Export + import**: browser localStorage state and JSON receipt import (strict, bounded schema). Imported receipt claims never update the “trusted” metric. No GitHub account authentication or API keys.

## Snapshot vs release

The as-of 2026-11-08 default-branch commit IDs in `data.js` were read from the connected GitHub repositories. The browser compiler pin came from `atto-lang/atto-lang.github.io/play/public/atto_compiler.receipt.json`. **Neither establishes the deployed GitHub Pages revision.** Browser and Node compiler-backed guest receipts are *not* seeded as executed evidence, because no independently audited run, job attempt and nonzero steps were inspected for these exact heads. Check current GitHub state before promoting any status.

The published browser compiler comes from **`atto-lang/atto-source.rs`**, not **`oreslang-source.rs`**. `oreslang-source.rs` is an independent native Cranelift prototype. `oreslang-source.wasm` invokes native LLVM/Clang and runs a narrow guest in Node worker_threads using V8 WebAssembly; it is not a browser Wasmtime runtime. `oreslang-source.js` emits JS ESM and offers trusted browser/Node Worker references, with source-level actor lowering outstanding.

## Deployment proposal

Target path: `atto-lang/atto-lang.github.io/play/architecture/`, linked from `/play/`. The existing playground release packager has a reviewed enumerated allowlist; **do not bypass it** to deploy this new route. Add dashboard files only after the Pages packager and verification test list are amended under independent review. Record the final deployed site manifest and HTTPS readback. `site-manifest.json` is a local file hash inventory and *not* a deployment receipt. The optional **Verify same-origin deployed compiler bytes** action reads `../public/atto_compiler.receipt.json` and `../public/atto_compiler.wasm` when this dashboard is hosted as a sibling of `play/public/`; it compares downloaded bytes to both the receipt and this snapshot and reports stale pins rather than silently accepting them. It cannot validate a workflow run or release authorization.

## Evidence classification

`Documented` = code/docs show a path, but not necessarily a current executed test. `Target` = intended, not implemented. `Unsupported` = no claimed runtime route. `No receipt` = cannot validate current artifact. Imported JSON can assert SHAs and steps but remains **UNVERIFIED_IMPORT** until an independent GitHub audit. Zero-step workflows and source-free host canaries never imply compiler-backed guest execution. Browser Worker isolation is not an OS sandbox. `wasm32` offsets are 32-bit, but actor-owned heaps/stacks and isolation must be proven separately; if actors share one Wasm linear memory, memory access is not automatically isolated.

## Security note

CSP forbids third-party scripts, inline script execution and remote code. All imported JSON is rendered with text nodes; it is never interpreted as executable code. Import is capped to 500 KiB and 100 records. `localStorage` data remains origin-local, may be deleted with browser storage and is not a source of authority. Browser probes run a hardcoded source-free module and terminate their Worker. The site never executes user-imported Wasm or arbitrary JavaScript.
