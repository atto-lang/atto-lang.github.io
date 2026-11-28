/** OresScheduler: browser-profile control loop for compiler-lowered tasks.
 *
 * Mirrors the Java reference `dev.oreslang.runtime.OresScheduler` turn
 * contract. The compiler lowers every `susp`/`suspends` callable and every
 * `task { }` body to a small resumable state machine in guest Wasm (guest
 * ABI `atto.task.v1`, docs/TASK_ABI_V1.md). One turn = one call of
 * `atto_task_resume(handle, wake)`, which returns a Step:
 *
 *   DONE      result is in atto_task_result(handle)
 *   CALL      `await f(..)` of a suspending callable: run child first, then
 *             resume the caller with the child's result
 *   AWAIT     `await future`: park until that Future settles
 *   SPAWN     `task { }`: register the child, resume caller with its Future
 *   DETACH    `do task { }`: register the child, resume caller with 0
 *   SLEEP     `await sleeper(ms)`: park on a host reactor timer
 *   COOPERATE turn budget spent: requeue behind already-ready work
 *
 * The scheduler, not the Future, owns continuation placement. Futures are
 * host tokens (positive task ids) that only the scheduler can settle; the
 * guest never receives a frame handle of another task. Reactor completions
 * only make tasks runnable; they never execute a guest turn directly.
 */

export const TASK_STATUS = Object.freeze({
  DONE: 0, CALL: 1, AWAIT: 2, SPAWN: 3, DETACH: 4, SLEEP: 5, COOPERATE: 6,
});
const STATUS_NAME = Object.fromEntries(Object.entries(TASK_STATUS).map(([k, v]) => [v, k]));

export const MAX_LIVE_TASKS = 1024;
export const MAX_TURNS = 1_000_000;
/** Yield the Worker's event loop this often so reactor callbacks can land. */
export const TURNS_PER_SLICE = 256;

export class TaskFault extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

/**
 * guest: { main(): bigint, resume(handle, wake): number, request(handle): bigint,
 *          result(handle): bigint, close(handle): void }
 * reactor: createReactor() instance (timers / host readiness).
 * lanes: other turn sources (actor Mailmen) — { hasWork(), turn() }, both
 *   synchronous: a lane turn runs to completion on the carrier.
 */
