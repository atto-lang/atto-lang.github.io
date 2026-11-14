/** Persistent Node TenantVM (guest ABI v2).
 *
 * Each tenant owns one worker_threads V8 isolate and actor-private Wasm
 * instances. A worker thread is NOT an OS sandbox for hostile JavaScript.
 *
 * Session admission closes immediately on shutdown; reclamation happens only
 * when the Worker physically exits. The registry retains its capacity/tenant
 * ID until that retirement has been confirmed.
 */
import { Worker } from 'node:worker_threads';

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const MAX_ACTORS = 16;
const ID = /^[A-Za-z0-9_.-]{1,64}$/;

function terminationError(cause) {
  const error = new Error('E_TENANT_TERMINATION: Worker retirement unconfirmed');
  error.cause = cause;
  return error;
}

export function createTenantSession({ tenantId, timeoutMs = 3000, WorkerImpl = Worker }) {
  if (typeof tenantId !== 'string' || !ID.test(tenantId)) {
    throw new TypeError('TenantVM requires a bounded tenant ID');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('Invalid TenantVM deadline');
  }
  if (typeof WorkerImpl !== 'function') throw new TypeError('TenantVM Worker implementation required');
  // Only trusted host code may provide a WorkerImpl. Never accept guest JS.
  const worker = new WorkerImpl(new URL('./tenant-session-worker.mjs', import.meta.url), {
    name: `atto-tenant-${tenantId}`
  });
  let state = 'fresh', pending = null, sequence = 0, retirement = null;
  let exited = false, retired = false;
  const handles = new WeakMap();

  function shutdown(error = new Error('TenantVM session closed')) {
    if (retirement) return retirement;
    state = 'closed'; // Reject all further admissions immediately.
    const outstanding = pending;
    pending = null;
    if (outstanding) clearTimeout(outstanding.timer);

    let receipt;
    if (exited) {
      // An actual worker 'exit' event is a physical retirement receipt.
      receipt = Promise.resolve();
    } else {
      try {
        const promised = worker.terminate();
        if (!promised || typeof promised.then !== 'function') {
          throw new Error('missing awaitable termination receipt');
        }
        receipt = Promise.resolve(promised);
      } catch (cause) {
        receipt = Promise.reject(cause);
      }
    }
    retirement = receipt.then(
      () => { retired = true; },
      cause => { throw terminationError(cause); }
    );
    if (outstanding) {
      // No result/error is delivered as a reclaimed tenant until retirement.
      retirement.then(
        () => outstanding.reject(error),
        failure => outstanding.reject(failure)
      );
    }
    // Worker error/exit events can initiate shutdown without an explicit
    // caller awaiting it; attach a rejection observer without hiding failures
    // from close(), pending request callers, or registry close().
    void retirement.catch(() => {});
    return retirement;
  }

  worker.on('message', message => {
    if (state === 'closed') return; // Late output after cancellation.
    if (!pending || message?.id !== pending.id) {
      void shutdown(new Error('E_TENANT_PROTOCOL: unexpected response'));
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.resolve(message);
  });
  worker.on('error', error => { void shutdown(error); });
  worker.on('exit', code => {
    exited = true;
    if (state !== 'closed') {
      void shutdown(new Error(`TenantVM worker exited (code ${code})`));
    }
  });

  function request(op, payload) {
    if (state === 'closed') throw new Error('E_TENANT: session closed');
    if (pending) throw new Error('E_TENANT: concurrent RPC not supported');
    const id = ++sequence;
    if (!Number.isSafeInteger(id)) throw new Error('E_TENANT: request sequence exhausted');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => { void shutdown(new Error('TenantVM execution deadline exceeded')); },
        timeoutMs
      );
      pending = { id, resolve, reject, timer };
      try { worker.postMessage({ id, op, ...payload }); }
      catch (error) { void shutdown(error); }
    });
  }

  async function start(wasm) {
    if (state !== 'fresh') throw new Error('E_TENANT: program already started');
    if (!(wasm instanceof Uint8Array) || wasm.byteLength > (1 << 20)) {
      throw new TypeError('TenantVM requires validated guest Wasm (at most 1 MiB)');
    }
    // Copy first so a caller changing shared memory cannot race validation
    // against the bytes ultimately transferred into the tenant Worker.
    const snapshot = new Uint8Array(wasm);
    if (!WebAssembly.validate(snapshot)) {
      throw new TypeError('TenantVM requires validated guest Wasm (at most 1 MiB)');
    }
    state = 'starting';
    const result = await request('start', { wasm: snapshot });
    if (!result || typeof result.ok !== 'boolean' ||
        !Number.isSafeInteger(result.actors) || result.actors < 0 ||
        result.actors > MAX_ACTORS) {
      await shutdown(new Error('E_TENANT_PROTOCOL: invalid start response'));
      throw new Error('E_TENANT_PROTOCOL: invalid start response');
    }
    if (!result.ok) {
      await shutdown(new Error(result.message || 'E_TENANT: guest rejected'));
      return result;
    }
    state = 'running';
    const actorHandles = Array.from({ length: result.actors }, (_, ref) => {
      const handle = Object.freeze({ tenantId, actor: ref });
      handles.set(handle, ref);
      return handle;
    });
    return { ...result, actorHandles };
  }

  async function send(handle, value) {
    if (state !== 'running') throw new Error('E_TENANT: session not running');
    const ref = handle && typeof handle === 'object' ? handles.get(handle) : undefined;
    if (ref === undefined) throw new Error('E_TENANT: invalid or cross-tenant ActorRef');
    if (typeof value !== 'bigint' || value < I64_MIN || value > I64_MAX) {
      throw new TypeError('E_TENANT: message must be a signed i64 BigInt');
    }
    const result = await request('send', { ref, value });
    if (!result || typeof result.ok !== 'boolean') {
      await shutdown(new Error('E_TENANT_PROTOCOL: invalid send response'));
      throw new Error('E_TENANT_PROTOCOL: invalid send response');
    }
    // Compiler-recognized actor-local faults preserve the live tenant and
    // healthy siblings. Protocol/engine failures still physically retire it.
    if (!result.ok && result.actorFault !== true) {
      await shutdown(new Error(result.message || 'E_TENANT: guest rejected'));
    }
    return result;
  }

  return {
    tenantId, start, send,
    close: () => shutdown(),
    get closed() { return state === 'closed'; },
    get retired() { return retired; }
  };
}

