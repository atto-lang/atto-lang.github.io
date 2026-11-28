import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createOresVM } from '../src/ores-vm.js';
import { TASK_STATUS as S } from '../src/ores-scheduler.js';
import {
  carrierConsumer, carrierProducer, carrierSupported, createCarrierChannel, CONTROL_STOP,
} from '../src/ores-carrier-channel.js';

function mockGuest(mainBody) {
  const frames = new Map();
  let next = 1n;
  const create = (body, ...args) => { const h = next++; frames.set(h, { it: body(...args), last: 0n, result: 0n, started: false }); return h; };
  return {
    create,
    main: () => create(mainBody),
    resume(h, wake) {
      const f = frames.get(h);
      const step = f.started ? f.it.next(wake) : f.it.next();
      f.started = true;
      if (step.done) { f.result = BigInt(step.value ?? 0); return S.DONE; }
      const [status, request] = step.value;
      f.last = typeof request === 'function' ? request() : request;
      return status;
    },
    request: h => frames.get(h).last,
    result: h => frames.get(h).result,
    close: h => { frames.delete(h); },
    frames,
  };
}

/** Run a producer on a real second thread against the carrier's channel. */
function producerThread(channel, script, gate = null) {
  return new Worker(`
    const { workerData } = require('node:worker_threads');
    const sab = workerData.channel;
    const h = new Int32Array(sab, 0, 8);
    const gate = workerData.gate ? new Int32Array(workerData.gate) : null;
    ${script}
  `, { eval: true, workerData: { channel, gate } });
}

test('Node can host a parking carrier', () => {
  assert.equal(carrierSupported(), true);
});

test('the carrier parks on Atomics.wait instead of spinning while tasks sleep', () => {
  const g = mockGuest(function* () { yield [S.SLEEP, 150n]; return 1; });
  const vm = createOresVM({ guest: g, scheduler: 'carrier' });
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const out = vm.runSync();
  const wall = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  assert.equal(out.scheduler, 'carrier');
  assert.equal(out.value, 1n);
  assert.ok(wall >= 145, `slept ${wall} ms`);
  assert.ok(out.carrier.parks >= 1);
  // A spinning loop would burn ~150 ms of CPU; a parked carrier almost none.
  assert.ok((cpu.user + cpu.system) / 1000 < 60, `cpu ${(cpu.user + cpu.system) / 1000} ms`);
});

test('timers fire from the carrier loop, in deadline order, with no host timer', () => {
  const log = [];
  let g;
  const sleeper = (name, ms) => function* () { yield [S.SLEEP, BigInt(ms)]; log.push(name); return ms; };
  g = mockGuest(function* () {
    const a = yield [S.SPAWN, () => g.create(sleeper('slow', 60))];
    const b = yield [S.SPAWN, () => g.create(sleeper('fast', 20))];
    return (yield [S.AWAIT, a]) + (yield [S.AWAIT, b]);
  });
  const realSetTimeout = globalThis.setTimeout;
  let hostTimers = 0;
  globalThis.setTimeout = (...args) => { hostTimers++; return realSetTimeout(...args); };
  try {
    const out = createOresVM({ guest: g, scheduler: 'carrier' }).runSync();
    assert.equal(out.value, 80n);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(log, ['fast', 'slow']);
  assert.equal(hostTimers, 0);
});

test('a completion published by another thread wakes the parked carrier at once', async () => {
  const channel = createCarrierChannel();
  // Reactor op 1 is the task's 10 s timer; a host-side reactor thread
  // completes it after ~50 ms (as a fetch/socket completion would).
  const g = mockGuest(function* () { const v = yield [S.SLEEP, 10_000n]; return v; });
  const vm = createOresVM({ guest: g, scheduler: 'carrier', channel });
  const reactorThread = producerThread(channel, `
    setTimeout(() => {
      // Mirror carrierProducer.complete for op 1 with value 77.
      const slots = h[5], base = 32;
      const stamps = new Int32Array(sab, base, slots), ops = new Int32Array(sab, base + slots * 4, slots);
      const flags = new Int32Array(sab, base + slots * 8, slots), values = new BigInt64Array(sab, base + slots * 12, slots);
      const pos = Atomics.load(h, 2);
      Atomics.compareExchange(h, 2, pos, pos + 1);
      ops[pos & (slots - 1)] = 1; flags[pos & (slots - 1)] = 0; values[pos & (slots - 1)] = 77n;
      Atomics.store(stamps, pos & (slots - 1), pos + 1);
      Atomics.add(h, 0, 1); Atomics.add(h, 6, 1); Atomics.notify(h, 0);
    }, 50);
  `);
  await new Promise(resolve => reactorThread.once('online', resolve));
  const t0 = performance.now();
  const out = vm.runSync();
  const elapsed = performance.now() - t0;
  await reactorThread.terminate();
  assert.equal(out.value, 77n, 'the wake value comes from the completion');
  assert.ok(elapsed < 900, `woke after ${elapsed} ms (park cap is 1000 ms)`);
  assert.equal(out.carrier.completions, 1);
});

test('supervisor CONTROL STOP reaches a parked carrier before any further DATA turn', async () => {
  const channel = createCarrierChannel();
  let resumed = false;
  const g = mockGuest(function* () { yield [S.SLEEP, 30_000n]; resumed = true; return 1; });
  const vm = createOresVM({ guest: g, scheduler: 'carrier', channel });
  const supervisor = producerThread(channel, `
    setTimeout(() => { Atomics.or(h, 1, ${CONTROL_STOP}); Atomics.add(h, 0, 1); Atomics.notify(h, 0); }, 40);
  `);
  await new Promise(resolve => supervisor.once('online', resolve));
  const t0 = performance.now();
  assert.throws(() => vm.runSync(), /E_STOPPED/);
  await supervisor.terminate();
  assert.ok(performance.now() - t0 < 900);
  assert.equal(resumed, false);
  assert.equal(g.frames.size, 0, 'frames are released on CONTROL stop');
});

test('MPSC ring: concurrent producers lose no completion and no wakeup', async () => {
  const N = 2000;
  const channel = createCarrierChannel({ slots: 64 });
  let g;
  // N detached tasks each wait on a long timer that only a producer thread
  // completes; ops 1..N are their timers (allocated in spawn order).
  const waiter = function* () { const v = yield [S.SLEEP, 60_000n]; return v; };
  // Barrier: the ready queue is FIFO, so this detached task's first turn runs
  // only after every waiter has registered its timer (reactor ops 1..N).
  // Completions for ops not yet issued are correctly ignored by the reactor,
  // so producers must not flood before this point.
  const gateBuffer = new SharedArrayBuffer(4);
  const gate = new Int32Array(gateBuffer);
  const barrier = function* () { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); return 0; };
  let sum = 0n;
  g = mockGuest(function* () {
    const futures = [];
    for (let i = 0; i < N; i++) futures.push(yield [S.SPAWN, () => g.create(waiter)]);
    yield [S.DETACH, () => g.create(barrier)];
    for (const f of futures) sum += yield [S.AWAIT, f];
    return Number(sum % 1_000_000n);
  });
  const vm = createOresVM({ guest: g, scheduler: 'carrier', channel, maxLiveTasks: N + 8, maxTurns: 10 * N });
  const script = (from, to) => `
    const slots = h[5], base = 32;
    const stamps = new Int32Array(sab, base, slots), ops = new Int32Array(sab, base + slots * 4, slots);
    const flags = new Int32Array(sab, base + slots * 8, slots), values = new BigInt64Array(sab, base + slots * 12, slots);
    function complete(op, value) {
      let pos = Atomics.load(h, 2);
      for (;;) {
        const slot = pos & (slots - 1);
        const dif = (Atomics.load(stamps, slot) - pos) | 0;
        if (dif === 0) {
          if (Atomics.compareExchange(h, 2, pos, (pos + 1) | 0) === pos) {
            ops[slot] = op; flags[slot] = 0; values[slot] = value;
            Atomics.store(stamps, slot, (pos + 1) | 0);
            Atomics.add(h, 0, 1); Atomics.add(h, 6, 1); Atomics.notify(h, 0);
            return true;
          }
          pos = Atomics.load(h, 2);
        } else if (dif < 0) return false;
        else pos = Atomics.load(h, 2);
      }
    }
    // Block this producer thread until the carrier opens the gate.
    Atomics.wait(gate, 0, 0);
    for (let op = ${from}; op <= ${to}; op++) {
      while (!complete(op, BigInt(op))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
  `;
  const producers = [producerThread(channel, script(1, N / 2), gateBuffer), producerThread(channel, script(N / 2 + 1, N), gateBuffer)];
  await Promise.all(producers.map(p => new Promise(resolve => p.once('online', resolve))));
  const out = vm.runSync();
  await Promise.all(producers.map(p => p.terminate()));
  const expected = BigInt(N) * BigInt(N + 1) / 2n;
  assert.equal(out.value, expected % 1_000_000n);
  assert.equal(out.carrier.completions, N);
});

