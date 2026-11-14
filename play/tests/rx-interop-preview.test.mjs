import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = new URL('../examples/preview/rx-interop.atto', import.meta.url);

test('Rx interop preview returns parenthesized await match from suspending function', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /^\/\/ SYNTAX PREVIEW/m);
  const collect = source.match(/suspends fnc collect_first\(Channel<int> input\): Result<int, string> \{([\s\S]*?)\n\}\n/);
  assert.ok(collect, 'collect_first must remain explicitly suspending');
  const body = collect[1];

  assert.match(body, /val first: Task<Option<int>> = doubled\.first_task\(\);/);
  assert.match(body, /return match \(await first\) over\n\s+on Some\(value\) -> \{ return Ok\(value\); \}\n\s+on None -> \{ return Err\("stream completed without values"\); \}\n\s+end/);
  assert.doesNotMatch(body, /\bmatch await first over\b/, 'unparenthesized, non-returned match must not regress');
  assert.match(source, /suspends fnc main\(\): int \{/);
  assert.match(source, /val result = await collect_first\(ch\);/);
});
