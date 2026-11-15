import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read = () => readFile(new URL('../examples/preview/callable-body-styles.atto', import.meta.url), 'utf8');
test('receiver aliases are illustrated without declaring duplicate signatures', async () => {
  const s = await read();
  for (const header of [
    '// mtd (Calculator self) square(int x) -> int ::',
    '// mtd (Calculator) square(int x) -> int ::',
    '// mtd (Calculator _) square(int x) -> int ::',
    '// mtd (mut self: Calculator) increment() -> int ::',
  ]) assert.ok(s.includes(header), header);
  assert.equal(s.split('mtd (self: Calculator)').length - 1, 5,
    'the original five active receiver forms must remain distinct');
  assert.match(s, /Actor state remains sealed/);
  assert.match(s, /Inline 'fnc name' and 'method name' format to bare/);
  assert.match(s, /Formatter integration remains a separate gate/);
  assert.match(s, /pinned playground Wasm compiler cannot execute/);
});
