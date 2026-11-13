/** Run a bounded AttoLang Wasm guest in one disposable Node TenantVM.
 * Every guest actor gets a private Wasm instance in this same Worker.
 * Node worker_threads is NOT an OS security boundary for hostile host JS.
 *
 * A result/timeout is NOT a reclamation receipt: never settle the parent
 * until Worker.terminate() confirms the entire tenant has exited.
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
  if (typeof WorkerImpl !== 'function') throw new TypeError('TenantVM Worker implementation required');
  // Pin exact admitted bytes before constructing the Worker.
  const bytes = new Uint8Array(wasm);
  const worker = new WorkerImpl(new URL('./tenant-worker.mjs', import.meta.url), {
    name: `atto-tenant-${tenantId}`
  });
  return new Promise((resolve, reject) => {
    let finishing = false;
    let timer;
    function detach() {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    }
    function unconfirmed(cause) {
      const error = new Error('E_TENANT_TERMINATION: Worker termination unconfirmed');
      error.cause = cause;
      reject(error);
    }
    function finish(error, result, exited = false) {
      if (finishing) return;
      finishing = true;
      detach();
      if (exited) { reject(error); return; } // exit event is physical proof
      let receipt;
      try {
        receipt = worker.terminate();
        if (!receipt || typeof receipt.then !== 'function') {
          unconfirmed(new Error('missing awaitable Worker termination receipt'));
          return;
        }
      } catch (cause) {
        unconfirmed(cause);
        return;
      }
      Promise.resolve(receipt).then(
        () => { if (error) reject(error); else resolve(result); },
        unconfirmed
      );
    }
    const onMessage = message => finish(null, message);
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`E_TENANT_EXIT: Worker exited (${code})`), null, true);
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    timer = setTimeout(() => finish(new Error('Execution deadline exceeded')), timeoutMs);
    try {
      worker.postMessage({ wasm: bytes });
    } catch (error) {
      // Clone/transport faults are not a reason to leave a tenant running.
      finish(error);
    }
  });
}
