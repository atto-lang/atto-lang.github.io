// Real compiled .atto guests: one tenant scheduler, private Wasm instance per
// actor, bounded FIFO mailboxes and fail-closed error handling.
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

test('one worker holds multiple actors with isolated state and per-actor FIFO mail', async () => {
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
  assert.deepEqual(r.stdout.trim().split('\n'), ['main done', '40', '7', '42']);
});

test('a panicking actor fails the tenant run with its name and prior output', async () => {
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

test('tenant scheduler rejects forged handles, types and payloads', async () => {
  const program = compiler.compile('pub fnc main(): int { return 0; }');
  const module = await WebAssembly.compile(program.wasm);
  const host = createActorHost({ module, names: ['A'], out: { text: '', truncated: false } });
  assert.throws(() => host.spawn(1), /unknown actor type/);
  assert.throws(() => host.spawn(-1), /unknown actor type/);
  assert.throws(() => host.send(0, 1n), /invalid actor reference/);
  const ref = host.spawn(0);
  assert.throws(() => host.send(ref, 1), /signed 64-bit/);
  assert.throws(() => host.send(ref, 2n ** 63n), /signed 64-bit/);
  assert.match(await host.drain(), /guest actor exports missing/);
  assert.throws(() => host.send(ref, 1n), /mailbox admission closed/);
  host.close();
  assert.throws(() => host.spawn(0), /closed/);
});

test('two guest actor instances never share globals or linear memory', async () => {
  const compiled = compiler.compile(COUNTER + 'pub fnc main(): int { return 0; }');
  const module = await WebAssembly.compile(compiled.wasm);
  const make = async () => {
    const output = { text: '', truncated: false };
    const { imports, bind } = guestImports(module, output);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    instance.exports.actor_init(0);
    return { instance, output };
  };
  const a = await make(), b = await make();
  assert.notStrictEqual(a.instance, b.instance);
  if (a.instance.exports.memory) assert.notStrictEqual(a.instance.exports.memory, b.instance.exports.memory);
  a.instance.exports.actor_receive(0, 20n, 0n);
  b.instance.exports.actor_receive(0, 3n, 0n);
  a.instance.exports.actor_receive(0, 2n, 1n);
  assert.equal(a.output.text, '20\n22\n');
  assert.equal(b.output.text, '3\n');
});

test('guest actor tables are validated', async () => {
  const plain = compiler.compile('pub fnc main(): int { return 0; }');
  assert.deepEqual(actorNames(await WebAssembly.compile(plain.wasm)), []);
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 3,2,1,0, 7,14,1,10,97,99,116,111,114,95,105,110,105,116,0,0, 10,4,1,2,0,11]);
  assert.throws(() => actorNames(new WebAssembly.Module(bytes)), /actor table missing/);
});

test('a failed actor is quarantined while queued healthy siblings finish', async () => {
  const r = await runActors(`define actor Faulty as
    receive(ActorMail<int> mail): void {
      stdio.println(mail.value);
      stdio.println(mail.value * 9223372036854775807);
      return;
    }
  end
  define actor Healthy as
    receive(ActorMail<int> mail): void {
      stdio.println(mail.value);
      return;
    }
  end
  pub fnc main(): int {
    val faulty = spawn Faulty();
    val healthy = spawn Healthy();
    faulty.send(7);
    faulty.send(8);
    healthy.send(41);
    healthy.send(42);
    return 0;
  }`);
  assert.equal(r.actors, 2);
  assert.equal(r.fault, 'E_PANIC: integer overflow in actor Faulty#0');
  assert.equal(r.stdout, '7\\n41\\n42\\n',
    'failed actor must not execute its second mail, but healthy sibling must finish both');
});
