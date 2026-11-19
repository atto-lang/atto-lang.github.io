/* Browser HTTP capability boundary. Not exposed to guest Wasm until the
 * compiler emits a reviewed asynchronous request/resume ABI.
 * Deny by default. No ambient credentials, redirects or opaque responses. */
export function createBrowserFetchCapability({
  allowOrigins = [],
  fetchImpl = globalThis.fetch,
  maxBytes = 1048576,
  maxRequests = 8,
  timeoutMs = 30000
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16777216) throw new RangeError('Invalid response limit');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 64) throw new RangeError('Invalid concurrency limit');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new RangeError('Invalid request timeout');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  // Reject inputs the WHATWG URL parser would silently trim or normalize.
  const isCleanUrl = value => typeof value === 'string' && value.length > 0 &&
    value.length <= 2048 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  if (!Array.isArray(allowOrigins)) throw new TypeError('allowOrigins must be an array');
  const origins = new Set(allowOrigins.map(value => {
    if (!isCleanUrl(value)) throw new TypeError('Invalid allowed origin');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Only HTTPS origins are allowed');
    return url.origin;
  }));
  const active = new Map();
  let closed = false;
  const abortError = () => new Error('E_NET_ABORTED: request cancelled');

  function validateUrl(raw) {
    if (!isCleanUrl(raw)) throw new TypeError('Invalid request URL');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.has(url.origin)) throw new Error('E_NET_PERMISSION: destination denied');
    return url.href;
  }

  async function request(id, rawUrl, { signal } = {}) {
    if (closed) throw new Error('E_NET_CLOSED: capability closed');
    if (!Number.isSafeInteger(id) || id < 0 || active.has(id)) throw new Error('E_NET_REQUEST_ID: invalid or duplicate ID');
    const url = validateUrl(rawUrl);
    if (active.size >= maxRequests) throw new Error('E_NET_QUOTA: concurrent request limit');
    if (signal != null && (typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')) throw new TypeError('Invalid abort signal');
    if (signal?.aborted) throw abortError();

    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(abortError());
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    // Also handle cancellation that races the listener installation.
    if (signal?.aborted) controller.abort(abortError());

    let rejectOnAbort;
    const aborted = new Promise((_, reject) => { rejectOnAbort = reject; });
    const onControllerAbort = () => rejectOnAbort(controller.signal.reason ?? abortError());
    controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    active.set(id, controller);
    const timer = setTimeout(() => {
      controller.abort(new Error('E_NET_TIMEOUT: request deadline exceeded'));
    }, timeoutMs);

    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      // A hostile transport may ignore AbortSignal completely. Race its
      // promise AND every stream read so cancellation frees admission slots.
      const response = await Promise.race([
        fetchImpl(url, {
          method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
          mode: 'cors', cache: 'no-store', signal: controller.signal
        }),
        aborted
      ]);
      if (controller.signal.aborted || closed) throw controller.signal.reason ?? abortError();
      if (response.url && new URL(response.url).origin !== new URL(url).origin) throw new Error('E_NET_REDIRECT: response origin changed');
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('E_NET_REDIRECT: redirected response rejected');
      if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.type === 'error') throw new Error('E_NET_OPAQUE: untrusted response rejected');
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw new Error('E_NET_STATUS: invalid response status');
      const length = response.headers?.get('content-length');
      if (length !== null && length !== undefined &&
          (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > maxBytes)) {
        throw new Error('E_NET_SIZE: response too large');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('E_NET_BODY: response body unavailable');

      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (controller.signal.aborted || closed) throw controller.signal.reason ?? abortError();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('E_NET_BODY: invalid chunk');
          size += value.byteLength;
          if (size > maxBytes) throw new Error('E_NET_SIZE: response too large');
          // A custom transport can recycle its buffers after read() resolves.
          chunks.push(new Uint8Array(value));
        }
      } finally {
        // A buggy reader.cancel() can itself never settle. Never await it:
        // cancellation and deadline still have to release the request slot.
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
        try { reader.releaseLock(); } catch {}
      }
      if (controller.signal.aborted || closed) throw controller.signal.reason ?? abortError();
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return { id, status: response.status, body };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onControllerAbort);
      signal?.removeEventListener('abort', onCallerAbort);
      active.delete(id);
    }
  }

  function cancel(id) {
    const controller = active.get(id);
    if (!controller) return false;
    controller.abort(abortError());
    return true;
  }
  function close() {
    closed = true;
    for (const controller of active.values()) controller.abort(abortError());
  }
  return { request, cancel, close, get pending() { return active.size; } };
}
