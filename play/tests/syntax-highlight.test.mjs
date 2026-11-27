import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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

test('separated ownership bangs never inherit coloring from an earlier keyword', () => {
  for (const source of ['borrow !value', 'take\n!value', 'share\t!value', 'copy /* comment */ !value',
    'copy // comment\n!value', 'take! \n !value']) {
    const tokens = tokenizeAtto(source);
    assert.equal(tokens.map(token => token.text).join(''), source);
    assert.equal(tokens.some(token => token.kind === 'ownership-bang'), source === 'take! \n !value');
  }
  for (const source of ['borrow!', 'take!', 'share!', 'copy!', 'copy!!']) {
    const tokens = tokenizeAtto(source);
    assert.equal(tokens.map(token => token.text).join(''), source);
    assert.equal(tokens.filter(token => token.kind === 'ownership-bang').length, source.endsWith('!!') ? 2 : 1);
  }
});

test('declaration and usage styling survives multiline declarations, nested comments, and CRLF', () => {
  const source = 'Packet make(): Packet { return Packet(); }\r\n' +
    'define\r\npub class /* nested /* comment */ still comment */ Packet as\r\n' +
    '  pub let String name = "Packet";\r\nend\r\n' +
    '// define class Phantom as\r\n';
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.ok(tokens.filter(token => token.text === 'Packet').length >= 4);
  assert.ok(tokens.filter(token => token.text === 'Packet').every(token => token.kind === 'user-type'));
  assert.equal(tokens.find(token => token.text === 'String')?.kind, 'type');
  assert.equal(tokens.some(token => token.text === 'Phantom' && token.kind === 'user-type'), false);
});

test('pending preview highlighter extensions remain compatible', () => {
  for (const keyword of ['ifnot', 'unless'])
    assert.equal(find(keyword + ' ready then', keyword), 'keyword');
  const tokens = tokenizeAtto('{"key" => 42}');
  assert.equal(tokens.find(token => token.text === '=>')?.kind, 'operator');
});

test('immutable Vector and Set type coloring cannot change source or escape comment and string boundaries', () => {
  const source = [
    'val Vector<int> source = [1, 2];',
    'val Set<int> seen = Set.of(1);',
    '// Vector Set borrow! => must remain an inert comment',
    '"Vector Set <img onerror=alert(1)>";'
  ].join('\n');
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.equal(tokens.filter(token => token.text === 'Vector' && token.kind === 'type').length, 1);
  assert.equal(tokens.filter(token => token.text === 'Set' && token.kind === 'type').length, 2);
  assert.equal(tokens.filter(token => token.kind === 'ownership-bang').length, 0);
  assert.equal(tokens.filter(token => token.kind === 'operator' && token.text === '=>').length, 0);
  assert.equal(tokens.filter(token => token.kind === 'comment').length, 1);
  assert.equal(tokens.filter(token => token.kind === 'string').length, 1);
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


test('return-first callable begin/end and exact U+2022 bullet highlight without Unicode aliasing', () => {
  const source = [
    'fnc int • double_answer(int value)',
    'begin',
    '  return value * 2;',
    'end',
    'int <- answer()',
    'begin',
    '  return double_answer(21);',
    'end',
  ].join('\n');
  const tokens = tokenizeAtto(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.equal(tokens.filter(token => token.text === 'begin' && token.kind === 'keyword').length, 2);
  assert.equal(tokens.filter(token => token.text === 'end' && token.kind === 'keyword').length, 2);
  assert.equal(tokens.find(token => token.text === '•')?.kind, 'operator');
  assert.equal(tokens.find(token => token.text === '<-')?.kind, 'operator');
  assert.equal(find('fnc int <- calculate(int x) ::', '::'), 'operator');
  assert.equal(find('raises Foo ::', '::'), 'operator');
  assert.equal(tokens.find(token => token.text === 'double_answer')?.kind, 'function');
  assert.equal(find('beginning endgame', 'beginning'), null);
  assert.equal(find('beginning endgame', 'endgame'), null);
  for (const lookalike of ['·', '∙', '‧', '●']) {
    const seen = tokenizeAtto('int ' + lookalike + ' bad()');
    assert.equal(seen.map(t => t.text).join(''), 'int ' + lookalike + ' bad()');
    assert.notEqual(seen.find(t => t.text === lookalike)?.kind, 'operator', lookalike);
  }
  for (const quoted of ['"begin • <- end"', '// begin • <- end', '/* begin • <- end */']) {
    assert.equal(tokenizeAtto(quoted).some(t => t.kind === 'keyword' || t.kind === 'operator'), false);
  }
});

// Keep preview contracts in this already-denied internal test file; adding a new
// tests/ path would require an explicit public HTTPS access-denial probe.

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

test('playground shows exact return-first bullet and begin spelling without promoting an unverified compiler', async () => {
  const [source, arrowGuest, profileText, app, html] = await Promise.all([
    read('examples/preview/return-first-signatures.atto'),
    read('examples/preview/return-first-arrow-guest.atto'),
    read('example-backend-profile.json'),
    read('src/app.js'),
    read('index.html')
  ]);
  assert.match(source, /fnc int • double_answer\(int value\) ::\s+return value \* 2;\s+end/);
  assert.match(source, /int <- answer\(\)\s+return double_answer\(21\);\s+end/);
  assert.match(source, /fnc int <- checked_double_begin\(int value\)\s+raises Foo\s+begin\s+if value > 3 then\s+raise! new Foo\(\);/);
  assert.match(source, /fnc int <- checked_double_colon\(int value\)\s+raises Foo ::\s+if value > 3 then\s+raise! new Foo\(\);/);
  assert.match(source, /return bullet_answer\("42", true\) \+ arrow_answer\(true, false, true\) - 42;/);
  assert.match(arrowGuest, /fnc int <- double_answer\(int value\)/);
  assert.match(arrowGuest, /begin\s+return value \* 2;\s+end/);
  const profile = JSON.parse(profileText).preview;
  assert.equal(profile.find(item => item.name === 'return-first-signatures')?.expect, 'preview-only');
  assert.equal(profile.find(item => item.name === 'return-first-arrow-guest')?.expect, 'exec');
  assert.match(app, /"preview\/return-first-signatures"/);
  assert.match(html, /value="preview\/return-first-signatures"/);
});

test('source examples reject separator lookalikes and split arrows as noncanonical', async () => {
  const source = await read('examples/preview/return-first-signatures.atto');
  assert.match(source, /INVALID: int < - broken\(\)/);
  assert.match(source, /INVALID: fnc int <- malformed\(int x\) raises Foo return x; end/);
  assert.match(source, /INVALID: fnc int <- malformed\(int x\) raises Foo :: throws Bar/);
  assert.match(source, /INVALID: use a different Unicode bullet-looking character/);
});

test('four suspension spellings are highlighted with exact source preservation',()=>{
  for(const spelling of ['suspends','susp','⧖','∂']){
    const source='pub '+spelling+' fnc fetch(): int { return 42; }';
    assert.equal(find(source,spelling),'keyword');
    assert.equal(tokenizeAtto(source).map(t=>t.text).join(''),source);
    for(const trivia of ['// '+spelling,'/* '+spelling+' */','"'+spelling+'"'])
      assert.equal(tokenizeAtto(trivia).some(t=>t.kind==='keyword'),false);
  }
  for(const id of ['suspension','susp2','suspπ','πsusp','suspends变量','▽'])
    assert.equal(tokenizeAtto(id).some(t=>t.kind==='keyword'),false,id);
});
