// Experimental v3 host capability tests using an independently assembled real
// Wasm32 module. This is NOT evidence that any AttoLang compiler emits v3.
// Each actor executes its own Wasm instance; JS only admits mail and routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorHost, MAX_ACTORS, MAX_MAILBOX} from '../src/actor-host.js';
import {actorNames, guestImports, pipeGuestAbi} from '../src/guest.js';

const leb = value => {
  const result = [];
  do { let b = value & 127; value >>>= 7; if (value) b |= 128; result.push(b); } while (value);
  return result;
};
const flat = (...pieces) => pieces.flat(Infinity);
const word = value => {
  const encoded = [...new TextEncoder().encode(value)];
  return [...leb(encoded.length), ...encoded];
};
const section = (number, data) => [number, ...leb(data.length), ...data];
const custom = (name, data) => section(0, flat(word(name), data));
const exported = (name, kind, index) => flat(word(name), [kind], leb(index));
const body = (locals, instructions) => [ ...leb(locals.length + instructions.length + 1), ...locals, ...instructions, 0x0b ];
const get = n => [0x20, ...leb(n)];
const set = n => [0x21, ...leb(n)];
const call = n => [0x10, ...leb(n)];
const i32 = n => [0x41, ...leb(n)];
// i64.const takes SIGNED LEB128; unsigned leb() would decode 99 as -29.
const sleb = value => {
  let v = BigInt(value);
  const result = [];
  for (;;) {
    const b = Number(v & 127n);
    v >>= 7n;
    if ((v === 0n && !(b & 64)) || (v === -1n && (b & 64))) { result.push(b); return result; }
    result.push(b | 128);
  }
};
const i64 = n => [0x42, ...sleb(n)];

// Actor ABI uses 0=Parse, 1=Validate, 2=Sink. Imports: spawn, link,
// send, emit, print_i64 in that order. The guest's own instructions call
// actor_emit; no JS code transforms or fakes the actor data values.
function wasmFixture({auto = true, trapAfterEmit = false, marker = 1} = {}) {
  const main = [];
  if (auto) {
    for (let i = 0; i < 6; i++) main.push(...i32(i % 3), ...call(0), ...set(i));
    for (const [a, b] of [[0, 1], [1, 2], [3, 4], [4, 5]]) {
      main.push(...get(a), ...get(b), ...call(1));
    }
    for (const root of [0, 3]) main.push(...get(root), ...i64(41), ...call(2));
  }
  main.push(...i64(0));
  const receive = [
    ...get(0), ...i32(0), 0x46, 0x04, 0x40, // Parse branch
      ...get(1), ...i64(1), 0x7c, ...call(3),
      ...(trapAfterEmit ? [
        ...get(1), ...i64(99), 0x51, 0x04, 0x40, 0x00, 0x0b
      ] : []),
    0x05,
      ...get(0), ...i32(1), 0x46, 0x04, 0x40, // Validate branch
        ...get(1), ...i64(0), 0x55, 0x04, 0x40,
          ...get(1), ...call(3),
        0x0b,
      0x05,
        ...get(1), ...call(4), // Sink prints its actual Wasm input
      0x0b,
    0x0b
  ];
  const bytes = flat(
    [0, 97, 115, 109, 1, 0, 0, 0],
    ...(marker === null ? [] : custom('atto.pipeline.v1', [marker])),
    custom('atto.actors', flat([3], word('Parse'), word('Validate'), word('Sink'))),
    section(1, flat([8],
      [0x60, 0, 1, 0x7e],                // main () -> i64
      [0x60, 1, 0x7f, 1, 0x7f],       // actor_spawn(i32) -> i32
      [0x60, 2, 0x7f, 0x7f, 0],     // actor_link(i32,i32) -> ()
      [0x60, 2, 0x7f, 0x7e, 0],     // actor_send(i32,i64) -> ()
      [0x60, 1, 0x7e, 0],           // actor_emit(i64) -> ()
      [0x60, 1, 0x7e, 0],           // print_i64(i64) -> ()
      [0x60, 1, 0x7f, 0],           // actor_init(i32) -> ()
      [0x60, 3, 0x7f, 0x7e, 0x7e, 0] // actor_receive(i32,i64,i64) -> ()
    )),
    section(2, flat([5],
      word('atto'), word('actor_spawn'), [0, 1],
      word('atto'), word('actor_link'), [0, 2],
      word('atto'), word('actor_send'), [0, 3],
      word('atto'), word('actor_emit'), [0, 4],
      word('atto'), word('print_i64'), [0, 5]
    )),
    section(3, [3, 0, 6, 7]),
    section(5, [1, 1, 1, 1]),           // independent 64 KiB memory each
    section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]), // panic_code
    section(7, flat([5],
      exported('main', 0, 5), exported('actor_init', 0, 6),
      exported('actor_receive', 0, 7), exported('memory', 2, 0),
      exported('panic_code', 3, 0)
    )),
    section(10, flat([3],
      body(auto ? [1, 6, 0x7f] : [0], main),
      body([0], []),
      body([0], receive)
    ))
  );
  const wasm = new Uint8Array(bytes);
  assert.equal(WebAssembly.validate(wasm), true, 'fixture must execute in actual Wasm');
  return new WebAssembly.Module(wasm);
}
function make(module) {
  const out = {text: '', truncated: false};
  return {out, host: createActorHost({module, names: actorNames(module), out})};
}

