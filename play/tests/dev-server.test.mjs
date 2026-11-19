import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../tools/serve.mjs';

const server = createDevServer();
let origin;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()));
});

test('local preview server serves the homepage, gallery, and an executable Atto sample', async () => {
  const checks = [
    ['/', /AttoLang/],
    ['/play/', /AttoLang compiler playground|AttoLang|Write Atto/],
    ['/play/showcase/', /REAL RUST COMPILER|Executable showcase|Code that/],
    ['/play/examples/preview/lambdas.atto', /main/]
  ];
  for (const [path, pattern] of checks) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, 'expected published route: ' + path);
    assert.match(await response.text(), pattern, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const linked = await fetch(origin + '/play/?example=preview%2Flambdas&run=1');
  assert.equal(linked.status, 200, 'safe deep-link queries serve the same static shell');
});

test('compiled browser Wasm is served with correct application/wasm MIME', async () => {
  const response = await fetch(origin + '/play/public/atto_compiler.wasm');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/wasm');
  assert.ok((await response.arrayBuffer()).byteLength > 1000);
});

test('local server denies internal code, release notes and path traversal', async () => {
  for (const path of [
    '/play/tests/browser-e2e.mjs',
    '/play/tools/serve.mjs',
    '/play/node/tenant-session-worker.mjs',
    '/play/package.json',
    '/play/docs/BACKEND_MAP.md',
    '/play/docs/BACKEND_MAP.html',
    '/play/release-candidates/2026-11-15-callable-class-mtd-rust-wasm.json',
    '/.github/scripts/package-playground.mjs',
    '/play/%2e%2e/.github/scripts/package-playground.mjs',
    '/play/nonexistent.atto',
    '//outside.example/play/'
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, 'must not serve ' + path);
  }
});

test('only GET/HEAD are accepted; HEAD has headers without body', async () => {
  const head = await fetch(origin + '/play/showcase/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.match(head.headers.get('content-type') ?? '', /text\/html/);
  const post = await fetch(origin + '/play/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
