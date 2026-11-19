import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDevServer } from '../tools/serve.mjs';
import { request as httpRequest } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS } from '../../.github/scripts/package-playground.mjs';

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
    '/play/docs/CLOSURES_RELEASE_GATE.md',
    '/play/docs/CLOSURES_RELEASE_GATE.html',
    '/play/docs/EXAMPLE_BACKEND_PARITY.md',
    '/play/docs/EXAMPLE_BACKEND_PARITY.html',
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

// Raw HTTP requests exercise the actual Host header. Fetch normalizes URLs
// and can hide DNS-rebinding and absolute-form request edge cases.
function rawRequest(path, { host, origin: requestOrigin } = {}) {
  const headers = {};
  if (host !== undefined) headers.Host = host;
  if (requestOrigin !== undefined) headers.Origin = requestOrigin;
  return new Promise((resolve, reject) => {
    const request = httpRequest(origin + path, { headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode,
        headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.end();
  });
}

test('DNS rebinding cannot access compiler, Atto source or internal files using a forged Host', async () => {
  const port = new URL(origin).port;
  const protectedPaths = ['/play/public/atto_compiler.wasm',
    '/play/examples/preview/lambdas.atto', '/play/docs/COMPILER_CONTRACT.md'];
  for (const hostname of [
    'attacker.invalid:' + port,
    '127.0.0.1.attacker.invalid:' + port,
    'localhost.attacker.invalid:' + port,
    'attacker.invalid@localhost:' + port,
    'localhost:' + (Number(port) + 1)
  ]) {
    for (const path of protectedPaths) {
      const response = await rawRequest(path, { host: hostname });
      assert.equal(response.status, 403, 'forged Host must not expose ' + path + ': ' + hostname);
      assert.equal(response.body, 'Forbidden origin');
      assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
    }
  }
  const legitimate = await rawRequest('/play/public/atto_compiler.wasm', { host: 'localhost:' + port });
  assert.equal(legitimate.status, 200, 'localhost with exact port remains supported');
});

test('cross-origin browser reads fail closed even with an otherwise valid loopback Host', async () => {
  const port = new URL(origin).port;
  for (const requestOrigin of ['https://attacker.invalid', 'null',
    'http://localhost:' + port, 'http://127.0.0.1:1']) {
    const response = await rawRequest('/play/examples/preview/lambdas.atto',
      { origin: requestOrigin });
    assert.equal(response.status, 403, 'cross-origin read from ' + requestOrigin);
  }
  const allowed = await rawRequest('/play/examples/preview/lambdas.atto',
    { origin });
  assert.equal(allowed.status, 200);
  assert.match(allowed.body, /main/);
  assert.equal(allowed.headers['x-frame-options'], 'DENY');
  assert.equal(allowed.headers['content-security-policy'], "frame-ancestors 'none'");
});

test('allowlisted URLs never disclose forbidden files through leaf or parent symlinks', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'atto-dev-site-'));
  const outside = await mkdtemp(join(tmpdir(), 'atto-private-file-'));
  const target = join(sandbox, 'play', 'examples', 'preview', 'lambdas.atto');
  const inside = join(sandbox, 'play', 'tests', 'secret.atto');
  const outsideFile = join(outside, 'secret.atto');
  let ephemeral;
  try {
    await mkdir(join(sandbox, 'play', 'examples', 'preview'), { recursive: true });
    await mkdir(join(sandbox, 'play', 'tests', 'preview'), { recursive: true });
    await writeFile(inside, 'DO_NOT_EXPOSE_INTERNAL_TEST_SOURCE');
    await writeFile(outsideFile, 'DO_NOT_EXPOSE_OUTSIDE_SOURCE');
    ephemeral = createDevServer({ root: sandbox });
    await new Promise((resolve, reject) => {
      ephemeral.once('error', reject);
      ephemeral.listen(0, '127.0.0.1', resolve);
    });
    const url = 'http://127.0.0.1:' + ephemeral.address().port +
      '/play/examples/preview/lambdas.atto';
    // A plain exact-path file is an authorized local development sample.
    await writeFile(target, 'pub fnc main(): int { return 42; }');
    let response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /return 42/);
    await unlink(target);
    // In-tree aliases are not safe: their target could be an internal test.
    await symlink(inside, target);
    response = await fetch(url);
    assert.equal(response.status, 404, 'in-tree symlink to unlisted file denied');
    assert.doesNotMatch(await response.text(), /DO_NOT_EXPOSE/);
    await unlink(target);
    await symlink(outsideFile, target);
    response = await fetch(url);
    assert.equal(response.status, 404, 'symlink outside root denied');
    await unlink(target);
    // A symlinked ancestor directory must not bypass the leaf-file check.
    await writeFile(join(sandbox, 'play', 'tests', 'preview', 'lambdas.atto'),
      'DO_NOT_EXPOSE_ALIAS_DIRECTORY');
    await rm(join(sandbox, 'play', 'examples'), { recursive: true });
    await symlink(join(sandbox, 'play', 'tests'),
      join(sandbox, 'play', 'examples'), 'dir');
    response = await fetch(url);
    assert.equal(response.status, 404, 'in-tree parent-directory symlink denied');
    assert.doesNotMatch(await response.text(), /DO_NOT_EXPOSE/);
  } finally {
    if (ephemeral?.listening) {
      await new Promise((resolve, reject) =>
        ephemeral.close(error => error ? reject(error) : resolve()));
    }
    await rm(sandbox, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('developer host is Node-only and excluded from the public artifact allowlist', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.serve, 'node tools/serve.mjs');
  assert.ok(!ASSETS.includes('tools/serve.mjs'));
  assert.ok(!ASSETS.includes('tests/dev-server.test.mjs'));
});
