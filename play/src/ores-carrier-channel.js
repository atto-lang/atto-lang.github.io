/** Shared-memory channel between an OresVM carrier thread and the threads
 *  that feed it (reactor Worker, supervisor / main thread).
 *
 * The carrier owns one Worker thread and never returns to that thread's
 * event loop while work exists: it parks in `Atomics.wait` on a doorbell.
 * Everything that must wake it goes through this SharedArrayBuffer:
 *
 *   header (Int32):  0 DOORBELL  monotonically bumped by every publisher
 *                    1 CONTROL   supervisor flags (STOP, CANCEL), CONTROL lane
 *                    2 WRITE     MPSC reservation cursor (producers)
 *                    3 READ      consumer cursor (carrier only)
 *                    4 PARKED    1 while the carrier is in Atomics.wait
 *                    5 SLOTS     ring capacity
 *                    6 WAKES     number of doorbell rings (diagnostics)
 *   ring: per slot  stamp (Int32), op (Int32), flags (Int32), value (BigInt64)
 *
 * The ring is a bounded MPSC queue (sequence-stamped slots): producers
 * reserve with compareExchange, publish by storing the slot stamp, then ring
 * the doorbell. A full ring rejects: the producer keeps the completion and
 * retries (no drop, no unbounded growth). Lost wakeups are impossible because
 * the carrier reads DOORBELL *before* re-checking its queues and only parks
 * if DOORBELL is still that value (Atomics.wait compares atomically).
 *
 * Completions carry only (op id, value, failure flag): reactor callbacks
 * never execute guest code; the carrier turns them into runnable tasks.
 */

export const DOORBELL = 0, CONTROL = 1, WRITE = 2, READ = 3, PARKED = 4, SLOTS = 5, WAKES = 6;
const HEADER_INTS = 8;
export const CONTROL_STOP = 1;
export const CONTROL_CANCEL = 2;
export const DEFAULT_RING_SLOTS = 256;

/** True when this realm can host a parking carrier (SAB + Atomics.wait). */
export function carrierSupported() {
  if (typeof SharedArrayBuffer !== 'function' || typeof Atomics?.wait !== 'function') return false;
  // Browsers expose SAB only to cross-origin isolated documents and Workers.
  if (typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated) return false;
  try {
    new Int32Array(new SharedArrayBuffer(4));
    return true;
  } catch {
    return false;
  }
}

export function createCarrierChannel({ slots = DEFAULT_RING_SLOTS } = {}) {
  if (!Number.isInteger(slots) || slots < 2 || slots > 65536 || (slots & (slots - 1))) {
    throw new RangeError('carrier ring slots must be a power of two in 2..65536');
  }
  const bytes = HEADER_INTS * 4 + slots * 12 + slots * 8;
  const sab = new SharedArrayBuffer(bytes);
  const header = new Int32Array(sab, 0, HEADER_INTS);
  header[SLOTS] = slots;
  const stamps = new Int32Array(sab, HEADER_INTS * 4, slots);
  for (let i = 0; i < slots; i++) stamps[i] = i;
  return sab;
}

function views(sab) {
  if (typeof SharedArrayBuffer !== 'function' || !(sab instanceof SharedArrayBuffer)) throw new TypeError('carrier channel must be a SharedArrayBuffer');
  const header = new Int32Array(sab, 0, HEADER_INTS);
  const slots = header[SLOTS];
  if (!Number.isInteger(slots) || slots < 2 || (slots & (slots - 1)) ||
      sab.byteLength !== HEADER_INTS * 4 + slots * 20) {
    throw new TypeError('malformed carrier channel');
  }
  const base = HEADER_INTS * 4;
  return {
    header, slots, mask: slots - 1,
    stamps: new Int32Array(sab, base, slots),
    ops: new Int32Array(sab, base + slots * 4, slots),
    flags: new Int32Array(sab, base + slots * 8, slots),
    values: new BigInt64Array(sab, base + slots * 12, slots),
  };
}

function ring(header) {
  Atomics.add(header, DOORBELL, 1);
  Atomics.add(header, WAKES, 1);
  Atomics.notify(header, DOORBELL);
}

/** Producer side: any thread (reactor Worker, supervisor) may publish. */
export function carrierProducer(sab) {
  const v = views(sab);
  return {
    /** Publish one completion; false when the ring is full (retry later). */
    complete(op, value = 0n, failed = false) {
      if (!Number.isInteger(op) || op <= 0 || op > 0x7fffffff) throw new RangeError('invalid op id');
      if (typeof value !== 'bigint') throw new TypeError('completion value must be a BigInt');
      let pos = Atomics.load(v.header, WRITE);
      for (;;) {
        const slot = pos & v.mask;
        const dif = (Atomics.load(v.stamps, slot) - pos) | 0;
        if (dif === 0) {
          if (Atomics.compareExchange(v.header, WRITE, pos, (pos + 1) | 0) === pos) {
            v.ops[slot] = op;
            v.flags[slot] = failed ? 1 : 0;
            v.values[slot] = BigInt.asIntN(64, value);
            Atomics.store(v.stamps, slot, (pos + 1) | 0); // publish (release)
            ring(v.header);
            return true;
          }
          pos = Atomics.load(v.header, WRITE);
        } else if (dif < 0) {
          return false; // full: caller retains the completion
        } else {
          pos = Atomics.load(v.header, WRITE);
        }
      }
    },
    /** Supervisor CONTROL: strictly ahead of any DATA turn. */
    control(bits) {
      Atomics.or(v.header, CONTROL, bits);
      ring(v.header);
    },
    get parked() { return Atomics.load(v.header, PARKED) === 1; },
  };
}

/** Consumer side: only the carrier thread. */
export function carrierConsumer(sab) {
  const v = views(sab);
  return {
    /** Drain every published completion into `sink(op, value, failed)`. */
    drain(sink) {
      let pos = Atomics.load(v.header, READ);
      let n = 0;
      for (;;) {
        const slot = pos & v.mask;
        if (Atomics.load(v.stamps, slot) !== ((pos + 1) | 0)) break;
        const op = v.ops[slot], failed = v.flags[slot] === 1, value = v.values[slot];
        Atomics.store(v.stamps, slot, (pos + v.slots) | 0); // free the slot
        pos = (pos + 1) | 0;
        Atomics.store(v.header, READ, pos);
        sink(op, value, failed);
        n++;
      }
      return n;
    },
    hasPending() {
      const pos = Atomics.load(v.header, READ);
      return Atomics.load(v.stamps, pos & v.mask) === ((pos + 1) | 0);
    },
    control: () => Atomics.load(v.header, CONTROL),
    /** Arm: read the doorbell before re-checking queues (no lost wakeup). */
    arm: () => Atomics.load(v.header, DOORBELL),
    /** Park until the doorbell moves past `armed` or `timeoutMs` elapses. */
    park(armed, timeoutMs) {
      Atomics.store(v.header, PARKED, 1);
      try {
        return Atomics.wait(v.header, DOORBELL, armed, timeoutMs);
      } finally {
        Atomics.store(v.header, PARKED, 0);
      }
    },
    get wakes() { return Atomics.load(v.header, WAKES); },
  };
}
