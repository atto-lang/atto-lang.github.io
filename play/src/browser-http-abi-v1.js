/**
 * EXPERIMENTAL / NON-SHIPPED atto.browser.http.v1 request/resume host.
 *
 * Not wired into runner-worker.js. A reviewed compiler-issued artifact,
 * strict import-signature validation, and explicit actor connect permissions
 * are prerequisites for enabling this in a production guest.
 */
import { createBrowserFetchCapability } from './browser-fetch-capability.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
export const HTTP_V1 = Object.freeze({
  ACCEPTED: 1,
  BAD_REQUEST: 2,
  CLOSED: 3,
  BUSY: 4,
  OK: 0,
  ERROR: 1,
  ERR_PERMISSION: 1,
  ERR_ABORTED: 2,
  ERR_TIMEOUT: 3,
  ERR_QUOTA: 4,
  ERR_SIZE: 5,
  ERR_REDIRECT: 6,
  ERR_OPAQUE: 7,
  ERR_BODY: 8,
  ERR_CLOSED: 9,
  ERR_TRANSPORT: 255
});

function assertVersion(module) {
  if (!(module instanceof WebAssembly.Module)) throw new TypeError('E_HTTP_ABI: WebAssembly.Module required');
  const markers = WebAssembly.Module.customSections(module, 'atto.http.v1');
  if (markers.length !== 1 || markers[0].byteLength !== 1 ||
      new Uint8Array(markers[0])[0] !== 1) {
    throw new Error('E_HTTP_ABI: missing or unsupported atto.http.v1 marker');
  }
  const imports = WebAssembly.Module.imports(module);
  const required = new Set(['request', 'cancel']);
  if (imports.length !== 2 || imports.some(entry =>
    entry.module !== 'atto_http_v1' || entry.kind !== 'function' || !required.delete(entry.name)) ||
    required.size !== 0) {
    throw new Error('E_HTTP_ABI: unexpected guest imports');
  }
  const exports = WebAssembly.Module.exports(module);
  for (const [name, kind] of [
    ['memory', 'memory'], ['atto_http_v1_reserve', 'function'],
    ['atto_http_v1_resume', 'function']
  ]) {
    if (!exports.some(entry => entry.name === name && entry.kind === kind)) {
      throw new Error('E_HTTP_ABI: missing guest export ' + name);
    }
  }
  // This marker is *not* authentication. A production runner must also
  // validate the raw type/import section and compiler artifact identity.
}

function errorCode(error) {
  const s = String(error?.message ?? '');
  for (const [prefix, code] of [
    ['E_NET_PERMISSION:', HTTP_V1.ERR_PERMISSION],
    ['E_NET_ABORTED:', HTTP_V1.ERR_ABORTED],
    ['E_NET_TIMEOUT:', HTTP_V1.ERR_TIMEOUT],
    ['E_NET_QUOTA:', HTTP_V1.ERR_QUOTA],
    ['E_NET_SIZE:', HTTP_V1.ERR_SIZE],
    ['E_NET_REDIRECT:', HTTP_V1.ERR_REDIRECT],
    ['E_NET_OPAQUE:', HTTP_V1.ERR_OPAQUE],
    ['E_NET_BODY:', HTTP_V1.ERR_BODY],
    ['E_NET_CLOSED:', HTTP_V1.ERR_CLOSED],
  ]) {
    if (s.startsWith(prefix)) return code;
  }
  return HTTP_V1.ERR_TRANSPORT;
}

