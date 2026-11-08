/** Read-only compiler disclosure authorization. Must execute both before
 * staging and after protected environment admission, immediately before deploy.
 * No approval is implied by a public binary or a successful PR test.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const COMPILER_FILE = fileURLToPath(new URL('../../play/public/atto_compiler.wasm', import.meta.url));
export function verifyApprovedCompiler({
  reviewedSha, requestedSha, confirmed, event, ref, repository, compilerBytes
} = {}) {
  if (event !== 'workflow_dispatch' || ref !== 'refs/heads/main' ||
      repository !== 'atto-lang/atto-lang.github.io' || confirmed !== 'yes') {
    throw new Error('Blocked: release requires confirmed manual dispatch on public main');
  }
  if (typeof reviewedSha !== 'string' || !/^[a-f0-9]{64}$/.test(reviewedSha) ||
      typeof requestedSha !== 'string' || !/^[a-f0-9]{64}$/.test(requestedSha)) {
    throw new Error('Blocked: independently reviewed compiler SHA-256 is absent or malformed');
  }
  if (!compilerBytes || compilerBytes.length < 8 ||
      compilerBytes.length > 1024 * 1024) {
    throw new Error('Blocked: compiler bytes absent or exceed release budget');
  }
  const actual = createHash('sha256').update(compilerBytes).digest('hex');
  if (reviewedSha !== requestedSha || actual !== reviewedSha)
    throw new Error('Blocked: compiler artifact differs from the current approved digest');
  return {verified: true, compiler_sha256: actual, bytes: compilerBytes.length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = await readFile(COMPILER_FILE);
  const result = verifyApprovedCompiler({
    reviewedSha: process.env.REVIEWED_SHA,
    requestedSha: process.env.REQUESTED_SHA,
    confirmed: process.env.CONFIRMED,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    compilerBytes: bytes
  });
  console.log('PASS reviewed public compiler SHA-256: ' + result.compiler_sha256);
}
