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
