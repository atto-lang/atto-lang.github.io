import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS = Object.freeze([
  'index.html',
  'styles.css',
  'showcase/index.html',
  'showcase/styles.css',
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
  'src/guest-import-abi.js',
  'src/actor-host.js',
  'src/actor-abi-version.js',
  'src/wasm-memory-admission.js',
  'src/actor-worker.js',
  'src/guest.js',
  'src/state-runtime.js',
  'src/state-guest-profile.js',
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
  'examples/preview/binary-data.atto',
  'examples/preview/bitwise.atto',
  'examples/preview/pointers.atto',
  'examples/preview/pipe-rpipe.atto',
  'examples/preview/functional-pipelines.atto',
  'examples/preview/channel-operators.atto',
  'examples/preview/collections.atto',
  'examples/preview/supervisor-boundaries.atto',
  'examples/preview/nested-actors.atto',
  'examples/preview/http-fs.atto',
  'examples/preview/permissions.atto',
  'examples/preview/actor-isolation.atto',
  'examples/preview/annotations.atto',
  'examples/preview/ownership.atto',
  'examples/preview/typed-messages.atto',
  'examples/preview/error-propagation.atto',
  'examples/preview/pattern-collections.atto',
  'examples/preview/concurrency.atto',
  'examples/preview/boolean-operators.atto',
  'examples/preview/generators.atto',
  'examples/preview/async-iterators.atto',
  'examples/preview/tasks-async.atto',
  'examples/preview/match-values.atto',
  'examples/preview/fib-match.atto',
  'examples/preview/match-types-is.atto',
  'examples/preview/use-using-with.atto',
  'examples/preview/modules.atto',
  'examples/preview/namespaces.atto',
  'examples/preview/actor-receiver-methods.atto',
  'examples/preview/stdio-channels.atto',
  'examples/preview/traits-interfaces.atto',
  'examples/preview/diamond-inheritance.atto',
  'examples/preview/data-shapes.atto',
  'examples/preview/effects.atto',
  'examples/preview/lexical-scope-pure.atto',
  'examples/preview/suspends.atto',
  'examples/preview/nio-reactor.atto',
  'examples/preview/mutex-locks.atto',
  'examples/preview/mutable-state.atto',
  'examples/preview/state-containers.atto',
  'examples/preview/borrow-checking.atto',
  'examples/preview/borrow-arc-send-atomic-box.atto',
  'examples/preview/dyn-interfaces.atto',
  'examples/preview/box-ownership.atto',
  'examples/preview/arc-sharing.atto',
  'examples/preview/sends-capabilities.atto',
  'examples/preview/atomic-ordering.atto',
  'examples/preview/weak-pin-lifetimes.atto',
  'examples/preview/borrow-typed.atto',
  'examples/preview/borrow-lifetimes.atto',
  'examples/preview/borrow-mut.atto',
  'examples/preview/borrow-suspension.atto',
  'examples/preview/sendable-serializable.atto',
  'examples/preview/freeze-share.atto',
  'examples/preview/copy-deep-copy.atto',
  'examples/preview/shared-rwlock.atto',
  'examples/preview/guard.atto',
  'examples/preview/lambdas.atto',
  'examples/preview/lambdas-advanced.atto',
  'examples/preview/closures-functors.atto',
  'examples/preview/routine.atto',
  'examples/preview/callable-body-styles.atto',
  'examples/preview/visibility-modifiers.atto',
  'examples/preview/function-pipeline.atto',
  'examples/preview/actor-pipeline.atto',
  'examples/preview/supervisor-mailbox.atto',
  'examples/preview/trap.atto',
  'examples/preview/defer-recover.atto',
  'examples/preview/result-option.atto',
  'examples/preview/result-option-end.atto',
  'examples/preview/channel-bounded.atto',
  'examples/preview/channel-probe.atto',
  'examples/preview/channel-unbounded.atto',
  'examples/preview/rx-observable.atto',
  'examples/preview/rx-interop.atto',
  'examples/preview/annotations-override.atto',
  'examples/preview/result-patterns-typed.atto',
  'examples/preview/typed-actor-messaging.atto',
  'examples/preview/unary-actor-replies.atto',
  'examples/preview/caret-return.atto',
  'examples/preview/optional-omittable.atto',
  'examples/preview/susp-shorthand.atto',
  'examples/preview/timers-sleep.atto',
  'examples/preview/symbols.atto',
  'examples/preview/generic-defaults.atto',
  'examples/preview/collection-factories.atto',
  'examples/preview/local-mutability.atto',
  'examples/preview/sealed-classes.atto',
  'examples/preview/typeof-operator.atto',
  'examples/preview/ffi-aot.atto',
  'examples/preview/error-traits.atto',
  'examples/preview/enum-methods.atto',
  // Only six reviewed browser-side architecture files may ship.
  'architecture/index.html',
  'architecture/styles.css',
  'architecture/data.js',
  'architecture/app.js',
  'architecture/receipt.js',
  'architecture/probe-worker.js',
]);

