// Isolated Worker-local state admission, adapted verbatim from
// atto-source.rs tests/browser/state-runtime.mjs (source commit a6e0d088).
// Imported only for a verified guest import ABI; no cross-Worker shared state.
// Private host-side state admission for compiled, Worker-local Atto guests.
// This module deliberately does not park a JS thread or advertise shared
// memory/cohort scheduling: synchronous Wasm imports must grant immediately
// or fail closed. Multi-Worker queued continuations are a separate ABI.
//
// Tickets, container generations and logical actor/continuation identity are
// minted here by the trusted host, never received from guest source.
// Only compiler-emitted code may call state_* imports. An arbitrary malicious
// Wasm module is NOT authenticated by this host API alone.

let nextRuntimeId = 0;
const MAX_RUNTIME_ID = 0x7fffffff;
const MAX_TICKET_ID = 0xffffffff;

function fail(message) { throw new Error('E_STATE_RUNTIME: ' + message); }

/** Creates one host scheduler authority for a single Wasm guest instance. */
export function createStateRuntime({
  maxContainers = 1024, maxTickets = 1024, onEvent = null,
  // Required by the browser Worker; disabled only for host-only model tests.
  requireBoundMemory = false,
} = {}) {
  if (typeof requireBoundMemory !== 'boolean') fail('invalid memory binding policy');
  if (!Number.isSafeInteger(maxContainers) || maxContainers < 1 ||
      !Number.isSafeInteger(maxTickets) || maxTickets < 1) {
    fail('invalid admission capacities');
  }
  if (nextRuntimeId >= MAX_RUNTIME_ID) fail('runtime identity exhausted');
  const actorIncarnation = ++nextRuntimeId;
  let nextContainerId = 0;
  let nextTicketId = 0;
  let retired = false;
  let boundMemory = null;
  const containers = new Map(); // private pointer -> host-owned generation
  const active = new Map(); // opaque i64 ticket -> host-authenticated authority
  const emit = event => { if (onEvent) onEvent(event); };
  const isPtr = ptr => Number.isSafeInteger(ptr) && ptr >= 0 && ptr % 8 === 0;

  // The worker binds only after guest instantiation. The Wasm admission gate
  // rejects start functions, so no guest code may register before this point.
  function bind(instance) {
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
    requirePointer(ptr);
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
    if (!isPtr(ptr)) fail('unaligned or invalid state pointer');
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
    if (nextTicketId >= MAX_TICKET_ID) fail('ticket sequence exhausted');
    // i64 capability encoding; distinct host instances cannot share tickets.
    const ticket = (BigInt(actorIncarnation) << 32n) | BigInt(++nextTicketId);
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
    if ((ticket >> 32n) !== BigInt(actorIncarnation)) fail('foreign actor incarnation');
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
    emit({kind:'complete'});
  }

  /** Only invoke AFTER a synchronous guest turn has physically unwound. */
  function abort() {
    retired = true;
    active.clear();
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
