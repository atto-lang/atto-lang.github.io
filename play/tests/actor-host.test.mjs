// Actor host bookkeeping with the real compiler and real guest instances.
// FakeWorker follows src/actor-worker.js's protocol in-process; the actual
// worker file runs in Chromium in tests/browser-e2e.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompiler } from '../src/compiler.js';
import { actorNames, describePanic, guestImports } from '../src/guest.js';
import { createActorHost, MAX_ACTORS, MAX_MAILBOX } from '../src/actor-host.js';

const compiler = await createCompiler(await readFile(new URL('../public/atto_compiler.wasm', import.meta.url)));

class FakeWorker {
  static live = 0;
  constructor() { FakeWorker.live++; this.queue = Promise.resolve(); this.out = { text: '', truncated: false }; }
  postMessage(data) {
    const copy = structuredClone(data);
    this.queue = this.queue.then(() => this.handle(copy));
  }
  emit(message) { if (this.onmessage) this.onmessage({ data: message }); }
  async handle(data) {
    if (this.failed || this.dead) return;
    try {
      if (data.kind === 'init') {
        const module = await WebAssembly.compile(data.wasm);
        const host = guestImports(module, this.out);
        this.instance = await WebAssembly.instantiate(module, host.imports);
        host.bind(this.instance);
        this.type = data.type;
        this.instance.exports.actor_init(this.type);
        this.emit({ kind: 'ready' });
      } else {
        this.out.text = '';
        this.instance.exports.actor_receive(this.type, data.value, BigInt(data.sequence));
        this.emit({ kind: 'done', sequence: data.sequence, stdout: this.out.text });
      }
    } catch (error) {
      this.failed = true;
      this.emit({ kind: 'fault', message: describePanic(this.instance, error), stdout: this.out.text });
    }
  }
  terminate() { this.dead = true; FakeWorker.live--; }
}

async function runActors(source) {
  const compiled = compiler.compile(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const module = await WebAssembly.compile(compiled.wasm);
  const out = { text: '', truncated: false };
  const host = createActorHost({ wasm: compiled.wasm, names: actorNames(module), out, WorkerImpl: FakeWorker, workerUrl: 'actor-worker.js' });
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
  state { let int total = 0; }
  receive(ActorMail<int> mail): void {
    self.handle_state(critical-write |s| -> {
      self.total = self.total + mail.value;
      stdio.println(self.total);
    });
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
  assert.equal(FakeWorker.live, 0, 'every actor worker is terminated');
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
  const host = createActorHost({ wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), names: ['A'], out, WorkerImpl: FakeWorker, workerUrl: 'x' });
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
