/** Run one AttoLang Wasm tenant inside a disposable Node.js worker thread.
 * The deadline is enforced by the parent, which can terminate a worker
 * even when a synchronous guest Wasm call does not return. Node worker
 * threads are NOT a security sandbox for arbitrary hostile host JavaScript.
 */
import { Worker } from 'node:worker_threads';

export function run_tenant(wasm, { deadline_ms = 3000 } = {}) {
  if (!(wasm instanceof Uint8Array) || wasm.byteLength > 1 << 20) {
    throw new TypeError('Expected bounded guest Wasm bytes');
  }
  if (!Number.isInteger(deadline_ms) || deadline_ms < 1 || deadline_ms > 60000) {
    throw new RangeError('Invalid tenant deadline');
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./node-tenant-worker.mjs', import.meta.url));
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(null, new Error('E_TENANT_TIMEOUT: execution deadline exceeded')), deadline_ms);
    worker.once('message', value => finish(value, null));
    worker.once('error', error => finish(null, error));
    worker.once('exit', code => finish(null, new Error(`E_TENANT_EXIT: worker exited (${code})`)));
    worker.postMessage({ wasm: new Uint8Array(wasm) });
  });
}
