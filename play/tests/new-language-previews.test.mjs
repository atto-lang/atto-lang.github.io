// Static target-syntax and release-wiring checks. NOT compiler/guest conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL('../'+path, import.meta.url), 'utf8');
const cases = {
  "lambda-delimiters": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "|| : int",
    "|_| : int",
    "|int x|",
    "|x: int",
    "const fnc"
  ],
  "generic-inference-ascription": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "calculate(5) : float",
    "calculate(5) as float",
    "calculate<float>(5)"
  ],
  "typed-match-select": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "match<int>",
    "select<int>",
    "on Ok(value)",
    "on Err(_)"
  ],
  "package-namespace-imports": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "import pkg 'std.math'",
    "import pkg 'std.time' as clock"
  ],
  "return-first-signatures": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "int• bullet_answer",
    "fnc int <- arrow_answer",
    "begin"
  ],
  "operator-spellings": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "12 ^^ 10",
    "1 <<< 3",
    "shifted >>> 2",
    "stdio.out <<",
    "^ bits + down"
  ],
  "actor-pipeline-bang-aliases": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "pipe!",
    "rpipe!",
    "stop!"
  ],
  "data-oriented-layouts": [
    "// SYNTAX PREVIEW — NOT browser-lowered",
    "// INVALID:",
    "layout=aos",
    "layout=soa",
    "layout=aosoa(8)"
  ]
};
test('eight new previews stay syntax-only, uniquely selected and release-allowlisted', async () => {
  const [html,app,profileJson,release,catalog] = await Promise.all([
    read('index.html'),read('src/app.js'),read('example-backend-profile.json'),
    read('../.github/scripts/package-playground.mjs'),read('tests/example-catalog.test.mjs')
  ]);
  const profile=JSON.parse(profileJson);
  const available=JSON.parse(app.match(/const PREVIEW_EXAMPLES = new Set\\((\\[[^\\n]+\\])\\)/)[1]);
  const runnable=JSON.parse(app.match(/const EXECUTABLE_PREVIEWS = new Set\\((\\[[^\\n]+\\])\\)/)[1]);
  const group=html.match(/<optgroup label="Language previews — syntax only \\(compiler diagnostics\\)">([\\s\\S]*?)<\\/optgroup>/);
  assert.ok(group);
  for (const [name,tokens] of Object.entries(cases)) {
    const src=await read('examples/preview/'+name+'.atto');
    const id='preview/'+name;
    assert.equal(html.split('value="'+id+'"').length-1,1,name+' dropdown');
    assert.ok(group[1].includes('value="'+id+'"'),name+' target group');
    assert.equal(available.filter(x=>x===id).length,1,name+' loader');
    assert.equal(runnable.includes(id),false,name+' must not be advertised executable');
    assert.deepEqual(profile.preview.find(x=>x.name===name),{name,expect:'preview-only'});
    assert.equal(release.split("'examples/preview/"+name+".atto'").length-1,1);
    assert.ok(catalog.includes('"'+name+'"'),name+' inventory');
    assert.match(src,/^\\/\\/ SYNTAX PREVIEW/);
    assert.match(src,/pub fnc main\\(\\): int/);
    for (const token of tokens) assert.ok(src.includes(token),name+': missing '+token);
  }
});
test('obsolete standalone underscore lambda is rejected in teaching examples',async()=>{
  const src=await read('examples/preview/lambdas-advanced.atto');
  assert.doesNotMatch(src,/^\\s*(?:val|const)\\s+\\w+\\s*=\\s*_\\s*(?::|->)/m);
  assert.match(src,/\\|_\\| : int -> 5/);
  assert.match(src,/\\|_, _\\| : int -> 5/);
  assert.match(src,/INVALID: val constant = _ : int -> 5/);
});
