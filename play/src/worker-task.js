import { ActorWorkerBroker } from './actor-worker-broker.js';

/** One disposable parent Worker; the page retains and revokes actor children. */
export function createWorkerTask({ WorkerImpl = globalThis.Worker,
  MessageChannelImpl = globalThis.MessageChannel,
  setTimer = setTimeout, clearTimer = clearTimeout,
  broker = new ActorWorkerBroker({ WorkerImpl, MessageChannelImpl }) } = {}) {
  let active = null, unsafeParent = false;
  function request(url, payload, timeoutMs, label = 'Execution',
    { superviseActors = false } = {}) {
    if (active) throw new Error('A worker request is already active');
    if (unsafeParent) throw new Error('E_WORKER_TERMINATION_UNCERTAIN');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new RangeError('Invalid worker deadline');
    return new Promise((resolve, reject) => {
      let worker, scope = null;
      try {
        if (superviseActors) scope = broker.reserve();
        worker = new WorkerImpl(url, { type: 'module' });
      } catch (error) {
        try { scope?.close(); } catch {}
        reject(error);
        return;
      }
      let settled = false, timer;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        try { if (timer !== undefined) clearTimer(timer); } catch {}
        for (const key of ['onmessage', 'onerror', 'onmessageerror']) {
          try { worker[key] = null; } catch {}
        }
        try { worker.terminate(); }
        catch {
          unsafeParent = true;
          error = new Error('E_WORKER_TERMINATION_UNCERTAIN');
        }
        try { scope?.close(); }
        catch { error = new Error('E_ACTOR_SUPERVISOR_UNCERTAIN'); }
        if (scope && broker.stats().uncertain)
          error = new Error('E_ACTOR_SUPERVISOR_UNCERTAIN');
        if (active?.worker === worker) active = null;
        if (error) reject(error); else resolve(result);
      }
      active = { worker, cancel: () => finish(new Error('Operation cancelled')) };
      try {
        worker.onmessage = event => finish(null, event.data);
        worker.onerror = () => finish(new Error('Worker failed to load or execute'));
        worker.onmessageerror = () => finish(new Error('Worker response could not be decoded'));
        timer = setTimer(() => finish(new Error(label + ' deadline exceeded')), timeoutMs);
        if (settled) return; // a synchronous deadline already terminated it
        if (scope) worker.postMessage({ ...payload, actorPort: scope.port }, [scope.port]);
        else worker.postMessage(payload);
      } catch (error) {
        finish(error);
      }
    });
  }
  function cancel() {
    if (!active) return false;
    active.cancel();
    return true;
  }
  return { request, cancel, actorStats: () => broker.stats() };
}
