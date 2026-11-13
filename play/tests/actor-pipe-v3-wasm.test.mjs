// Experimental v3 host capability tests using an independently assembled real
// Wasm32 module. This is NOT evidence that any AttoLang compiler emits v3.
// Each actor executes its own Wasm instance; JS only admits mail and routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorHost, MAX_MAILBOX} from '../src/actor-host.js';
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
