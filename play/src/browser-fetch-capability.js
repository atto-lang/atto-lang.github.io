/* Browser HTTP capability boundary. Not exposed to guest Wasm until the
 * compiler emits a reviewed asynchronous request/resume ABI.
 * Deny by default. No ambient credentials, redirects or opaque responses. */
export function createBrowserFetchCapability({ allowOrigins = [], fetchImpl = globalThis.fetch, maxBytes = 1048576, maxRequests = 8 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16777216) throw new RangeError('Invalid response limit');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 64) throw new RangeError('Invalid concurrency limit');
  const origins = new Set(allowOrigins.map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Only HTTPS origins are allowed');
    return url.origin;
  }));
  const active = new Map();
  let closed = false;
  function validateUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 2048) throw new TypeError('Invalid request URL');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || !origins.has(url.origin)) throw new Error('E_NET_PERMISSION: destination denied');
    return url.href;
  }
  async function request(id, rawUrl, { signal } = {}) {
    if (closed) throw new Error('E_NET_CLOSED: capability closed');
    if (!Number.isSafeInteger(id) || id < 0 || active.has(id)) throw new Error('E_NET_REQUEST_ID: invalid or duplicate ID');
    const url = validateUrl(rawUrl);
    if (active.size >= maxRequests) throw new Error('E_NET_QUOTA: concurrent request limit');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    active.set(id, controller);
    try {
      const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error', mode: 'cors', cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted || closed) throw new Error('E_NET_ABORTED: request cancelled');
      if (response.url && new URL(response.url).origin !== new URL(url).origin) throw new Error('E_NET_REDIRECT: response origin changed');
      if (response.redirected) throw new Error('E_NET_REDIRECT: redirected response rejected');
      if (response.type === 'opaque' || response.type === 'opaqueredirect') throw new Error('E_NET_OPAQUE: opaque response rejected');
      const length = response.headers?.get('content-length');
      if (length !== null && length !== undefined && (/^\d+$/.test(length) === false || Number(length) > maxBytes)) throw new Error('E_NET_SIZE: response too large');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('E_NET_BODY: response body unavailable');
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted || closed) throw new Error('E_NET_ABORTED: request cancelled');
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('E_NET_BODY: invalid chunk');
          size += value.byteLength;
          if (size > maxBytes) throw new Error('E_NET_SIZE: response too large');
          chunks.push(value);
        }
      } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      if (controller.signal.aborted || closed) throw new Error('E_NET_ABORTED: request cancelled');
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return { id, status: response.status, body };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      active.delete(id);
    }
  }
  function cancel(id) { const controller = active.get(id); if (!controller) return false; controller.abort(); return true; }
  function close() { closed = true; for (const controller of active.values()) controller.abort(); }
  return { request, cancel, close, get pending() { return active.size; } };
}
