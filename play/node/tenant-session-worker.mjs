/** Persistent Node TenantVM worker. One V8 isolate per tenant session, with
 * many independently instantiated guest Wasm actors living across RPC turns.
 * This is for trusted host code running validated Atto guest Wasm, NOT an OS
 * sandbox for arbitrary JavaScript or hostile tenant extensions.
 */
import { parentPort } from 'node:worker_threads';
import { actorNames, describePanic, guestImports } from '../src/guest.js';
import { createActorHost } from '../src/actor-host.js';

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
  const module = await WebAssembly.compile(wasm);
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
  if (fault) throw new Error(fault);
  started = true;
  return { ok: true, value: result.toString() };
}

async function send(ref, value) {
  if (!started || failed || !host) throw new Error('E_TENANT: actors are not available');
  out.text = '';
  out.truncated = false;
  host.sendExternal(ref, value);
  const fault = await host.drain();
  if (fault) throw new Error(fault);
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
    failed = true;
    host?.close();
    reply(id, { ok: false, message: error.message.startsWith('E_') ? error.message : `E_RUNTIME: ${error.message}` });
  } finally {
    busy = false;
  }
});
