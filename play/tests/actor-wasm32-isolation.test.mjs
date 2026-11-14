import test from 'node:test';
import assert from 'node:assert/strict';
import { createActorHost, MAX_MAILBOX } from '../src/actor-host.js';

// Real Wasm32 guest memory at address zero, not JavaScript actor state.
function leb(value) {
  const bytes = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return bytes;
}
function flat(...parts) { return parts.flat(Infinity); }
function str(value) {
  const bytes = [...new TextEncoder().encode(value)];
  return [...leb(bytes.length), ...bytes];
}
function section(id, bytes) { return [id, ...leb(bytes.length), ...bytes]; }
function exportEntry(name, kind, index) { return [...str(name), kind, ...leb(index)]; }
function code(...instructions) {
  const body = [0, ...instructions, 0x0b]; // zero local groups, end
  return [...leb(body.length), ...body];
}

function actorFixture() {
  // Imports: atto.print_i64(i64). Exports: main, panic_code, memory,
  // actor_init, actor_receive. Each instance stores its actor state at
  // memory address 0; this proves linear memories are independent.
  const main = code(0x42, 0x00); // i64.const 0
  const init = code(
    0x41, 0x00,               // i32.const 0 (address)
    0x20, 0x00,               // local.get 0 (type index)
    0x36, 0x02, 0x00          // i32.store
  );
  const receive = code(
    0x20, 0x01, 0x42, 0x07, 0x51, // mail value == 7?
    0x04, 0x40, 0x00, 0x0b,       // if (then unreachable) end
    0x41, 0x00,                   // i32.const 0 (store address)
    0x41, 0x00, 0x28, 0x02, 0x00, // i32.load from 0
    0x41, 0x01, 0x6a,             // add 1
    0x36, 0x02, 0x00,             // store at 0
    0x41, 0x00, 0x28, 0x02, 0x00, // load state
    0xac,                         // i64.extend_i32_s
    0x10, 0x00                    // call imported print_i64
  );
  return new Uint8Array(flat(
    [0, 97, 115, 109, 1, 0, 0, 0],
    section(1, flat([4],
      [0x60, 0, 1, 0x7e],                     // () -> i64
      [0x60, 1, 0x7f, 0],                      // (i32) -> ()
      [0x60, 3, 0x7f, 0x7e, 0x7e, 0],         // (i32,i64,i64) -> ()
      [0x60, 1, 0x7e, 0])),                   // (i64) -> ()
    section(2, flat([1], str('atto'), str('print_i64'), [0, 3])),
    section(3, [3, 0, 1, 2]),
    section(5, [1, 1, 1, 1]),                // 1-page memory min=max
    section(6, [1, 0x7f, 1, 0x41, 0, 0x0b]), // panic_code global
    section(7, flat([5],
      exportEntry('main', 0, 1),
      exportEntry('actor_init', 0, 2),
      exportEntry('actor_receive', 0, 3),
      exportEntry('memory', 2, 0),
      exportEntry('panic_code', 3, 0))),
    section(10, flat([3], main, init, receive))
  ));
}


test('two tenant actors have independent Wasm32 memories and FIFO state', async () => {
  const wasm = actorFixture();
  assert.equal(WebAssembly.validate(wasm), true);
  const module = new WebAssembly.Module(wasm);
  const out = {text:'', truncated:false};
  const host = createActorHost({module,names:['Counter'],out});
  const a = host.spawn(0), b = host.spawn(0);
  host.send(a, 10n);
  host.send(a, 11n);
  host.send(b, 12n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '112');
  assert.equal(host.memoryBytes, 2 * 65536);
  host.close();
  assert.equal(host.memoryBytes, 0);
});


test('a trapped actor releases its Wasm heap while surviving siblings keep theirs', async () => {
  const module = new WebAssembly.Module(actorFixture());
  const out = {text: '', truncated: false};
  const host = createActorHost({module, names: ['Counter'], out, persistent: true});
  const bad = host.spawn(0), good = host.spawn(0);
  host.send(bad, 7n); // the real Wasm fixture executes unreachable on value 7
  host.send(good, 10n);
  const fault = await host.drain();
  assert.match(fault, /^E_RUNTIME: .* in actor Counter#0$/);
  assert.equal(out.text, '1');
  assert.equal(host.memoryBytes, 65536, 'failed actor must release its private memory');
  assert.throws(() => host.sendExternal(bad, 10n), /E_ACTOR_DEAD/);
  host.sendExternal(good, 11n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '12');
  assert.equal(host.memoryBytes, 65536, 'healthy actor memory persists across turns');
  host.close();
  assert.equal(host.memoryBytes, 0);
});

test('closing during async Wasm instantiation never resurrects a retired actor heap', async () => {
  const module = new WebAssembly.Module(actorFixture());
  const out = { text: '', truncated: false };
  const host = createActorHost({module, names: ['Counter'], out, persistent: true});
  const first = host.spawn(0), second = host.spawn(0);
  host.send(first, 10n);
  host.send(second, 11n);

  // drain() is suspended inside WebAssembly.instantiate(). The close fence
  // must prevent any resolved instance from being adopted afterward.
  const draining = host.drain();
  host.close();
  assert.equal(host.memoryBytes, 0);
  assert.equal(await draining, 'E_ACTOR: tenant closed during drain');
  assert.equal(host.memoryBytes, 0, 'no Wasm heap may reappear after close()');
  assert.equal(out.text, '', 'a retired tenant must not execute queued mail');
  assert.throws(() => host.sendExternal(first, 12n), /E_ACTOR: persistent tenant not ready/);
  await assert.rejects(host.drain(), /E_ACTOR: actor host closed/);
});


test('real Wasm panic under a full mailbox reclaims queued mail and heap before siblings run', async () => {
  const module = new WebAssembly.Module(actorFixture());
  const out = {text:'', truncated:false};
  const host = createActorHost({module, names:['Counter'], out, persistent:true});
  const bad = host.spawn(0), good = host.spawn(0);
  // The fixture traps on input 7, leaving 9,999 undeliverable messages.
  host.send(bad, 7n);
  for (let i = 1; i < MAX_MAILBOX; i++) host.send(bad, 10n);
  host.send(good, 10n);
  host.send(good, 11n);
  assert.equal(host.mailboxStorageEntries, MAX_MAILBOX + 2);
  const fault = await host.drain();
  assert.match(fault, /^E_RUNTIME: .* in actor Counter#0$/);
  assert.equal(out.text, '12',
    'dead actor must print no further mail; sibling delivers both messages');
  assert.equal(host.mailboxStorageEntries, 0,
    'all dead mail and healthy acknowledged mail must be reclaimed');
  assert.equal(host.memoryBytes, 65536,
    'only the healthy actor private 64KiB Wasm32 heap survives');
  assert.throws(() => host.sendExternal(bad, 10n), /E_ACTOR_DEAD/,
    'replay cannot revive the actor that panicked');
  host.sendExternal(good, 12n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '123',
    'a healthy actor continues with monotonic mailbox sequence and private state');
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 65536);
  host.close();
  assert.equal(host.mailboxStorageEntries, 0);
  assert.equal(host.memoryBytes, 0);
});