/** Same-process registry: capacity is held through verified Worker retirement.
 * A multi-process deployment must enforce tenant ownership externally. */
export function createTenantRegistry({ maxTenants = 8, timeoutMs = 3000, WorkerImpl = Worker } = {}) {
  if (!Number.isSafeInteger(maxTenants) || maxTenants < 1 || maxTenants > 128) {
    throw new RangeError('TenantVM registry capacity must be 1..128');
  }
  const tenants = new Map();
  let closingAll = false;
  return {
    open(tenantId) {
      if (closingAll) throw new Error('E_TENANT: registry closing');
      if (tenants.has(tenantId)) throw new Error('E_TENANT: duplicate tenant ID');
      if (tenants.size >= maxTenants) throw new Error('E_TENANT_LIMIT: registry full');
      const session = createTenantSession({ tenantId, timeoutMs, WorkerImpl });
      tenants.set(tenantId, session);
      return session;
    },
    get(tenantId) { return tenants.get(tenantId); },
    async close(tenantId) {
      const session = tenants.get(tenantId);
      if (!session) return false;
      await session.close();
      // Only after physical termination, and only if not replaced meanwhile.
      if (tenants.get(tenantId) === session) tenants.delete(tenantId);
      return true;
    },
    async closeAll() {
      if (closingAll) throw new Error('E_TENANT: registry already closing');
      closingAll = true;
      // Forbid new tenants during the entire asynchronous termination
      // barrier. Otherwise an open() racing closeAll() could be silently
      // dropped by clear(), leaving a live untracked Worker.
      const list = Array.from(tenants.entries());
      try {
        // Promise.all() fails as soon as ONE termination rejects, which
        // would reopen registry admission while other workers are still live.
        // Wait for every physical termination receipt before leaving this
        // barrier; failed exits must keep their tenant IDs reserved.
        // Each tenant ID is released as soon as ITS worker exit is confirmed;
        // failed exits keep their IDs reserved.
        const results = await Promise.allSettled(list.map(async ([id, session]) => {
          await session.close();
          if (tenants.get(id) === session) tenants.delete(id);
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      } finally {
        closingAll = false;
      }
    },
    get size() { return tenants.size; }
  };
}
