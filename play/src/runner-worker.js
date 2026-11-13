/* One page-owned Worker is one disposable browser TenantVM incarnation.
 * The Worker contains main and all of the tenant's actors. Every actor has
 * its own Wasm Instance (and private instance globals/linear memory), while
 * the tenant has exactly one scheduling/event-loop carrier. Stop/deadline
 * terminates that carrier directly from the page: no nested actor Workers.
 *
 * This is a browser Worker boundary, not an OS sandbox or a promise that all
 * browsers implement Workers with V8 isolates. A noncooperative actor can
 * stall its own tenant until page-enforced termination.
 */
import { actorNames, describePanic, guestImports } from './guest.js';
import { createActorHost } from './actor-host.js';

self.onmessage = async ({ data }) => {
  const out = { text: '', truncated: false };
  let host = null;
  const reply = message => self.postMessage({ ...message, stdout: out.text, truncated: out.truncated, actors: host?.count ?? 0 });
  try {
    const wasm = new Uint8Array(data.wasm);
    if (wasm.byteLength > 1 << 20 || !WebAssembly.validate(wasm)) throw new Error('Invalid/oversized guest module');
    const module = await WebAssembly.compile(wasm);
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
    const fault = host ? await host.drain() : null;
    host?.close();
    if (fault) reply({ ok: false, message: fault, value: result.toString() });
    else reply({ ok: true, value: result.toString() });
  } catch (error) {
    host?.close();
    reply({ ok: false, message: `E_RUNTIME: ${error.message}` });
  }
};
