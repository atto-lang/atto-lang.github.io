/** Fail-closed audit of the EXACT artifact uploaded to GitHub Pages. */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, SITE_ASSETS } from './package-playground.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const MAX_BYTES = 1024 * 1024;
const EXPECTED = Object.freeze([...ASSETS.map(x => 'play/' + x), ...SITE_ASSETS].sort());

function sameKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid ' + label);
  const actual = Object.keys(value).sort();
  const required = [...keys].sort();
  if (actual.length !== required.length || actual.some((x,i) => x !== required[i]))
    throw new Error('Missing or unexpected ' + label + ': ' + JSON.stringify(actual));
}
async function scan(root, prefix = '') {
  const result = [];
  for (const name of await readdir(join(root,prefix))) {
    const rel = prefix ? prefix + '/' + name : name;
    const st = await lstat(join(root,rel));
    if (st.isSymbolicLink()) throw new Error('Symlink in staged release: ' + rel);
    if (st.isDirectory()) result.push(...await scan(root,rel));
    else if (st.isFile()) result.push(rel);
    else throw new Error('Non-regular staged asset: ' + rel);
  }
  return result;
}
export async function verifyStagedRelease({
  outputRoot = fileURLToPath(new URL('../../',import.meta.url)),
  expectedSourceCommit,
  expectedCompilerSha256 = null
} = {}) {
  if (typeof expectedSourceCommit !== 'string' || !HEX40.test(expectedSourceCommit))
    throw new Error('Exact source commit required');
  if (expectedCompilerSha256 !== null &&
      (typeof expectedCompilerSha256 !== 'string' || !HEX64.test(expectedCompilerSha256)))
    throw new Error('Malformed approved compiler digest');
  const root = resolve(outputRoot,'_site');
  const st = await lstat(root);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Invalid staging root');
  const found = await scan(root);
  sameKeys(Object.fromEntries(found.map(x => [x,true])),
    [...EXPECTED,'release-manifest.json'],'staged paths');

  const manifestPath = join(root,'release-manifest.json');
  const ms = await lstat(manifestPath);
  if (!ms.isFile() || ms.isSymbolicLink() || ms.size < 2 || ms.size > MAX_BYTES)
    throw new Error('Invalid staged manifest file');
  const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
  sameKeys(manifest,['schema','source_commit','compiler_sha256','assets','site_assets'],
    'manifest structure');
  if (manifest.schema !== 1 || manifest.source_commit !== expectedSourceCommit ||
      !HEX64.test(manifest.compiler_sha256))
    throw new Error('Manifest source or compiler digest mismatch');
  sameKeys(manifest.assets,ASSETS.map(x=>'play/'+x),'play asset manifest');
  sameKeys(manifest.site_assets,SITE_ASSETS,'homepage manifest');
  for (const rel of EXPECTED) {
    const target = resolve(root,rel);
    const back = relative(root,target);
    if (!back || back === '..' || back.startsWith('..'+sep) || back.startsWith(sep))
      throw new Error('Asset escaped staging root: '+rel);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Invalid staged file: '+rel);
    const info = rel.startsWith('play/') ? manifest.assets[rel] : manifest.site_assets[rel];
    sameKeys(info,['size','sha256'],'asset metadata: '+rel);
    if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_BYTES ||
        !HEX64.test(info.sha256) || stat.size !== info.size)
      throw new Error('Incorrect asset metadata: '+rel);
    if (createHash('sha256').update(await readFile(target)).digest('hex') !== info.sha256)
      throw new Error('Staged file digest mismatch: '+rel);
  }
  const wasm = await readFile(join(root,'play/public/atto_compiler.wasm'));
  const digest = createHash('sha256').update(wasm).digest('hex');
  if (manifest.compiler_sha256 !== digest ||
      (expectedCompilerSha256 !== null && expectedCompilerSha256 !== digest))
    throw new Error('Compiler digest mismatched manifest or independent approval');
  if (!WebAssembly.validate(wasm))
    throw new Error('Staged compiler is not valid Wasm');
  return {source_commit:expectedSourceCommit,compiler_sha256:digest,asset_count:EXPECTED.length};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await verifyStagedRelease({
    expectedSourceCommit:process.env.SOURCE_COMMIT,
    expectedCompilerSha256:process.env.APPROVED_COMPILER_SHA256 || null
  });
  console.log('PASS exact Pages staging manifest and file tree:',receipt);
}
