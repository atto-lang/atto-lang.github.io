import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FORMATTER_SHA256,FORMATTER_BYTES,FORMATTER_SOURCE_COMMIT} from '../src/formatter-pin.js';
import {formatWithWasm,mapFormatCaret} from '../src/formatter-runtime.js';
const wasm=await readFile(new URL('../public/oreslang_format.wasm',import.meta.url));
const receipt=JSON.parse(await readFile(new URL('../public/oreslang_format.receipt.json',import.meta.url),'utf8'));
test('real canonical formatter Wasm is exact SHA/size-pinned and import-free',()=>{
  assert.equal(wasm.length,FORMATTER_BYTES);
  assert.equal(createHash('sha256').update(wasm).digest('hex'),FORMATTER_SHA256);
  assert.equal(receipt.schema,'atto.browser.formatter.vendor.v1');
  assert.equal(receipt.source_head,FORMATTER_SOURCE_COMMIT);
  assert.equal(receipt.wasm_sha256,FORMATTER_SHA256);
  assert.equal(receipt.wasm_bytes,FORMATTER_BYTES);
  assert.equal(WebAssembly.validate(wasm),true);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(wasm)),[]);
});
const compiled = await WebAssembly.compile(wasm);
async function fmt(source) { return formatWithWasm(await WebAssembly.instantiate(compiled,{}),source); }
test('canonical Rust Wasm formatter indents, is idempotent and preserves Unicode',async()=>{
  const src='// 🚀 文字\nfnc main() -> int {\nreturn 42;\n}\n';
  const a=await fmt(src);
  assert.equal(a.ok,true,JSON.stringify(a));
  assert.match(a.formatted,/  return 42;/);
  assert.match(a.formatted,/🚀 文字/);
  assert.deepEqual(await fmt(a.formatted),a);
});
test('formatter failures leave caller source unchanged and report a diagnostic',async()=>{
  const source='fnc identity(int x) -> int do return x; end\n';
  const got=await fmt(source);
  assert.equal(got.ok,false);
  assert.ok(got.diagnostic.length);
  await assert.rejects(()=>fmt('x'.repeat(65537)),/65536/);
  assert.throws(()=>formatWithWasm({exports:{}},'hi'),/ABI/);
});
test('caret mapping preserves unchanged ranges and reasonable indented positions',()=>{
  const src='fnc main() -> int {\nreturn 42;\n}\n',dst='fnc main() -> int {\n  return 42;\n}\n';
  assert.equal(mapFormatCaret(src,dst,0),0);
  assert.equal(mapFormatCaret(src,dst,src.length),dst.length);
  const pos=src.indexOf('42')+2;
  assert.equal(dst.slice(mapFormatCaret(src,dst,pos)-2,mapFormatCaret(src,dst,pos)),'42');
});

test('pinned Rust Wasm formatter accepts and round-trips both Result/Option examples', async () => {
  for (const name of ['result-option','result-option-end']) {
    const input = await readFile(new URL('../examples/preview/' + name + '.atto', import.meta.url), 'utf8');
    const first = await fmt(input);
    assert.equal(first.ok,true,name+': '+JSON.stringify(first));
    assert.equal((await fmt(first.formatted)).formatted,first.formatted);
    assert.match(first.formatted,/return Ok\(port\);/);
    if (name === 'result-option-end') {
      assert.match(first.formatted,/fnc validate_port\(int port\) -> Result<int, string>\n/);
      assert.match(first.formatted,/fnc optional_port\(bool present\) -> Option<int> ::\n/);
    }
  }
});
test('compact end-delimited function rejects missing body separator', async () => {
  const compact = await fmt('fnc identity(int x) -> Result<int, string> :: return Ok(x); end\n');
  assert.equal(compact.ok,true,JSON.stringify(compact));
  assert.match(compact.formatted,/-> Result<int, string> ::\n  return Ok\(x\);\nend/);
  assert.equal((await fmt(compact.formatted)).formatted,compact.formatted);
  assert.equal((await fmt('fnc identity(int x) -> int return x; end\n')).ok,false);
});
