import test from 'node:test';
import assert from 'node:assert/strict';
import { createOresVM } from '../src/ores-vm.js';
import { TASK_STATUS as S } from '../src/ores-scheduler.js';
import { createReactor, createVirtualClock } from '../src/ores-reactor.js';
import { createPostOffice, Mailbox } from '../src/ores-mailman.js';

/** Mock task guest: each frame is a JS generator that yields [status, request]
 *  and receives the wake value, exactly like a compiler-lowered state machine. */
function mockGuest(bodies, mainBody) {
  const frames = new Map();
  let next = 1n;
  const closed = [];
  const create = (body, ...args) => {
    const handle = next++;
    frames.set(handle, { it: body(...args), last: null, result: 0n, started: false });
    return handle;
  };
  const api = {
    create,
    main: () => create(mainBody),
    resume(handle, wake) {
      const f = frames.get(handle);
      if (!f) throw new Error('stale handle');
      const step = f.started ? f.it.next(wake) : f.it.next();
      f.started = true;
      if (step.done) { f.result = BigInt(step.value ?? 0); return S.DONE; }
      const [status, request] = step.value;
      f.last = typeof request === 'function' ? request() : request;
      return status;
    },
    request: h => frames.get(h).last,
    result: h => frames.get(h).result,
    close: h => { closed.push(h); frames.delete(h); },
    frames, closed, bodies,
  };
  return api;
}

const fast = { yieldSlice: () => Promise.resolve() };

test('await of a suspending call runs the callee first and resumes with its result', async () => {
  const log = [];
  let g;
  const loadAnswer = function* () { log.push('callee'); return 42; };
  g = mockGuest({}, function* () {
    log.push('root');
    const v = yield [S.CALL, () => g.create(loadAnswer)];
    log.push(`resumed ${v}`);
    return v;
  });
  const vm = createOresVM({ guest: g, clock: createVirtualClock(), ...fast });
  const out = await vm.run();
  assert.equal(out.value, 42n);
  assert.deepEqual(log, ['root', 'callee', 'resumed 42']);
  assert.equal(g.frames.size, 0, 'every frame is closed after quiescence');
});

test('task {} returns a Future immediately; await parks until it settles', async () => {
  const log = [];
  let g;
  const child = function* (n) { log.push('child'); return n * 2; };
  g = mockGuest({}, function* () {
    const future = yield [S.SPAWN, () => g.create(child, 21)];
    log.push(`spawned ${future}`);
    const v = yield [S.AWAIT, future];
    log.push(`awaited ${v}`);
    return v;
  });
  const out = await createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run();
  assert.equal(out.value, 42n);
  assert.deepEqual(log, ['spawned 2', 'child', 'awaited 42']);
});

test('sleeping tasks wake in deadline order on the reactor, never inside a timer callback', async () => {
  const log = [];
  let g;
  const sleeper = (name, ms) => function* () { yield [S.SLEEP, BigInt(ms)]; log.push(name); return ms; };
  g = mockGuest({}, function* () {
    const a = yield [S.SPAWN, () => g.create(sleeper('slow', 100))];
    const b = yield [S.SPAWN, () => g.create(sleeper('fast', 10))];
    const x = yield [S.AWAIT, a];
    const y = yield [S.AWAIT, b];
    return x + y;
  });
  const clock = createVirtualClock();
  const out = await createOresVM({ guest: g, clock, ...fast }).run();
  assert.equal(out.value, 110n);
  assert.deepEqual(log, ['fast', 'slow']);
  assert.equal(clock.now(), 100, 'virtual time jumps to deadlines without wall waits');
});

test('do task {} is detached: root value is kept and the VM quiesces after it runs', async () => {
  const log = [];
  let g;
  const detached = function* () { yield [S.SLEEP, 5n]; log.push('detached ran'); return 7; };
  g = mockGuest({}, function* () {
    const zero = yield [S.DETACH, () => g.create(detached)];
    assert.equal(zero, 0n);
    log.push('root done');
    return 42;
  });
  const out = await createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run();
  assert.equal(out.value, 42n);
  assert.deepEqual(log, ['root done', 'detached ran']);
});

test('awaiting an unknown Future is rejected', async () => {
  const g = mockGuest({}, function* () { yield [S.AWAIT, 99n]; return 0; });
  await assert.rejects(createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run(), /E_TASK: await of an unknown/);
});

test('an await cycle is reported as a deadlock instead of hanging', async () => {
  let g;
  // Task 2 awaits Future 3 and task 3 awaits Future 2.
  const a = function* () { return yield [S.AWAIT, 3n]; };
  const b = function* () { return yield [S.AWAIT, 2n]; };
  g = mockGuest({}, function* () {
    const fa = yield [S.SPAWN, () => g.create(a)];
    const fb = yield [S.SPAWN, () => g.create(b)];
    return (yield [S.AWAIT, fa]) + (yield [S.AWAIT, fb]);
  });
  await assert.rejects(createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run(), /E_DEADLOCK/);
});

test('cooperate requeues behind ready work (fair interleaving)', async () => {
  const log = [];
  let g;
  const worker = name => function* () {
    for (let i = 0; i < 3; i++) { log.push(`${name}${i}`); yield [S.COOPERATE, 0n]; }
    return 1;
  };
  g = mockGuest({}, function* () {
    const a = yield [S.SPAWN, () => g.create(worker('a'))];
    const b = yield [S.SPAWN, () => g.create(worker('b'))];
    return (yield [S.AWAIT, a]) + (yield [S.AWAIT, b]);
  });
  const out = await createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run();
  assert.equal(out.value, 2n);
  assert.deepEqual(log, ['a0', 'b0', 'a1', 'b1', 'a2', 'b2']);
});

