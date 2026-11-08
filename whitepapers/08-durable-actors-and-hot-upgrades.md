---
title: "Durable Actors, Supervision, and Hot Upgrades"
permalink: /whitepapers/08-durable-actors-and-hot-upgrades.html
---

# Durable Actors, Supervision, and Hot Upgrades

**Technical Papers · Paper 08 · Version 0.1 · 8 November 2026**  
**Status:** Architecture proposal and design constraints. It is not a claim of end-to-end durable actor support.

## Abstract

A long-running actor system must manage more than message dispatch. It must define how actors are identified, how state survives process failure, how activations are supervised, and how code can be upgraded without allowing stale work to mutate new state. Durability and hot upgrades are therefore lifecycle protocols spanning storage, scheduling, messaging, memory ownership, and security.

This paper describes a model in which logical actor identity is separated from a particular runtime activation. It outlines persistence, recovery, generation fencing, quiescence, rollback, and the tests required to make these operations reliable.

## 1. Logical identity and activation identity

An actor's logical identity should remain stable even when its process or runtime activation changes. A useful durable identity is a tuple such as tenant, namespace, and object identifier. It names the durable entity, not the memory address of one running instance.

An activation is one concrete execution generation of that logical actor. It owns its current heap, stack or continuation state, mailbox admission state, timers, subscriptions, and external resource handles. Restart creates a new activation generation, even where the logical actor identifier remains unchanged.

A stable ActorRef should resolve through a supervisor or routing layer rather than expose raw pointers into activation memory. Messages and handles tied to an old generation must be fenced before old memory is reclaimed.

## 2. State model and persistence boundary

Durable actor state must define what is persisted and when. Common approaches include snapshots, append-only event logs, write-ahead logs, or combinations of them. The choice affects recovery time, consistency, storage amplification, and compatibility.

A useful design separates:
- **Volatile activation state:** caches, scheduler queues, temporary borrows, and in-flight local data.
- **Durable domain state:** state required to reconstruct the logical actor.
- **Protocol state:** schema versions, sequence numbers, deduplication keys, and upgrade metadata.
- **External resources:** sockets, files, locks, and leases that must be reopened or reacquired after restart.

The runtime must not serialize arbitrary stack frames or closures as a shortcut for durability. Durable state should be explicit, typed data with a versioned schema.

## 3. Transaction boundaries and message processing

A durable actor needs a clear relationship between message handling and persistence. If a message changes durable state, the system must specify whether the state write happens before the handler acknowledges completion, whether the message is recorded before processing, and how retries avoid duplicate effects.

Exactly-once behavior cannot be asserted merely because messages have sequence numbers. The system must define the transaction boundary, deduplication state, and treatment of external side effects. Many systems can provide at-least-once delivery plus idempotent handlers or transactional state updates; the paper should state which guarantee applies to each transport.

The commit protocol should distinguish:
1. Message accepted into the runtime mailbox.
2. Message selected for processing.
3. Handler completed.
4. Durable state commit completed.
5. Acknowledgment returned to the publisher.

These events are not interchangeable. Failure between them creates distinct recovery cases.

## 4. Supervision and restart

A supervisor manages actor activation, restart policy, and failure containment. Policy may include restart intensity, backoff, escalation, dependency ordering, and shutdown deadlines.

Restart should be treated as a state transition rather than simply constructing another object. Before the replacement is admitted, the supervisor should decide the fate of:
- Queued messages.
- In-flight messages.
- Suspended tasks.
- Timers.
- Pub-sub subscriptions.
- External leases.
- Durable state transactions.
- Generation-scoped handles.

A restart storm can overwhelm storage and scheduler capacity. Admission and backoff need bounded resources and observability.

## 5. Generation fencing

Generation fencing ensures that work created for an old activation cannot corrupt a new activation. Every activation-scoped operation should validate its generation at the point where it commits a side effect, not merely when a request is first created.

