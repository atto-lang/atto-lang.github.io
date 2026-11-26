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
