/** Mailboxes and Mailmen for the browser OresVM.
 *
 * A Mailman is the *micro loop* that drains one owner's mailbox: every actor
 * has one, and so does every supervisor. One Mailman turn takes CONTROL mail
 * first (stop, child-failure notices, supervision commands), then at most
 * `batch` ordinary messages, then returns the carrier to the OresVM *macro
 * loop* (OresScheduler), which interleaves Mailman turns with task turns and
 * reactor completions. A Mailman never blocks: a handler that needs to wait
 * must suspend through the task ABI instead of parking the carrier.
 *
 * Delivery is FIFO per (sender lane, mailbox) with a contiguous per-mailbox
 * sequence. Admission is bounded; a full mailbox rejects at send time instead
 * of growing without bound. A handler fault is terminal for its owner: queued
 * user mail is retired and a notice is posted to the supervisor's CONTROL
 * lane, which that supervisor's own Mailman handles on a later turn.
 */

export const MAILBOX_CAPACITY = 10_000;
export const CONTROL_CAPACITY = 256;
export const MAILMAN_BATCH = 32;
export const MAX_MAILMEN = 256;

export class Mailbox {
  constructor({ capacity = MAILBOX_CAPACITY, controlCapacity = CONTROL_CAPACITY } = {}) {
    this.capacity = capacity;
    this.controlCapacity = controlCapacity;
    this.user = [];
    this.userHead = 0;
    this.control = [];
    this.controlHead = 0;
    this.sequence = 0;
    this.closed = false;
  }

  get pendingUser() { return this.user.length - this.userHead; }
  get pendingControl() { return this.control.length - this.controlHead; }
  get pending() { return this.pendingUser + this.pendingControl; }

  post(message, { control = false } = {}) {
    if (this.closed) throw new Error('E_MAILBOX_CLOSED: mailbox no longer admits mail');
    if (control) {
      if (this.pendingControl >= this.controlCapacity) throw new Error('E_MAILBOX_FULL: control lane full');
      this.control.push({ sequence: this.sequence++, message, control: true });
    } else {
      if (this.pendingUser >= this.capacity) throw new Error(`E_MAILBOX_FULL: mailbox already has ${this.capacity} messages`);
      this.user.push({ sequence: this.sequence++, message, control: false });
    }
    if (!Number.isSafeInteger(this.sequence)) throw new Error('E_MAILBOX: sequence exhausted');
  }

  take() {
    if (this.pendingControl) return compactTake(this, 'control', 'controlHead');
    if (this.pendingUser) return compactTake(this, 'user', 'userHead');
    return null;
  }

  /** Retire undeliverable user mail; CONTROL mail is still handled. */
  retireUser() {
    const dropped = this.pendingUser;
    this.user.length = 0;
    this.userHead = 0;
    return dropped;
  }

  close() {
    this.closed = true;
    this.retireUser();
    this.control.length = 0;
    this.controlHead = 0;
  }
}

function compactTake(box, lane, head) {
  const item = box[lane][box[head]];
  box[lane][box[head]] = undefined;
  box[head]++;
  if (box[head] >= 512 && box[head] * 2 >= box[lane].length) {
    box[lane].splice(0, box[head]);
    box[head] = 0;
  }
  return item;
}

/**
 * One owner's micro loop. handler(message, envelope) handles user mail;
 * onControl(message, envelope) handles control mail (default: stop on
 * {type:'stop'}, ignore others). Both are synchronous carrier turns.
 */
export class Mailman {
  constructor(office, { id, name, kind = 'actor', supervisor = null, handler, onControl = null, batch = MAILMAN_BATCH, mailbox }) {
    this.office = office;
    this.id = id;
    this.name = name ?? `${kind}#${id}`;
    this.kind = kind;
    this.supervisor = supervisor;
    this.handler = handler;
    this.onControl = onControl;
    this.batch = batch;
    this.mailbox = mailbox ?? new Mailbox();
    this.state = 'running'; // running | stopped | failed
    this.handled = 0;
    this.fault = null;
  }