test('v3 real Wasm actors use mailboxes and independent memories to deliver 42 twice', async () => {
  const module = wasmFixture();
  const {out, host} = make(module);
  const {imports, bind} = guestImports(module, out, host);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  assert.equal(instance.exports.main(), 0n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '4242');
  assert.equal(host.count, 6);
  assert.equal(host.memoryBytes, 6 * 65536);
  host.close();
  assert.equal(host.memoryBytes, 0);
});

test('links are tenant-local, single writer, acyclic and closed after main', async () => {
  const module = wasmFixture({auto: false});
  const {host, out} = make(module);
  const a = host.spawn(0), b = host.spawn(1), c = host.spawn(2);
  assert.throws(() => host.link(a, a), /E_PIPE_LINK/);
  assert.throws(() => host.link(a, 999), /E_PIPE_LINK/);
  host.link(a, b);
  host.link(b, c);
  assert.throws(() => host.link(c, a), /cyclic/);
  assert.throws(() => host.link(a, c), /already linked/);
  host.send(a, 41n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '42');
  assert.throws(() => host.link(c, a), /mailbox admission closed/);
  host.close();
  assert.throws(() => host.link(c, a), /actor host closed/);
});

test('v2 guests cannot request v3 imports, even if caller offers a host', () => {
  const plain = wasmFixture({marker: null});
  assert.equal(pipeGuestAbi(plain), false);
  const out = {text: '', truncated: false};
  assert.throws(() => guestImports(plain, out), /Guest import not granted: atto.actor_link/);
  const invalid = wasmFixture({marker: 2});
  assert.throws(() => pipeGuestAbi(invalid), /E_PIPE_ABI/);
  assert.throws(() => createActorHost({module: invalid, names: actorNames(invalid), out}), /E_PIPE_ABI/);
});

test('actor-origin emit never receives main or unbound authority', async () => {
  const module = wasmFixture({auto: false});
  const out = {text: '', truncated: false};
  // An actor instance built with main's imports has no bound emitter.
  const {imports, bind} = guestImports(module, out);
  const actor = await WebAssembly.instantiate(module, imports);
  bind(actor);
  assert.throws(() => actor.exports.actor_receive(0, 41n, 0n), /E_ACTOR/);
});

