# atto.browser.http.v1 — experimental async Wasm request/resume ABI

Status: **non-shipped conformance prototype**. This is a host-side protocol exercised
with a manually assembled **real Wasm test fixture**, not an Atto compiler output
and not proof that Atto source expressions such as \`await fetch(url)\` execute.

The public runner remains on the strict \`atto.browser.guest.v2\` import allowlist;
\`atto_http_v1\` is explicitly **not granted**. Neither the host bridge nor the
fetch capability is included in the GitHub Pages asset allowlist. Do not enable
this contract in the user-facing playground without compiler/source admission,
guest type-section verification, a reviewed CSP policy and browser E2E.

## Negotiation

The candidate module declares exactly one Wasm custom section named
\`atto.http.v1\`, with a single payload byte \`0x01\`. The marker is a version
assertion, **not** an authenticity guarantee. The prototype only accepts two
function imports from \`atto_http_v1\`. A real runner must additionally verify
all binary function signatures and compiler provenance before instantiation.

| Direction | Signature | Contract |
|---|---|---|
| guest import | \`atto_http_v1.request(id:i32, url_ptr:i32, url_len:i32) -> i32\` | Nonblocking admission: 1 accepted, 2 bad request, 3 closed, 4 busy |
| guest import | \`atto_http_v1.cancel(id:i32) -> i32\` | Returns 1 if active cancellation signaled, otherwise 0 |
| guest export | \`memory: WebAssembly.Memory\` | Private unshared Wasm32 memory |
| guest export | \`atto_http_v1_reserve(len:i32) -> i32\` | Guest-owned, in-bounds response buffer, fresh for this result |
| guest export | \`atto_http_v1_resume(id:i32, tag:i32, code:i32, ptr:i32, len:i32)\` | Exactly one completion notification unless tenant is closed |

Request IDs must be positive unique integers among pending requests. URL bytes
are snapshotted from the guest and decoded as strict UTF-8, at most 2048 bytes.
The host validates the Wasm memory range before reading. Admission does **not**
block the worker thread. The matching response is delivered asynchronously via
\`resume\`. The caller must suspend cooperatively and persist its own state.
That source-to-continuation lowering is **not implemented** in this PR.

For \`tag=0\` (success), \`code\` is the HTTP status and \`ptr,len\` describe
response bytes owned by the guest. The host calls \`reserve(len)\`, obtains the
current memory buffer after possible growth, checks its bounds and copies bytes
before resuming. The guest retains ownership and must reclaim the space.
\`tag=1\` indicates an error, \`ptr=len=0\`. Error codes:
1 permission, 2 aborted, 3 timeout, 4 quota, 5 size, 6 redirect,
7 opaque response, 8 body, 9 closed, 255 transport/unknown.

The host has an explicit \`allowOrigins\` array, deny-by-default. The backing
capability performs HTTPS GET only, credentials omitted, no referrer, no
redirects, strict origin/URL checks, and bounded buffering. Defaults:
1 MiB response, 8 concurrent requests, 30s total deadline. These are host
ceilings; they are not actor permissions. On actor/tenant teardown,
\`close()\` revokes the capability and suppresses all later guest callbacks,
even if injected transports ignore abort. \`drain()\` settles active logical
requests and reports a failing guest callback; it does not certify that
uncooperative custom transports have physically stopped.

## Before compiler-backed promotion

1. Implement async suspension and pinned-frame liveness in the Rust source
   checker, lowering, and Wasm backend. In particular, an ordinary synchronous
   \`main:()->i64\` cannot return a Promise through a Wasm import.
2. Specify exact compile-time borrowing of URL strings and \`Response\` values.
   Guest-owned buffers need linear/single-ownership release and memory limits.
3. Validate raw Wasm import/export signatures and compiler identity in a
   distinct opt-in admission profile; never let a marker alone grant network.
4. Bind connect permissions to a specific tenant/actor capability, not a
   process-wide allowlist. Implement cancellation on actor shutdown/panic and
   generation-fence IDs across actor restart and reuse.
5. Prove deadlines, backpressure, cancellation, memory bounds, CORS and CSP
   with compiled source fixtures in both Node and real Chromium.
6. Pin the new compiler binary/digest, obtain independent code-owner approval,
   and only then replace the relevant HTTP \`PREVIEW ONLY\` showcase with a
   genuinely runnable example.

## Evidence boundary

\`play/tests/browser-http-abi-v1.test.mjs\` compiles and instantiates a
synthetic Wasm binary containing the version marker, request/cancel imports,
response reserve/resume exports and a real \`main\`. It checks byte transfer,
deny-by-default behavior, redirects/opaque responses, cancellation, deadlines,
memory and URL admission, and release exclusion. This demonstrates only the
JavaScript/Wasm boundary. The public \`validateGuestImportABI\` continues to
reject HTTP imports and the release workflow continues to deny the source
module. Never report these tests as Atto source execution.
