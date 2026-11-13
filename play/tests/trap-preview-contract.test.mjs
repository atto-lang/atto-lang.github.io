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
