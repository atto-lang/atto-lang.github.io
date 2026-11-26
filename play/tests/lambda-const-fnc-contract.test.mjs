// Static release-admission guard, NOT proof that the unreleased Rust/Wasm
// compiler can execute the new const fnc variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path, root), 'utf8');

test('lambda preview documents mandatory pipes and distinct local/module const ABI', async () => {
  const [sample, profileText] = await Promise.all([
    read('examples/preview/lambda-delimiters.atto'),
    read('example-backend-profile.json')
  ]);
  const profile = JSON.parse(profileText);
  assert.match(sample, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
  assert.match(sample, /Spec: https:\/\/github.com\/atto-lang\/atto-spec\/pull\/192/);
  assert.match(sample, /const fnc module_five = \|int _\| : int -> 5;/);
  assert.match(sample, /const fnc v = \|_\| : int -> 5;\s*return v\(41\);/);
  assert.match(sample, /const fnc zero = \|\| : int -> 5;/);
  assert.match(sample, /const fnc discard_two = \|_, _\| : int -> 5;/);
  assert.match(sample, /discard_two\(10, false\)/);
  assert.match(sample, /INVALID: discard_two\(1\);/);
  assert.match(sample, /INVALID: const fnc bad = \|_, _\| : int -> _;/);
  assert.match(sample, /const fnc twice = \|int x\| -> x \* 2;/);
  assert.match(sample, /const fnc sum = \|x: int, y: int\| -> x \+ y;/);
  assert.match(sample, /INVALID \(type\): const fnc module_bad = \|_\|/);
  assert.match(sample, /INVALID: const fnc broken = _ : int -> 5;/);
  assert.match(sample, /INVALID: const fnc broken = _ -> 5;/);
  const withoutComments = sample.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
  assert.doesNotMatch(withoutComments, /const fnc \w+\s*=\s*_\s*(?::|->)/);
  assert.deepEqual(profile.preview.find(e => e.name === 'lambda-delimiters'),
    {name:'lambda-delimiters', expect:'preview-only'});
});

test('the old pinned browser guest remains executable but is not a const-fnc release', async () => {
  const [guest, profileText, receiptText] = await Promise.all([
    read('examples/preview/lambda-delimiters-guest.atto'),
    read('example-backend-profile.json'),
    read('public/atto_compiler.receipt.json')
  ]);
  const profile = JSON.parse(profileText);
  const receipt = JSON.parse(receiptText);
  assert.match(guest, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground/);
  assert.match(guest, /val constant = \|_\| : int -> 5;/);
  assert.match(guest, /val constant = \|\| -> 7;/);
  assert.deepEqual(profile.preview.find(e => e.name === 'lambda-delimiters-guest'),
    {name:'lambda-delimiters-guest', expect:'exec', return:'42', stdout:''});
  assert.match(receipt.source_head, /^[a-f0-9]{40}$/);
  assert.match(receipt.compiler_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(receipt.source_head, '63574e0b527c5f557326cfcc2a207c4b49419c19',
    'unreleased draft Rust lambda compiler must not be mistaken for the published binary');
});