test('panic after emit discards the whole uncommitted actor turn', async () => {
  const module = wasmFixture({auto: false, trapAfterEmit: true});
  const {out, host} = make(module);
  const a = host.spawn(0), sink = host.spawn(2);
  host.link(a, sink);
  host.send(a, 99n);
  const fault = await host.drain();
  assert.match(fault, /^E_RUNTIME: .* in actor Parse#0$/);
  assert.equal(out.text, '', 'uncommitted emit must not reach Sink');
  host.close();
});

test('full downstream mailbox fails atomic forwarding instead of dropping messages', async () => {
  const module = wasmFixture({auto: false});
  const {out, host} = make(module);
  const a = host.spawn(0), sink = host.spawn(2);
  host.link(a, sink);
  host.send(a, 41n);
  for (let i = 0; i < MAX_MAILBOX; i++) host.send(sink, 1n);
  const fault = await host.drain();
  assert.match(fault, /^E_MAILBOX_FULL: downstream Sink#1.*in actor Parse#0$/);
  assert.equal(out.text, '1'.repeat(MAX_MAILBOX), 'preexisting FIFO mail remains intact');
  host.close();
});

test('long actor drains compact delivered FIFO entries without losing sequence or Wasm isolation', async () => {
  // Observe storage synchronously during a real Wasm receive turn. An
  // end-of-drain-only cleanup would pass a final-size check but fail here.
  let printed = '', retainedDuringDrain = null, host;
  const out = {
    truncated: false,
    get text() { return printed; },
    set text(value) {
      printed = value;
      if (printed.length >= 3000 && retainedDuringDrain === null) {
        retainedDuringDrain = host.mailboxStorageEntries;
      }
    }
  };
  const module = wasmFixture({auto: false});
  host = createActorHost({module, names: actorNames(module), out});
  const source = host.spawn(0), sink = host.spawn(2);
  host.link(source, sink);
  const count = 2048; // Four compaction batches per actor, including forwarded mail.
  for (let i = 0; i < count; i++) host.send(source, BigInt(i));
  assert.equal(await host.drain(), null);
  assert.equal(out.text, Array.from({length: count}, (_, i) => String(i + 1)).join(''),
    'compaction must retain FIFO order and exact sequence accounting');
  assert.equal(out.truncated, false);
  assert.ok(retainedDuringDrain !== null && retainedDuringDrain < count,
    'compaction must reduce physical mailbox storage before drain completes');
  assert.ok(host.mailboxStorageEntries < 1024,
    'consumed entries must not remain retained for the whole drain');
  assert.equal(host.memoryBytes, 2 * 65536,
    'compaction cannot alias or retire unrelated actor linear memories');
  host.close();
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 0);
});

test('persistent pipeline preserves absolute mailbox sequence after multiple compactions and new turns', async () => {
  const module = wasmFixture({auto: false});
  const out = {text: '', truncated: false};
  const host = createActorHost({module, names: actorNames(module), out, persistent: true});
  const source = host.spawn(0), sink = host.spawn(2);
  host.link(source, sink);

  // Cross two compaction thresholds, with a remainder that the persistent
  // cleanup must acknowledge exactly once before the next admitted turn.
  const count = 1025;
  for (let i = 0; i < count; i++) host.send(source, BigInt(i));
  assert.equal(await host.drain(), null);
  const firstOutput = Array.from({length: count}, (_, i) => String(i + 1)).join('');
  assert.equal(out.text, firstOutput);
  assert.equal(host.mailboxStorageEntries, 0, 'delivered messages must be reclaimed across turns');

  host.sendExternal(source, 40n);
  host.sendExternal(source, 41n);
  assert.equal(await host.drain(), null,
    'the next drain must use absolute sequence numbers, not reset them to zero');
  assert.equal(out.text, firstOutput + '4142',
    'no message can be lost, repeated, or misordered across compaction boundaries');
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 2 * 65536,
    'persistent actors must retain distinct private linear memories until close');
  host.close();
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 0);
});


