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
