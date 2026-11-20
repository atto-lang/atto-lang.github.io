import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserHttpAbiV1, HTTP_V1 } from '../src/browser-http-abi-v1.js';
import { validateGuestImportABI } from '../src/guest-import-abi.js';
import { ASSETS } from '../../.github/scripts/package-playground.mjs';
import { FORBIDDEN } from '../../.github/scripts/audit-live-playground.mjs';

// A REAL binary Wasm guest, hand-assembled for ABI conformance only.
// This is NOT an Atto-compiled program or evidence of async compiler lowering.
const MAGIC = [0, 97, 115, 109, 1, 0, 0, 0];
const leb = n => {
  const out = [];
  do { let b = n & 127; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n);
  return out;
};
const name = s => { const data = [...new TextEncoder().encode(s)]; return [...leb(data.length), ...data]; };
const section = (id, body) => [id, ...leb(body.length), ...body];
const fn = (params, results) => [0x60, ...leb(params.length), ...params, ...leb(results.length), ...results];
const fbody = code => [...leb(code.length), ...code];
const reqUrl = new TextEncoder().encode('https://example.com/data');
const response = (body = [10, 20, 30], props = {}) => ({
  status: 200, redirected: false, type: 'basic', headers: new Headers(),
  body: new ReadableStream({
    start(c) { c.enqueue(Uint8Array.from(body)); c.close(); }
  }),
  ...props
});

function guestBytes({ marker = true } = {}) {
  const I32 = 0x7f, I64 = 0x7e;
  const types = section(1, [4,
    ...fn([I32,I32,I32],[I32]), ...fn([I32],[I32]),
    ...fn([I32,I32,I32,I32,I32],[]), ...fn([],[I64])
  ]);
  const imports = section(2, [2,
    ...name('atto_http_v1'), ...name('request'), 0, 0,
    ...name('atto_http_v1'), ...name('cancel'), 0, 1
  ]);
  const funcs = section(3, [3, 1, 2, 3]);
  const memory = section(5, [1, 1, 1, 1]); // one fixed-size 64-KiB page
  const globals = section(6, [2,
    I32, 1, 0x41, 0, 0x0b,
    I32, 1, 0x41, 0, 0x0b
  ]);
  const exports = section(7, [6,
    ...name('memory'), 2, 0,
    ...name('atto_http_v1_reserve'), 0, 2,
    ...name('atto_http_v1_resume'), 0, 3,
    ...name('main'), 0, 4,
    ...name('last_tag'), 3, 0,
    ...name('last_code'), 3, 1
  ]);
  const reserve = fbody([0, 0x41, 0x80, 0x08, 0x0b]); // return guest-owned offset 1024
  const resume = fbody([0, 0x20, 1, 0x24, 0, 0x20, 2, 0x24, 1, 0x0b]);
  const main = fbody([0,
    0x41, 7, 0x41, 0, 0x41, ...leb(reqUrl.length),
    0x10, 0, 0x1a, 0x42, 42, 0x0b
  ]); // request(7, 0, URL bytes), drop status, return 42n
  const code = section(10, [3, ...reserve, ...resume, ...main]);
  const data = section(11, [1, 0, 0x41, 0, 0x0b, ...leb(reqUrl.length), ...reqUrl]);
  const custom = marker ? section(0, [...name('atto.http.v1'), 1]) : [];
  return Uint8Array.from([...MAGIC, ...custom, ...types, ...imports, ...funcs,
    ...memory, ...globals, ...exports, ...code, ...data]);
}
function boot(options = {}, fixture = {}) {
  const bytes = guestBytes(fixture);
  assert.equal(WebAssembly.validate(bytes), true, 'synthetic ABI fixture is real valid Wasm');
  const module = new WebAssembly.Module(bytes);
  const runtime = createBrowserHttpAbiV1({ module, ...options });
  const instance = new WebAssembly.Instance(module, runtime.imports);
  runtime.bind(instance);
  return { bytes, module, runtime, instance };
}

test('real Wasm receives an asynchronous response in guest-owned memory', async () => {
  let init;
  const { runtime, instance, module, bytes } = boot({
    allowOrigins: ['https://example.com'],
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.com/data');
      init = options;
      return response([11, 22, 33]);
    }
  });
  assert.throws(() => validateGuestImportABI(bytes, module), /guest import not granted/,
    'normal production runner continues denying experimental imports');
  assert.equal(instance.exports.main(), 42n);
  await runtime.drain();
  assert.equal(instance.exports.last_tag.value, HTTP_V1.OK);
  assert.equal(instance.exports.last_code.value, 200);
  assert.deepEqual([...new Uint8Array(instance.exports.memory.buffer, 1024, 3)], [11, 22, 33]);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.equal(runtime.pending, 0);
  runtime.close();
});

