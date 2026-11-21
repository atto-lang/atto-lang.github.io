/**
 * Read-only incident diagnostics for the public Pages origin.
 * OBSERVATION_ONLY is NEVER a release certificate or approval token.
 * A regular push must not publish a public compiler, even if it matches a pin.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_ORIGIN, FORBIDDEN } from './audit-live-playground.mjs';
import { COMPILER_SHA256 } from '../../play/src/compiler-pin.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validHex = (s, n) => typeof s === 'string' && new RegExp('^[a-f0-9]{' + n + '}$').test(s);
const typeOf = response => (response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();

async function readBounded(response, limit, path) {
  const length = response.headers?.get?.('content-length');
  // Fetch yields decoded bytes, but Content-Length may describe compressed
  // transport bytes. Keep the decoded-byte cap and digest check authoritative.
  const encoding = (response.headers?.get?.('content-encoding') || '').trim().toLowerCase();
  const compressed = ['gzip', 'br', 'deflate'].includes(encoding);
  if (encoding && encoding !== 'identity' && !compressed)
    throw new Error('unsupported Content-Encoding for ' + path);
  if (length !== null && length !== undefined &&
      (!/^(0|[1-9][0-9]*)$/.test(length.trim()) ||
       !Number.isSafeInteger(Number(length)) || Number(length) > limit))
    throw new Error('invalid Content-Length for ' + path);
  if (!response.body || typeof response.body.getReader !== 'function')
    throw new Error('missing body for ' + path);
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('invalid bytes for ' + path);
      size += value.byteLength;
      if (size > limit) throw new Error('oversized response for ' + path);
      chunks.push(value);
    }
    if (!compressed && length !== null && length !== undefined && Number(length) !== size)
      throw new Error('mismatched Content-Length for ' + path);
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function observePublicPages({
  fetchImpl = fetch, origin = PUBLIC_ORIGIN, expectedCommit,
  expectedCompilerSha256 = COMPILER_SHA256
} = {}) {
  if (origin !== PUBLIC_ORIGIN) throw new Error('Unexpected public origin');
  if (!validHex(expectedCommit, 40) || !validHex(expectedCompilerSha256, 64))
    throw new Error('Expected source commit and local compiler pin required');
  const findings = [];
  const get = async path => {
    const response = await fetchImpl(origin + path, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (!response || response.redirected === true || !Number.isInteger(response.status))
      throw new Error('Invalid or redirected response at ' + path);
    return response;
  };
  async function inspect(path, maxBytes, expectedMime) {
    try {
      const response = await get(path);
      if (response.status !== 200) {
        findings.push(path + ': HTTP ' + response.status);
        await response.body?.cancel?.().catch(() => {});
        return null;
      }
      if (typeOf(response) !== expectedMime)
        findings.push(path + ': MIME mismatch');
      const bytes = await readBounded(response, maxBytes, path);
      return {bytes, sha256: digest(bytes), length: bytes.byteLength};
    } catch (error) {
      findings.push(path + ': ' + error.message);
      return null;
    }
  }
  const manifest = await inspect('/release-manifest.json', 256 * 1024, 'application/json');
  const compiler = await inspect('/play/public/atto_compiler.wasm', 1024 * 1024, 'application/wasm');
  const receipt = await inspect('/play/public/atto_compiler.receipt.json', 64 * 1024, 'application/json');
  let manifestCommit = null;
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.bytes.toString('utf8'));
      manifestCommit = parsed.source_commit || null;
      if (parsed.schema !== 1 || parsed.source_commit !== expectedCommit)
        findings.push('public manifest does not identify the current source commit');
      if (parsed.compiler_sha256 !== expectedCompilerSha256)
        findings.push('public manifest compiler digest differs from local reviewed pin');
    } catch {
      findings.push('public manifest is malformed JSON');
    }
  }
  if (compiler && compiler.sha256 !== expectedCompilerSha256)
    findings.push('public Wasm bytes differ from local compiler pin');
  if (receipt) {
    try {
      const parsed = JSON.parse(receipt.bytes.toString('utf8'));
      if (parsed.compiler_sha256 !== expectedCompilerSha256)
        findings.push('public receipt compiler digest differs from local pin');
      if (compiler && parsed.compiler_bytes !== compiler.length)
        findings.push('public receipt compiler size differs from public bytes');
    } catch {
      findings.push('public compiler receipt is malformed JSON');
    }
  }
  // These are diagnostics, not an approval signal. Inspect every user-facing
  // deck asset even when the release manifest or compiler is stale/missing.
  // No source bytes are published or altered by the observer.
  const deckAssets = [
    ['/deck/', 'deck/index.html', 'text/html'],
    ['/deck/index.html', 'deck/index.html', 'text/html'],
    ['/deck/deck.css', 'deck/deck.css', 'text/css'],
    ['/deck/deck.js', 'deck/deck.js', 'text/javascript']
  ];
  const approvedDeck = new Map();
  for (const [path, sourcePath, expectedMime] of deckAssets) {
    const expected = await readFile(new URL('../../' + sourcePath, import.meta.url));
    approvedDeck.set(sourcePath, expected);
    const observed = await inspect(path, 128 * 1024, expectedMime);
    if (observed && (observed.length !== expected.length ||
        observed.sha256 !== digest(expected))) {
      findings.push(path + ': deployed deck differs from current source');
    }
  }

  // The public link is often shared without a trailing slash. Follow no
  // redirects, forbid other origins/paths and accept only the exact source
  // page or a single canonicalization redirect to /deck/.
  try {
    const alias = await fetchImpl(origin + '/deck', {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    if (!alias || alias.redirected === true || !Number.isInteger(alias.status)) {
      findings.push('/deck: invalid or already redirected response');
    } else if ([301, 302, 307, 308].includes(alias.status)) {
      const location = alias.headers?.get?.('location');
      if (location !== '/deck/' && location !== origin + '/deck/')
        findings.push('/deck: unsafe or incorrect canonical redirect');
    } else if (alias.status === 200) {
      if (typeOf(alias) !== 'text/html') findings.push('/deck: MIME mismatch');
      const bytes = await readBounded(alias, 128 * 1024, '/deck');
      if (digest(bytes) !== digest(approvedDeck.get('deck/index.html')))
        findings.push('/deck: unreviewed route bytes');
    } else {
      findings.push('/deck: HTTP ' + alias.status);
    }
    await alias?.body?.cancel?.().catch(() => {});
  } catch (error) {
    findings.push('/deck: ' + error.message);
  }

  let exposedFiles = 0;
  for (const path of FORBIDDEN) {
    try {
      const response = await get(path);
      if (![404, 410].includes(response.status)) {
        if (response.status >= 200 && response.status < 300) {
          exposedFiles++;
          findings.push('forbidden public path ' + path + ': HTTP ' + response.status);
        } else {
          // Remain fail-closed, but do not count 403/429/5xx as leaked files.
          findings.push('forbidden path probe inconclusive ' + path + ': HTTP ' + response.status);
        }
      }
      await response.body?.cancel?.().catch(() => {});
    } catch (error) {
      findings.push('forbidden path probe failed ' + path + ': ' + error.message);
    }
  }
  return Object.freeze({
    status: 'OBSERVATION_ONLY_NOT_CERTIFIED',
    expected_source_commit: expectedCommit,
    manifest_source_commit: manifestCommit,
    expected_local_compiler_sha256: expectedCompilerSha256,
    observed_compiler_sha256: compiler?.sha256 || null,
    observed_compiler_bytes: compiler?.length || null,
    forbidden_paths_checked: FORBIDDEN.length,
    exposed_paths: exposedFiles,
    findings: Object.freeze(findings)
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await observePublicPages({expectedCommit: process.env.EXPECTED_SOURCE_SHA});
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length) process.exitCode = 1;
  } catch (error) {
    console.error('OBSERVATION_FAILED_NOT_CERTIFIED: ' + error.message);
    process.exitCode = 1;
  }
}
