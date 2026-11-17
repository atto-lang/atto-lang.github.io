# Browser HTTP capability — implementation boundary

The browser playground currently compiles a restricted Atto subset. **The pinned compiler does not lower `await fetch(url)` to Wasm.** This change provides a hardened JavaScript transport capability, not a claim of end-to-end Atto HTTP execution.

## Host-side contract

`createBrowserFetchCapability({allowOrigins, fetchImpl, maxBytes, maxRequests})` defaults to no network access. `request(id, url, {signal})` returns `{id, status, body: Uint8Array}` for an explicitly allowed HTTPS origin. Requests use GET, omit credentials, reject redirects and opaque responses, and enforce a bounded body size and concurrency quota. `cancel(id)` aborts an in-flight request and `close()` revokes the capability. Browser CORS and CSP remain additional restrictions.

The host deliberately **does not import network functions into arbitrary guest modules**. Existing runner admission and its strict guest ABI remain unchanged.

## Required before an Atto `fetch` showcase becomes runnable

1. Specify versioned request-ID, URL encoding, response ownership, and error-code ABI in the Atto compiler/runtime contract.
2. Lower a suspending Atto `fetch` call into an explicit yield/resume continuation; synchronous Wasm imports cannot await JavaScript promises.
3. Define cancellation, actor teardown, deadline, memory limits, and per-actor permission inheritance.
4. Support response streaming with bounded backpressure (this initial adapter buffers at most 1 MiB by default).
5. Gate permitted origins in a reviewed CSP policy and add compiler, browser-worker, CORS, redirect, cancellation, and cross-origin tests.
6. Only then connect the adapter to the disposable guest runner and promote the HTTP example from illustrative to runnable.

Do not silently grant network imports or widen `connect-src` for all guests.