test('deny-by-default origin isolation delivers an explicit guest error; no HTTP dispatch', async () => {
  let called = false;
  const { runtime, instance } = boot({
    fetchImpl: () => { called = true; return response(); }
  });
  assert.equal(instance.exports.main(), 42n);
  await runtime.drain();
  assert.equal(instance.exports.last_tag.value, HTTP_V1.ERROR);
  assert.equal(instance.exports.last_code.value, HTTP_V1.ERR_PERMISSION);
  assert.equal(called, false);
  runtime.close();
});

test('synchronous admissions reject duplicate IDs, invalid memory, malformed UTF-8 and quotas', async () => {
  let called = false;
  const { runtime, instance } = boot({
    allowOrigins: ['https://example.com'], maxRequests: 1,
    fetchImpl: () => { called = true; return new Promise(() => {}); }
  });
  const mem = new Uint8Array(instance.exports.memory.buffer);
  assert.equal(runtime.imports.atto_http_v1.request(1, 65530, 24), HTTP_V1.BAD_REQUEST);
  assert.equal(runtime.imports.atto_http_v1.request(1, 0, 0), HTTP_V1.BAD_REQUEST);
  mem.set([0xc3, 0x28], 200);
  assert.equal(runtime.imports.atto_http_v1.request(1, 200, 2), HTTP_V1.BAD_REQUEST);
  assert.equal(called, false);
  assert.equal(instance.exports.main(), 42n);
  assert.equal(runtime.imports.atto_http_v1.request(7, 0, reqUrl.length), HTTP_V1.BAD_REQUEST);
  assert.equal(runtime.imports.atto_http_v1.request(8, 0, reqUrl.length), HTTP_V1.BUSY);
  assert.equal(runtime.imports.atto_http_v1.cancel(7), 1);
  await runtime.drain();
  assert.equal(instance.exports.last_tag.value, HTTP_V1.ERROR);
  assert.equal(instance.exports.last_code.value, HTTP_V1.ERR_ABORTED);
  assert.equal(runtime.pending, 0);
  runtime.close();
});

test('uncooperative fetch transport is terminated logically by request deadline', async () => {
  const { runtime, instance } = boot({
    allowOrigins: ['https://example.com'], timeoutMs: 12,
    fetchImpl: () => new Promise(() => {})
  });
  instance.exports.main();
  await runtime.drain();
  assert.equal(instance.exports.last_tag.value, HTTP_V1.ERROR);
  assert.equal(instance.exports.last_code.value, HTTP_V1.ERR_TIMEOUT);
  assert.equal(runtime.pending, 0);
  runtime.close();
});

test('redirect and opaque responses never provide guest-accessible bytes', async () => {
  for (const [props, expected] of [
    [{ status: 302, redirected: false }, HTTP_V1.ERR_REDIRECT],
    [{ type: 'opaque' }, HTTP_V1.ERR_OPAQUE],
    [{ url: 'https://other.example.org/data' }, HTTP_V1.ERR_REDIRECT]
  ]) {
    const { runtime, instance } = boot({
      allowOrigins: ['https://example.com'],
      fetchImpl: async () => response([99], props)
    });
    instance.exports.main();
    await runtime.drain();
    assert.equal(instance.exports.last_tag.value, HTTP_V1.ERROR);
    assert.equal(instance.exports.last_code.value, expected);
    assert.equal(new Uint8Array(instance.exports.memory.buffer)[1024], 0);
    runtime.close();
  }
});

test('close cancels physical requests and forbids any late guest callbacks', async () => {
  let finish;
  const { runtime, instance } = boot({
    allowOrigins: ['https://example.com'],
    fetchImpl: () => new Promise(resolve => { finish = resolve; })
  });
  instance.exports.main();
  runtime.close();
  finish(response([5]));
  await runtime.drain();
  assert.equal(instance.exports.last_tag.value, 0);
  assert.equal(instance.exports.last_code.value, 0);
  assert.equal(runtime.imports.atto_http_v1.request(9, 0, reqUrl.length), HTTP_V1.CLOSED);
  assert.equal(runtime.pending, 0);
});

test('rejects missing version attestation marker, even if binary imports are otherwise valid', () => {
  const module = new WebAssembly.Module(guestBytes({ marker: false }));
  assert.throws(() => createBrowserHttpAbiV1({ module }), /missing or unsupported/);
});

test('experimental HTTP adapter and tests cannot be shipped as public Pages assets', () => {
  for (const path of ['src/browser-fetch-capability.js', 'src/browser-http-abi-v1.js']) {
    assert.equal(ASSETS.includes(path), false);
    assert.ok(FORBIDDEN.includes('/play/' + path), 'audit must forbid ' + path);
  }
  assert.equal(ASSETS.includes('tests/browser-http-abi-v1.test.mjs'), false);
  assert.ok(FORBIDDEN.includes('/play/tests/browser-http-abi-v1.test.mjs'));
});
