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
  'src/actor-host.js',
  'src/wasm-memory-admission.js',
  'src/actor-worker.js',
  'src/guest.js',
  'src/worker-task.js',
  'public/atto_compiler.wasm',
  'public/atto_compiler.receipt.json',
  'public/oreslang_format.wasm',
  'public/oreslang_format.receipt.json',
  'docs/COMPILER_CONTRACT.md',
  'examples/actors.atto',
  'examples/classes.atto',
  'examples/conditions.atto',
  'examples/enums.atto',
  'examples/error.atto',
  'examples/fib.atto',
  'examples/hello.atto',
  'examples/overflow.atto',
  'examples/primes.atto',
  'examples/preview/boolean-operators.atto',
  'examples/preview/generators.atto',
  'examples/preview/async-iterators.atto',
  'examples/preview/tasks-async.atto',
  'examples/preview/match-values.atto',
  'examples/preview/match-types-is.atto',
  'examples/preview/use-using-with.atto',
  'examples/preview/function-pipeline.atto',
  'examples/preview/actor-pipeline.atto',
  'examples/preview/supervisor-mailbox.atto',
  'examples/preview/trap.atto',
  'examples/preview/result-option.atto',
  'examples/preview/result-option-end.atto',
  'examples/preview/channel-bounded.atto',
  'examples/preview/channel-probe.atto',
  'examples/preview/channel-unbounded.atto',
  'examples/preview/rx-observable.atto',
  'examples/preview/rx-interop.atto',
  'BUILD_RECEIPT.md',
]);

// Only these rendered, reviewed documentation assets may accompany the protected
// playground release. Never package arbitrary Jekyll output or source files.
export const PUBLICATION_ASSETS = Object.freeze([
  'index.html',
  'assets/site.css',
  'whitepapers/index.html',
  'whitepapers/README.html',
  'whitepapers/STATUS.html',
  'whitepapers/AUDIT.html',
  'whitepapers/assets/css/whitepapers.css',
  'whitepapers/01-language-design.html',
  'whitepapers/02-compiler-architecture.html',
  'whitepapers/03-memory-ownership-and-zero-gc.html',
  'whitepapers/04-actor-runtime-and-concurrency.html',
  'whitepapers/05-portable-aot-and-backends.html',
  'whitepapers/06-type-system-and-static-guarantees.html',
  'whitepapers/07-execution-context-and-scheduling.html',
  'whitepapers/08-durable-actors-and-hot-upgrades.html',
  'whitepapers/09-multi-tenant-isolation-and-security.html',
  'whitepapers/10-performance-and-conformance.html',
  'whitepapers/11-async-programming-and-structured-concurrency.html',
  'whitepapers/assets/01-semantic-layers.svg',
  'whitepapers/assets/02-compiler-pipeline.svg',
  'whitepapers/assets/03-memory-ownership.svg',
  'whitepapers/assets/04-actor-runtime.svg',
  'whitepapers/assets/05-backend-conformance.svg',
  'whitepapers/assets/06-type-guarantees.svg',
  'whitepapers/assets/07-execution-context.svg',
  'whitepapers/assets/08-hot-upgrade.svg',
  'whitepapers/assets/09-tenant-security.svg',
  'whitepapers/assets/10-performance-evidence.svg',
  'whitepapers/assets/11-structured-concurrency.svg',
]);

export async function packagePlayground({
  root = fileURLToPath(new URL('../../play/', import.meta.url)),
  outputRoot = fileURLToPath(new URL('../../', import.meta.url)),
  approvedSha256 = null,
  sourceCommit = null,
  renderedSiteRoot = null
} = {}) {
  const source = resolve(root), workspace = resolve(outputRoot), destination = join(workspace, '_site');
  if (source !== join(workspace, 'play')) throw new Error('Unexpected public source directory');
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid release commit');
  if (typeof renderedSiteRoot !== 'string' || !renderedSiteRoot) {
    throw new Error('Reviewed Jekyll publication build is required');
  }
  const rendered = resolve(renderedSiteRoot);
  if (!rendered.startsWith(workspace + '/') || rendered === destination || rendered.startsWith(destination + '/')) {
    throw new Error('Rendered publication root must be a separate workspace directory');
  }
  const renderedStat = await lstat(rendered);
  if (!renderedStat.isDirectory() || renderedStat.isSymbolicLink()) {
    throw new Error('Rendered publication root must be a real directory');
  }
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
  const publicationEntries = [];
  for (const name of PUBLICATION_ASSETS) {
    let current = rendered;
    const segments = name.split('/');
    for (let i = 0; i < segments.length; i++) {
      current = join(current, segments[i]);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Refusing publication symlink: ' + name);
      if (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        throw new Error('Not a regular publication asset: ' + name);
      }
    }
    const bytes = await readFile(current);
    if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('Invalid publication asset size: ' + name);
    const content = bytes.toString('utf8');
    let releaseBytes = bytes;
    if (name.endsWith('.html')) {
      // The default Jekyll theme adds AnchorJS plus an inline initializer to
      // the rendered root page. The protected release serves a static homepage:
      // remove every script element from root HTML, then assert no executable
      // HTML remains. Never strip scripts from the white-paper pages; reject
      // unexpected active markup there instead.
      let inspected = content;
      if (name === 'index.html') {
        inspected = inspected.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_tag, attrs, payload) => {
          if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) JSON.parse(payload);
          return '';
        });
        // Jekyll's theme stylesheet is not part of the separate protected
        // playground artifact. Use the allowlisted local marketing CSS
        // instead of allowing broken or remote stylesheet references.
        inspected = inspected.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, '');
        if (!/<\/head\s*>/i.test(inspected)) {
          throw new Error('Publication root must contain a head element');
        }
        inspected = inspected.replace(/<\/head\s*>/i,
          '<link rel="stylesheet" href="/assets/site.css">\n</head>');
      }
      if (!/^<!doctype html>/i.test(inspected.trimStart()) ||
          /<script\b|<iframe\b|<object\b|<embed\b/i.test(inspected) ||
          /<[^>]+\bon[a-z]+\s*=/i.test(inspected) ||
          /javascript\s*:/i.test(inspected)) {
        throw new Error('Unsafe or malformed static publication HTML: ' + name);
      }
      releaseBytes = Buffer.from(inspected, 'utf8');
    } else if (name.endsWith('.svg')) {
      if (!/<svg\b/.test(content) || !/<title\b/.test(content) || !/<desc\b/.test(content) ||
          /<script\b|<foreignObject\b|(?:href|xlink:href)\s*=|<iframe\b|<[^>]+\bon[a-z]+\s*=|javascript\s*:/i.test(content)) {
        throw new Error('Unsafe publication SVG: ' + name);
      }
    } else if (name.endsWith('.css')) {
      if (/@import\b|url\s*\(/i.test(content)) throw new Error('External CSS dependency is forbidden: ' + name);
    }
    publicationEntries.push({name, bytes: releaseBytes});
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
  for (const entry of publicationEntries) {
    const relative = entry.name;
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
    approvedSha256:process.env.APPROVED_COMPILER_SHA256 || null,
    renderedSiteRoot:process.env.ATTO_RENDERED_SITE_ROOT || null
  });
  console.log('PASS: staged ' + Object.keys(manifest.assets).length + ' allowlisted assets, digest ' + manifest.compiler_sha256);
}
