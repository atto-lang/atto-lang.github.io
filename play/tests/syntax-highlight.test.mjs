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
