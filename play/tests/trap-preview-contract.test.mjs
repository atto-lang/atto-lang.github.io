import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../examples/preview/trap.atto', import.meta.url), 'utf8');

function bodyOf(name) {
  const pattern = new RegExp(`^fnc ${name}\\([^\\n]+\\): void \\{([\\s\\S]*?)^\\}`, 'm');
  const match = source.match(pattern);
  assert.ok(match, `missing ${name} function`);
  return match[1];
}

test('trap is applied at call sites and wraps Result in Option without flattening', () => {
  assert.match(source, /fnc checked_id\(int id\): Result<int, String>/);
  assert.match(source, /val Option<Result<int, String>> success = trap checked_id\(5\);/);
  assert.match(source, /val Option<Result<int, String>> invalid = trap checked_id\(-1\);/);
  assert.match(source, /Some\(Err\(/);
  assert.doesNotMatch(source, /trap fnc checked_id/);
});

test('the Result handler only matches Ok and Err', () => {
  assert.match(source, /fnc print_checked\(Result<int, String> outcome\): void/);
  const body = bodyOf('print_checked');
  assert.match(body, /on Ok\(id\)/);
  assert.match(body, /on Err\(message\)/);
  assert.doesNotMatch(body, /on (?:Some|None)\b/);
});

test('the Option handler unwraps Some before passing Result to print_checked', () => {
  assert.match(source, /fnc print_trapped\(Option<Result<int, String>> outcome\): void/);
  const body = bodyOf('print_trapped');
  assert.match(body, /on Some\(result\) -> \{ print_checked\(result\); \}/);
  assert.match(body, /on None ->/);
  assert.doesNotMatch(body, /on (?:Ok|Err)\b/);
  assert.match(source, /print_trapped\(success\);/);
  assert.match(source, /print_trapped\(invalid\);/);
  assert.doesNotMatch(source, /print_checked\((?:success|invalid)\)/);
});

test('trap captures a thrown Error as None but never treats Err as a throw', () => {
  assert.match(source, /fnc checked_or_throw\(int id\): Result<int, String>/);
  assert.match(source, /if id eq 13 then\s+throw Error\("unexpected id"\);/);
  assert.match(source, /return checked_id\(id\);/);
  assert.match(source, /val Option<Result<int, String>> thrown = trap checked_or_throw\(13\);/);
  assert.match(source, /print_trapped\(thrown\);/);
  assert.match(source, /on None -> \{ stdio\.println\("an ordinary throw was caught"\); \}/);
  assert.doesNotMatch(source, /on Err\([^\n]*\) -> \{\s*throw/);
});


test('published guest ABI receipt and trap release documentation agree on v2', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const receipt = JSON.parse(read('public/atto_compiler.receipt.json'));
  const docs = read('docs/COMPILER_CONTRACT.md');
  const runner = read('src/runner-worker.js');
  const abi = read('src/actor-abi-version.js');

  assert.equal(receipt.guest_abi, 'atto.browser.guest.v2',
    'guest ABI upgrades require independent host review');
  assert.match(docs, /currently checked-in and published receipt explicitly identifies guest\s+ABI `atto\.browser\.guest\.v2`/);
  assert.ok(docs.includes('atto.browser.guest.v2'));
  assert.doesNotMatch(docs, /currently shipped v1 runner|receipt pinned here explicitly identifies guest ABI/);
  assert.match(runner, /requireGuestAbiV2\(module\)/,
    'host must enforce the advertised guest ABI on executed modules');
  assert.match(abi, /if \(version !== ACTOR_ABI_V2\)/,
    'unknown future ABI upgrades must fail closed');
  assert.match(docs, /Require a reviewed compiler\+runner release, approved digest/,
    'a candidate is not a public release authorization');
});
