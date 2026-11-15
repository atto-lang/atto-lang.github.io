import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('published guest ABI receipt and release documentation agree on v2', () => {
  const receipt = JSON.parse(read('public/atto_compiler.receipt.json'));
  const docs = read('docs/COMPILER_CONTRACT.md');
  const runner = read('src/runner-worker.js');
  const abi = read('src/actor-abi-version.js');

  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2',
    'guest ABI upgrades require independent host review');
  assert.ok(docs.includes('currently pinned receipt actually declares guest ABI'));
  assert.ok(docs.includes('atto.browser.guest.v2'));
  assert.doesNotMatch(docs, /currently shipped v1 runner|receipt pinned here explicitly identifies guest ABI/);
  assert.match(runner, /requireGuestAbiV2\(module\)/,
    'host must enforce the advertised guest ABI on executed modules');
  assert.match(abi, /if \(version !== ACTOR_ABI_V2\)/,
    'unknown future ABI upgrades must fail closed');
  assert.ok(docs.includes('independently reviewed compiler+runner release'),
    'a candidate is not a public release authorization');
});
