import { requireGuestAbiV2 } from '../src/actor-abi-version.js';
/** Persistent Node TenantVM worker. One V8 isolate per tenant session, with
 * many independently instantiated guest Wasm actors living across RPC turns.
 * This is for trusted host code running validated Atto guest Wasm, NOT an OS
 * sandbox for arbitrary JavaScript or hostile tenant extensions.
 */
import { parentPort } from 'node:worker_threads';
import { actorNames, describePanic, guestImports } from '../src/guest.js';
import { createActorHost } from '../src/actor-host.js';
import { admitWasm32Memory } from '../src/wasm-memory-admission.js';

if (!parentPort) throw new Error('TenantVM must run inside worker_threads');

const out = { text: '', truncated: false };
let host = null, started = false, failed = false, busy = false;

function reply(id, message) {
  parentPort.postMessage({
    id, ...message, stdout: out.text, truncated: out.truncated,
    actors: host?.count ?? 0
  });
}

async function start(wasmBytes) {
  if (started || failed) throw new Error('E_TENANT: program already started');
  const wasm = new Uint8Array(wasmBytes);
  if (wasm.byteLength > (1 << 20) || !WebAssembly.validate(wasm)) {
    throw new Error('E_TENANT: invalid or oversized guest Wasm');
  }
  // The persistent-session entrypoint must apply the same pre-instantiation
  // quota admission as the disposable browser/Node runner.
  admitWasm32Memory(wasm);
  const module = await WebAssembly.compile(wasm);
  requireGuestAbiV2(module);
  const names = actorNames(module);
  if (names.length) host = createActorHost({ module, names, out, persistent: true });
  const { imports, bind } = guestImports(module, out, host);
  const instance = await WebAssembly.instantiate(module, imports);
  bind(instance);
  let result;
  try {
    result = instance.exports.main();
  } catch (error) {
    throw new Error(describePanic(instance, error));
  }
  if (typeof result !== 'bigint') throw new Error('E_TENANT: invalid guest return value');
  const fault = host ? await host.drain() : null;
  // Compiler-recognized actor panics are local: the sibling instances remain
  // live and the host can continue sending mail after this initial drain.
  // Unknown engine/protocol failures remain tenant-fatal.
  if (fault && !fault.startsWith('E_PANIC: ')) throw new Error(fault);
  started = true;
  return { ok: true, value: result.toString(), actorFault: fault };
}

async function send(ref, value) {
  if (!started || failed || !host) throw new Error('E_TENANT: actors are not available');
  out.text = '';
  out.truncated = false;
  host.sendExternal(ref, value);
  const fault = await host.drain();
  if (fault) {
    if (!fault.startsWith('E_PANIC: ')) throw new Error(fault);
    return { ok: false, actorFault: true, message: fault };
  }
  return { ok: true };
}

parentPort.on('message', async data => {
  const id = data?.id;
  if (!Number.isSafeInteger(id) || id < 1) {
    failed = true;
    host?.close();
    return;
  }
  if (busy) {
    failed = true;
    host?.close();
    reply(id, { ok: false, message: 'E_TENANT: concurrent RPC rejected' });
    return;
  }
  busy = true;
  try {
    if (failed) throw new Error('E_TENANT: session failed');
    if (data.op === 'start') reply(id, await start(data.wasm));
    else if (data.op === 'send') reply(id, await send(data.ref, data.value));
    else throw new Error('E_TENANT: unknown command');
  } catch (error) {
    // A send to an already retired actor is a normal capability rejection,
    // not grounds to destroy its healthy siblings' tenant worker.
    const actorDead = typeof error?.message === 'string' && /^E_ACTOR_DEAD: /.test(error.message);
    if (!actorDead) {
      failed = true;
      host?.close();
    }
    reply(id, { ok: false, ...(actorDead ? { actorFault: true } : {}),
      message: error.message.startsWith('E_') ? error.message : `E_RUNTIME: ${error.message}` });
  } finally {
    busy = false;
  }
});
