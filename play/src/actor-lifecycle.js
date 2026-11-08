// Stage-3 browser actor lifecycle: genuine asynchronous completion, not mailbox
// admission. This module runs in the browser compiler's module Web Worker and
// has no access to user JavaScript or source evaluation.
export const ACTOR_MAILBOX_CAPACITY = 32;
export const ACTOR_PROTOCOL_VERSION = 1;
export const ACTOR_ADMISSION = Object.freeze({
  OK: 0, CLOSED: 1, FULL: 2, INVALID: 3,
});

function actor_error(code) {
  return new Error(code);
}

export class ActorSession {
  constructor(worker, actor_id, wasm, { timeout_ms = 2000 } = {}) {
    if (!worker || !Number.isInteger(actor_id) || actor_id < 0 ||
        !Number.isInteger(timeout_ms) || timeout_ms < 1) {
      throw actor_error('E_ACTOR_SESSION_ARGS');
    }
    this.worker = worker;
    this.actor_id = actor_id;
    this.timeout_ms = timeout_ms;
    this.state = 'starting';
    this.closed = false;
    this.queue = [];
    this.processed = 0;
    this.next_seq = 1;
    this.pending = null;
    this.ready_timer = null;
    this.done_timer = null;
    this.drain_task = null;

    this.ready = new Promise((resolve, reject) => {
      this.resolve_ready = resolve;
      this.reject_ready = reject;
    });
    this.done = new Promise((resolve, reject) => {
      this.resolve_done = resolve;
      this.reject_done = reject;
    });
    // Register handlers now: admission-only programs may never request the task.
    // A failed actor must not create an unhandled rejection in that case.
    this.ready.catch(() => {});
    this.done.catch(() => {});

    worker.onmessage = ({ data }) => this.on_message(data);
    worker.onerror = () => this.fail('E_ACTOR_WORKER');
    worker.onmessageerror = () => this.fail('E_ACTOR_MESSAGE_CLONE');
    this.ready_timer = setTimeout(() => this.fail('E_ACTOR_READY_TIMEOUT'), timeout_ms);
    try {
      worker.postMessage({ kind: 'init', actorId: actor_id, version: ACTOR_PROTOCOL_VERSION, wasm });
    } catch {
      this.fail('E_ACTOR_INIT_CLONE');
    }
  }

  // Synchronous import: 0 = successfully admitted into the host-owned queue.
  // It deliberately provides no evidence of receive() or shutdown completion.
  admit(value) {
    if (this.closed || this.is_terminal()) return ACTOR_ADMISSION.CLOSED;
    if (typeof value !== 'bigint' || BigInt.asIntN(64, value) !== value) {
      return ACTOR_ADMISSION.INVALID;
    }
    if (this.queue.length === ACTOR_MAILBOX_CAPACITY) return ACTOR_ADMISSION.FULL;
    this.queue.push(value);
    return ACTOR_ADMISSION.OK;
  }

  get_done() {
    return this.done;
  }

  is_terminal() {
    return ['completed', 'failed', 'cancelled'].includes(this.state);
  }

  clear_pending() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  terminate() {
    try { this.worker.terminate(); } catch { /* worker may already be closed */ }
  }

  fail(code, cancelled = false) {
    if (this.is_terminal()) return;
    const error = actor_error(code);
    this.state = cancelled ? 'cancelled' : 'failed';
    this.closed = true;
    this.queue.length = 0;
    clearTimeout(this.ready_timer);
    clearTimeout(this.done_timer);
    this.reject_ready(error);
    if (this.pending) {
      const { reject } = this.pending;
      this.clear_pending();
      reject(error);
    }
    this.reject_done(error);
    this.terminate();
  }

  cancel() {
    this.fail('E_ACTOR_CANCELLED', true);
  }

  on_message(msg) {
    if (this.is_terminal()) return; // stale messages cannot resurrect the task
    if (!msg || typeof msg !== 'object') return this.fail('E_ACTOR_PROTOCOL');
    switch (msg.kind) {
      case 'ready':
        if (this.state !== 'starting' || msg.actorId !== this.actor_id ||
            msg.version !== ACTOR_PROTOCOL_VERSION) return this.fail('E_ACTOR_PROTOCOL');
        clearTimeout(this.ready_timer);
        this.state = 'ready';
        this.resolve_ready();
        return;
      case 'reply': {
        if (this.state !== 'draining' || !this.pending ||
            msg.actorId !== this.actor_id || msg.seq !== this.pending.seq ||
            typeof msg.value !== 'bigint' ||
            BigInt.asIntN(64, msg.value) !== msg.value) {
          return this.fail('E_ACTOR_REPLY_PROTOCOL');
        }
        const { resolve } = this.pending;
        this.clear_pending();
        this.processed++;
        resolve(msg.value);
        return;
      }
      case 'done':
        if (this.state !== 'closing' || this.pending ||
            msg.actorId !== this.actor_id || msg.version !== ACTOR_PROTOCOL_VERSION ||
            !Number.isSafeInteger(msg.processed) ||
            msg.processed !== this.processed || msg.lastSeq !== this.processed) {
          return this.fail('E_ACTOR_DONE_PROTOCOL');
        }
        clearTimeout(this.done_timer);
        this.state = 'completed';
        this.resolve_done({
          kind: 'completed', actor_id: this.actor_id, processed: this.processed,
        });
        this.terminate();
        return;
      case 'error':
        return this.fail(typeof msg.message === 'string' &&
          /^E_[A-Z0-9_]+$/.test(msg.message) ? msg.message : 'E_ACTOR_FAULT');
      default:
        return this.fail('E_ACTOR_PROTOCOL');
    }
  }

