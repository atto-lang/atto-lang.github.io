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

test('negated conditional keywords and guard highlight without coloring literals or comments', () => {
  const source = 'do ifnot ready then return 1; fi\nunless ready { return 2; }\nguard ready { return 3; }';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const word of ['ifnot', 'unless', 'guard']) {
    assert.ok(tokens.some(token => token.text === word && token.kind === 'keyword'), word);
    assert.equal(find('// ' + word, word), undefined);
    assert.equal(find('"' + word + '"', word), undefined);
    assert.equal(find('prefix_' + word, 'prefix_' + word), null);
  }
});

test('Map, Record, Array, List, Pair, Entry, Tuple and => highlight without source mutation', () => {
  const src = [
    'let Map<string, string> g = {"5" => "foo", x => "bar"};',
    'let Record m = (name="foo", bar=5, star=true);',
    'let Pair<string, string> p = Pair.of("x", "y");',
    'let Entry<string, string> e = "x" => "y";',
    'let List<bool> items = [true, false];',
    'let Array<int> ary = [1, 2];',
    'let Tuple<int, string> tup = (7, "paid");',
  ].join('\n');
  const tokens = tokenizeAtto(src);
  assert.equal(tokens.map(t => t.text).join(''), src, 'tokenization must be lossless');
  for (const type of ['Map', 'Record', 'Pair', 'Entry', 'List', 'Array', 'Tuple']) {
    assert.ok(tokens.some(t => t.text === type && t.kind === 'type'),
      type + ' must be highlighted as a collection/product type');
  }
  assert.equal(tokens.filter(t => t.text === '=>' && t.kind === 'operator').length, 3);
  assert.equal(find(src, 'let'), 'keyword');
  assert.equal(find(src, 'true'), 'literal');
  assert.equal(find('Map.of_entries("a" => 1)', 'of_entries'), 'function');
  assert.equal(find('"x => y"', '=>'), undefined, 'operator text within a string is opaque');
  assert.equal(find('// => Entry', '=>'), undefined, 'operator text within a comment is opaque');
  assert.equal(find('foo => bar', '=>'), 'operator');
});

test('immutable Vector, List, Map and Set examples retain exact source and nested type coloring', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const name of [
    'immutable-vector-const', 'immutable-vector-updates',
    'immutable-vector-rebinding', 'immutable-list',
    'immutable-map-set', 'immutable-collection-pipelines'
  ]) {
    const source = await readFile(new URL('../examples/preview/' + name + '.atto', import.meta.url), 'utf8');
    const tokens = tokenizeAtto(source);
    assert.equal(tokens.map(token => token.text).join(''), source, name + ': tokenizer changed source');
    const required = name === 'immutable-list' ? ['List']
      : name === 'immutable-map-set' ? ['Map', 'Set'] : ['Vector'];
    for (const type of required) {
      assert.ok(tokens.some(token => token.text === type && token.kind === 'type'),
        name + ': missing highlighted ' + type + ' type');
    }
    // The initial warnings and invalid-code tutorials must stay comments.
    assert.equal(tokens[0].kind, 'comment', name + ': compiler caveat became active syntax');
    assert.ok(tokens.some(token => token.kind === 'comment' && token.text.startsWith('// INVALID:')),
      name + ': negative examples must stay commented');
  }
  const injection = '// Vector Set =>\\n"Vector Set => <img onerror=alert(1)>"\\nlet Vector<int> v = []; let Set<int> s = Set.of(1);';
  const tokens = tokenizeAtto(injection);
  assert.equal(tokens.map(token => token.text).join(''), injection,
    'immutable gallery syntax highlighting must be lossless with HTML-looking strings');
  assert.equal(tokens.filter(token => token.text === 'Vector' && token.kind === 'type').length, 1);
  assert.equal(tokens.filter(token => token.text === 'Set' && token.kind === 'type').length, 2);
  assert.equal(tokens.filter(token => token.text === '=>' && token.kind === 'operator').length, 0,
    'quoted and commented arrows must never escape into operator markup');
});
