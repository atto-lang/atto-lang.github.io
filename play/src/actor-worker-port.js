/**
 * Worker-like facades in the disposable v2 runner. A single transferred
 * MessagePort multiplexes actor IDs; the page owns actual Worker objects.
 * MessagePort ordering preserves spawn -> init -> FIFO mail per actor.
 */
import { MAX_SUPERVISED_ACTORS } from './actor-worker-broker.js';

export function actorWorkerPortFactory(port) {
  if (!port || typeof port.postMessage !== 'function' ||
      typeof port.close !== 'function') throw new Error('E_ACTOR_PORT');
  let nextId = 0;
  const instances = new Map();
  port.onmessage = ({ data }) => {
    const actor = instances.get(data?.id);
    if (!actor || actor.closed) return;
    if (data.op === 'event') actor.onmessage?.({ data: data.data });
    else if (data.op === 'messageerror') actor.onmessageerror?.();
    else actor.onerror?.({ preventDefault() {} });
  };
  port.onmessageerror = () => {
    for (const actor of instances.values())
      if (!actor.closed) actor.onmessageerror?.();
  };
  port.start?.();
  return class PortActorWorker {
    constructor() {
      if (nextId >= MAX_SUPERVISED_ACTORS) throw new Error('E_ACTOR_LIMIT');
      this.id = nextId++;
      this.closed = false;
      this.onmessage = null;
      this.onerror = null;
      this.onmessageerror = null;
      instances.set(this.id, this);
      try { port.postMessage({ op: 'spawn', id: this.id }); }
      catch (error) {
        this.closed = true;
        instances.delete(this.id);
        throw error;
      }
    }
    postMessage(data) {
      if (this.closed) throw new Error('E_ACTOR_PORT_CLOSED');
      port.postMessage({ op: 'post', id: this.id, data });
    }
    terminate() {
      if (this.closed) return;
      this.closed = true;
      instances.delete(this.id);
      try { port.postMessage({ op: 'terminate', id: this.id }); }
      finally { this.onmessage = this.onerror = this.onmessageerror = null; }
    }
  };
}
