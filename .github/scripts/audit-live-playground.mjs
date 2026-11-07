/**
 * Read-only HTTPS postflight for the publicly deployed AttoLang playground.
 * PASS is only live HTTP / deployed-asset verification; it does NOT certify
 * admin settings, reviews, tenant isolation or unpublished compiler source.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ASSETS, SITE_ASSETS } from './package-playground.mjs';

export const PUBLIC_ORIGIN = 'https://atto-lang.github.io';
export const FORBIDDEN = Object.freeze([
  '/play/BUILD_RECEIPT.md',
  '/play/package.json',
  '/play/package-lock.json',
  '/play/tests/browser-e2e.mjs',
  '/play/tests/compiler.test.mjs',
  '/play/tests/ui.test.mjs',
  '/play/scripts/vendor-compiler.sh',
  '/.github/workflows/approved-playground-pages.yml'
]);
const packaged = new Set(ASSETS.map(asset => '/play/' + asset));
if (new Set(FORBIDDEN).size !== FORBIDDEN.length ||
    FORBIDDEN.some(path => packaged.has(path))) {
  throw new Error('NOT_CERTIFIED: forbidden URL overlaps the canonical release allowlist');
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = (s, n) => typeof s === 'string' &&
  new RegExp('^[0-9a-f]{' + n + '}$').test(s);
const mime = response => response.headers?.get?.('content-type')?.toLowerCase() ?? '';

export async function auditLivePlayground({
  fetchImpl = fetch,
  origin = PUBLIC_ORIGIN,
  expectedCommit,
  approvedCompilerSha256
} = {}) {
  if (origin !== PUBLIC_ORIGIN) throw new Error('NOT_CERTIFIED: unexpected public origin');
  if (!hex(expectedCommit, 40) || !hex(approvedCompilerSha256, 64))
    throw new Error('NOT_CERTIFIED: approved commit and binary SHA-256 are required');
  const get = async path => {
    const response = await fetchImpl(origin + path, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (!response || response.redirected === true || !Number.isInteger(response.status))
      throw new Error('NOT_CERTIFIED: invalid/redirected response: ' + path);
    return response;
  };
  // Probe forbidden paths even if the manifest/asset check fails. A missing
  // release manifest must never mask an independently exposed source path.
  const failures = [];
  let manifestBytes;
  try {
  const manifestResponse = await get('/release-manifest.json');
  if (manifestResponse.status !== 200 || !mime(manifestResponse).includes('json'))
    throw new Error('NOT_CERTIFIED: missing or wrongly typed release manifest');
  manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  if (manifestBytes.length < 10 || manifestBytes.length > 256 * 1024)
    throw new Error('NOT_CERTIFIED: invalid manifest size');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || manifest.schema !== 1 ||
      manifest.source_commit !== expectedCommit ||
      manifest.compiler_sha256 !== approvedCompilerSha256 ||
      !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets))
    throw new Error('NOT_CERTIFIED: incorrect/unsigned release claims');
  const siteNames = [...SITE_ASSETS].sort();
  if (!manifest.site_assets || typeof manifest.site_assets !== 'object' ||
      Array.isArray(manifest.site_assets) ||
      JSON.stringify(Object.keys(manifest.site_assets).sort()) !== JSON.stringify(siteNames))
    throw new Error('NOT_CERTIFIED: homepage manifest is not the exact approved site allowlist');
  const assetNames = ASSETS.map(name => 'play/' + name).sort();
  if (JSON.stringify(Object.keys(manifest.assets).sort()) !== JSON.stringify(assetNames))
    throw new Error('NOT_CERTIFIED: missing or unexpected released files');
  for (const name of assetNames) {
    const entry = manifest.assets[name];
    if (!entry || !Number.isSafeInteger(entry.size) ||
        entry.size < 1 || entry.size > 1024 * 1024 || !hex(entry.sha256, 64))
      throw new Error('NOT_CERTIFIED: invalid manifest entry ' + name);
    const response = await get('/' + name);
    if (response.status !== 200) throw new Error('NOT_CERTIFIED: missing released asset ' + name);
    if (name.endsWith('.wasm') && !/^application\/wasm(?:\s*;|$)/.test(mime(response)))
      throw new Error('NOT_CERTIFIED: Wasm MIME mismatch ' + name);
    if (name.endsWith('.js') && !/(?:javascript|ecmascript)/.test(mime(response)))
      throw new Error('NOT_CERTIFIED: module JS MIME mismatch ' + name);
    if (name.endsWith('.css') && !mime(response).startsWith('text/css'))
      throw new Error('NOT_CERTIFIED: CSS MIME mismatch ' + name);
    if (name.endsWith('.json') && !mime(response).startsWith('application/json'))
      throw new Error('NOT_CERTIFIED: JSON MIME mismatch ' + name);
    if (name.endsWith('.html') && !mime(response).startsWith('text/html'))
      throw new Error('NOT_CERTIFIED: HTML MIME mismatch ' + name);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
      throw new Error('NOT_CERTIFIED: deployed asset digest mismatch ' + name);
    if (name.endsWith('.wasm')) {
      if (!WebAssembly.validate(bytes))
        throw new Error('NOT_CERTIFIED: invalid reviewed Wasm ' + name);
      const wasmModule = new WebAssembly.Module(bytes);
      if (WebAssembly.Module.imports(wasmModule).length !== 0)
        throw new Error('NOT_CERTIFIED: forbidden Wasm host imports ' + name);
    }
    if (name === 'play/public/atto_compiler.wasm' &&
        sha256(bytes) !== approvedCompilerSha256)
      throw new Error('NOT_CERTIFIED: unapproved deployed compiler');
    if (name === 'play/index.html') {
      const html = bytes.toString('utf8');
      if (!/http-equiv=["']Content-Security-Policy["']/i.test(html) ||
          !html.includes("default-src 'none'") ||
          !html.includes("connect-src 'self'") ||
          !html.includes("'wasm-unsafe-eval'") ||
          html.includes("'unsafe-inline'"))
        throw new Error('NOT_CERTIFIED: missing or permissive playground CSP');
    }
  }
  // GitHub Pages maps /play/ to play/index.html. Verify that visitors
  // actually receive the exact reviewed file, not a stale branch build.
  const route = await get('/play/');
  if (route.status !== 200 || !mime(route).startsWith('text/html'))
    throw new Error('NOT_CERTIFIED: /play/ is unavailable or not HTML');
  const routeBytes = Buffer.from(await route.arrayBuffer());
  const index = manifest.assets['play/index.html'];
  if (routeBytes.length !== index.size || sha256(routeBytes) !== index.sha256)
    throw new Error('NOT_CERTIFIED: /play/ route differs from reviewed index.html');
  const editor = routeBytes.toString('utf8');
  if (!/id=["']source["']/.test(editor) || !editor.includes('src/app.js'))
    throw new Error('NOT_CERTIFIED: /play/ lacks the reviewed compiler editor');
  // Root marketing assets are part of the same reviewed release.
  for (const name of siteNames) {
    const entry = manifest.site_assets[name];
    if (!entry || !Number.isSafeInteger(entry.size) ||
        entry.size < 1 || entry.size > 1024 * 1024 || !hex(entry.sha256, 64))
      throw new Error('NOT_CERTIFIED: invalid homepage manifest entry ' + name);
    const response = await get('/' + name);
    if (response.status !== 200)
      throw new Error('NOT_CERTIFIED: missing approved homepage asset ' + name);
    if (name.endsWith('.html') && !mime(response).startsWith('text/html'))
      throw new Error('NOT_CERTIFIED: homepage HTML MIME mismatch ' + name);
    if (name.endsWith('.css') && !mime(response).startsWith('text/css'))
      throw new Error('NOT_CERTIFIED: homepage CSS MIME mismatch ' + name);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
      throw new Error('NOT_CERTIFIED: homepage asset digest mismatch ' + name);
  }
  const home = await get('/');
  if (home.status !== 200 || !mime(home).startsWith('text/html'))
    throw new Error('NOT_CERTIFIED: homepage route unavailable');
  const homeBytes = Buffer.from(await home.arrayBuffer());
  if (homeBytes.length !== manifest.site_assets['index.html'].size ||
      sha256(homeBytes) !== manifest.site_assets['index.html'].sha256)
    throw new Error('NOT_CERTIFIED: homepage route differs from reviewed root index.html');
  } catch (error) {
    failures.push(error.message);
  }
  for (const path of FORBIDDEN) {
    try {
      const response = await get(path);
      if (![404, 410].includes(response.status))
        throw new Error('NOT_CERTIFIED: build/test path exposed ' + path + ' (HTTP ' + response.status + ')');
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return Object.freeze({
    status: 'LIVE_HTTP_VERIFIED',
    source_commit: expectedCommit,
    compiler_sha256: approvedCompilerSha256,
    manifest_sha256: sha256(manifestBytes),
    checked_assets: ASSETS.length,
    checked_homepage_assets: SITE_ASSETS.length,
    forbidden_probes: FORBIDDEN.length
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await auditLivePlayground({
      expectedCommit: process.env.EXPECTED_SOURCE_SHA,
      approvedCompilerSha256: process.env.ATTO_PUBLIC_COMPILER_SHA256
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error('NOT_CERTIFIED: ' + error.message);
    process.exitCode = 1;
  }
}
