/** OresVM (browser profile): the tenant's root control loop.
 *
 * One OresVM per tenant Worker. It owns:
 *   - the OresScheduler macro loop (compiler-lowered task turns),
 *   - the OresReactor (host timers / readiness; never runs guest code),
 *   - the PostOffice (one Mailman micro loop per actor and supervisor).
 *
 * The guest is a compiled `atto.task.v1` module (docs/TASK_ABI_V1.md). The VM
 * creates the root task from `atto_task_main`, then alternates task turns,
 * Mailman turns and reactor completions until everything has quiesced or a
 * fault (trap, deadlock, budget) stops the tenant. Traps are terminal for the
 * whole tenant instance: its Wasm state is undefined after a trap.
 */
import { createScheduler, TaskFault } from './ores-scheduler.js';
import { carrierClock, createReactor, realClock } from './ores-reactor.js';
import { runCarrier } from './ores-carrier.js';
import { carrierSupported, createCarrierChannel } from './ores-carrier-channel.js';
import { createPostOffice } from './ores-mailman.js';

export const TASK_ABI_SECTION = 'atto.task.v1';
export const TASK_EXPORTS = Object.freeze([
  'atto_task_main', 'atto_task_resume', 'atto_task_request', 'atto_task_result', 'atto_task_close',
]);

/** True when the module opts into the task ABI; malformed opt-ins reject. */
export function taskGuestAbi(module) {
  const sections = WebAssembly.Module.customSections(module, TASK_ABI_SECTION);
  const exports = WebAssembly.Module.exports(module);
  const present = exports.filter(e => TASK_EXPORTS.includes(e.name));
  if (!sections.length) {
    if (present.length) throw new Error('E_TASK_ABI: task exports without atto.task.v1 marker');
    return false;
  }
  if (sections.length !== 1 || sections[0].byteLength !== 1 || new Uint8Array(sections[0])[0] !== 1) {
    throw new Error('E_TASK_ABI: invalid atto.task.v1 marker');
  }
  for (const name of TASK_EXPORTS) {
    if (exports.find(e => e.name === name)?.kind !== 'function') {
      throw new Error(`E_TASK_ABI: missing task export ${name}`);
    }
  }
  return true;
}

/** Narrow, type-checked adapter over the guest's task exports. */
export function taskGuest(instance) {
  const x = instance.exports;
  const big = (v, what) => {
    if (typeof v !== 'bigint') throw new TaskFault(`E_TASK_ABI: ${what} must return i64`);
    return v;
  };
  return {
    main: () => big(x.atto_task_main(), 'atto_task_main'),
    resume: (handle, wake) => {
      const status = x.atto_task_resume(handle, wake);
      if (!Number.isInteger(status)) throw new TaskFault('E_TASK_ABI: atto_task_resume must return i32');
      return status;
    },
    request: handle => big(x.atto_task_request(handle), 'atto_task_request'),
    result: handle => big(x.atto_task_result(handle), 'atto_task_result'),
    close: handle => { x.atto_task_close(handle); },
  };
}

/** Actor Mailmen of an actor host as one macro-loop lane: each turn is one
 *  fair round (at most one mail per actor) while main's tasks are live. */
export function actorMailmanLane(host) {
  return { hasWork: () => host.hasMail, turn: () => host.pump() };
}

/**
 * scheduler: 'carrier' (dedicated thread, Atomics.wait parking; needs SAB),
 * 'event-loop' (explicit fallback driver) or 'auto' (carrier when supported).
 * channel: optional SharedArrayBuffer shared with a reactor / supervisor.
 */
export function createOresVM({
  instance = null, guest = null, clock = null, postOffice = null,
  lanes = [], maxLiveTasks, maxTurns, turnsPerSlice, yieldSlice, trace,
  scheduler: mode = 'event-loop', channel = null,
} = {}) {
  if (!['carrier', 'event-loop', 'auto'].includes(mode)) throw new TypeError('unknown OresVM scheduler mode');
  const useCarrier = mode === 'carrier' || (mode === 'auto' && carrierSupported());
  if (useCarrier && !carrierSupported()) {
    throw new Error('E_CARRIER_UNAVAILABLE: SharedArrayBuffer/Atomics.wait unavailable (not cross-origin isolated)');
  }
  clock ??= useCarrier ? carrierClock() : realClock();
  if (useCarrier && !clock.polled) throw new TypeError('a carrier needs a polled clock');
  const ring = useCarrier ? (channel ?? createCarrierChannel()) : null;
  const reactor = createReactor({ clock });
  const office = postOffice ?? createPostOffice();
  const mailmanLane = {
    hasWork: () => office.hasWork(),
    turn: () => { office.turn(); },
  };
  const scheduler = createScheduler({
    guest: guest ?? taskGuest(instance),
    reactor,
    lanes: [mailmanLane, ...lanes],
    maxLiveTasks, maxTurns, turnsPerSlice, yieldSlice, trace,
  });
  let closed = false;

  const finish = outcome => {
    const faults = office.faults;
    return { ...outcome, fault: faults.length ? faults[0] : null };
  };

  /** Run to quiescence. On a carrier this blocks the calling thread (it is
   *  the carrier) and settles synchronously; the promise is a convenience. */
  async function run() {
    if (useCarrier) return runSync();
    try {
      return { ...finish(await scheduler.run()), scheduler: 'event-loop' };
    } finally {
      close();
    }
  }

  /** Carrier entry point: owns this thread until quiescence. */
  function runSync() {
    if (!useCarrier) throw new Error('E_CARRIER_UNAVAILABLE: this OresVM uses the event-loop driver');
    try {
      return { ...finish(runCarrier({ scheduler, reactor, channel: ring, clock })), scheduler: 'carrier' };
    } finally {
      close();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    scheduler.close();
    reactor.close();
    office.close();
  }

  return { run, runSync, close, reactor, postOffice: office, scheduler, channel: ring,
    mode: useCarrier ? 'carrier' : 'event-loop' };
}
