/** Durable Node TenantVM session (guest ABI v2).
 *
 * One worker_threads V8 isolate per tenant, one Wasm Instance per guest actor.
 * The host can send additional i64 mail after main() returns; private actor
 * state is retained until close() or a failed/expired RPC. The v2 guest cannot
 * yet spawn/send from within an actor or resume a suspended native Wasm stack.
 *
 * worker_threads is NOT an OS isolation boundary for untrusted JavaScript.
 */
import { Worker } from 'node:worker_threads';

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;
const ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function createTenantSession({ tenantId, timeoutMs = 3000, WorkerImpl = Worker }) {
  if (typeof tenantId !== 'string' || !ID.test(tenantId)) {
    throw new TypeError('TenantVM requires a bounded tenant ID');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('Invalid TenantVM deadline');
  }
  const worker = new WorkerImpl(new URL('./tenant-session-worker.mjs', import.meta.url), {
    name: `atto-tenant-${tenantId}`
  });
  let state = 'fresh', pending = null, sequence = 0, termination = null;
  const handles = new WeakMap();

  function shutdown(error = new Error('TenantVM session closed')) {
    if (state === 'closed') return termination;
    state = 'closed';
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      p.reject(error);
    }
    termination = Promise.resolve(worker.terminate()).catch(() => {});
    return termination;
  }

  worker.on('message', message => {
    if (!pending || message?.id !== pending.id) {
      shutdown(new Error('E_TENANT_PROTOCOL: unexpected response'));
      return;
    }
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p.resolve(message);
  });
  worker.on('error', error => { shutdown(error); });
  worker.on('exit', code => {
    if (state !== 'closed') shutdown(new Error(`TenantVM worker exited (code ${code})`));
  });

  function request(op, payload) {
    if (state === 'closed') throw new Error('E_TENANT: session closed');
    if (pending) throw new Error('E_TENANT: concurrent RPC not supported');
    const id = ++sequence;
    if (!Number.isSafeInteger(id)) throw new Error('E_TENANT: request sequence exhausted');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => shutdown(new Error('TenantVM execution deadline exceeded')), timeoutMs
      );
      pending = { id, resolve, reject, timer };
      try { worker.postMessage({ id, op, ...payload }); }
      catch (error) { shutdown(error); }
    });
  }

  async function start(wasm) {
    if (state !== 'fresh') throw new Error('E_TENANT: program already started');
    if (!(wasm instanceof Uint8Array) || wasm.byteLength > (1 << 20) || !WebAssembly.validate(wasm)) {
      throw new TypeError('TenantVM requires validated guest Wasm (at most 1 MiB)');
    }
    state = 'starting';
    const result = await request('start', { wasm: new Uint8Array(wasm) });
    if (!result.ok) { shutdown(new Error(result.message)); return result; }
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
    // Compiler-recognized actor-local faults preserve the live tenant and
    // healthy siblings. Protocol/engine failures still physically retire it.
    if (!result.ok && result.actorFault !== true) shutdown(new Error(result.message));
    return result;
  }

  return {
    tenantId,
    start,
    send,
    close: () => shutdown(),
    get closed() { return state === 'closed'; }
  };
}

/** The registry prevents duplicate sessions for a tenant within this host.
 * A production multi-process deployment must enforce ownership externally. */
export function createTenantRegistry({ maxTenants = 8, timeoutMs = 3000, WorkerImpl = Worker } = {}) {
  if (!Number.isSafeInteger(maxTenants) || maxTenants < 1 || maxTenants > 128) {
    throw new RangeError('TenantVM registry capacity must be 1..128');
  }
  const tenants = new Map();
  return {
    open(tenantId) {
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
      tenants.delete(tenantId);
      await session.close();
      return true;
    },
    async closeAll() {
      const list = Array.from(tenants.values());
      tenants.clear();
      await Promise.all(list.map(session => session.close()));
    },
    get size() { return tenants.size; }
  };
}
