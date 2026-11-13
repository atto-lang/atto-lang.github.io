/**
 * Read-only HTTPS postflight for the publicly deployed AttoLang playground.
 * PASS is only live HTTP / deployed-asset verification; it does NOT certify
 * admin settings, reviews, tenant isolation or unpublished compiler source.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ASSETS } from './package-playground.mjs';

export const PUBLIC_ORIGIN = 'https://atto-lang.github.io';
export const FORBIDDEN = Object.freeze([
  '/play/BUILD_RECEIPT.md',
  '/play/package.json',
  '/play/package-lock.json',
  '/play/tests/actor-host.test.mjs',
  '/play/tests/actor-wasm32-isolation.test.mjs',
  '/play/tests/browser-e2e.mjs',
  '/play/tests/browser-scalar-v1-parity.test.mjs',
  '/play/tests/browser-smoke.mjs',
  '/play/tests/candidate-gate.test.mjs',
  '/play/tests/channel-bounded-preview.test.mjs',
  '/play/tests/compiler.test.mjs',
  '/play/tests/example-catalog.test.mjs',
  '/play/tests/formatter-wasm.test.mjs',
  '/play/tests/rx-interop-preview.test.mjs',
  '/play/tests/saved-programs.test.mjs',
  '/play/tests/syntax-highlight.test.mjs',
  '/play/tests/tenant-node-lifetime.test.mjs',
  '/play/tests/tenant-node.test.mjs',
  '/play/tests/tenant-session-retirement.test.mjs',
  '/play/tests/tenant-session-termination-fence.test.mjs',
  '/play/tests/tenant-session.test.mjs',
  '/play/tests/tenant-termination-fence.test.mjs',
  '/play/tests/trap-compiler-candidate.test.mjs',
  '/play/tests/trap-preview-contract.test.mjs',
  '/play/tests/ui.test.mjs',
  '/play/tests/wasm-memory-admission.test.mjs',
  '/play/tests/worker-task.test.mjs',
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
// Reject misleading MIME prefixes or bogus hints in header parameters.
const mime = response => {
  const value = response.headers?.get?.('content-type');
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
};
const JS_MIME = new Set([
  'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'
]);

// An untrusted public server must not be able to force unbounded audit memory.
async function boundedBody(response, maxBytes, path) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined &&
      (!/^(0|[1-9][0-9]*)$/.test(length.trim()) ||
       !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) {
    throw new Error('NOT_CERTIFIED: invalid/oversized Content-Length ' + path);
  }
  if (!response.body || typeof response.body.getReader !== 'function')
    throw new Error('NOT_CERTIFIED: missing readable response body ' + path);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array))
        throw new Error('NOT_CERTIFIED: malformed streamed response ' + path);
      total += value.byteLength;
      if (total > maxBytes)
        throw new Error('NOT_CERTIFIED: oversized response ' + path);
      chunks.push(value);
    }
    if (length !== null && length !== undefined && Number(length) !== total)
      throw new Error('NOT_CERTIFIED: inconsistent Content-Length ' + path);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

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
  if (manifestResponse.status !== 200 || mime(manifestResponse) !== 'application/json')
    throw new Error('NOT_CERTIFIED: missing or wrongly typed release manifest');
  manifestBytes = await boundedBody(manifestResponse, 256 * 1024, '/release-manifest.json');
  if (manifestBytes.length < 10 || manifestBytes.length > 256 * 1024)
    throw new Error('NOT_CERTIFIED: invalid manifest size');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || manifest.schema !== 1 ||
      manifest.source_commit !== expectedCommit ||
      manifest.compiler_sha256 !== approvedCompilerSha256 ||
      !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets))
    throw new Error('NOT_CERTIFIED: incorrect/unsigned release claims');
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
    if (name.endsWith('.wasm') && mime(response) !== 'application/wasm')
      throw new Error('NOT_CERTIFIED: Wasm MIME mismatch ' + name);
    if (name.endsWith('.js') && !JS_MIME.has(mime(response)))
      throw new Error('NOT_CERTIFIED: module JS MIME mismatch ' + name);
    if (name.endsWith('.css') && mime(response) !== 'text/css')
      throw new Error('NOT_CERTIFIED: CSS MIME mismatch ' + name);
    if (name.endsWith('.json') && mime(response) !== 'application/json')
      throw new Error('NOT_CERTIFIED: JSON MIME mismatch ' + name);
    if (name.endsWith('.html') && mime(response) !== 'text/html')
      throw new Error('NOT_CERTIFIED: HTML MIME mismatch ' + name);
    const bytes = await boundedBody(response, entry.size, '/' + name);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
      throw new Error('NOT_CERTIFIED: deployed asset digest mismatch ' + name);
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
  // The route users visit must match the reviewed index bytes, not merely
  // have a separately accessible index.html file from a newer release.
  const route = await get('/play/');
  if (route.status !== 200 || mime(route) !== 'text/html')
    throw new Error('NOT_CERTIFIED: /play/ route is missing or not HTML');
  const index = manifest.assets['play/index.html'];
  const routeBytes = await boundedBody(route, index.size, '/play/');
  if (routeBytes.length !== index.size || sha256(routeBytes) !== index.sha256)
    throw new Error('NOT_CERTIFIED: /play/ route differs from reviewed index.html');
  const editor = routeBytes.toString('utf8');
  if (!/id=["']source["']/.test(editor) || !editor.includes('src/app.js'))
    throw new Error('NOT_CERTIFIED: /play/ lacks reviewed source compiler editor');
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