export function createBrowserHttpAbiV1({
  module,
  allowOrigins = [],
  fetchImpl = globalThis.fetch,
  maxBytes = 1048576,
  maxRequests = 8,
  timeoutMs = 30000
} = {}) {
  assertVersion(module);
  const capability = createBrowserFetchCapability({
    allowOrigins, fetchImpl, maxBytes, maxRequests, timeoutMs
  });
  let instance = null, closed = false, fault = null;
  const active = new Map();

  function memoryBytes() {
    if (!instance) throw new Error('E_HTTP_ABI: guest not bound');
    const buffer = instance.exports.memory?.buffer;
    if (!(buffer instanceof ArrayBuffer)) throw new Error('E_HTTP_ABI: unshared guest memory required');
    return new Uint8Array(buffer);
  }
  const validRange = (bytes, ptr, len) =>
    Number.isInteger(ptr) && Number.isInteger(len) && ptr >= 0 && len >= 0 &&
    ptr <= bytes.length && len <= bytes.length - ptr;

  function deliver(id, result, error) {
    if (closed) return;
    // Retire the request *before* invoking the guest continuation; the guest
    // can synchronously admit its next operation during resume.
    active.delete(id);
    let tag = HTTP_V1.OK, code, ptr = 0, len = 0;
    if (error) {
      tag = HTTP_V1.ERROR;
      code = errorCode(error);
    } else {
      code = result.status;
      len = result.body.byteLength;
      if (len > 0) {
        ptr = instance.exports.atto_http_v1_reserve(len);
        const memory = memoryBytes(); // reserve may have grown memory
        if (!validRange(memory, ptr, len)) throw new Error('E_HTTP_ABI: guest reserve returned out-of-bounds memory');
        memory.set(result.body, ptr);
      }
    }
    instance.exports.atto_http_v1_resume(id, tag, code, ptr, len);
  }

  const imports = Object.freeze({
    atto_http_v1: Object.freeze({
      request(id, ptr, len) {
        if (closed || !instance) return HTTP_V1.CLOSED;
        if (!Number.isSafeInteger(id) || id < 1 || active.has(id) ||
            !Number.isSafeInteger(len) || len < 1 || len > 2048) return HTTP_V1.BAD_REQUEST;
        if (active.size >= maxRequests) return HTTP_V1.BUSY;
        let url;
        try {
          const memory = memoryBytes();
          if (!validRange(memory, ptr, len)) return HTTP_V1.BAD_REQUEST;
          // Snapshot bytes before the asynchronous boundary. Reject malformed
          // UTF-8, NUL and forbidden control characters.
          url = decoder.decode(memory.slice(ptr, ptr + len));
          if (/[\u0000-\u001f\u007f]/.test(url)) return HTTP_V1.BAD_REQUEST;
        } catch {
          return HTTP_V1.BAD_REQUEST;
        }
        let transport;
        try { transport = capability.request(id, url); }
        catch (error) { transport = Promise.reject(error); }
        const entry = { settled: null };
        active.set(id, entry);
        entry.settled = Promise.resolve(transport).then(
          response => deliver(id, response, null),
          error => deliver(id, null, error)
        ).catch(error => {
          fault = error;
          close();
        }).finally(() => {
          if (active.get(id) === entry) active.delete(id);
        });
        return HTTP_V1.ACCEPTED;
      },
      cancel(id) {
        if (closed || !active.has(id)) return 0;
        return capability.cancel(id) ? 1 : 0;
      }
    })
  });

  function bind(value) {
    if (closed || instance) throw new Error('E_HTTP_ABI: guest already bound or closed');
    if (!(value instanceof WebAssembly.Instance)) throw new TypeError('E_HTTP_ABI: WebAssembly.Instance required');
    if (!(value.exports.memory instanceof WebAssembly.Memory) ||
        typeof value.exports.atto_http_v1_reserve !== 'function' ||
        typeof value.exports.atto_http_v1_resume !== 'function') {
      throw new Error('E_HTTP_ABI: missing guest memory/continuation');
    }
    instance = value;
  }

  function close() {
    if (closed) return;
    closed = true;
    capability.close();
    active.clear(); // no callbacks after revocation or actor teardown
  }

  async function drain() {
    while (active.size && !fault) {
      const jobs = [...active.values()].map(entry => entry.settled);
      await Promise.all(jobs);
    }
    if (fault) throw new Error('E_HTTP_ABI: guest continuation failed', { cause: fault });
  }

  return Object.freeze({
    imports, bind, drain, close,
    get pending() { return active.size; },
    get closed() { return closed; }
  });
}
