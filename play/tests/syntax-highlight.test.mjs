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

test('exception-control keywords are highlighted but comments and string literals never become syntax', () => {
  const source = 'defer recover raise throw try catch finally panic';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['defer','recover','raise','throw','try','catch','finally','panic']) {
    assert.equal(tokens.find(token => token.text === word)?.kind, 'keyword', word);
    assert.equal(tokenizeAtto('// '+word).some(token => token.kind === 'keyword'), false);
    assert.equal(tokenizeAtto('"'+word+'"').some(token => token.kind === 'keyword'), false);
  }
});

test('new effects, visibility and guard keywords are highlighted, never evaluated', () => {
  const source = 'export pub[pkg] external internal protected final pure requires critical guard routine using suspends';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['export','external','internal','protected','final','pure','requires','critical','guard','routine','using','suspends'])
    assert.equal(tokens.find(token => token.text === word)?.kind, 'keyword', word);
  for (const comment of ['// external guard', '"protected final"', '/* routine */'])
    assert.equal(tokenizeAtto(comment).some(token => token.kind === 'keyword'), false);
});

test('comma-separated named import aliases highlight import/from/pkg/as without changing using', () => {
  const source = 'import span as create_span, tracer from pkg "core.telemetry";\nusing create_span("demo") as current_span {}';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(t => t.text).join(''), source);
  for (const keyword of ['import', 'from', 'pkg', 'as', 'using']) {
    assert.equal(tokens.some(t => t.text === keyword && t.kind === 'keyword'), true, keyword);
  }
});

test('return caret, assignment, eq and neq share the red operator-accent style', () => {
  const source = '^ packet = left eq right; left neq right;';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const value of ['^', '=', 'eq', 'neq'])
    assert.equal(tokens.find(token => token.text === value)?.kind, 'operator-accent', value);
  for (const value of ['equal', 'neq_value', 'equation'])
    assert.equal(find(value, value), null);
  for (const value of ['"eq neq ^ ="', '// eq neq ^ =', '/* eq neq ^ = */'])
    assert.equal(tokenizeAtto(value).some(token => token.kind === 'operator-accent'), false);
});

test('ownership words stay purple keywords while attached exclamation marks turn red', () => {
  const source = 'borrow! take! share! copy! copy!!';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['borrow', 'take', 'share', 'copy'])
    assert.equal(tokens.find(token => token.text === word)?.kind, 'keyword');
  assert.equal(tokens.filter(token => token.kind === 'ownership-bang').length, 6);
  assert.equal(find('borrower!','borrower'), null);
  assert.equal(find('!flag','!'), 'operator');
  assert.equal(find('copy !','!'), 'operator'); // only contiguous postfix operators
  assert.equal(tokenizeAtto('"copy!!" // borrow!').filter(token => token.kind === 'ownership-bang').length, 0);
});

test('block and task constructs use their own concurrency color class', () => {
  for (const keyword of ['block', 'task'])
    assert.equal(find(keyword + ' {}', keyword), 'concurrency');
  assert.equal(find('blockchain', 'blockchain'), null);
  assert.equal(find('"block task"', 'block'), undefined);
  assert.equal(find('// block task', 'task'), undefined);
});

test('user-defined type declarations and usages differ from core/std built-in types', () => {
  const source = [
    'Packet build(Packet input): String { return Packet(input.id); }',
    'define class Packet as',
    '  pub let int id = 42;',
    'end',
    'declare actor Worker;',
    'define struct Point as end',
    'let value: Packet = new Packet();',
    'let worker: Worker;',
    'let point: Point;',
  ].join('\n');
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['Packet', 'Worker', 'Point']) {
    const appearances = tokens.filter(token => token.text === word);
    assert.ok(appearances.length >= 2, word);
    assert.ok(appearances.every(token => token.kind === 'user-type'), word);
  }
  assert.equal(find(source, 'int'), 'type');
  assert.equal(find(source, 'String'), 'type');
  assert.equal(find('Map<String, Vector<int>>', 'Map'), 'type');
  assert.equal(find('Map<String, Vector<int>>', 'Vector'), 'type');
  assert.equal(find('ExternalType instance;', 'ExternalType'), null);
  assert.equal(find('define class Packet as end', 'Packet'), 'user-type');
});

test('comments and strings cannot introduce user-defined types or cause token loss', () => {
  const source = [
    'Fake value;',
    '// define class Fake as',
    '/* define class Bogus as */',
    '"define class Ghost as"',
    'define class Actual /* nested /* keep */ comment */ as end',
    'Actual value; Fake another; Ghost phantom; Bogus ghost;',
  ].join('\n');
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.equal(tokens.filter(token => token.text === 'Actual').every(token => token.kind === 'user-type'), true);
  for (const word of ['Fake', 'Ghost', 'Bogus'])
    assert.equal(tokens.find(token => token.text === word)?.kind, null, word);
});

test('syntax colors are specified without changing the editor mirror metrics', async () => {
  const {readFile} = await import('node:fs/promises');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  for (const kind of ['operator-accent', 'ownership-bang', 'concurrency', 'user-type'])
    assert.ok(css.includes('.syntax-layer .tok-' + kind + '{color:#'), kind);
  assert.match(css, /\.tok-keyword\{color:#b9a2ff/);
  assert.match(css, /\.tok-type\{color:#72d8df/);
});

test('pending preview highlighter extensions remain compatible', () => {
  for (const keyword of ['ifnot', 'unless'])
    assert.equal(find(keyword + ' ready then', keyword), 'keyword');
  const tokens = tokenizeAtto('{"key" => 42}');
  assert.equal(tokens.find(token => token.text === '=>')?.kind, 'operator');
});