// Only these rendered, reviewed documentation assets may accompany the protected
// playground release. Never package arbitrary Jekyll output or source files.
export function validateBrandSvg(source,name) {
  const reject=()=>{throw new Error("Unsafe Atto brand SVG: "+name)};
  if(!["assets/atto-logo.svg","assets/atto-mark.svg"].includes(name)||
     typeof source!=="string"||source.length>16000||
     !/^\s*<svg\b/.test(source)||!/<\/svg>\s*$/.test(source)||
     /<!|<\?|&|url\s*\(|@import|javascript\s*:|data\s*:/i.test(source))reject();
  const allowed={svg:["xmlns","viewBox","role","aria-labelledby"],title:["id"],desc:["id"],rect:["x","y","width","height","rx","fill"],path:["fill","fill-rule","d"]};
  const opened=[];
  for(const m of source.matchAll(/<\s*(\/?)([a-z][a-z0-9-]*)([^<>]*)>/gi)){
    const closing=m[1]==="/",tag=m[2],raw=m[3];
    if(!Object.hasOwn(allowed,tag))reject();
    if(closing){if(raw.trim())reject();continue;}
    opened.push(tag);
    const attrSrc=raw.replace(/\/\s*$/,""),rx=/\s+([a-z][\w:-]*)="([^"]*)"/gi;
    const attrs=[...attrSrc.matchAll(rx)];
    if(attrSrc.replace(rx,"").trim())reject();
    const seen=new Set();
    for(const a of attrs){
      const key=a[1],value=a[2];
      if(seen.has(key)||!allowed[tag].includes(key)||/[<>&]/.test(value))reject();
      seen.add(key);
      if(key==="fill"&&!["#0b1a34","#7175fb","#fff"].includes(value))reject();
      if(key==="fill-rule"&&value!=="evenodd")reject();
      if(key==="xmlns"&&value!=="http://www.w3.org/2000/svg")reject();
      if(key==="role"&&value!=="img")reject();
      if(key==="d"&&(!value.startsWith("M")||!/^[MZLHVCSQTAmlhvcsqta0-9,.\s+\-]+$/.test(value)))reject();
    }
    if(tag==="svg"&&(!seen.has("xmlns")||!seen.has("viewBox")||!seen.has("role")))reject();
    if(tag==="path"&&(!seen.has("fill")||!seen.has("d")))reject();
  }
  for(const [tag,count] of [["svg",1],["title",1],["desc",1],["rect",name.endsWith("mark.svg")?1:0]]){
    if(opened.filter(x=>x===tag).length!==count)reject();
  }
  if(opened.filter(x=>x==="path").length!==2)reject();
  const rest=source.replace(/<(title|desc)\b[^>]*>[^<]*<\/\1>/g,"").replace(/<\s*\/?[a-z][a-z0-9-]*[^<>]*>/gi,"").trim();
  if(rest)reject();
  const vb=source.match(/\bviewBox="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
  if(!vb||vb.length!==4||!vb.every(Number.isFinite)||vb[2]<=0||vb[3]<=0)reject();
  if(name.endsWith("mark.svg")&&vb[2]!==vb[3])reject();
  return true;
}