test('turn budget and live-task limits fail closed', async () => {
  const spin = mockGuest({}, function* () { for (;;) yield [S.COOPERATE, 0n]; });
  await assert.rejects(createOresVM({ guest: spin, clock: createVirtualClock(), maxTurns: 50, ...fast }).run(), /E_TASK_BUDGET/);
  let g;
  const idle = function* () { yield [S.SLEEP, 1000n]; return 0; };
  g = mockGuest({}, function* () { for (;;) yield [S.DETACH, () => g.create(idle)]; });
  await assert.rejects(createOresVM({ guest: g, clock: createVirtualClock(), maxLiveTasks: 8, ...fast }).run(), /E_TASK_LIMIT/);
});

test('a guest trap stops the tenant and releases every frame', async () => {
  let g;
  const sleeper = function* () { yield [S.SLEEP, 10n]; return 0; };
  g = mockGuest({}, function* () {
    yield [S.SPAWN, () => g.create(sleeper)];
    throw new Error('unreachable');
  });
  await assert.rejects(createOresVM({ guest: g, clock: createVirtualClock(), ...fast }).run(), /unreachable/);
  assert.equal(g.frames.size, 0);
});

test('reactor rejects out-of-range timers and ignores duplicate completions', () => {
  const reactor = createReactor({ clock: createVirtualClock() });
  assert.throws(() => reactor.timer(-1n, 1), /E_TIMER/);
  assert.throws(() => reactor.timer(10n ** 9n, 1), /E_TIMER/);
  const op = reactor.register('fetch', 1);
  assert.equal(reactor.complete(op, 5n), true);
  assert.equal(reactor.complete(op, 6n), false);
  assert.deepEqual(reactor.poll().map(e => e.value), [5n]);
});

test('mailman micro loop: control mail first, bounded batch per turn', () => {
  const office = createPostOffice();
  const seen = [];
  const actor = office.enroll({ name: 'A', handler: m => seen.push(m), batch: 2,
    onControl: m => seen.push(`ctl:${m.type}`) });
  office.send(actor.id, 1);
  office.send(actor.id, 2);
  office.send(actor.id, 3);
  office.control(actor.id, { type: 'ping' });
  office.turn();
  assert.deepEqual(seen, ['ctl:ping', 1]);
  office.turn();
  assert.deepEqual(seen, ['ctl:ping', 1, 2, 3]);
  assert.equal(office.hasWork(), false);
});

test('a failing actor notifies its supervisor mailman on the control lane', () => {
  const office = createPostOffice();
  const notices = [];
  const sup = office.enroll({ name: 'Sup', kind: 'supervisor', handler: () => {}, onControl: n => notices.push(n) });
  const child = office.enroll({ name: 'Worker', supervisor: sup.id, handler: m => { if (m === 2) throw new Error('E_PANIC: boom'); } });
  office.send(child.id, 1);
  office.send(child.id, 2);
  office.send(child.id, 3);
  while (office.turn());
  assert.equal(child.state, 'failed');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'failed');
  assert.equal(notices[0].fault, 'E_PANIC: boom');
  assert.equal(notices[0].retired, 1, 'undeliverable mail is retired, not retried');
  assert.throws(() => office.send(child.id, 4), /E_ACTOR_DEAD/);
  assert.deepEqual(office.faults, [], 'a supervised fault is not a tenant fault');
});

test('an unsupervised fault becomes the tenant fault; mailbox admission is bounded', () => {
  const office = createPostOffice();
  const a = office.enroll({ name: 'A', handler: () => { throw new Error('bad'); } });
  office.send(a.id, 1);
  office.turn();
  assert.deepEqual(office.faults, ['E_RUNTIME: bad in A']);
  const box = new Mailbox({ capacity: 2 });
  box.post(1); box.post(2);
  assert.throws(() => box.post(3), /E_MAILBOX_FULL/);
});

test('OresVM interleaves Mailman turns with task turns', async () => {
  const log = [];
  const office = createPostOffice();
  const actor = office.enroll({ name: 'Logger', handler: m => log.push(`mail ${m}`), batch: 1 });
  let g;
  g = mockGuest({}, function* () {
    office.send(actor.id, 1);
    office.send(actor.id, 2);
    log.push('task 1');
    yield [S.COOPERATE, 0n];
    log.push('task 2');
    yield [S.COOPERATE, 0n];
    log.push('task 3');
    return 0;
  });
  await createOresVM({ guest: g, postOffice: office, clock: createVirtualClock(), ...fast }).run();
  assert.deepEqual(log, ['task 1', 'mail 1', 'task 2', 'mail 2', 'task 3']);
});

test('a zero-length sleep yields through the reactor without arming a wall timer', async () => {
  let armed = 0;
  const clock = { virtual: false, now: () => 0, setTimer: () => { armed++; return 1; }, clearTimer: () => {} };
  const g = mockGuest({}, function* () {
    for (let i = 0; i < 1000; i++) yield [S.SLEEP, 0n];
    return 7;
  });
  const out = await createOresVM({ guest: g, clock, ...fast }).run();
  assert.equal(out.value, 7n);
  assert.equal(armed, 0);
});
