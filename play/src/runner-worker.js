import { requireGuestAbiV2 } from './actor-abi-version.js';
/* Executes one guest module for ONE tenant in this worker.
 * All tenant actors are scheduled here, each in an independent Wasm instance.
 * The host's worker deadline enforces cancellation even for non-cooperative
 * guest loops. No actor worker is spawned and no extra imports are granted. */
import { actorNames, describePanic, guestImports } from './guest.js';
import { createActorHost } from './actor-host.js';
import { admitWasm32Memory } from './wasm-memory-admission.js';

// A disposable Worker is a single-use tenant execution boundary. Without
// this synchronous latch, two postMessage() calls can overlap across the
// async compile/instantiate/drain awaits and allocate two independent actor
// hosts, defeating the worker-wide 16-actor and memory admission limits.
// Never dereference the second payload or expose the first guest's output.
let acceptedOneGuest = false;
self.onmessage = async ({ data }) => {
  if (acceptedOneGuest) {
    self.postMessage({
      ok: false,
      message: 'E_TENANT_REUSE: disposable Worker already accepted a guest',
      stdout: '', truncated: false, actors: 0
    });
    return;
  }
  acceptedOneGuest = true;
  const out = { text: '', truncated: false };
  let host = null;
  const reply = message => self.postMessage({ ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0 });
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    // Admission happens BEFORE compiling or instantiating guest code.
    admitWasm32Memory(wasm);
    const module = await WebAssembly.compile(wasm);
    requireGuestAbiV2(module);
    const names = actorNames(module);
    if (names.length) host = createActorHost({ module, names, out });
    const { imports, bind } = guestImports(module, out, host);
    const instance = await WebAssembly.instantiate(module, imports);
    bind(instance);
    let result;
    try {
      result = instance.exports.main();
    } catch (error) {
      host?.close();
      reply({ ok: false, message: describePanic(instance, error) });
      return;
    }
    if (typeof result !== 'bigint') throw new Error('Guest returned unexpected value');
    // main has returned: wait until every actor has handled all of its mail
    const fault = host ? await host.drain() : null;
    host?.close();
    if (fault) reply({ ok: false, message: fault, value: result.toString() });
    else reply({ ok: true, value: result.toString() });
  } catch (error) {
    host?.close();
    reply({ ok: false, message: /^E_[A-Z_]+: /.test(error?.message ?? '') ? error.message : `E_RUNTIME: ${error.message}` });
  }
};
