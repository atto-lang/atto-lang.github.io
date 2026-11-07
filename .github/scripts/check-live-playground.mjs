/** Public HTTPS release audit. This READ-ONLY probe never uploads user source.
 * Run after GitHub Pages is configured to deploy ONLY allowlisted Actions artifacts.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ORIGIN = 'https://atto-lang.github.io/';
const MAX_BYTES = 1024 * 1024;
const PRIVATE_PATHS = [
  'play/tests/browser-e2e.mjs',
  'play/tests/compiler.test.mjs',
  'play/package.json',
  'play/scripts/vendor-compiler.sh',
  'play/.github/workflows/ci.yml',
  '.github/workflows/approved-playground-pages.yml'
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function auditLivePlayground({
  fetchImpl = fetch,
  localCompiler = readFile(fileURLToPath(new URL('../../play/public/atto_compiler.wasm', import.meta.url)))
} = {}) {
  const localBytes = await localCompiler;
  const reviewedDigest = sha256(localBytes);
  async function get(path) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== new URL(ORIGIN).origin) throw new Error('Unexpected asset origin');
    const response = await fetchImpl(url.toString(), {
      method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': '*/*' }
    });
    return response;
  }
  async function required(path, mime) {
    const response = await get(path);
    if (response.status !== 200 || response.redirected) throw new Error(path + ' expected HTTP 200; got ' + response.status);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith(mime)) throw new Error(path + ' wrong MIME ' + contentType);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error(path + ' unexpectedly large content');
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) throw new Error(path + ' body outside budget');
    return body;
  }
  // Assess all independent release controls even if the first one fails.
  // This prevents a missing manifest from hiding exposed repository test files.
  const failures = [];
  async function collect(label, work) {
    try { return await work(); }
    catch (error) { failures.push(label + ': ' + error.message); return null; }
  }
  await collect('editor', async () => {
    const page = new TextDecoder().decode(await required('play/', 'text/html'));
    if (!page.includes('id="source"') || !page.includes('./src/app.js')) {
      throw new Error('/play/ did not serve the real browser editor');
    }
  });
  const manifest = await collect('manifest', async () =>
    JSON.parse(new TextDecoder().decode(await required('release-manifest.json', 'application/json'))));
  if (manifest && (!/^[a-f0-9]{40}$/.test(manifest.source_commit || '') ||
      manifest.compiler_sha256 !== reviewedDigest ||
      manifest.assets?.['play/public/atto_compiler.wasm']?.sha256 !== reviewedDigest)) {
    failures.push('Live release manifest does not match locally reviewed compiler bytes and commit');
  }
  const wasm = await collect('compiler', async () =>
    required('play/public/atto_compiler.wasm', 'application/wasm'));
  if (wasm) {
    if (sha256(wasm) !== reviewedDigest || !WebAssembly.validate(wasm)) {
      failures.push('Live compiler Wasm differs from reviewed local bytes');
    } else if (WebAssembly.Module.imports(new WebAssembly.Module(wasm)).length > 0) {
      failures.push('Live compiler has forbidden host imports');
    }
  }
  for (const path of PRIVATE_PATHS) {
    await collect('exposure', async () => {
      const response = await get(path);
      if (response.redirected || (response.status >= 200 && response.status < 300)) {
        throw new Error('Unreviewed file is publicly exposed: /' + path + ' (' + response.status + ')');
      }
    });
  }
  if (failures.length) throw new Error(failures.join('; '));
  return { page: ORIGIN + 'play/', source_commit: manifest.source_commit,
    compiler_sha256: reviewedDigest, rejected_private_paths: PRIVATE_PATHS.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidence = await auditLivePlayground();
    console.log('PASS external HTTPS Pages audit: ' + JSON.stringify(evidence));
  } catch (error) {
    console.error('FAIL public deployment audit: ' + error.message);
    process.exitCode = 1;
  }
}
