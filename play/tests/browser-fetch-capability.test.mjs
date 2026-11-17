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