This matters for delayed messages, callbacks, timer events, storage completions, channel waits, and tasks resumed after suspension. A stale continuation may be memory-safe yet semantically invalid because its activation no longer owns the logical actor.

Fencing tokens should be monotonically advanced or otherwise uniquely bound to an activation and validated by the relevant resource boundary. Durable storage and external services may need their own fencing tokens if stale processes can still reach them.

## 6. Hot-upgrade protocol

A safe upgrade should be a controlled protocol:

1. **Prepare:** validate the new artifact, schema migrations, compatibility rules, and runtime ABI.
2. **Fence admission:** prevent new work from entering the old generation beyond a defined boundary.
3. **Quiesce:** finish or cancel current work according to the upgrade policy.
4. **Persist:** commit required state and record the upgrade checkpoint.
5. **Migrate:** transform durable state with a versioned, testable migration.
6. **Activate:** start the new generation with the migrated state.
7. **Verify:** perform health and protocol checks before routing normal traffic.
8. **Commit or rollback:** route traffic to the new generation or restore the previous compatible generation.
9. **Reclaim:** release old-generation resources only after stale work is fenced and no valid references remain.

Rollback is not always a simple switch to old code. A state migration may be irreversible, or external side effects may already have occurred. Migration compatibility and rollback capability must be designed together.

## 7. ABI and state compatibility

A hot-load ABI should define stable handles, generation fields, symbol resolution, message schema compatibility, state migration hooks, and ownership rules. A stable ActorRef is a logical handle; it must not be implemented as a raw pointer that silently outlives an activation.

The runtime should version the ABI and reject incompatible artifacts before quiescing healthy actors. If an upgrade cannot prove compatibility, it should fail without changing the active generation.

## 8. Pub-sub and recovery

Actors may subscribe to multiple groups and may need to re-establish subscriptions after restart. Subscription restoration must be generation-aware. Otherwise, a late unsubscribe from an old generation could remove a new subscription, or messages could be delivered twice.

Publish, unsubscribe, leave, group close, actor termination, and supervisor restart can race. Each operation needs a serialization or commit rule. Bounded queues and backpressure must remain active during recovery; restart should not bypass quotas or create an unbounded replay backlog.

## 9. Failure and disaster recovery

A durable actor system must distinguish process crash, host loss, storage outage, network partition, schema incompatibility, and operator-initiated upgrade. Recovery may require replay from a log, snapshot restore, lease reacquisition, or migration to another host.

The design should define the consistency guarantee for each storage and messaging mode. It should also specify retention, backup, encryption, key rotation, tenant isolation, and administrative recovery procedures.

## 10. Testing and evidence

The conformance suite should include crash injection before and after every persistence boundary, duplicate delivery, stale generation callbacks, interrupted migrations, rollback after partial activation, subscription restoration, restart storms, storage unavailability, and old-version/new-version message exchange.

A test that invokes a host supervisor method does not prove that compiled actor guest code survives restart. A durable feature requires end-to-end tests that execute guest handlers, commit state, terminate the activation or process, reconstruct the actor, and compare externally observable behavior.

## 11. Current status

The stable-reference, generation-fencing, durable identity, supervisor, and hot-upgrade architecture described here is a target design. This paper does not claim that all such mechanisms are integrated across Java/GraalVM, LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift.

Implementation reports should identify the exact repository, commit and tree, storage adapter, runtime ABI version, guest fixtures, failure-injection results, and the recovery guarantees actually proven.

## Conclusion

Durability is a lifecycle property. It depends on explicit identity, state schemas, commit boundaries, supervision, generation fencing, and safe reclamation. Hot upgrades are reliable only when those mechanisms cooperate to prevent stale work from reaching new state.

## References

- [AttoLang specification repository](https://github.com/atto-lang/atto-spec)
- [AttoLang platform conformance](https://github.com/atto-lang/atto-platform-conformance)
- [Public playground compiler contract](../play/docs/COMPILER_CONTRACT.md)