  get hasWork() {
    if (this.state === 'running') return this.mailbox.pending > 0;
    return this.mailbox.pendingControl > 0 && this.kind === 'supervisor';
  }

  /** One micro-loop turn: control first, then up to `batch` user messages. */
  turn() {
    let budget = this.batch;
    while (budget-- > 0) {
      const envelope = this.mailbox.take();
      if (!envelope) return;
      try {
        if (envelope.control) this.handleControl(envelope);
        else if (this.state === 'running') { this.handler(envelope.message, envelope); this.handled++; }
      } catch (error) {
        this.fail(error);
        return;
      }
      if (this.state !== 'running' && this.mailbox.pendingControl === 0) return;
    }
  }

  handleControl(envelope) {
    const message = envelope.message;
    if (this.onControl) { this.onControl(message, envelope); return; }
    if (message?.type === 'stop') this.stop();
  }

  stop() {
    if (this.state !== 'running') return;
    this.state = 'stopped';
    this.mailbox.retireUser();
    this.office.notify(this, { type: 'stopped', child: this.id, name: this.name });
  }

  fail(error) {
    this.state = 'failed';
    this.fault = /^E_[A-Z_]+: /.test(error?.message ?? '') ? error.message : `E_RUNTIME: ${error?.message ?? error}`;
    const retired = this.mailbox.retireUser();
    this.office.notify(this, { type: 'failed', child: this.id, name: this.name, fault: this.fault, retired });
  }
}

/** The tenant's post office: owns every Mailman and is one OresVM lane. */
export function createPostOffice({ maxMailmen = MAX_MAILMEN, onUnsupervisedFault = null } = {}) {
  const mailmen = [];
  let cursor = 0;
  let closed = false;
  const faults = [];

  function enroll(options) {
    if (closed) throw new Error('E_MAILMAN: post office closed');
    if (mailmen.length >= maxMailmen) throw new Error(`E_MAILMAN_LIMIT: at most ${maxMailmen} mailmen per tenant`);
    if (options.supervisor !== null && options.supervisor !== undefined && !mailmen[options.supervisor]) {
      throw new Error('E_MAILMAN: unknown supervisor');
    }
    const mailman = new Mailman(office, { ...options, id: mailmen.length });
    mailmen.push(mailman);
    return mailman;
  }

  function lookup(id) {
    const mailman = Number.isInteger(id) ? mailmen[id] : undefined;
    if (!mailman) throw new Error('E_MAILMAN: invalid mailbox reference');
    return mailman;
  }

  function send(id, message) {
    const mailman = lookup(id);
    if (mailman.state !== 'running') throw new Error(`E_ACTOR_DEAD: ${mailman.name} is ${mailman.state}`);
    mailman.mailbox.post(message);
  }

  function control(id, message) {
    lookup(id).mailbox.post(message, { control: true });
  }

  /** Route a lifecycle notice to the owner's supervisor CONTROL lane. */
  function notify(mailman, notice) {
    if (mailman.supervisor !== null && mailman.supervisor !== undefined) {
      const sup = mailmen[mailman.supervisor];
      if (sup && sup.state !== 'failed') { sup.mailbox.post(notice, { control: true }); return; }
    }
    if (notice.type === 'failed') {
      faults.push(`${notice.fault} in ${mailman.name}`);
      onUnsupervisedFault?.(notice, mailman);
    }
  }

  /** Macro-loop lane: one Mailman micro-loop turn, round robin. */
  function turn() {
    for (let i = 0; i < mailmen.length; i++) {
      const mailman = mailmen[(cursor + i) % mailmen.length];
      if (mailman.hasWork) {
        cursor = (cursor + i + 1) % mailmen.length;
        mailman.turn();
        return true;
      }
    }
    return false;
  }

  function close() {
    closed = true;
    for (const mailman of mailmen) mailman.mailbox.close();
  }

  const office = {
    enroll, send, control, notify, turn, close, lookup,
    hasWork: () => mailmen.some(m => m.hasWork),
    get faults() { return faults.slice(); },
    get size() { return mailmen.length; },
  };
  return office;
}
