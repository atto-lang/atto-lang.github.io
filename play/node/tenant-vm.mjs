/** Launch a disposable AttoLang v2 guest in one Node.js worker per tenant.
 * The result is never made visible as complete until physical worker
 * termination is confirmed. Node worker_threads is not an OS sandbox.
 */
import { Worker } from 'node:worker_threads';

const TENANT_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function runTenantWasm({ tenantId, wasm, timeoutMs = 3000, WorkerImpl = Worker }) {
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) {
    throw new TypeError('TenantVM requires a bounded tenant ID');
  }
  if (!(wasm instanceof Uint8Array) || wasm.byteLength > (1 << 20) || !WebAssembly.validate(wasm)) {
    throw new TypeError('TenantVM requires validated guest Wasm (at most 1 MiB)');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('Invalid TenantVM deadline');
  }
  if (typeof WorkerImpl !== 'function') throw new TypeError('TenantVM requires a Worker constructor');

  // A caller may mutate its input while the worker starts; send an owned copy.
  const snapshot = new Uint8Array(wasm);
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new WorkerImpl(new URL('./tenant-worker.mjs', import.meta.url), {
        name: `atto-tenant-${tenantId}`
      });
    } catch (error) {
      reject(error);
      return;
    }

    let finishing = false, timer;
    const detach = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };

    function finish(error, result, alreadyExited = false) {
      if (finishing) return;
      finishing = true;
      detach();

      // An exit event proves termination already occurred. Other paths MUST
      // wait for terminate(); a thrown/rejected/non-promise termination
      // receipt is NOT proof that the tenant stopped.
      if (alreadyExited) {
        reject(error ?? new Error('E_TENANT_EXIT: unexpected worker exit'));
        return;
      }
      let receipt;
      try {
        receipt = worker.terminate();
      } catch (cause) {
        const failure = new Error('E_TENANT_TERMINATION: worker termination unconfirmed');
        failure.cause = cause;
        reject(failure);
        return;
      }
      if (!receipt || typeof receipt.then !== 'function') {
        reject(new Error('E_TENANT_TERMINATION: worker termination unconfirmed'));
        return;
      }
      Promise.resolve(receipt).then(
        () => { if (error) reject(error); else resolve(result); },
        cause => {
          const failure = new Error('E_TENANT_TERMINATION: worker termination unconfirmed');
          failure.cause = cause;
          reject(failure);
        }
      );
    }

    const onMessage = message => finish(null, message);
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`E_TENANT_EXIT: worker exited before replying (code ${code})`), null, true);
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    timer = setTimeout(() => finish(new Error('Execution deadline exceeded')), timeoutMs);
    try {
      worker.postMessage({ wasm: snapshot });
    } catch (error) {
      finish(error); // PostMessage failure must still fence termination.
    }
  });
}
