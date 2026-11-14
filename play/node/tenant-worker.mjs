/* Node.js TenantVM entrypoint. worker_threads provides a distinct V8 isolate
 * per tenant invocation; the guest runner and all its actors stay in this
 * thread. This is NOT an OS security sandbox for untrusted JS/Node code. */
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('TenantVM requires a Node worker thread');
globalThis.self = {
  onmessage: null,
  postMessage: message => parentPort.postMessage(message)
};
await import('../src/runner-worker.js');
parentPort.on('message', data => globalThis.self.onmessage({ data }));