test('a full ring rejects instead of dropping, and drains in FIFO order', () => {
  const channel = createCarrierChannel({ slots: 4 });
  const producer = carrierProducer(channel);
  const consumer = carrierConsumer(channel);
  for (let op = 1; op <= 4; op++) assert.equal(producer.complete(op, BigInt(op * 10)), true);
  assert.equal(producer.complete(5, 50n), false, 'backpressure: producer retains op 5');
  const seen = [];
  consumer.drain((op, value) => seen.push([op, value]));
  assert.deepEqual(seen, [[1, 10n], [2, 20n], [3, 30n], [4, 40n]]);
  assert.equal(producer.complete(5, 50n), true);
  consumer.drain((op, value) => seen.push([op, value]));
  assert.deepEqual(seen.at(-1), [5, 50n]);
});

test('carrier mode fails closed where shared memory is unavailable', () => {
  const saved = globalThis.crossOriginIsolated;
  globalThis.crossOriginIsolated = false;
  try {
    assert.equal(carrierSupported(), false);
    assert.throws(() => createOresVM({ guest: mockGuest(function* () { return 0; }), scheduler: 'carrier' }), /E_CARRIER_UNAVAILABLE/);
    assert.equal(createOresVM({ guest: mockGuest(function* () { return 0; }), scheduler: 'auto' }).mode, 'event-loop');
  } finally {
    if (saved === undefined) delete globalThis.crossOriginIsolated; else globalThis.crossOriginIsolated = saved;
  }
});

test('a realm with no SharedArrayBuffer global runs on the event-loop driver', async () => {
  const saved = globalThis.SharedArrayBuffer;
  delete globalThis.SharedArrayBuffer;
  try {
    assert.equal(carrierSupported(), false);
    const g = mockGuest(function* () { yield [S.SLEEP, 5n]; return 9; });
    const vm = createOresVM({ guest: g, scheduler: 'auto' });
    assert.equal(vm.mode, 'event-loop');
    const out = await vm.run();
    assert.equal(out.value, 9n);
    assert.equal(out.scheduler, 'event-loop');
    const { createWorkerTask } = await import('../src/worker-task.js');
    class FailingWorker { constructor() {} postMessage() { this.onerror?.(); } terminate() {} }
    await assert.rejects(createWorkerTask({ WorkerImpl: FailingWorker }).request('x', { wasm: new Uint8Array() }, 1000), /failed to load/);
  } finally {
    globalThis.SharedArrayBuffer = saved;
  }
});