/** Approved PNG derivatives of the fixed Atto mascot, pinned to exact bytes. */
export function validateBrandPng(bytes, name) {
  const pinned = {
    'assets/favicon-32x32.png': [32,32,8,'dabefc06a9487b7d3ddc17c287ad4e98808c6cdd0d1965998609b376208a46aa'],
    'assets/apple-touch-icon.png': [180,180,8,'16337ad7368b4879df3933c98830d04b78adc5c6db00ebfc1f09d1283923d0fc'],
    'assets/atto-social-preview.png': [1200,630,2,'cb031083275f6f5d8e6113b682d64d7be3de26f8677d556b27c6660452bfc4ec']
  }[name];
  if (!pinned || !Buffer.isBuffer(bytes) || bytes.length < 70 ||
      bytes.length > 200000 ||
      bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== pinned[0] || bytes.readUInt32BE(20) !== pinned[1] ||
      bytes.readUInt8(24) !== pinned[2] || ![2,3,6].includes(bytes.readUInt8(25)) ||
      bytes.readUInt32BE(bytes.length-12) !== 0 ||
      bytes.toString('ascii',bytes.length-8,bytes.length-4) !== 'IEND' ||
      createHash('sha256').update(bytes).digest('hex') !== pinned[3]) {
    throw new Error('Invalid or altered Atto brand PNG: ' + name);
  }
}

export const PUBLICATION_ASSETS = Object.freeze([
  'index.html',
  'atto-the-pl/index.html',
  // Reviewed presentation assets, never an entire directory wildcard.
  'deck/index.html',
  'deck/deck.css',
  'deck/deck.js',
  'assets/site.css',
  'assets/atto-logo.svg',
  'assets/atto-mark.svg',
  'assets/favicon-32x32.png',
  'assets/apple-touch-icon.png',
  'assets/atto-social-preview.png',
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
    if (name.startsWith('assets/') && name.endsWith('.png')) validateBrandPng(bytes,name);
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
      // Preserve exactly one reviewed local script for slide navigation.
      // All other publication pages remain strictly script-free.
      let validationHtml = inspected;
      if (name === 'deck/index.html') {
        const trustedTag = '<script src="./deck.js" defer></script>';
        if (inspected.split(trustedTag).length !== 2) {
          throw new Error('Missing or duplicate deck entry script');
        }
        validationHtml = inspected.replace(trustedTag, '');
      }
      if (!/^<!doctype html>/i.test(validationHtml.trimStart()) ||
          /<script\b|<iframe\b|<object\b|<embed\b/i.test(validationHtml) ||
          /<[^>]+\bon[a-z]+\s*=/i.test(validationHtml) ||
          /javascript\s*:/i.test(validationHtml)) {
        throw new Error('Unsafe or malformed static publication HTML: ' + name);
      }
      releaseBytes = Buffer.from(inspected, 'utf8');
    } else if (name.endsWith('.svg')) {
      if (name === 'assets/atto-logo.svg' || name === 'assets/atto-mark.svg') {
        validateBrandSvg(content, name);
      }
      if (!/<svg\b/.test(content) || !/<title\b/.test(content) || !/<desc\b/.test(content) ||
          /<script\b|<foreignObject\b|(?:href|xlink:href)\s*=|<iframe\b|<[^>]+\bon[a-z]+\s*=|javascript\s*:/i.test(content)) {
        throw new Error('Unsafe publication SVG: ' + name);
      }
    } else if (name.endsWith('.css')) {
      if (/@import\b|url\s*\(/i.test(content)) throw new Error('External CSS dependency is forbidden: ' + name);
    } else if (name.endsWith('.js')) {
      // Restrict executable website JS to this audited, small, offline-only file.
      if (name !== 'deck/deck.js' || bytes.length > 16384 ||
          /\b(?:eval|Function)\s*\(|document\.write\s*\(|\.innerHTML\s*=|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(/.test(content)) {
        throw new Error('Unsafe deck publication script: ' + name);
      }
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
