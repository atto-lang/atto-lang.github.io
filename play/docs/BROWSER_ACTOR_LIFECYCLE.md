# Browser actor execution — staged host integration

This is **source-only infrastructure**. The public, SHA-256-pinned
atto_compiler.wasm still uses the older subset and currently rejects
top-level class, enum and actor definitions. This patch does not update
or publish a compiler binary and does not represent a deployed feature.

## Next reviewed compiler target

The private Rust source compiler candidate atto-lang/atto-source.rs PR #25
(plus integrated class/enum work and its actor dependencies) provides a
restricted, browser-executable subset:
- Nominal enum values with checked type comparison;
- Bounded class instances, constructor/field/method lowering;
- Scalar actor receive handlers and source-level spawn/send;
- One worker and independent Wasm instance per spawned actor;
- A bounded 32-message mailbox per actor, FIFO delivery and typed admission;
- Terminal source-level await on get_done(), resolved only after a child
  acknowledges close with the exact processed-message count.

The host grants only the compiler's enumerated atto imports. Child actor
workers deny nested actor capabilities and stdio. Each program has a maximum
of four actors, 2-second per-actor startup/receive/close deadlines, and a
12-second parent deadline for actor programs; Stop terminates the parent and
its nested workers. Browser workers are not OS security or tenant isolation.

The host cannot infer actor support from a successful main() compile:
the specific compiler's actor exports/imports must be present. No user source
is evaluated as JavaScript or transmitted to a compilation server.

## Release gate

Do not copy source-built private compiler artifacts into this public repository
until independent review, exact-head nonzero-step native/wasm/Chromium receipts,
byte-identical source/compiler provenance, explicit binary-disclosure approval,
and the manually approved Pages workflow have all succeeded. In particular,
resolve atto-lang/atto-lang.github.io issue #5 (Pages bypass/unprotected main).
After promotion, add real in-browser class/enum and actor source examples and
execute compiler->guest->multiple-Worker E2E tests on the staged release tree,
then independently check both public HTTPS origins.

The current Node lifecycle tests exercise the same worker state machine with
fault-injectable fake workers, and do not alone establish that the browser
has the actor-enabled compiler deployed.

## Actor worker protocol hardening (v1)

Every actor `init` and `ready` exchanges an explicit protocol version and
actor ID. Each admitted message receives one monotonically increasing sequence
number; the child echoes that sequence with its response. The parent rejects
replayed, skipped, mismatched-identity, or unsolicited replies, and the child
rejects replayed/skipped receives. Terminal close carries the final message
sequence and its acknowledged count. A cancellation between readiness and a
drain continuation, or from an output callback, cannot reopen a terminal actor.
These controls are tested with fake-worker race injection **and** real Chromium
Web Worker replay tests. They establish protocol integrity, not cryptographic
isolation or arbitrary untrusted-code sandboxing.


## Actor stress evidence (source-free)

A separate executable Wasm fixture runs four nested browser workers,
checks host admission results inside guest code, and demands 128 ordered
receive replies (32 per actor) while rejecting every 33rd message.
A fifth spawn is rejected and a disposable parent worker cannot be reused
for a second guest program. A deterministic injected-worker suite tests
concurrent cancellation and terminal-state integrity. These are bounded
runtime tests, not full actor scheduling or OS-tenant isolation.

## Parent-owned actor scope (concurrent drain and sibling cancellation)

The parent runner owns an explicit ActorScope; it rejects a fifth child and
keeps each child in its registry until completion, cancellation, or failure.
Child shutdown now drains concurrently under bounded individual deadlines,
so one slow actor does not hold up delivery to every other actor. Results are
buffered per actor and flushed in spawn order after successful terminal ACKs.
Any panic, missing ACK or protocol error cancels all remaining children.
The parent also accepts a cooperative cancel message while suspended on child
I/O; the UI retains immediate Worker termination as its independent deadline
backstop for synchronous guest loops. Fault-injection tests cover 40 rounds of
sibling-failure cancellation and 40 rounds of parent cancellation with four
outstanding children, checking exactly-once termination.


## Strict Wasm admission and terminal pre-start cancellation

Both parent and nested actor Workers now validate a bounded (1 MiB)
Uint8Array before instantiating a guest and reject any *otherwise valid*
Wasm module containing an automatic start section. A start function executes
at instantiation time, before host invocation of main()/actor receive(), and
is not part of this actor ABI. Source-free valid-start fixtures prove this
denial in Node and both real Chromium worker domains. Nested actor workers
also reject oversized bytecode before expensive WebAssembly.validate.
A cooperative parent cancellation arriving before initialization is latched;
any subsequent program submission returns E_RUN_CANCELLED and does not execute
guest code.


## Wasm linear-memory and table limits

A small validated Wasm file can declare unbounded memory, so the existing
1 MiB *binary* size cap is insufficient. The parent and every nested actor
worker now reject imported/local tables, imported memories, shared or memory64
memories, and any local memory without an explicit maximum. At most one
32-bit unshared local memory is allowed with both initial and maximum size
at or below **16 Wasm pages (1 MiB)**. Function declarations and imported
function count are also capped at 1024. Before actual compilation, valid
source-free negative Wasm fixtures exercise local and imported resource
limits in Node and in **both real Chromium worker domains**. A positive
growth fixture verifies the 16-page maximum is enforced by WebAssembly.
These are *per-instance Wasm linear-memory* bounds, not total process RAM,
C stack, JIT compiler resource, allocation/CPU time or OS tenant isolation.


## Noncooperative nested receive cancellation

The browser fault suite also runs a valid source-free actor guest whose
receive handler loops forever without calling cooperate. It observes the
nested worker script being fetched, cancels the parent while the child has
outstanding work, and confirms the parent reports failure (never successful
completion) and refuses one-shot worker reuse. The parent can react while
awaiting child I/O because the CPU-bound receive runs in a separate Worker.
The test does not claim OS-level sandboxing, guaranteed browser-wide orphan
worker accounting, or forceful cancellation of an infinite loop running in
the parent itself; the UI's parent Worker deadline remains that backstop.


## Forced termination of a parent with four busy child workers

The browser fault matrix creates a parent whose guest spawns four nested
actor Workers with noncooperative infinite receive handlers. Chromium CI
checks four child worker script requests, then forcefully terminates the
parent, rejects any late successful completion and proves a new independent
parent runs correctly. Chromium's page-level and browser-level CDP Target
enumeration did not expose nested worker target lifetimes in CI, so this
does **not** independently prove that all child worker processes were
reclaimed. Actual orphan-worker accounting remains a release-hardening
follow-up rather than a claimed acceptance proof.
Separate deterministic worker-task tests cover 160 cancellation/deadline/
late-reply races and ensure even an exception from terminate() cannot strand
a settled request or prevent a subsequent run.
