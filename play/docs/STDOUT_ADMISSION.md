# Browser stdout admission contract

This document covers the **restricted Rust-compiled Wasm browser guest profile**, not full AttoLang channel runtime support. The language-wide contract is specified by [atto-spec PR #32](https://github.com/atto-lang/atto-spec/pull/32).

## No capacity suspension

For a typed `stdio.out` handle, `writech stdio.out, "Hello";` and `stdio.out << "Hello";` are **non-suspending admissions**. Both retain the I/O effect and mean “the output channel accepted one complete message,” not “the operating system or user has received it.”

The browser compiler currently routes these forms through the existing `atto.print_*` Wasm host imports. These imports synchronously copy/encode into a tenant-local output capture; they never wait for browser UI rendering, pipe readiness, a network recipient or a terminal. This is a **quota-bounded capture profile**, not an infinitely growing buffer or an asynchronous OS stdout implementation.

## Resource accounting and failures

* The browser capture limit is **65,536 UTF-16 code units per tenant**. Actor output capture buffers share one tenant-wide admission budget so separate actors cannot each over-admit 65,536 units.
* Writes that cannot fit fail **atomically**, without changing the captured text, debiting quota or setting a misleading successful truncation indicator. The legacy `appendCapped` helper remains only for displaying/preparing diagnostic summaries; it is **not** a successful guest-channel write.
* Writes attempted after a capture is closed return `E_STDOUT_CLOSED`; quota exhaustion produces `E_STDOUT_QUOTA`. In this browser ABI v2 they surface as **host error/traps**, because `atto.print_*` imports return `void`; returning the normal typed `Result` requires a subsequent ABI/compiler change.
* Admission counts full UTF-16 messages including surrogate pairs; a message cannot be cut through the middle of a Unicode character and reported as accepted.
* The capture is ordered by import-call admission order. Actor scheduling may interleave writers; actor-output aggregation determines the final preview order. There is no implicit fsync or flush.

## Not yet implemented

The browser profile does **not** implement a general `Channel<T>.unbounded()` runtime, atomic selectable output admission, `await stdio.out.flush()`, OS-level drain completion, or typed failure results from `writech`. The language-wide requirement that all these features be correct remains a distinct backend/conformance milestone.

## Evidence

`node --test play/tests/stdio-admission.test.mjs` exercises local atomic quota logic, shared tenant accounting and a small genuine WebAssembly guest that invokes `atto.print_i64`. This is not a source compiler test. Rust compiler tests in [atto-source.rs PR #176](https://github.com/atto-lang/atto-source.rs/pull/176) cover the restricted `writech` and `<<` lowering; standalone source and actual guest execution are not interchangeable with runtime/OS backpressure evidence.
