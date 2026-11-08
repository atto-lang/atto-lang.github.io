import { ActorWorkerSupervisor } from './actor-worker-supervisor.js';
/** Own one disposable worker and, for actor programs, the children in a
 * separately supervised page-owned registry. */
export function createWorkerTask({ WorkerImpl = globalThis.Worker, setTimer = setTimeout,
  clearTimer = clearTimeout, MessageChannelImpl=globalThis.MessageChannel,
  supervisor=new ActorWorkerSupervisor({WorkerImpl,MessageChannelImpl}) } = {}) {
  let active = null;
  function request(url, payload, timeoutMs, label = 'Execution',
    {actorSlots=0}={}) {
    if (active) throw new Error('A worker request is already active');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid worker deadline');
    return new Promise((resolve, reject) => {
      let worker, scope=null;
      try {
        if(actorSlots!==0)scope=supervisor.reserve(actorSlots);
        worker=new WorkerImpl(url,{type:'module'});
      } catch(error) {
        scope?.close();
        reject(error);return;
      }
      let settled = false;
      let timer;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        // Release state and settle the caller even if the browser throws
        // while terminating a defective/disposed Worker. Termination is a
        // best-effort cleanup step, never a reason to strand this Promise.
        try { worker.terminate(); } catch { /* cancellation still settles */ }
        // The page revokes all actor Workers even if this parent is frozen,
        // forcibly terminated or never executes its own finally block.
        scope?.close();
        if (active?.worker === worker) active = null;
        if (error) reject(error); else resolve(result);
      }
      active = { worker, cancel: () => finish(new Error('Operation cancelled')) };
      worker.onmessage = event => finish(null, event.data);
      worker.onerror = () => finish(new Error('Worker failed to load or execute'));
      worker.onmessageerror = () => finish(new Error('Worker response could not be decoded'));
      timer = setTimer(() => finish(new Error(`${label} deadline exceeded`)), timeoutMs);
      try {
        if(scope)worker.postMessage({...payload,actorPorts:scope.ports},scope.ports);
        else worker.postMessage(payload);
      } catch(error){finish(error);}
    });
  }
  function cancel() {
    if (!active) return false;
    active.cancel();
    return true;
  }
  return { request, cancel, actorStats:()=>supervisor.stats() };
}
