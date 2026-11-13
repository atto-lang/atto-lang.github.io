/** Launch an AttoLang compiled guest in a disposable tenant-specific Node.js
 * V8 isolate. Every actor spawned by this guest is a separate WebAssembly
 * instance in that SAME worker thread. The host enforces the deadline.
 *
 * This is for trusted Node hosts: worker_threads does NOT sandbox arbitrary
 * JS, native addons, filesystem or process APIs. Only run validated Atto
 * guest Wasm with the runner's strict import allowlist.
 */
import { Worker } from 'node:worker_threads';

export function runTenantWasm({ tenantId, wasm, timeoutMs = 3000, WorkerImpl = Worker }) {
  if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(tenantId)) {
    throw new TypeError('TenantVM requires a bounded tenant ID');
  }
  if (!(wasm instanceof Uint8Array) || wasm.byteLength > (1 << 20) || !WebAssembly.validate(wasm)) {
    throw new TypeError('TenantVM requires validated guest Wasm (at most 1 MiB)');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('Invalid TenantVM deadline');
  }
  // One Worker per tenant invocation, not one Worker per actor. Do not pool
  // workers across tenants or allow tenant-supplied worker entrypoints.
  const worker = new WorkerImpl(new URL('./tenant-worker.mjs', import.meta.url), {
    name: `atto-tenant-${tenantId}`
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Execution deadline exceeded')), timeoutMs);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    worker.once('message', message => finish(null, message));
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(`TenantVM worker exited before replying (code ${code})`)));
    try { worker.postMessage({ wasm: new Uint8Array(wasm) }); }
    catch (error) { finish(error); }
  });
}