  send_to_worker(value) {
    return new Promise((resolve, reject) => {
      if (this.state !== 'draining' || this.pending) {
        reject(actor_error('E_ACTOR_SEND_STATE'));
        return;
      }
      if (!Number.isSafeInteger(this.next_seq)) {
        reject(actor_error('E_ACTOR_SEQUENCE_OVERFLOW'));
        this.fail('E_ACTOR_SEQUENCE_OVERFLOW');
        return;
      }
      const seq = this.next_seq++;
      const timer = setTimeout(() => this.fail('E_ACTOR_TIMEOUT'), this.timeout_ms);
      this.pending = { resolve, reject, timer, seq };
      try {
        this.worker.postMessage({ kind: 'message', actorId: this.actor_id, seq, value });
      } catch {
        this.fail('E_ACTOR_MESSAGE_CLONE');
      }
    });
  }

  // This is a structured-scope close: reject further admissions, deliver all
  // accepted messages, request explicit child shutdown, then await the child's
  // terminal ack. It is the *only* path that resolves get_done() successfully.
  drain_and_close(on_reply = () => {}) {
    if (this.drain_task) return this.drain_task;
    this.closed = true;
    this.drain_task = (async () => {
      await this.ready;
      // A cancellation can win after the ready ACK but before this
      // continuation resumes. Never resurrect an already terminal actor.
      if (this.is_terminal() || this.state !== 'ready') {
        throw actor_error('E_ACTOR_CANCELLED');
      }
      this.state = 'draining';
      try {
        for (const payload of this.queue) {
          const result = await this.send_to_worker(payload);
          on_reply(payload, result);
          // Reply callbacks can cancel the actor synchronously. A completed
          // reply is not permission to reopen a cancelled session.
          if (this.is_terminal() || this.state !== 'draining') {
            throw actor_error('E_ACTOR_CANCELLED');
          }
        }
        if (this.is_terminal() || this.state !== 'draining') {
          throw actor_error('E_ACTOR_CANCELLED');
        }
        this.queue.length = 0;
        this.state = 'closing';
        this.done_timer = setTimeout(
          () => this.fail('E_ACTOR_DONE_TIMEOUT'), this.timeout_ms);
        this.worker.postMessage({ kind: 'close', actorId: this.actor_id, seq: this.processed });
      } catch (error) {
        if (!this.is_terminal()) this.fail('E_ACTOR_DRAIN_FAULT');
        throw error;
      }
      return this.get_done();
    })();
    this.drain_task.catch(() => {});
    return this.drain_task;
  }
}

// Parent-owned structured actor scope: child admission is closed when
// draining starts, and sibling failures cancel all still-live children.
// Drains run concurrently so a stuck receive cannot starve other actors;
// results are returned in deterministic spawn order for ordered stdout.
export class ActorScope {
  constructor({max_actors=4}={}) {
    if(!Number.isInteger(max_actors)||max_actors<1||max_actors>4)
      throw actor_error('E_ACTOR_SCOPE_ARGS');
    this.max_actors=max_actors;
    this.actors=[];
    this.closed=false;
    this.cancelled=false;
    this.drain_task=null;
  }

  add(actor) {
    if(this.closed || this.cancelled) {
      actor.cancel();
      throw actor_error('E_ACTOR_SCOPE_CLOSED');
    }
    if(this.actors.length>=this.max_actors) {
      actor.cancel();
      throw actor_error('E_ACTOR_LIMIT_OR_ID');
    }
    this.actors.push(actor);
    return this.actors.length;
  }

  cancel_all() {
    this.cancelled=true;
    this.closed=true;
    for(const actor of this.actors)
      if(!actor.is_terminal()) actor.cancel();
  }

  drain_all() {
    if(this.drain_task)return this.drain_task;
    if(this.closed || this.cancelled)
      return Promise.reject(actor_error('E_ACTOR_SCOPE_CLOSED'));
    this.closed=true;
    const replies=this.actors.map(()=>[]);
    this.drain_task=(async()=>{
      try {
        const completed=await Promise.all(this.actors.map(async(actor,i)=>{
          try {
            const done=await actor.drain_and_close((message,reply)=>{
              if(this.cancelled)throw actor_error('E_ACTOR_CANCELLED');
              replies[i].push([message,reply]);
            });
            if(done.kind!=='completed'||done.actor_id!==actor.actor_id)
              throw actor_error('E_ACTOR_DONE_PROTOCOL');
            return done;
          } catch(error) {
            this.cancel_all();
            throw error;
          }
        }));
        if(this.cancelled)throw actor_error('E_ACTOR_CANCELLED');
        return {completed,replies};
      } catch(error) {
        this.cancel_all();
        throw error;
      }
    })();
    this.drain_task.catch(()=>{});
    return this.drain_task;
  }
}
