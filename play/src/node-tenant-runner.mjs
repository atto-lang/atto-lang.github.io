/** Disposable Node TenantVM: settle only after physical Worker termination. */
import { Worker } from 'node:worker_threads';

/** Injection is trusted-host/test-only; never pass a guest-provided Worker. */
export function createNodeTenantRunner(WorkerImpl = Worker) {
  if (typeof WorkerImpl !== 'function') throw new TypeError('Worker implementation required');
  return function run_tenant(wasm, { deadline_ms = 3000 } = {}) {
    if (!(wasm instanceof Uint8Array) || wasm.byteLength > 1 << 20) {
      throw new TypeError('Expected bounded guest Wasm bytes');
    }
    if (!Number.isInteger(deadline_ms) || deadline_ms < 1 || deadline_ms > 60000) {
      throw new RangeError('Invalid tenant deadline');
    }
    const snapshot = new Uint8Array(wasm);
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new WorkerImpl(new URL('./node-tenant-worker.mjs', import.meta.url));
      } catch (error) {
        reject(error);
        return;
      }
      let finishing = false;
      let timer;
      const detach = () => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const unconfirmed = cause => {
        const error = new Error('E_TENANT_TERMINATION: worker termination unconfirmed');
        error.cause = cause;
        reject(error);
      };
      function finish(value, error, alreadyExited = false) {
        if (finishing) return;
        finishing = true;
        detach();
        if (alreadyExited) {
          reject(error ?? new Error('E_TENANT_EXIT: unexpected worker exit'));
          return;
        }
        let receipt;
        try {
          receipt = worker.terminate();
          if (!receipt || typeof receipt.then !== 'function') {
            unconfirmed(new Error('missing awaitable termination receipt'));
            return;
          }
        } catch (cause) {
          unconfirmed(cause);
          return;
        }
        Promise.resolve(receipt).then(
          () => { if (error) reject(error); else resolve(value); },
          unconfirmed
        );
      }
      const onMessage = value => finish(value, null);
      const onError = error => finish(null, error);
      const onExit = code => finish(null, new Error(`E_TENANT_EXIT: worker exited (${code})`), true);
      worker.once('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      timer = setTimeout(
        () => finish(null, new Error('E_TENANT_TIMEOUT: execution deadline exceeded')),
        deadline_ms
      );
      try {
        worker.postMessage({ wasm: snapshot });
      } catch (error) {
        finish(null, error); // Clone/transport fault still requires termination.
      }
    });
  };
}

export const run_tenant = createNodeTenantRunner();
