import { carrierProducer, CONTROL_STOP } from './ores-carrier-channel.js';

/** Own one disposable worker at a time and settle every request on cancellation.
 *  When the payload carries an OresVM carrier channel, cancellation first
 *  posts supervisor CONTROL STOP (the carrier sees it before its next DATA
 *  turn, even while parked), then terminates the Worker as the hard fence. */
export function createWorkerTask({ WorkerImpl = globalThis.Worker, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let active = null;
  function request(url, payload, timeoutMs, label = 'Execution') {
    if (active) throw new Error('A worker request is already active');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid worker deadline');
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new WorkerImpl(url, { type: 'module' }); }
      catch (error) { reject(error); return; }
      let settled = false;
      let timer;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        if (error && typeof SharedArrayBuffer === 'function' && payload?.channel instanceof SharedArrayBuffer) {
          try { carrierProducer(payload.channel).control(CONTROL_STOP); } catch { /* terminate still fences */ }
        }
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        // A failed termination is NOT proof the previous guest stopped.
        // Keep the task fenced against reuse, but always settle the promise.
        let terminationFailure = null;
        try { worker.terminate(); }
        catch (cause) {
          terminationFailure = new Error('E_WORKER_TERMINATION: Worker termination unconfirmed');
          terminationFailure.cause = cause;
        }
        if (!terminationFailure && active?.worker === worker) active = null;
        if (terminationFailure) reject(terminationFailure);
        else if (error) reject(error);
        else resolve(result);
      }
      active = { worker, cancel: () => finish(new Error('Operation cancelled')) };
      worker.onmessage = event => finish(null, event.data);
      worker.onerror = () => finish(new Error('Worker failed to load or execute'));
      worker.onmessageerror = () => finish(new Error('Worker response could not be decoded'));
      timer = setTimer(() => finish(new Error(`${label} deadline exceeded`)), timeoutMs);
      try { worker.postMessage(payload); }
      catch (error) { finish(error); }
    });
  }
  function cancel() {
    if (!active) return false;
    active.cancel();
    return true;
  }
  return { request, cancel };
}
