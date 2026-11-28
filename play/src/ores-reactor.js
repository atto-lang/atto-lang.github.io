/** OresReactor: the tenant's host-owned NIO readiness reactor (browser profile).
 *
 * The reactor owns every pending host operation of one tenant: timers today,
 * plus any registered readiness source (fetch, WebSocket, actor mail). It
 * never executes guest code. A completed operation only becomes a *readiness
 * event* that the OresVM control loop collects with poll() and turns into a
 * runnable task (Java OresScheduler: "Timer callbacks never execute guest
 * turns"). This keeps one-writer-per-tenant semantics on a single Worker.
 *
 * Clock is injectable: { now(), setTimer(fn, ms) -> id, clearTimer(id) }.
 * The virtual clock (createVirtualClock) makes timer order deterministic in
 * tests and lets a run with only sleeping tasks finish without wall waits.
 */

export const MAX_PENDING_OPS = 4096;
export const MAX_TIMER_MS = 60_000;

export function realClock() {
  return {
    virtual: false,
    now: () => (globalThis.performance?.now?.() ?? Date.now()),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: id => clearTimeout(id),
  };
}

/** Carrier clock: real monotonic time, but no host timers. The carrier fires
 *  due timers itself on every poll and parks until nextDeadline(). */
export function carrierClock() {
  return {
    virtual: false,
    polled: true,
    now: () => (globalThis.performance?.now?.() ?? Date.now()),
  };
}

/** Deterministic clock: time only moves when the control loop advances it. */
export function createVirtualClock() {
  let time = 0;
  return {
    virtual: true,
    polled: true,
    now: () => time,
    advanceTo(t) { if (t > time) time = t; },
    setTimer: () => 0,
    clearTimer: () => {},
  };
}

export function createReactor({ clock = realClock(), maxPending = MAX_PENDING_OPS } = {}) {
  let nextOp = 1;
  let closed = false;
  const pending = new Map(); // op id -> { kind, deadline, timer, owner }
  const ready = [];          // completed readiness events, FIFO
  let wake = null;           // resolver for a loop parked in waitForEvent()

  function signal() {
    const w = wake;
    wake = null;
    w?.();
  }

  function admit(kind, owner) {
    if (closed) throw new Error('E_REACTOR: reactor closed');
    if (pending.size >= maxPending) throw new Error(`E_REACTOR_LIMIT: at most ${maxPending} pending host operations`);
    const id = nextOp++;
    pending.set(id, { id, kind, owner, deadline: null, timer: null });
    return id;
  }

  /** Complete an operation exactly once; late or duplicate completions are ignored. */
  function complete(id, value = 0n, failure = null) {
    const op = pending.get(id);
    if (!op) return false;
    pending.delete(id);
    if (op.timer !== null) clock.clearTimer(op.timer);
    ready.push({ op: id, kind: op.kind, owner: op.owner, value, failure });
    signal();
    return true;
  }

  /** One-shot timer: owner becomes runnable once `ms` milliseconds elapse. */
  function timer(ms, owner) {
    if (typeof ms === 'bigint') {
      if (ms < 0n || ms > BigInt(MAX_TIMER_MS)) throw new Error(`E_TIMER: sleep must be 0..${MAX_TIMER_MS} ms`);
      ms = Number(ms);
    }
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMER_MS) throw new Error(`E_TIMER: sleep must be 0..${MAX_TIMER_MS} ms`);
    const id = admit('timer', owner);
    const op = pending.get(id);
    op.deadline = clock.now() + ms;
    op.seq = id;
    // A zero-length sleep is a yield through the reactor: ready on the next
    // poll, behind work that is already ready, with no clamped wall timer.
    if (ms === 0) { complete(id, 0n); return id; }
    if (!clock.polled) op.timer = clock.setTimer(() => complete(id, 0n), ms);
    return id;
  }

  /** Register an externally completed operation (fetch, socket, mailbox). */
  function register(kind, owner) {
    return admit(kind, owner);
  }

  function cancel(id) {
    const op = pending.get(id);
    if (!op) return false;
    pending.delete(id);
    if (op.timer !== null) clock.clearTimer(op.timer);
    return true;
  }

  /** Collect every readiness event; on a polled clock, fire due timers first. */
  function poll() {
    if (clock.polled) fireDue(clock.now());
    return ready.splice(0, ready.length);
  }

  /** Earliest pending timer deadline (Infinity when none). */
  function nextDeadline() {
    let earliest = Infinity;
    for (const op of pending.values()) if (op.kind === 'timer' && op.deadline < earliest) earliest = op.deadline;
    return earliest;
  }

  function fireDue(now) {
    const due = [...pending.values()]
      .filter(op => op.kind === 'timer' && op.deadline <= now)
      .sort((a, b) => a.deadline - b.deadline || a.seq - b.seq);
    for (const op of due) complete(op.id, 0n);
  }

  /** Park the loop until some event is ready. A virtual clock jumps straight
   *  to the earliest deadline instead of waiting on wall time. */
  function waitForEvent() {
    if (ready.length) return Promise.resolve();
    if (clock.virtual) {
      let earliest = Infinity;
      for (const op of pending.values()) if (op.kind === 'timer' && op.deadline < earliest) earliest = op.deadline;
      if (earliest !== Infinity) {
        clock.advanceTo(earliest);
        fireDue(earliest);
        return Promise.resolve();
      }
    }
    return new Promise(resolve => { wake = resolve; });
  }

  function close() {
    closed = true;
    for (const op of pending.values()) if (op.timer !== null) clock.clearTimer(op.timer);
    pending.clear();
    ready.length = 0;
    signal();
  }

  return {
    timer, register, complete, cancel, poll, waitForEvent, close, nextDeadline,
    get pendingCount() { return pending.size; },
    get readyCount() { return ready.length; },
    hasTimers() { for (const op of pending.values()) if (op.kind === 'timer') return true; return false; },
    pendingOwners() { return [...pending.values()].map(op => ({ op: op.id, kind: op.kind, owner: op.owner })); },
    now: () => clock.now(),
  };
}
