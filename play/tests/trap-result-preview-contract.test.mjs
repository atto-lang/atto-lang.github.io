import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../examples/preview/trap-result.atto', import.meta.url), 'utf8');

function bodyOf(name) {
  const pattern = new RegExp('^fnc ' + name + '\\([^\\n]+\\): void \\{([\\s\\S]*?)^\\}', 'm');
  const match = source.match(pattern);
  assert.ok(match, 'missing ' + name + ' function');
  return match[1];
}

test('caller-side trap yields one Result, retaining existing Ok and Err values', () => {
  assert.match(source, /fnc checked_id\(int id\): Result<int, Error>/);
  assert.match(source, /val Result<int, Error> success = trap checked_id\(5\);/);
  assert.match(source, /val Result<int, Error> invalid = trap checked_id\(-1\);/);
  assert.match(source, /val Result<int, Error> thrown = trap checked_or_throw\(13\);/);
  assert.match(source, /return Err\(Error\("id must be nonnegative"\)\);/);
  assert.doesNotMatch(source, /Option<Result<int, Error>>|Result<Result<int, Error>, Error>/);
  assert.doesNotMatch(source, /\btrap\s+fnc\b/);
});

test('a non-Result operand is wrapped once, and an Option stays inside the Result', () => {
  assert.match(source, /fnc count_or_throw\(int count\): int throws\(Error\)/);
  assert.match(source, /val Result<int, Error> plain = trap count_or_throw\(7\);/);
  assert.match(source, /fnc optional_id\(bool present\): Option<int>/);
  assert.match(source, /val Result<Option<int>, Error> absent = trap optional_id\(false\);/);
  const body = bodyOf('print_optional');
  assert.match(body, /on Ok\(Some\(id\)\)/);
  assert.match(body, /on Ok\(None\)/);
  assert.match(body, /on Err\(error\)/);
});

test('ordinary throw is Err, not None, and panic/raise bypass trap', () => {
  assert.match(source, /if id eq 13 then\s+throw! Error\("unexpected id"\);/);
  assert.match(source, /fnc checked_or_throw\(int id\): Result<int, Error> throws\(Error\)/);
  assert.match(source, /val Result<int, Error> thrown = trap checked_or_throw\(13\);/);
  assert.match(source, /Err\(Error\("unexpected id"\)\)/);
  const body = bodyOf('print_trapped');
  assert.match(body, /on Ok\(id\)/);
  assert.match(body, /on Err\(error\)/);
  assert.doesNotMatch(body, /on (?:Some|None)\b/);
  assert.match(source, /raise!, panic!, cancellation, and fatal host\/Wasm traps bypass trap/);
});

test('canonical trap is clearly separated from historical executable pin in the picker', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const html = read('index.html');
  const app = read('src/app.js');
  const legacy = read('examples/preview/trap.atto');
  const profile = JSON.parse(read('example-backend-profile.json'));
  const byName = new Map(profile.preview.map(x => [x.name, x]));
  assert.equal(byName.get('trap').expect, 'exec');
  assert.equal(byName.get('trap-result').expect, 'preview-only');
  assert.match(html, /value="preview\/trap">trap — legacy Option behavior/);
  assert.match(html, /value="preview\/trap-result">trap — canonical Result contract/);
  assert.match(app, /selector\.value === 'preview\/trap-result'/);
  assert.match(app, /The pinned Rust\/Wasm binary does not compile this preview yet/);
  assert.match(legacy, /Option<Result<int, String>> success = trap checked_id\(5\)/);
  assert.match(source, /Result<int, Error> success = trap checked_id\(5\)/);
  assert.match(source, /Result<int, Error> invalid = trap checked_id\(-1\)/);
  assert.match(source, /Result<int, Error> plain = trap count_or_throw\(7\)/);
  assert.match(source, /E_TRAP_ERROR_JOIN/);
  assert.doesNotMatch(source, /val Option<Result</);
});

test('published guest ABI receipt and trap release documentation agree on v2', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const receipt = JSON.parse(read('public/atto_compiler.receipt.json'));
  const docs = read('docs/COMPILER_CONTRACT.md');
  const runner = read('src/runner-worker.js');
  const abi = read('src/actor-abi-version.js');

  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2',
    'guest ABI upgrades require independent host review');
  assert.match(docs, /The candidate compiler receipt identifies guest ABI `atto\.browser\.guest\.v2`/);
  assert.match(docs, /GitHub PR, successful staging or merged source commit is not proof of deployment/i,
    'documented candidate must not be portrayed as approved for public deployment');
  assert.ok(docs.includes('atto.browser.guest.v2'));
  assert.doesNotMatch(docs, /currently shipped v1 runner|receipt pinned here explicitly identifies guest ABI/);
  assert.match(runner, /requireGuestAbiV2\(module\)/,
    'host must enforce the advertised guest ABI on executed modules');
  assert.match(abi, /if \(version !== ACTOR_ABI_V2\)/,
    'unknown future ABI upgrades must fail closed');
  assert.match(docs, /Require a reviewed compiler\+runner release, approved digest/,
    'a candidate is not a public release authorization');
});