export function createScheduler({
  guest, reactor, lanes = [], maxLiveTasks = MAX_LIVE_TASKS, maxTurns = MAX_TURNS,
  turnsPerSlice = TURNS_PER_SLICE, yieldSlice = defaultYield, trace = null,
}) {
  if (!guest || typeof guest.resume !== 'function') throw new TypeError('scheduler needs a task guest');
  if (!reactor) throw new TypeError('scheduler needs a reactor');

  let nextId = 1;
  let live = 0;
  let turns = 0;
  let closed = false;
  const tasks = new Map();   // id -> task record
  const futures = new Set(); // ids the guest may await (SPAWN results only)
  const ready = [];          // FIFO of task ids; CALL children jump the queue

  function admit(handle, kind, parent) {
    if (typeof handle !== 'bigint' || handle === 0n) {
      throw new TaskFault('E_TASK_ABI: guest returned an invalid task frame handle');
    }
    if (live >= maxLiveTasks) throw new TaskFault(`E_TASK_LIMIT: at most ${maxLiveTasks} live tasks per tenant`);
    const id = nextId++;
    tasks.set(id, {
      id, handle, kind, parent, state: 'ready', wake: 0n, waiters: [],
      awaiting: null, result: undefined, timer: null,
    });
    live++;
    return id;
  }

  function settle(task, value) {
    task.state = 'done';
    task.result = value;
    task.awaiting = null;
    live--;
    const handle = task.handle;
    task.handle = 0n;
    guest.close(handle); // the frame is recycled; the result lives on host-side
    for (const waiterId of task.waiters) {
      const waiter = tasks.get(waiterId);
      // A caller resumes right after its CALL child, like a direct return.
      const front = waiter.awaiting === task.id && task.kind === 'call';
      waiter.awaiting = null;
      makeReady(waiter, value, front);
    }
    task.waiters.length = 0;
    // A CALL child is never observable as a Future: forget it at once.
    if (!futures.has(task.id) && task.kind !== 'root') tasks.delete(task.id);
  }

  function makeReady(task, wake, front = false) {
    task.state = 'ready';
    task.wake = wake;
    if (front) ready.unshift(task.id); else ready.push(task.id);
  }

  /** Reject an await that would close a cycle in the VM-wide await graph. */
  function wouldDeadlock(waiter, target) {
    let cursor = target;
    for (let hops = 0; cursor && hops <= tasks.size; hops++) {
      if (cursor.id === waiter.id) return true;
      cursor = cursor.awaiting === null ? null : tasks.get(cursor.awaiting);
    }
    return false;
  }

  function turn(task) {
    task.state = 'running';
    const wake = task.wake;
    task.wake = 0n;
    turns++;
    const status = guest.resume(task.handle, wake);
    trace?.({ task: task.id, status: STATUS_NAME[status] ?? status, wake });
    switch (status) {
      case TASK_STATUS.DONE:
        settle(task, guest.result(task.handle));
        return;
      case TASK_STATUS.CALL: {
        const childId = admit(guest.request(task.handle), 'call', task.id);
        const child = tasks.get(childId);
        task.state = 'waiting';
        task.awaiting = childId;
        child.waiters.push(task.id);
        // `await f()` runs f before anything else that was already ready,
        // like a direct call that may suspend.
        ready.unshift(childId);
        return;
      }
      case TASK_STATUS.AWAIT: {
        const token = guest.request(task.handle);
        const id = token > 0n && token <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(token) : 0;
        const target = futures.has(id) ? tasks.get(id) : null;
        if (!target) throw new TaskFault('E_TASK: await of an unknown or foreign Future');
        if (target.state === 'done') { makeReady(task, target.result); return; }
        if (wouldDeadlock(task, target)) {
          throw new TaskFault(`E_DEADLOCK: task ${task.id} awaiting Future ${id} closes an await cycle`);
        }
        task.state = 'waiting';
        task.awaiting = id;
        target.waiters.push(task.id);
        return;
      }
      case TASK_STATUS.SPAWN:
      case TASK_STATUS.DETACH: {
        const detached = status === TASK_STATUS.DETACH;
        const childId = admit(guest.request(task.handle), detached ? 'detached' : 'task', task.id);
        if (!detached) futures.add(childId);
        ready.push(childId);
        // The spawning task continues first with its Future token.
        makeReady(task, detached ? 0n : BigInt(childId), true);
        return;
      }
      case TASK_STATUS.SLEEP: {
        const ms = guest.request(task.handle);
        task.state = 'sleeping';
        task.timer = reactor.timer(ms, task.id);
        return;
      }
      case TASK_STATUS.COOPERATE:
        makeReady(task, 0n);
        return;
      default:
        throw new TaskFault(`E_TASK_ABI: unknown task step ${status}`);
    }
  }

  function collectReactorEvents() {
    for (const event of reactor.poll()) {
      const task = tasks.get(event.owner);
      if (!task || task.state !== 'sleeping' || task.timer !== event.op) continue;
      task.timer = null;
      if (event.failure) throw new TaskFault(String(event.failure));
      makeReady(task, event.value ?? 0n);
    }
  }

  function describeBlocked() {
    return [...tasks.values()]
      .filter(t => t.state === 'waiting' || t.state === 'sleeping')
      .map(t => `task ${t.id} (${t.kind}) ${t.state}${t.awaiting ? ` on ${t.awaiting}` : ''}`)
      .join(', ');
  }

  let rootId = 0;
  let laneCursor = 0;

  /** Admit the root task (main). */
  function start() {
    if (closed) throw new TaskFault('E_TASK: scheduler closed');
    if (rootId) throw new TaskFault('E_TASK: scheduler already started');
    rootId = admit(guest.main(), 'root', 0);
    ready.push(rootId);
  }

  /**
   * Synchronous core used by every driver: run at most `budget` turns
   * (task turns interleaved with one lane turn each). Never awaits.
   * Returns 'progress' (budget spent, more may be ready), 'idle' (waiting on
   * the reactor: timers or external completions) or 'done' (quiescent).
   * A blocked state with nothing pending anywhere throws E_DEADLOCK.
   */
  function runSlice(budget = turnsPerSlice) {
    if (closed) throw new TaskFault('E_TASK: scheduler closed');
    for (let n = 0; n < budget; n++) {
      collectReactorEvents();
      let progressed = false;
      const id = ready.shift();
      if (id !== undefined) {
        const task = tasks.get(id);
        if (task && task.state === 'ready') { turn(task); progressed = true; }
      }
      // Interleave one Mailman turn per task turn, round robin over lanes.
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[(laneCursor + i) % lanes.length];
        if (lane.hasWork()) { lane.turn(); progressed = true; laneCursor = (laneCursor + i + 1) % lanes.length; break; }
      }
      if (turns > maxTurns) throw new TaskFault(`E_TASK_BUDGET: more than ${maxTurns} task turns`);
      if (progressed) continue;
      if (live === 0 && !lanes.some(l => l.hasWork())) return 'done';
      if (reactor.pendingCount > 0) return 'idle';
      throw new TaskFault(`E_DEADLOCK: no runnable task and no pending host operation: ${describeBlocked()}`);
    }
    return 'progress';
  }

  function outcome() {
    const root = tasks.get(rootId);
    return { value: root.result, turns, tasks: nextId - 1 };
  }

  /** Event-loop driver (fallback when no dedicated carrier can park). */
  async function run() {
    start();
    for (;;) {
      const state = runSlice(turnsPerSlice);
      if (state === 'done') return outcome();
      if (state === 'idle') await reactor.waitForEvent();
      else await yieldSlice();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const task of tasks.values()) {
      if (task.timer !== null) reactor.cancel(task.timer);
      if (task.handle !== 0n) { try { guest.close(task.handle); } catch { /* trapped guest */ } }
      task.handle = 0n;
    }
    tasks.clear();
    ready.length = 0;
  }

  return {
    run, start, runSlice, outcome, close,
    get liveTasks() { return live; },
    get turns() { return turns; },
  };
}

function defaultYield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
