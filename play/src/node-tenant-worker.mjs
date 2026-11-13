/** Node.js worker_threads adapter for the portable browser tenant runner.
 * No alternate actor execution implementation: both environments use the
 * same runner-worker.js and tenant-actor-host.js.
 */
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('Tenant entrypoint must run in worker_threads');

const scope = {
  onmessage: null,
  postMessage(message) { parentPort.postMessage(message); }
};
globalThis.self = scope;
await import('./runner-worker.js');

parentPort.on('message', data => {
  Promise.resolve(scope.onmessage({ data })).catch(error => {
    parentPort.postMessage({
      ok: false,
      message: `E_RUNTIME: tenant worker failed: ${error?.message ?? 'unknown'}`,
      stdout: '', truncated: false, actors: 0
    });
  });
});
