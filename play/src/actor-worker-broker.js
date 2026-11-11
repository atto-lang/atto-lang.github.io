/**
 * Page-owned, on-demand worker broker for atto.browser.guest.v2.
 *
 * The disposable runner receives a MessagePort, never a child Worker handle.
 * Actual actor Worker objects live on the page, so Stop/deadline/error can
 * terminate them even when the runner is stuck in synchronous guest code.
 * Counters describe Worker API handles/termination attempts, NOT OS process
 * exit or physical CPU/RSS reclamation.
 */
export const MAX_SUPERVISED_ACTORS = 16;

export class ActorWorkerBroker {
  constructor({ WorkerImpl = globalThis.Worker,
    MessageChannelImpl = globalThis.MessageChannel,
    childUrl = new URL('./actor-worker.js', import.meta.url) } = {}) {
    this.WorkerImpl = WorkerImpl;
    this.MessageChannelImpl = MessageChannelImpl;
    this.childUrl = childUrl;
    this.scope = null;
    this.created = 0;
    this.terminated = 0;
    this.uncertain = 0;
    this.dispatched = 0;
    this.ready = 0;
    this.maxActive = 0;
  }
  stats() {
    return Object.freeze({
      activeChildren: this.scope?.entries.size ?? 0,
      created: this.created, terminated: this.terminated,
      uncertain: this.uncertain, dispatched: this.dispatched,
      ready: this.ready, maxActive: this.maxActive
    });
  }
  reserve() {
    if (this.uncertain) throw new Error('E_ACTOR_SUPERVISOR_UNCERTAIN');
    if (this.scope) throw new Error('E_ACTOR_SUPERVISOR_BUSY');
    const channel = new this.MessageChannelImpl();
    const entries = new Map();
    let closed = false, nextId = 0;
    const closeEntry = entry => {
      if (entry.closed) return;
      entry.closed = true;
      entries.delete(entry.id);
      for (const key of ['onmessage', 'onerror', 'onmessageerror']) {
        try { entry.child[key] = null; } catch {}
      }
      try { entry.child.terminate(); }
      catch { this.uncertain++; }
      this.terminated++;
    };
    const notify = (id, op, data) => {
      if (closed) return;
      try { channel.port1.postMessage({ id, op, data }); }
      catch {
        const entry = entries.get(id);
        if (entry) closeEntry(entry);
      }
    };
    const scope = {
      port: channel.port2,
      entries,
      close: () => {
        if (closed) return;
        closed = true;
        this.scope = null;
        for (const key of ['onmessage', 'onmessageerror']) {
          try { channel.port1[key] = null; } catch {}
        }
        try { channel.port1.close(); } catch {}
        try { channel.port2.close(); } catch {}
        for (const entry of [...entries.values()]) closeEntry(entry);
      }
    };
    const onMessage = ({ data }) => {
      if (closed) return;
      const { op, id } = data && typeof data === 'object' ? data : {};
      if (!Number.isInteger(id) || id < 0 || id >= MAX_SUPERVISED_ACTORS) {
        scope.close();
        return;
      }
      if (op === 'spawn') {
        if (id !== nextId || entries.has(id)) {
          notify(id, 'fault');
          return;
        }
        nextId++;
        let child;
        try { child = new this.WorkerImpl(this.childUrl, { type: 'module' }); }
        catch { notify(id, 'fault'); return; }
        this.created++;
        const entry = { id, child, closed: false };
        entries.set(id, entry);
        this.maxActive = Math.max(this.maxActive, entries.size);
        try {
          child.onmessage = event => {
            if (closed || entry.closed) return;
            if (event.data?.kind === 'ready') this.ready++;
            notify(id, 'event', event.data);
          };
          child.onerror = () => {
            notify(id, 'fault');
            closeEntry(entry);
          };
          child.onmessageerror = () => {
            notify(id, 'messageerror');
            closeEntry(entry);
          };
        } catch {
          notify(id, 'fault');
          closeEntry(entry);
        }
        return;
      }
      const entry = entries.get(id);
      if (op === 'terminate') {
        if (entry) closeEntry(entry);
        return;
      }
      if (op !== 'post' || !entry || entry.closed ||
          !data.data || (data.data.kind !== 'init' && data.data.kind !== 'mail')) {
        notify(id, 'fault');
        if (entry) closeEntry(entry);
        return;
      }
      try {
        entry.child.postMessage(data.data);
        if (data.data.kind === 'mail') this.dispatched++;
      } catch {
        notify(id, 'fault');
        closeEntry(entry);
      }
    };
    this.scope = scope;
    try {
      channel.port1.onmessage = onMessage;
      channel.port1.onmessageerror = () => scope.close();
      channel.port1.start?.();
    } catch (error) {
      scope.close();
      throw error;
    }
    return scope;
  }
}
