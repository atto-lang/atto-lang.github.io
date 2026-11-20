// Bounded and secured Worker-local state lease admission for Atto guest ABI v1.
// Hardened from the atto-source.rs host model: guest pointers must refer to
// private exported guest Wasm memory and signed-i64 tickets use secure entropy.
// No cross-Worker shared state or suspension-based contention is implemented.
// Private host-side state admission for compiled, Worker-local Atto guests.
// This module deliberately does not park a JS thread or advertise shared
// memory/cohort scheduling: synchronous Wasm imports must grant immediately
// or fail closed. Multi-Worker queued continuations are a separate ABI.
//
// Opaque lease tickets are securely minted by the trusted host and returned
// to the guest for release. Guests may supply untrusted ticket values to
// state_leave; these must never be predictable from counters or instance ids.
// Only compiler-emitted code may call state_* imports. An arbitrary malicious
// Wasm module is NOT authenticated by this host API alone.

let nextRuntimeId = 0;
const MAX_RUNTIME_ID = 0x7fffffff;
const MAX_TICKET_ID = 0xffffffff;
const MAX_ISSUED_TICKETS = 65536; // finite replay ledger per disposable guest

function fail(message) { throw new Error('E_STATE_RUNTIME: ' + message); }

/** Creates one host scheduler authority for a single Wasm guest instance. */
export function createStateRuntime({
  maxContainers = 1024, maxTickets = 1024,
  maxTicketIssuance = MAX_ISSUED_TICKETS, onEvent = null,
  // Strict by default. Host-only model tests must explicitly opt out.
  requireBoundMemory = true,
} = {}) {
  if (typeof requireBoundMemory !== 'boolean') fail('invalid memory binding policy');
  if (!Number.isSafeInteger(maxContainers) || maxContainers < 1 ||
      !Number.isSafeInteger(maxTickets) || maxTickets < 1 ||
      !Number.isSafeInteger(maxTicketIssuance) || maxTicketIssuance < 1 ||
      maxTicketIssuance > MAX_ISSUED_TICKETS ||
      maxTickets > maxTicketIssuance) {
    fail('invalid admission capacities');
  }
  if (nextRuntimeId >= MAX_RUNTIME_ID) fail('runtime identity exhausted');
  const actorIncarnation = ++nextRuntimeId;
  let nextContainerId = 0;
  let nextTicketId = 0;
  let retired = false;
  let boundMemory = null;
  const containers = new Map(); // private pointer -> host-owned generation
  const active = new Map(); // opaque signed i64 ticket -> host-authenticated claim
  const issued = new Set(); // deny reuse even after a ticket has been released
  const emit = event => { if (onEvent) onEvent(event); };
  if (onEvent !== null && typeof onEvent !== 'function') fail('invalid event observer');

  function mintTicket() {
    if (nextTicketId >= maxTicketIssuance) fail('total ticket issuance capacity');
    const secureRandom = globalThis.crypto?.getRandomValues;
    if (typeof secureRandom !== 'function') fail('secure randomness unavailable');
    // JS BigInt must be signed because imported WebAssembly i64 values round
    // trip as signed BigInts; both high and low words are unpredictable.
    const words = new Uint32Array(2);
    for (let attempt = 0; attempt < 16; attempt++) {
      globalThis.crypto.getRandomValues(words);
      const ticket = BigInt.asIntN(64, (BigInt(words[0]) << 32n) | BigInt(words[1]));
      if (ticket === 0n || issued.has(ticket)) continue;
      issued.add(ticket);
      nextTicketId++;
      return ticket;
    }
    fail('unique secure ticket generation unavailable');
  }
  const isPtr = ptr => Number.isSafeInteger(ptr) && ptr >= 0 && ptr % 8 === 0;

  // The worker binds only after guest instantiation. The Wasm admission gate
  // rejects start functions, so no guest code may register before this point.
  function bind(instance) {
    // Host-only model tests do not instantiate guest linear memory. The
    // production Worker always opts into the required binding policy.
    if (!requireBoundMemory) return;
    if (retired || boundMemory) fail('state guest memory already bound or retired');
    if (!(instance instanceof WebAssembly.Instance)) fail('verified guest instance required');
    const memory = instance.exports.memory;
    if (!(memory instanceof WebAssembly.Memory) ||
        !(memory.buffer instanceof ArrayBuffer) ||
        memory.buffer.byteLength < 8 ||
        memory.buffer.byteLength > (1 << 20)) {
      fail('bounded private state guest memory export required');
    }
    boundMemory = memory;
  }

  function requirePointer(ptr) {
    if (!isPtr(ptr)) fail('unaligned or invalid state pointer');
    if (requireBoundMemory) {
      if (!boundMemory) fail('guest memory not yet bound');
      const size = boundMemory.buffer.byteLength;
      if (size > (1 << 20) || ptr > size - 8) {
        fail('state pointer outside bounded guest memory');
      }
    }
  }

  function register(ptr) {
    if (retired) fail('register after retirement');
    requirePointer(ptr);
    if (containers.has(ptr)) fail('state pointer reused without retirement');
    if (containers.size >= maxContainers) fail('state container admission capacity');
    if (nextContainerId >= MAX_TICKET_ID) fail('container generation exhausted');
    const meta = {
      ptr, containerId: ++nextContainerId,
      actorIncarnation, generation: 1, retired: false,
    };
    containers.set(ptr, meta);
    emit({kind:'register', containerId:meta.containerId, actorIncarnation});
  }

  function enter(ptr, mode) {
    if (retired) fail('guest execution retired');
    requirePointer(ptr);
    if (!containers.has(ptr)) fail('unknown state container');
    if (mode !== 0 && mode !== 1) fail('invalid lease mode');
    const meta = containers.get(ptr);
    if (meta.retired) fail('state container is retired');
    if (active.size >= maxTickets) fail('state admission capacity');
    // Single synchronous Wasm turn: never attempt to wait on contention.
    for (const claim of active.values()) {
      if (claim.containerId === meta.containerId && (mode === 1 || claim.mode === 1)) {
        fail('synchronous state admission contention; suspension not implemented');
      }
    }
    // Never expose a predictable lease identifier. A malicious guest may
    // guess i64 values, but cannot compute another live ticket from one it
    // has observed. Replays cannot become valid after a later admission.
    const ticket = mintTicket();
    active.set(ticket, {
      containerId:meta.containerId, actorIncarnation,
      generation:meta.generation, mode,
    });
    emit({kind:'enter', containerId:meta.containerId, mode});
    return ticket;
  }

  function leave(ticket) {
    if (typeof ticket !== 'bigint') fail('invalid ticket type');
    const claim = active.get(ticket);
    if (!claim) fail('missing or replayed admission ticket');
    const meta = [...containers.values()].find(m => m.containerId === claim.containerId);
    if (!meta || meta.generation !== claim.generation ||
        meta.actorIncarnation !== claim.actorIncarnation) {
      fail('stale state generation');
    }
    active.delete(ticket);
    emit({kind:'leave',containerId:claim.containerId,mode:claim.mode});
  }

  function beginRetire(ptr) {
    requirePointer(ptr);
    if (!containers.has(ptr)) fail('unknown state container');
    const meta = containers.get(ptr);
    meta.retired = true;
    emit({kind:'retire',containerId:meta.containerId});
  }

  function quiescent(ptr) {
    requirePointer(ptr);
    if (!containers.has(ptr)) fail('unknown state container');
    const meta = containers.get(ptr);
    return meta.retired && ![...active.values()].some(c => c.containerId === meta.containerId);
  }

  /** Successful physical completion cannot silently abandon a live ticket. */
  function complete() {
    if (active.size) fail('guest returned with unreleased state tickets');
    retired = true;
    for (const meta of containers.values()) meta.retired = true;
    issued.clear(); // the guest is permanently retired
    emit({kind:'complete'});
  }

  /** Only invoke AFTER a synchronous guest turn has physically unwound. */
  function abort() {
    retired = true;
    active.clear();
    issued.clear();
    for (const meta of containers.values()) meta.retired = true;
    emit({kind:'abort'});
  }

  function snapshot() {
    return Object.freeze({
      actorIncarnation, containers: containers.size, active:active.size,
      retired, quiescent:retired && active.size === 0,
    });
  }

  return Object.freeze({
    bind,
    imports: Object.freeze({
      state_register: register,
      state_enter: enter,
      state_leave: leave,
    }),
    beginRetire, quiescent, complete, abort, snapshot,
  });
}
