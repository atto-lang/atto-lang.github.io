import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS = Object.freeze([
  'index.html',
  'styles.css',
  'src/app.js',
  'src/editor.js',
  'src/ui.js',
  'src/program-picker.js',
  'src/saved-programs.js',
  'src/syntax-highlight.js',
  'src/formatter-worker.js',
  'src/formatter-runtime.js',
  'src/formatter-pin.js',
  'src/compiler-pin.js',
  'src/compiler.js',
  'src/compiler-worker.js',
  'src/runner-worker.js',
  'src/guest.js',
  'src/worker-task.js',
  'public/atto_compiler.wasm',
  'public/atto_compiler.receipt.json',
  'public/oreslang_format.wasm',
  'public/oreslang_format.receipt.json',
  'docs/COMPILER_CONTRACT.md',
  'examples/conditions.atto',
  'examples/error.atto',
  'examples/fib.atto',
  'examples/hello.atto',
  'examples/overflow.atto',
  'examples/primes.atto',
  'BUILD_RECEIPT.md',
]);

export async function packagePlayground({
  root = fileURLToPath(new URL('../../play/', import.meta.url)),
  outputRoot = fileURLToPath(new URL('../../', import.meta.url)),
  approvedSha256 = null,
  sourceCommit = null
} = {}) {
  const source = resolve(root), workspace = resolve(outputRoot), destination = join(workspace, '_site');
  if (source !== join(workspace, 'play')) throw new Error('Unexpected public source directory');
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid release commit');
  const entries = [];
  for (const name of ASSETS) {
    let current = source;
    const segments = name.split('/');
    for (let i = 0; i < segments.length; i++) {
      current = join(current, segments[i]);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Refusing symlink in release asset: ' + name);
      if (i === segments.length-1 ? !stat.isFile() : !stat.isDirectory()) throw new Error('Not a regular asset: ' + name);
    }
    const bytes = await readFile(current);
    if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Invalid asset size: ' + name);
    entries.push({name, bytes});
  }
  const byName = n => entries.find(e => e.name === n).bytes;
  const wasm = byName('public/atto_compiler.wasm');
  const receipt = JSON.parse(byName('public/atto_compiler.receipt.json').toString('utf8'));
  const actual = createHash('sha256').update(wasm).digest('hex');
  const pin = byName('src/compiler-pin.js').toString('utf8');
  if (receipt.schema !== 'atto.browser.compiler.vendor.v1' ||
      receipt.compiler_sha256 !== actual || receipt.compiler_bytes !== wasm.length ||
      !pin.includes("COMPILER_SHA256 = '" + actual + "'") ||
      !pin.includes('COMPILER_BYTES = ' + wasm.length) ||
      !WebAssembly.validate(wasm)) throw new Error('Compiler binary/receipt/pin verification failed');
  const mod = new WebAssembly.Module(wasm);
  if (WebAssembly.Module.imports(mod).length) throw new Error('Public compiler must have no imports');
  const formatter=byName('public/oreslang_format.wasm');
  const fmtReceipt=JSON.parse(byName('public/oreslang_format.receipt.json').toString('utf8'));
  const fmtHash=createHash('sha256').update(formatter).digest('hex');
  const fmtPin=byName('src/formatter-pin.js').toString('utf8');
  if (!WebAssembly.validate(formatter) ||
      fmtReceipt.schema!=='atto.browser.formatter.vendor.v1' ||
      fmtReceipt.wasm_sha256!==fmtHash ||
      fmtReceipt.wasm_bytes!==formatter.length ||
      !fmtPin.includes("FORMATTER_SHA256 = '" + fmtHash + "'") ||
      !fmtPin.includes('FORMATTER_BYTES = ' + formatter.length) ||
      !fmtPin.includes("FORMATTER_SOURCE_COMMIT = '" + fmtReceipt.source_head + "'")) {
    throw new Error('Formatter binary/receipt/pin verification failed');
  }
  const formatterMod=new WebAssembly.Module(formatter);
  if(WebAssembly.Module.imports(formatterMod).length) throw new Error('Formatter must have no imports');
  for(const name of ['memory','oresfmt_alloc','oresfmt_free','oresfmt_format']) {
    if(!WebAssembly.Module.exports(formatterMod).some(x=>x.name===name))
      throw new Error('Formatter export missing: '+name);
  }
  if (approvedSha256 !== null && (
      !/^[a-f0-9]{64}$/.test(approvedSha256) || approvedSha256 !== actual)) {
    throw new Error('Public compiler SHA-256 has not been approved');
  }
  const prior = await lstat(destination).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (prior?.isSymbolicLink()) throw new Error('Release destination must not be a symlink');
  await rm(destination, { recursive: true, force: true });
  const paths = {};
  for (const entry of entries) {
    const relative = 'play/' + entry.name;
    const target = join(destination, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, {flag:'wx'});
    paths[relative] = {size:entry.bytes.length, sha256:createHash('sha256').update(entry.bytes).digest('hex')};
  }
  const manifest = {schema:1, source_commit:sourceCommit, compiler_sha256:actual, assets:paths};
  await writeFile(join(destination,'release-manifest.json'), JSON.stringify(manifest,null,2)+'\n', {flag:'wx'});
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await packagePlayground({
    sourceCommit:process.env.SOURCE_COMMIT || null,
    approvedSha256:process.env.APPROVED_COMPILER_SHA256 || null
  });
  console.log('PASS: staged ' + Object.keys(manifest.assets).length + ' allowlisted assets, digest ' + manifest.compiler_sha256);
}
