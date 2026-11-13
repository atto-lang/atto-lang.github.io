// Real compiler-backed tenant-local actor host tests. The outer runner is the
// only Worker; actors are private WebAssembly.Instance objects inside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { actorNames, describePanic, guestImports } from '../src/guest.js';
import { createActorHost, MAX_ACTORS, MAX_MAILBOX } from '../src/actor-host.js';

const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));

async function runActors(source) {
  const compiled = compiler.compile(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const module = await WebAssembly.compile(compiled.wasm);
  const out = { text: '', truncated: false };
  const host = createActorHost({ module, names: actorNames(module), out });
  const { imports, bind } = guestImports(module, out, host);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  let value, fault;
  try { value = instance.exports.main(); fault = await host.drain(); }
  catch (error) { fault = describePanic(instance, error); }
  host.close();
  return { value, fault, stdout: out.text, actors: host.count };
}

const COUNTER = `define actor Counter as
  let int total = 0;
  receive(ActorMail<int> mail): void {
    self.total = self.total + mail.value;
    stdio.println(self.total);
    return;
  }
end
`;

test('actor state is private per instance and mail is FIFO with sequence numbers', async () => {
  const r = await runActors(COUNTER + `pub fnc main(): int {
  val a = spawn Counter();
  val b = spawn Counter();
  a.send(40); a.send(2); b.send(7);
  stdio.println("main done");
  return 5;
}`);
  assert.equal(r.fault, null);
  assert.equal(r.value, 5n);
  assert.equal(r.actors, 2);
  assert.ok(r.stdout.startsWith('main done\n'), 'main runs to completion first');
  const lines = r.stdout.trim().split('\n').slice(1);
  assert.deepEqual(lines.filter(l => l !== '7'), ['40', '42'], 'actor a sees its own mail in order');
  assert.ok(lines.includes('7'), 'actor b has independent state');
});

test('a panicking actor fails the run with its name, keeping earlier output', async () => {
  const r = await runActors(`define actor W as
  receive(ActorMail<int> mail): void {
    stdio.println(mail.value);
    stdio.println(mail.value * 9223372036854775807);
    return;
  }
end
pub fnc main(): int { val w = spawn W(); w.send(7); w.send(8); return 0; }`);
  assert.equal(r.fault, 'E_PANIC: integer overflow in actor W#0');
  assert.equal(r.stdout, '7\n');
});

test('actor count and mailbox size are bounded', async () => {
  let r = await runActors(COUNTER + `pub fnc main(): int {
  for (let i = 0; i < ${MAX_ACTORS + 1}; i++) { val c = spawn Counter(); }
  return 0;
}`);
  assert.match(r.fault, /^E_ACTOR_LIMIT: at most 16 actors per run/);
  r = await runActors(`define actor Sink as
  receive(ActorMail<int> mail): void { return; }
end
pub fnc main(): int {
  val s = spawn Sink();
  for (let i = 0; i <= ${MAX_MAILBOX}; i++) { s.send(i); }
  return 0;
}`);
  assert.match(r.fault, /^E_MAILBOX_FULL: actor Sink#0 already has 10000 messages/);
});

test('host rejects forged references, types and payloads', () => {
  const out = { text: '', truncated: false };
  const good = compiler.compile(COUNTER + 'pub fnc main(): int { return 0; }');
  assert.equal(good.ok, true);
  const host = createActorHost({ module: new WebAssembly.Module(good.wasm), names: ['Counter'], out });
  assert.throws(() => host.spawn(1), /unknown actor type/);
  assert.throws(() => host.spawn(-1), /unknown actor type/);
  assert.throws(() => host.send(0, 1n), /invalid actor reference/);
  const ref = host.spawn(0);
  assert.throws(() => host.send(ref, 1), /signed 64-bit/);
  assert.throws(() => host.send(ref, 2n ** 63n), /signed 64-bit/);
  host.close();
  assert.throws(() => host.spawn(0), /closed/);
});

test('guest actor tables are validated', async () => {
  const plain = compiler.compile('pub fnc main(): int { return 0; }');
  assert.deepEqual(actorNames(await WebAssembly.compile(plain.wasm)), []);
  // a module claiming actor exports without the atto.actors table is refused
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 3,2,1,0, 7,14,1,10,97,99,116,111,114,95,105,110,105,116,0,0, 10,4,1,2,0,11]);
  assert.throws(() => actorNames(new WebAssembly.Module(bytes)), /actor table missing/);
});

test('one tenant hosts many private Wasm instances with round-robin FIFO', async () => {
  const r = await runActors(COUNTER + `pub fnc main(): int {
    val a = spawn Counter();
    val b = spawn Counter();
    a.send(1); a.send(1); b.send(7);
    return 0;
  }`);
  assert.equal(r.fault, null);
  assert.equal(r.actors, 2);
  assert.deepEqual(r.stdout.trim().split('\n'), ['1', '7', '2']);
});

test('separate tenant hosts have independent state and output', async () => {
  const compiled = compiler.compile(COUNTER + 'pub fnc main(): int { return 0; }');
  assert.equal(compiled.ok, true);
  const module = new WebAssembly.Module(compiled.wasm);
  const names = actorNames(module);
  const outA = { text: '', truncated: false }, outB = { text: '', truncated: false };
  const a = createActorHost({ module, names, out: outA });
  const b = createActorHost({ module, names, out: outB });
  a.send(a.spawn(0), 5n);
  b.send(b.spawn(0), 9n);
  assert.equal(await a.drain(), null);
  assert.equal(await b.drain(), null);
  assert.equal(outA.text, '5\n');
  assert.equal(outB.text, '9\n');
  a.close(); b.close();
});

test('a trapping actor does not run its remaining mail, but sibling finishes', async () => {
  const r = await runActors(COUNTER + `pub fnc main(): int {
    val a = spawn Counter();
    val b = spawn Counter();
    a.send(9223372036854775807); a.send(1);
    b.send(7);
    return 0;
  }`);
  assert.match(r.fault, /E_PANIC: integer overflow in actor Counter#0/);
  assert.equal(r.stdout, '9223372036854775807\n7\n');
});

test('no nested Worker is required to spawn and drain actors', async () => {
  const prior = globalThis.Worker;
  globalThis.Worker = class ForbiddenWorker { constructor() { throw new Error('nested workers forbidden'); } };
  try {
    const r = await runActors(COUNTER + `pub fnc main(): int {
      val a = spawn Counter(); val b = spawn Counter();
      a.send(10); b.send(20); return 0;
    }`);
    assert.equal(r.fault, null);
    assert.equal(r.actors, 2);
  } finally {
    if (prior === undefined) delete globalThis.Worker;
    else globalThis.Worker = prior;
  }
});
