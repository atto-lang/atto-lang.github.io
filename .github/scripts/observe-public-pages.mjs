/**
 * Read-only incident diagnostics for the public Pages origin.
 * OBSERVATION_ONLY is NEVER a release certificate or approval token.
 * A regular push must not publish a public compiler, even if it matches a pin.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_ORIGIN, FORBIDDEN } from './audit-live-playground.mjs';
import { COMPILER_SHA256 } from '../../play/src/compiler-pin.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validHex = (s, n) => typeof s === 'string' && new RegExp('^[a-f0-9]{' + n + '}$').test(s);
const typeOf = response => (response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();

async function readBounded(response, limit, path) {
  const length = response.headers?.get?.('content-length');
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
    if (length !== null && length !== undefined && Number(length) !== size)
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
  let exposedFiles = 0;
  for (const path of FORBIDDEN) {
    try {
      const response = await get(path);
      if (![404, 410].includes(response.status)) {
        exposedFiles++;
        findings.push('forbidden public path ' + path + ': HTTP ' + response.status);
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
