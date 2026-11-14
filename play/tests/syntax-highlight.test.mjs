import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenizeAtto} from '../src/syntax-highlight.js';
const find = (src, part) => tokenizeAtto(src).find(t=>t.text===part)?.kind;
test('formatter-derived keywords and compiler types are highlighted', () => {
  const source='pub fnc main(): int { return 42; }';
  assert.equal(find(source,'pub'),'keyword');
  assert.equal(find(source,'fnc'),'keyword');
  assert.equal(find(source,'main'),'function');
  assert.equal(find(source,'int'),'type');
  assert.equal(find('return true;','true'),'literal');
  assert.equal(find('critical-read','critical-read'),'keyword');
});
test('strings and nested comments never produce nested keywords', () => {
  const source='// fnc <script>\n/* out /* inside */ more */\n"return // literal"';
  const tokens=tokenizeAtto(source);
  assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.equal(tokens.filter(t=>t.kind==='comment').length,2);
  assert.equal(tokens.filter(t=>t.kind==='string').length,1);
  assert.equal(tokens.filter(t=>t.kind==='keyword').length,0);
});
test('preserves source exactly with unicode, escapes, CRLF and invalid/incomplete code', () => {
  for(const s of ['fnc f() {return 42;}\r\n',"'escape\\'quote'", '🚀 <img onerror=boom>',
    '/* unfinished','"unfinished','let x=0xBEEF+0b101;','x--y'])
    assert.equal(tokenizeAtto(s).map(t=>t.text).join(''),s);
});

test('explicit *gen syntax is highlighted without treating multiplication as a keyword', () => {
  const source = 'fnc *gen count_to(int limit): Generator<int> { yield limit; }';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.equal(find(source, 'fnc'), 'keyword');
  assert.equal(find(source, '*'), 'operator');
  assert.equal(find(source, 'gen'), 'keyword');
  assert.equal(find(source, 'count_to'), 'function');
  assert.equal(find(source, 'Generator'), 'type');
  assert.equal(find(source, 'yield'), 'keyword');
  assert.equal(find('let product = 2 * 3;', '*'), 'operator');
  assert.equal(find('// fnc *gen count_to()', 'gen'), undefined);
});

test('yield* delegation is a distinct token; other stars and literals are untouched', () => {
  const src = 'fnc *gen outer(): Generator<int> { yield 0; yield* inner(); }';
  const tokens = tokenizeAtto(src);
  assert.equal(tokens.map(token => token.text).join(''), src);
  assert.equal(tokens.find(token => token.text === 'yield*')?.kind, 'keyword');
  assert.equal(find(src, 'yield'), 'keyword');
  assert.equal(find(src, '*'), 'operator');
  for (const source of [
    'yield *numbers;',
    'val v = a * b;',
    '"yield* inner()"',
    '// yield* inner()',
    '/* yield* inner() */',
    'yield**source;',
    'yield*count_to(4);',
  ]) {
    const parts = tokenizeAtto(source);
    assert.equal(parts.map(part => part.text).join(''), source);
    if (source === 'yield *numbers;')
      assert.equal(parts.some(part => part.text === 'yield*'), false);
    if (source.startsWith('"') || source.startsWith('//') || source.startsWith('/*'))
      assert.equal(parts.some(part => part.text === 'yield*' && part.kind === 'keyword'), false);
  }
});

test('actor pipeline keyword uses distinct syntax from boolean and functional pipes', () => {
  const source = 'val p = spawn Parse() pipe spawn Validate() pipe spawn Sink();';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.equal(tokens.filter(token => token.text === 'pipe' && token.kind === 'keyword').length, 2);
  assert.equal(find('pipe', 'pipe'), 'keyword');
  assert.equal(find('pipeline_keyword', 'pipeline_keyword'), null);
  assert.equal(find('pipeline', 'pipeline'), null);
  assert.equal(find('spawn A() | spawn B()', '|'), 'operator');
  assert.equal(find('x |> f()', '>'), 'operator');
  assert.equal(find('// pipe is documentation', 'pipe'), undefined);
  assert.equal(find('"pipe"', 'pipe'), undefined);
});

test('module, namespace and typed actor receiver previews highlight contextual declarations', () => {
  const source = [
    'use namespace demo;',
    'import module math from "./math.atto";',
    'declare actor Foo1;',
    'declare actor Foo2;',
    'mtd (mut self: Foo1) increment(int value): void {',
    '  self.handle_state(critical-write |s| -> { s.count = value; });',
    '}',
  ].join('\n');
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const keyword of ['use','namespace','import','module','from','declare','actor','mtd','mut','self','critical-write']) {
    assert.equal(tokens.some(token => token.text === keyword && token.kind === 'keyword'), true,
      keyword + ' must have keyword styling');
  }
  assert.equal(find('declaration', 'declaration'), null);
  assert.equal(find('method_name()', 'method_name'), 'function');
  assert.equal(find('// declare actor Foo1;', 'declare'), undefined);
  assert.equal(find('"mtd (self: Foo1)"', 'mtd'), undefined);
});
