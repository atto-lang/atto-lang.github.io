// Stage-3 browser actor lifecycle: genuine asynchronous completion, not mailbox
// admission. This module runs in the browser compiler's module Web Worker and
// has no access to user JavaScript or source evaluation.
export const ACTOR_MAILBOX_CAPACITY = 32;
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
      worker.postMessage({ kind: 'init', actorId: actor_id, wasm });
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
        if (this.state !== 'starting') return this.fail('E_ACTOR_PROTOCOL');
        clearTimeout(this.ready_timer);
        this.state = 'ready';
        this.resolve_ready();
        return;
      case 'reply': {
        if (this.state !== 'draining' || !this.pending ||
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
            !Number.isSafeInteger(msg.processed) ||
            msg.processed !== this.processed) {
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
      const timer = setTimeout(() => this.fail('E_ACTOR_TIMEOUT'), this.timeout_ms);
      this.pending = { resolve, reject, timer };
      try {
        this.worker.postMessage({ kind: 'message', value });
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
      this.state = 'draining';
      try {
        for (const payload of this.queue) {
          const result = await this.send_to_worker(payload);
          on_reply(payload, result);
        }
        this.queue.length = 0;
        this.state = 'closing';
        this.done_timer = setTimeout(
          () => this.fail('E_ACTOR_DONE_TIMEOUT'), this.timeout_ms);
        this.worker.postMessage({ kind: 'close' });
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