test('terminal actor panic retires queued mail before healthy siblings finish draining', async () => {
  const module = wasmFixture({auto: false, trapAfterEmit: true});
  let printed = '', retainedAtHealthyPrint = null, host;
  const out = {
    truncated: false,
    get text() { return printed; },
    set text(value) {
      printed = value;
      // This fires while a healthy sibling prints, before drain() finishes.
      // End-of-drain cleanup is too late to satisfy the memory contract.
      if (printed === '41' && retainedAtHealthyPrint === null) {
        retainedAtHealthyPrint = host.mailboxStorageEntries;
      }
    },
  };
  host = createActorHost({module, names: actorNames(module), out});
  const crashing = host.spawn(0), healthy = host.spawn(2);
  host.link(crashing, healthy);
  host.send(crashing, 99n);
  for (let i = 1; i < MAX_MAILBOX; i++) host.send(crashing, 41n);
  host.send(healthy, 41n);
  const fault = await host.drain();
  assert.match(fault, /^E_RUNTIME: .* in actor Parse#0$/);
  assert.equal(out.text, '41', 'healthy sibling must still execute');
  assert.equal(retainedAtHealthyPrint, 1,
    'failed actor pending mailbox must be released before any sibling execution');
  assert.equal(host.mailboxStorageEntries, 1,
    'only healthy actor un-compacted delivery may remain retained');
  host.close();
  assert.equal(host.mailboxStorageEntries, 0);
});

test('persistent failed actor queue retirement preserves healthy actor admission and sequencing', async () => {
  const module = wasmFixture({auto: false, trapAfterEmit: true});
  const out = {text: '', truncated: false};
  const host = createActorHost({module, names: actorNames(module), out, persistent: true});
  const crashing = host.spawn(0), healthy = host.spawn(2);
  host.link(crashing, healthy);
  host.send(crashing, 99n);
  for (let i = 1; i < 600; i++) host.send(crashing, 41n);
  host.send(healthy, 41n);
  assert.match(await host.drain(), /in actor Parse#0$/);
  assert.equal(host.mailboxStorageEntries, 0);
  assert.throws(() => host.sendExternal(crashing, 41n), /E_ACTOR_DEAD/);
  host.sendExternal(healthy, 42n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '4142', 'survivor sequence remains monotonic and exactly once');
  assert.equal(host.mailboxStorageEntries, 0);
  host.close();
});

test('real Wasm mailbox admits exactly 10,000 pending messages and preserves FIFO under saturation', async () => {
  const module = wasmFixture({ auto: false });
  const { out, host } = make(module);
  const busy = host.spawn(2), sibling = host.spawn(2);
  for (let i = 0; i < MAX_MAILBOX; i++) host.send(busy, 1n);
  assert.throws(() => host.send(busy, 2n), /E_MAILBOX_FULL/,
    'the 10,001st pending message cannot enter the saturated FIFO');
  // Saturating one mailbox must not consume a sibling's separate capacity.
  host.send(sibling, 9n);
  assert.equal(host.mailboxStorageEntries, MAX_MAILBOX + 1);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '19' + '1'.repeat(MAX_MAILBOX - 1),
    'single-threaded scheduler must preserve FIFO and still service siblings');
  assert.ok(host.mailboxStorageEntries < 1024,
    'long drains must compact acknowledged entries before returning');
  assert.equal(host.memoryBytes, 2 * 65536,
    'both actors must retain independent 64KiB Wasm32 memories');
  host.close();
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 0);
});

test('real Wasm actor count admits exactly 16 isolated actors and rejects the 17th', async () => {
  const module = wasmFixture({ auto: false });
  const { out, host } = make(module);
  const refs = Array.from({ length: MAX_ACTORS }, () => host.spawn(2));
  assert.deepEqual(refs, Array.from({ length: MAX_ACTORS }, (_, index) => index));
  assert.throws(() => host.spawn(2), /E_ACTOR_LIMIT/,
    'the 17th instance cannot evade the global per-tenant capacity');
  refs.forEach((ref, index) => host.send(ref, BigInt(index + 1)));
  assert.equal(await host.drain(), null);
  assert.equal(out.text, refs.map((_, index) => String(index + 1)).join(''),
    'every admitted actor must receive exactly its own message');
  assert.equal(host.memoryBytes, MAX_ACTORS * 65536,
    'the actor limit must preserve independent private linear memories');
  host.close();
  assert.equal(host.memoryBytes, 0);
});
