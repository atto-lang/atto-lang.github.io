/**
 * Regenerate fixtures/task-guests/*.wasm and PROVENANCE.json from Atto
 * source with a candidate Rust/Wasm compiler running in createCompiler()
 * (the same path the browser uses). Test evidence only, never the public pin.
 *
 *   node tools/make-task-guest-fixtures.mjs /abs/atto_compiler.wasm <compiler-source-id>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCompiler } from '../src/compiler.js';

const [compilerPath, sourceId] = process.argv.slice(2);
if (!compilerPath?.startsWith('/') || !sourceId) {
  console.error('usage: make-task-guest-fixtures.mjs /abs/atto_compiler.wasm <compiler-source-id>');
  process.exit(2);
}
const play = new URL('../', import.meta.url);
const dir = new URL('fixtures/task-guests/', play);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const SOURCES = {
  'tasks-async': 'examples/preview/tasks-async.atto',
  'timers-sleep': 'examples/preview/timers-sleep.atto',
  'borrow-suspension': 'examples/preview/borrow-suspension.atto',
  'interleaving': 'fixtures/task-guests/interleaving.atto',
  'actors-interleave': 'fixtures/task-guests/actors-interleave.atto',
};

const compilerBytes = await readFile(compilerPath);
const compiler = await createCompiler(compilerBytes);
const guests = {};
for (const [name, source] of Object.entries(SOURCES)) {
  const text = await readFile(new URL(source, play), 'utf8');
  const compiled = compiler.compile(text);
  if (!compiled.ok) throw new Error(`${name}: ${compiled.message ?? JSON.stringify(compiled)}`);
  await writeFile(new URL(`${name}.wasm`, dir), compiled.wasm);
  guests[name] = { source, source_sha256: sha(Buffer.from(text)), wasm_sha256: sha(compiled.wasm), bytes: compiled.wasm.length };
}
await writeFile(new URL('PROVENANCE.json', dir), JSON.stringify({
  note: 'atto.task.v1 guests compiled by an UNPUBLISHED candidate atto-source.rs compiler (rustc 1.85.1, opt-level=z, CI cargo rustc cdylib recipe) running in createCompiler(). Test evidence only; not the public pin.',
  compiler_source: sourceId,
  compiler_sha256: sha(compilerBytes),
  compiler_bytes: compilerBytes.length,
  guests,
}, null, 2) + '\n');
console.log(JSON.stringify(guests, null, 1));
