/** OresVM carrier: a control loop that owns its thread.
 *
 * Browser and Node profile of the OresVM carrier-thread scheduler. On the
 * JVM/Graal, .NET and LLVM backends a bounded pool of OS carrier threads runs
 * actor and task turns while a separate NIO reactor thread (selector, IOCP,
 * epoll/kqueue) only posts completions. A browser tenant gets one dedicated
 * Worker thread instead, and Node one worker_thread; this module turns that
 * thread into a real carrier:
 *
 *   for (;;) {
 *     CONTROL first      supervisor STOP/CANCEL word, before any DATA turn
 *     drain completions  reactor/supervisor ring -> reactor -> runnable tasks
 *     run a slice        task turns + Mailman turns, continuations called here
 *     park               Atomics.wait(doorbell, armed, until next deadline)
 *   }
 *
 * The loop never awaits a promise and never yields to the thread's event
 * loop while work exists, so the JS event loop is not the scheduler: guest
 * continuations, timers and Mailman turns are all dispatched by this loop.
 * Timers are deadlines checked by the loop itself (park timeout), not
 * setTimeout callbacks. Things only the host event loop can do (fetch,
 * WebSocket, MessagePort traffic) belong on a reactor thread that publishes
 * completions into the shared channel; it never executes guest code.
 *
 * Without SharedArrayBuffer (a browser page that is not cross-origin
 * isolated) a carrier cannot park; the OresVM then uses its explicit
 * event-loop driver and reports `scheduler: 'event-loop'` instead.
 */
import { TaskFault } from './ores-scheduler.js';
import { carrierConsumer, CONTROL_STOP, CONTROL_CANCEL } from './ores-carrier-channel.js';

/** Turns per slice between CONTROL/completion checks. */
export const CARRIER_SLICE = 64;
/** Upper bound on one park so a dead producer cannot hide forever from the
 *  watchdog; the loop re-checks its predicate and parks again. */
export const MAX_PARK_MS = 1000;

/**
 * Run the scheduler to quiescence on the current thread. Synchronous.
 * channel: SharedArrayBuffer from createCarrierChannel().
 * onCompletion(op, value, failed): maps a ring completion into the reactor.
 */
export function runCarrier({ scheduler, reactor, channel, clock, slice = CARRIER_SLICE, maxParkMs = MAX_PARK_MS }) {
  const ring = carrierConsumer(channel);
  const stats = { slices: 0, parks: 0, timedOutParks: 0, completions: 0, controlChecks: 0 };
  const sink = (op, value, failed) => {
    stats.completions++;
    reactor.complete(op, value, failed ? `E_IO: host operation ${op} failed` : null);
  };
  scheduler.start();
  for (;;) {
    // CONTROL lane: strictly before any new DATA turn.
    stats.controlChecks++;
    const control = ring.control();
    if (control & CONTROL_STOP) throw new TaskFault('E_STOPPED: supervisor CONTROL stopped the tenant');
    if (control & CONTROL_CANCEL) throw new TaskFault('E_CANCELLED: supervisor CONTROL cancelled the tenant');
    ring.drain(sink);
    stats.slices++;
    const state = scheduler.runSlice(slice);
    if (state === 'done') return { ...scheduler.outcome(), carrier: stats };
    if (state === 'progress') continue;
    // Idle: arm, re-check every wake source, then park until the doorbell
    // moves or the next timer is due. A publish between arm and park makes
    // Atomics.wait return 'not-equal' immediately.
    const armed = ring.arm();
    if (ring.hasPending() || ring.control() || reactor.readyCount > 0) continue;
    const deadline = reactor.nextDeadline();
    const wait = deadline === Infinity ? maxParkMs : Math.max(0, Math.min(maxParkMs, deadline - clock.now()));
    if (wait === 0) continue;
    stats.parks++;
    if (ring.park(armed, wait) === 'timed-out') stats.timedOutParks++;
  }
}
