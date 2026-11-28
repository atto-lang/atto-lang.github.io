// Static UI/catalog and design-preview evidence; NOT compiler guest-conformance proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../examples/preview/' + name + '.atto', import.meta.url), 'utf8');

const required = {
  'annotations-override': ['@Override', 'pub describe()', 'INVALID:'],
  'result-patterns-typed': ['match<int>', 'Err(error) when', 'on Err()', 'on Ok(value) when', 'on Ok(_)', 'exhaustiveness'],
  'typed-actor-messaging': ['receives int', 'sends string', 'ActorMail<int>', 'CONTROL', 'INVALID:'],
  'unary-actor-replies': ['unary http actor', 'respond_with(response)', 'send_back(response)', 'INVALID:'],
  'channel-operators': ['<< writes', '>> reads', 'c << 42', '(c >>)'],
  'caret-return': ['guard x > 0', '^ Err(', '^ Ok(', 'INVALID:'],
  'optional-omittable': ['string? name?', 'greet()', 'greet("Atto")', 'INVALID:'],
  'susp-shorthand': ['susp fnc', 'suspends fnc', 'susp |x|', 'INVALID:'],
  'timers-sleep': ['await sleeper(100ms)', 'sleep_blocking(100ms)', 'INVALID:'],
  symbols: ['#ready', '#running', 'Symbol state', 'INVALID:'],
  'generic-defaults': ['<T=int>', '<B=bool, A=int>', 'INVALID:'],
  'collection-factories': ['List.of(', 'Tuple.of(', 'Map.of(', 'Pair.of(', 'Entry.of(', 'Array.of('],
  'local-mutability': ['val mut Cell', 'let mut Cell', 'final int fixed', 'INVALID:'],
  'sealed-classes': ['sealed class', 'non-sealed class', 'INVALID:'],
  'typeof-operator': ['typeof value', 'typeof! value', 'under review'],
  'ffi-aot': ['external fnc', 'ABI', 'AOT', 'INVALID:'],
  'error-traits': ['Throwable', 'Raisable', 'Panicable', 'extends Error', 'INHERIT', 'throws(', 'raises(', 'panics(', 'Fake implements Throwable'],
  'enum-methods': ['define enum', 'is_terminal()', 'INVALID:'],
};

// Graduated to exact-oracle execution by the atto.task.v1 compiler pin.
const executable = new Set(['susp-shorthand', 'timers-sleep']);

test('expanded language previews are explicitly unverified and contain documented negative cases', async () => {
  for (const [name, tokens] of Object.entries(required)) {
    const source = await read(name);
    if (executable.has(name)) {
      assert.match(source, /^\/\/ LANGUAGE PREVIEW — compiles and runs in this browser playground\.\n/, name);
      assert.match(source, /^\/\/ INVALID:/m, name);
    } else if (name === 'channel-operators') {
      assert.match(source, /^\/\/ PREVIEW ONLY:.*<< writes, >> reads/);
    } else {
      assert.match(source, /^\/\/ SYNTAX PREVIEW — NOT browser-lowered/);
      assert.match(source, /^\/\/ INVALID:/m, name);
    }
    assert.match(source, /fnc main\(\)/);
    for (const token of tokens) assert.ok(source.includes(token), name + ': missing ' + token);
  }
});

test('sequence-pattern matching remains deferred; factories are not match patterns', async () => {
  const files = Object.keys(required);
  assert.ok(!files.includes('sequence-pattern-matching'));
  for (const name of files) {
    const source = await read(name);
    assert.doesNotMatch(source, /List\.of\(\s*\.\.\._|Tuple\.of\(\s*\.\.\._/);
  }
});

test('result discard forms never introduce implicit variables', async () => {
  const src = await read('result-patterns-typed');
  assert.match(src, /on Err\(\)/);
  assert.match(src, /on Ok\(_\)/);
  assert.match(src, /implicit error or value binding/);
  assert.match(src, /constructing Err\(\)/);
});

test('FFI preview requests an unbound import and cannot silently execute a safe fallback', async () => {
  const source = await read('ffi-aot');
  assert.match(source, /^external fnc host_clock_ns\(\): int;$/m);
  assert.match(source, /^  return host_clock_ns\(\);$/m);
  assert.doesNotMatch(source, /return elapsed_ns\(1, 43\);/);
  // The pinned-preview-admission suite must also reject this exact source as
  // diagnostic-only: no compiler or host may substitute a runnable stub.
});
