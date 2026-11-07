import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostic, sourceOffset, lineNumbers, caretPosition, formatWasm, compilerDiagnosticGuidance } from '../src/ui.js';

test('compiler diagnostics normalize location and never interpret content as markup', () => {
  const item = formatDiagnostic({ line: 2, column: 5, message: '<img onerror="alert(1)">' });
  assert.deepEqual(item, { line: 2, column: 5, message: '<img onerror="alert(1)">' });
  assert.deepEqual(formatDiagnostic(null), { line: 1, column: 1, message: 'E_COMPILER: unknown error' });
  assert.equal(formatDiagnostic({ line: -2, column: Infinity, message: 'bad' }).line, 1);
  assert.equal(formatDiagnostic({ message: 'a'.repeat(10000) }).message.length, 4096);
});
test('line and column navigation clamps invalid and out-of-range positions', () => {
  const s = 'hello\nworld\n';
  assert.equal(sourceOffset(s,2,3),8);
  assert.equal(sourceOffset(s,-1,Infinity),0);
  assert.equal(sourceOffset(s,999,999),s.length);
  assert.deepEqual(caretPosition(s,8),{line:2,column:3});
  assert.deepEqual(caretPosition(s,s.length),{line:3,column:1});
});
test('line gutter is bounded for oversized or adversarial source', () => {
  assert.equal(lineNumbers('a\nb\n'), '1\n2\n3\n');
  assert.equal(lineNumbers('\n'.repeat(5000),20).split('\n').length,21);
});
test('Wasm metadata never exposes more than 32 preview bytes', () => {
  assert.equal(formatWasm(null), 'No compiled artifact yet.');
  const bytes = new Uint8Array(70);bytes.set([0,97,115,109]);
  const text = formatWasm(bytes);
  assert.match(text,/Size: 70 bytes/);
  assert.match(text,/00 61 73 6d/);
  assert.match(text,/preview limited to 32 bytes/);
  assert.equal(text.split('bytes:\n')[1].split('\n')[0].trim().split(' ').length,32);
});

test('unsupported top-level define explains deployed capability without hiding compiler error', () => {
  const missing = {line: 6, column: 1, message: "E_UNSUPPORTED: top-level 'define' is not supported by the browser compiler yet"};
  assert.match(compilerDiagnosticGuidance(missing), /deployed compiler does not support top-level define/);
  assert.match(compilerDiagnosticGuidance(missing), /no Wasm was generated/);
  assert.equal(compilerDiagnosticGuidance({message:'E_IMMUTABLE: cannot reassign val'}), null);
  assert.equal(compilerDiagnosticGuidance({message:'E_UNSUPPORTED: actor send is not supported'}), null);
  assert.equal(compilerDiagnosticGuidance({message:'<script>define</script>'}), null);
  assert.equal(compilerDiagnosticGuidance(null), null);
});
