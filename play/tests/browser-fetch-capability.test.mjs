import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFetchCapability } from '../src/browser-fetch-capability.js';
const makeResponse = (bytes = [1,2,3], headers = new Headers()) => ({ status: 200, type: 'basic', headers, body: new ReadableStream({ start(c) { c.enqueue(Uint8Array.from(bytes)); c.close(); } }) });
test('default denies all network requests without invoking fetch', async () => {
  let called = false;
  const cap = createBrowserFetchCapability({fetchImpl: async () => {called=true;}});
  await assert.rejects(cap.request(1, 'https://example.com/'), /E_NET_PERMISSION/);
  assert.equal(called,false);
});
test('allowed HTTPS request is credentialless and bounded', async () => {
  const cap = createBrowserFetchCapability({allowOrigins:['https://example.com'],fetchImpl:async (url, opts) => {
    assert.equal(url,'https://example.com/data'); assert.equal(opts.credentials,'omit'); assert.equal(opts.redirect,'error'); return makeResponse();
  }});
  const result = await cap.request(3,'https://example.com/data');
  assert.deepEqual([...result.body],[1,2,3]); assert.equal(cap.pending,0);
});
test('denies subdomains, embedded credentials, HTTP and redirects', async () => {
  const cap=createBrowserFetchCapability({allowOrigins:['https://example.com'],fetchImpl:async()=>makeResponse()});
  for(const url of ['https://sub.example.com','http://example.com','https://user:pass@example.com']) await assert.rejects(cap.request(1,url));
  assert.throws(()=>createBrowserFetchCapability({allowOrigins:['http://example.com']}));
});
test('enforces streamed size limit and releases request slot',async()=>{
  const cap=createBrowserFetchCapability({allowOrigins:['https://example.com'],maxBytes:2,fetchImpl:async()=>makeResponse([1,2,3])});
  await assert.rejects(cap.request(1,'https://example.com'),/E_NET_SIZE/);
  assert.equal(cap.pending,0);
});
test('close prevents subsequent requests',async()=>{
  const cap=createBrowserFetchCapability({allowOrigins:['https://example.com']}); cap.close();
  await assert.rejects(cap.request(1,'https://example.com'),/E_NET_CLOSED/);
});

test('rejects oversized Content-Length before reading', async () => {
  const cap = createBrowserFetchCapability({ allowOrigins: ['https://example.com'], maxBytes: 2, fetchImpl: async () => makeResponse([1], new Headers({'content-length':'3'})) });
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_SIZE/);
});
test('rejects redirected responses even if fetch adapter violates redirect:error', async () => {
  const cap = createBrowserFetchCapability({ allowOrigins: ['https://example.com'], fetchImpl: async () => ({ ...makeResponse(), redirected: true, url: 'https://example.com/other' }) });
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_REDIRECT/);
});
test('rejects completion after close even if transport ignores AbortSignal', async () => {
  let finish;
  const cap = createBrowserFetchCapability({ allowOrigins: ['https://example.com'], fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const request = cap.request(1, 'https://example.com');
  cap.close();
  finish(makeResponse());
  await assert.rejects(request, /E_NET_ABORTED/);
});
test('duplicate IDs and concurrency limits are enforced', async () => {
  let finish;
  const cap = createBrowserFetchCapability({ allowOrigins: ['https://example.com'], maxRequests: 1, fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const request = cap.request(1, 'https://example.com');
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_REQUEST_ID/);
  await assert.rejects(cap.request(2, 'https://example.com'), /E_NET_QUOTA/);
  finish(makeResponse());
  await request;
});

test('internal network adapter cannot enter the public playground release', async () => {
  const [{ ASSETS }, { FORBIDDEN }] = await Promise.all([
    import('../../.github/scripts/package-playground.mjs'),
    import('../../.github/scripts/audit-live-playground.mjs'),
  ]);
  assert.equal(ASSETS.includes('src/browser-fetch-capability.js'), false);
  assert.ok(FORBIDDEN.includes('/play/src/browser-fetch-capability.js'));
});


test('pre-aborted calls do not dispatch transport requests', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: () => { calls++; return makeResponse(); }
  });
  await assert.rejects(cap.request(1, 'https://example.com', { signal: controller.signal }), /E_NET_ABORTED/);
  assert.equal(calls, 0);
  assert.equal(cap.pending, 0);
});

test('cancel settles a transport that ignores AbortSignal and releases its slot', async () => {
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'], maxRequests: 1,
    fetchImpl: () => new Promise(() => {})
  });
  const request = cap.request(1, 'https://example.com');
  assert.equal(cap.cancel(1), true);
  await assert.rejects(request, /E_NET_ABORTED/);
  assert.equal(cap.pending, 0);
  assert.equal(cap.cancel(1), false);
  cap.close();
});

test('external abort settles a blocked stream read even with an uncooperative reader', async () => {
  const controller = new AbortController();
  const reader = {
    read: () => new Promise(() => {}),
    cancel: () => new Promise(() => {}),
    releaseLock: () => {}
  };
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: async () => ({ status: 200, type: 'basic', headers: new Headers(), body: { getReader: () => reader } })
  });
  const request = cap.request(1, 'https://example.com', { signal: controller.signal });
  // Allow the request to enter its first stream read.
  await Promise.resolve();
  controller.abort();
  await assert.rejects(request, /E_NET_ABORTED/);
  assert.equal(cap.pending, 0);
});

test('deadline settles an uncooperative transport without leaking request admission', async () => {
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'], timeoutMs: 15,
    fetchImpl: () => new Promise(() => {})
  });
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_TIMEOUT/);
  assert.equal(cap.pending, 0);
});

test('copies chunks before a transport can reuse the underlying byte buffer', async () => {
  const reused = new Uint8Array([1, 2]);
  let reads = 0;
  const reader = {
    read: async () => {
      if (reads++ === 0) return { done: false, value: reused };
      if (reads === 2) { reused.set([3, 4]); return { done: false, value: reused }; }
      return { done: true };
    },
    cancel: async () => {},
    releaseLock: () => {}
  };
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: async () => ({ status: 200, type: 'basic', headers: new Headers(), body: { getReader: () => reader } })
  });
  const result = await cap.request(1, 'https://example.com');
  assert.deepEqual([...result.body], [1, 2, 3, 4]);
});

test('rejects invalid adapter limits and non-HTTP response status', async () => {
  for (const timeoutMs of [0, -1, 1.1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createBrowserFetchCapability({ timeoutMs }), /Invalid request timeout/);
  }
  assert.throws(() => createBrowserFetchCapability({ fetchImpl: null }), /fetchImpl/);
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: async () => ({ ...makeResponse(), status: 0 })
  });
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_STATUS/);
  assert.equal(cap.pending, 0);
});

test('opaque and cross-origin substituted responses are rejected', async () => {
  const cap = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: async () => ({ ...makeResponse(), type: 'opaque' })
  });
  await assert.rejects(cap.request(1, 'https://example.com'), /E_NET_OPAQUE/);
  const wrongOrigin = createBrowserFetchCapability({
    allowOrigins: ['https://example.com'],
    fetchImpl: async () => ({ ...makeResponse(), url: 'https://other.example.org/data' })
  });
  await assert.rejects(wrongOrigin.request(1, 'https://example.com'), /E_NET_REDIRECT/);
});
