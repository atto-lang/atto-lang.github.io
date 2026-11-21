import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/vendor-compiler.sh', import.meta.url));
const run = (...args) => spawnSync('sh', [script, ...args],
  {cwd: root, encoding: 'utf8', timeout: 10_000});

const requirePackage = await readFile(new URL('../package.json', import.meta.url), 'utf8');

test('vendor:compiler entrypoint exists, is valid POSIX shell, and documents both nonpublishing modes', () => {
  const parse = spawnSync('sh', ['-n', script], {cwd: root, encoding:'utf8'});
  assert.equal(parse.status, 0, parse.stderr);
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Rust compiler WASM|RUST->WASM|compiler WASM/i);
  assert.match(help.stdout, /NEVER modifies public/);
  const pkg = JSON.parse(requirePackage);
  assert.match(pkg.scripts['vendor:compiler'], /scripts\/vendor-compiler\.sh/);
});

test('default vendor:compiler command executes the real pinned Wasm/guest checks without publishing', async () => {
  const pin = new URL('../src/compiler-pin.js', import.meta.url);
  const receipt = new URL('../public/atto_compiler.receipt.json', import.meta.url);
  const before = [await readFile(pin), await readFile(receipt)];
  const result = spawnSync('sh', [script], {cwd:root, encoding:'utf8', timeout:60_000});
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout.slice(-3500));
  assert.match(result.stdout, /# pass [1-9][0-9]*/);
  assert.match(result.stdout, /# fail 0/);
  assert.deepEqual([await readFile(pin), await readFile(receipt)], before,
    'verification must not republish a compiler or change pins');
});

test('invalid private candidate cannot overwrite the published compiler pin or receipt', async () => {
  const pin = new URL('../src/compiler-pin.js', import.meta.url);
  const receipt = new URL('../public/atto_compiler.receipt.json', import.meta.url);
  const before = [await readFile(pin), await readFile(receipt)];
  for (const args of [
    ['--stage-private'],
    ['--stage-private', '/missing/atto_compiler.wasm', '2026-11-15-ownership-rust-wasm.json'],
    ['--stage-private', '/missing/atto_compiler.wasm', '../../receipt.json'],
    ['--stage-private', 'relative.wasm', '2026-11-15-ownership-rust-wasm.json'],
    ['--invalid-mode'],
  ]) {
    const result = run(...args);
    assert.notEqual(result.status, 0, 'accepted invalid candidate: ' + args.join(' '));
  }
  const after = [await readFile(pin), await readFile(receipt)];
  assert.deepEqual(after, before, 'an unverified compiler was published');
});

test('script has no direct publication path or implicit source mirroring', async () => {
  const content = await readFile(script, 'utf8');
  assert.doesNotMatch(content, /git\s+push|curl\s+|wget\s+|gh\s+api|cp\s+.*public\/atto_compiler/);
  assert.match(content, /verify-compiler-candidate\.mjs/);
  assert.match(content, /tests\/typed-lambda-comma-compiler-gate\.test\.mjs/);
});
