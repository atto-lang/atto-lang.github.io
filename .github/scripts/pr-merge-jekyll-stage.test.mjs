import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../workflows/approved-playground-pages.yml', import.meta.url),'utf8');

test('proposed PR merge gets its own reviewed Jekyll tree before packaging', () => {
  const checkout = workflow.indexOf('- name: Check out proposed PR merge commit');
  const render = workflow.indexOf('- name: Build reviewed documentation from proposed merge');
  const verify = workflow.indexOf('- name: Verify proposed merge parents and execute integrated guest tests');
  assert.ok(checkout >= 0 && render > checkout && verify > render);
  const renderBlock = workflow.slice(render,verify);
  assert.match(renderBlock,/if: github\.event_name == 'pull_request'/);
  assert.match(renderBlock,/source: \.\/\.pr-merge-check/);
  assert.match(renderBlock,/destination: \.\/\.pr-merge-check\/_whitepapers-build/);

  const audit = workflow.slice(verify,workflow.indexOf('- uses: actions/upload-pages-artifact', verify));
  assert.match(audit,/working-directory: \.pr-merge-check/);
  assert.match(audit,/SOURCE_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(audit,/ATTO_RENDERED_SITE_ROOT: _whitepapers-build/);
  assert.match(audit,/node scripts\/check-whitepapers-build\.mjs/);
  assert.match(audit,/node \.github\/scripts\/package-playground\.mjs/);
  assert.match(audit,/node \.github\/scripts\/verify-staged-release\.mjs/);
  assert.ok(audit.indexOf('node scripts/check-whitepapers-build.mjs') <
    audit.indexOf('node .github/scripts/package-playground.mjs'));
  assert.ok(audit.indexOf('node .github/scripts/package-playground.mjs') <
    audit.indexOf('node .github/scripts/verify-staged-release.mjs'));
});
