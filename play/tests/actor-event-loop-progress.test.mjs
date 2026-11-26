// Compiler-backed host scheduler tests. No HTTP imports, async source lowering,
// or production guest ABI changes. These test actual emitted Wasm turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { actorNames, guestImports } from '../src/guest.js';
import { createActorHost } from '../src/actor-host.js';

const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));
const count = 96;
const source = `define actor Counter as
  let int total = 0;
  receive(ActorMail<int> mail): void {
    self.total = self.total + mail.value;
    stdio.println(self.total);
    return;
  }
end
pub fnc main(): int {
  val a = spawn Counter();
  val b = spawn Counter();
  for (let i = 0; i < ${count}; i++) {
    a.send(1);
    b.send(100);
  }
  return 42;
}`;
const expected = Array.from({length: count}, (_, i) => [String(i + 1), String(100 * (i + 1))]).flat();

async function setup() {
  const compiled = compiler.compile(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const module = await WebAssembly.compile(compiled.wasm);
  const out = {text: '', truncated: false};
  const host = createActorHost({module, names: actorNames(module), out, persistent: true});
  const {imports, bind} = guestImports(module, out, host);
  const root = await WebAssembly.instantiate(module, imports);
  bind(root);
  assert.equal(root.exports.main(), 42n);
  assert.equal(host.count, 2);
  return {host, out};
}

function lines(out) { return out.text.split('\n').filter(Boolean); }

// Observe real macrotask progress rather than a Promise microtask (which
// would not establish browser timers/control messages can run).
function observeProgress(out, onPartial) {
  let timer, stopped = false;
  const observations = [];
  const tick = () => {
    if (stopped) return;
    const n = lines(out).length;
    if (n > 0 && n < expected.length) {
      observations.push(n);
      onPartial?.();
    }
    if (!stopped && n < expected.length) timer = setTimeout(tick, 0);
  };
  timer = setTimeout(tick, 0);
  return {observations, stop() { stopped = true; clearTimeout(timer); }};
}

test('compiled actor turns yield to host timers and preserve fair FIFO state', {timeout: 10000}, async () => {
  const {host, out} = await setup();
  const probe = observeProgress(out);
  try {
    assert.equal(await host.drain(), null);
    assert.ok(probe.observations.length > 0, 'a real host timer must run while actor mail is pending');
    assert.deepEqual(lines(out), expected, 'round-robin delivery and isolated actor state');
    assert.equal(out.truncated, false);
    assert.equal(host.mailboxStorageEntries, 0);
    host.sendExternal(0, 1n);
    host.sendExternal(1, 100n);
    assert.equal(await host.drain(), null);
    assert.deepEqual(lines(out), [...expected, '97', '9700']);
  } finally { probe.stop(); host.close(); }
  assert.equal(host.memoryBytes, 0);
  assert.equal(host.mailboxStorageEntries, 0);
});

test('host CONTROL close interrupts a yielding drain and prevents later actor turns', {timeout: 10000}, async () => {
  const {host, out} = await setup();
  let prefix;
  const probe = observeProgress(out, () => {
    if (prefix !== undefined) return;
    prefix = lines(out);
    host.close();
  });
  try {
    assert.equal(await host.drain(), 'E_ACTOR: tenant closed during drain');
    assert.ok(prefix?.length > 0 && prefix.length < expected.length, 'close must interrupt active DATA work');
    assert.deepEqual(prefix, expected.slice(0, prefix.length));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(lines(out), prefix, 'no guest output after retirement');
    assert.equal(host.memoryBytes, 0);
    assert.equal(host.mailboxStorageEntries, 0);
    assert.throws(() => host.sendExternal(0, 1n), /persistent tenant not ready/);
    await assert.rejects(host.drain(), /actor host closed/);
  } finally { probe.stop(); host.close(); }
});


test('MessageChannel control events run during multi-quantum DATA drain and compaction', {timeout: 10000}, async () => {
  const {host, out} = await setup();
  const channel = new MessageChannel();
  const additional = 1100; // crosses two 512-entry mailbox compactions per actor
  try {
    assert.equal(await host.drain(), null);
    for (let i = 0; i < additional; i++) {
      host.sendExternal(0, 1n);
      host.sendExternal(1, 100n);
    }
    const target = Array.from({length: additional}, (_, i) =>
      [String(count + i + 1), String(100 * (count + i + 1))]).flat();
    let observed;
    const control = new Promise((resolve, reject) => {
      channel.port1.onmessage = () => {
        try {
          observed = lines(out).length - expected.length;
          assert.ok(observed > 0 && observed < target.length,
            'real message delivery must occur before DATA drain finishes');
          assert.throws(() => host.sendExternal(0, 9n), /concurrent mailbox admission/);
          resolve();
        } catch (error) { reject(error); }
      };
    });
    channel.port2.postMessage('control-probe');
    const [fault] = await Promise.all([host.drain(), control]);
    assert.equal(fault, null);
    assert.ok(observed > 0);
    assert.deepEqual(lines(out), [...expected, ...target]);
    assert.equal(out.truncated, false);
    assert.equal(host.mailboxStorageEntries, 0);
    host.sendExternal(0, 1n);
    host.sendExternal(1, 100n);
    assert.equal(await host.drain(), null);
    assert.deepEqual(lines(out).slice(-2),
      [String(count + additional + 1), String(100 * (count + additional + 1))]);
  } finally {
    channel.port1.close();
    channel.port2.close();
    host.close();
  }
  assert.equal(host.memoryBytes, 0);
  assert.equal(host.mailboxStorageEntries, 0);
});

test('compiled actor panic after several yields retires its remaining DATA while sibling survives compaction', {timeout: 10000}, async () => {
  const built = compiler.compile(`define actor Crash as
    receive(ActorMail<int> mail): void {
      stdio.println(mail.value * 9223372036854775807);
      return;
    }
  end
  define actor Healthy as
    let int total = 0;
    receive(ActorMail<int> mail): void {
      self.total = self.total + mail.value;
      stdio.println(self.total);
      return;
    }
  end
  pub fnc main(): int {
    val bad = spawn Crash();
    val good = spawn Healthy();
    for (let i = 0; i < 65; i++) { bad.send(1); }
    bad.send(2);
    bad.send(1);
    for (let i = 0; i < 1100; i++) { good.send(1); }
    return 42;
  }`);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const module = await WebAssembly.compile(built.wasm);
  const out = {text: '', truncated: false};
  const host = createActorHost({module, names: actorNames(module), out, persistent: true});
  try {
    const {imports, bind} = guestImports(module, out, host);
    const root = await WebAssembly.instantiate(module, imports);
    bind(root);
    assert.equal(root.exports.main(), 42n);
    assert.equal(await host.drain(), 'E_PANIC: integer overflow in actor Crash#0');
    const want = Array.from({length: 1100}, (_, i) =>
      i < 65 ? ['9223372036854775807', String(i + 1)] : [String(i + 1)]).flat();
    assert.deepEqual(lines(out), want, 'no dead-actor replay; no lost healthy mail');
    assert.equal(out.truncated, false);
    assert.equal(host.mailboxStorageEntries, 0);
    assert.throws(() => host.sendExternal(0, 1n), /E_ACTOR_DEAD/);
    host.sendExternal(1, 1n);
    assert.equal(await host.drain(), null);
    assert.equal(lines(out).at(-1), '1101');
    assert.equal(host.mailboxStorageEntries, 0);
  } finally { host.close(); }
  assert.equal(host.memoryBytes, 0);
  assert.equal(host.mailboxStorageEntries, 0);
});
