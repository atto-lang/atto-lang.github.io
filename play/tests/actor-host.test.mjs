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

class ControlledActorWorker {
  static instances = [];
  constructor() {
    this.messages = [];
    this.terminations = 0;
    ControlledActorWorker.instances.push(this);
  }
  postMessage(data) { this.messages.push(data); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminations++; }
}
function controlledActorHost() {
  const out = { text: '', truncated: false };
  const host = createActorHost({
    wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    names: ['Pending'], out, WorkerImpl: ControlledActorWorker, workerUrl: 'actor-worker.js'
  });
  host.spawn(0);
  return { host, worker: ControlledActorWorker.instances.at(-1), out };
}

test('drain waits for actor initialization even without any mailbox messages', async () => {
  const { host, worker, out } = controlledActorHost();
  let settled = false;
  const pending = host.drain().then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false, 'main returning before actor_init must not indicate success');
  worker.emit({ kind: 'ready', stdout: 'initialized\n' });
  assert.equal(await pending, null);
  assert.equal(out.text, 'initialized\n');
  host.close();
});

test('actor initialization faults are reported when no messages were sent', async () => {
  const { host, worker } = controlledActorHost();
  const pending = host.drain();
  worker.emit({ kind: 'fault', message: 'E_PANIC: actor init failed' });
  assert.equal(await pending, 'E_PANIC: actor init failed in actor Pending#0');
  host.close();
});

test('duplicate readiness and completion before readiness are fail-closed', async () => {
  const first = controlledActorHost();
  const initial = first.host.drain();
  first.worker.emit({ kind: 'ready' });
  assert.equal(await initial, null);
  first.worker.emit({ kind: 'ready' });
  assert.match(await first.host.drain(), /E_ACTOR_PROTOCOL: duplicate or late actor readiness/);
  first.host.close();

  const second = controlledActorHost();
  const pending = second.host.drain();
  second.worker.emit({ kind: 'done', sequence: 0 });
  assert.match(await pending, /E_ACTOR_PROTOCOL: unexpected actor completion/);
  second.host.close();
});

test('closing a pending actor host settles drain and terminates once', async () => {
  const { host, worker } = controlledActorHost();
  const pending = host.drain();
  host.close();
  assert.equal(await pending, 'E_ACTOR: actor host closed');
  host.close();
  assert.equal(worker.terminations, 1);
});

class ThrowingInitWorker extends ControlledActorWorker {
  postMessage() { throw new Error('DataCloneError: failed to queue init'); }
}

test('failed actor initialization handoff releases worker and preserves host count', async () => {
  const out = { text: '', truncated: false };
  const host = createActorHost({
    wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    names: ['Pending'], out, WorkerImpl: ThrowingInitWorker, workerUrl: 'actor-worker.js'
  });
  const existing = ControlledActorWorker.instances.length;
  assert.throws(() => host.spawn(0), /DataCloneError/);
  assert.equal(host.count, 0, 'failed spawn must not reserve an actor reference');
  assert.equal(ControlledActorWorker.instances.length, existing + 1);
  assert.equal(ControlledActorWorker.instances.at(-1).terminations, 1, 'orphan worker must be terminated');
  assert.equal(await host.drain(), null);
  host.close();
});

test('overlapping drains fail closed instead of losing the original promise', async () => {
  const { host, worker } = controlledActorHost();
  const first = host.drain();
  assert.throws(() => host.drain(), /E_ACTOR: drain already pending/);
  worker.emit({ kind: 'ready' });
  assert.equal(await first, null, 'the original caller must still complete');
  host.close();
  assert.equal(await host.drain(), 'E_ACTOR: actor host closed');
});
