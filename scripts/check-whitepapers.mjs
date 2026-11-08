import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const required = [
  'whitepapers/index.html',
  'whitepapers/01-language-design.md',
  'whitepapers/02-compiler-architecture.md',
  'whitepapers/03-memory-ownership-and-zero-gc.md',
  'whitepapers/04-actor-runtime-and-concurrency.md',
  'whitepapers/05-portable-aot-and-backends.md',
  'whitepapers/README.md',
  'whitepapers/STATUS.md',
];
for (const file of required) {
  assert.ok(existsSync(resolve(root, file)), \`missing required publication file: \${file}\`);
}
const mdFiles = required.filter(file => file.endsWith('.md'));
const permalinks = new Set();
for (const file of mdFiles) {
  const body = readFileSync(resolve(root, file), 'utf8');
  assert.ok(body.startsWith('---\n'), \`\${file}: missing Jekyll front matter\`);
  const closing = body.indexOf('\n---\n', 4);
  assert.ok(closing >= 0, \`\${file}: unterminated Jekyll front matter\`);
  const front = body.slice(4, closing);
  assert.ok(front.includes('title:'), \`\${file}: front matter has no title\`);
  const match = front.match(/^permalink:\s*(.+)$/m);
  assert.ok(match, \`\${file}: front matter has no permalink\`);
  assert.ok(!permalinks.has(match[1]), \`duplicate permalink: \${match[1]}\`);
  permalinks.add(match[1]);
  const fences = body.split('\n').filter(line => line.startsWith('\`\`\`')).length;
  assert.equal(fences % 2, 0, \`\${file}: unbalanced fenced code blocks\`);
  assert.ok(body.includes('Status:**') || body.includes('Status:'), \`\${file}: missing status declaration\`);
  for (const [, href] of body.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#|data:)/i.test(href)) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = resolve(dirname(resolve(root, file)), decodeURIComponent(clean));
    assert.ok(existsSync(target), \`\${file}: broken relative source link: \${href}\`);
  }
}
const page = readFileSync(resolve(root, 'whitepapers/index.html'), 'utf8');
assert.ok(page.toLowerCase().startsWith('<!doctype html>'));
assert.ok(page.includes('Foundational series'));
for (const slug of ['01-language-design','02-compiler-architecture','03-memory-ownership-and-zero-gc','04-actor-runtime-and-concurrency','05-portable-aot-and-backends']) {
  assert.ok(page.includes(slug + '.html'), \`landing page missing paper link: \${slug}\`);
}
assert.ok(page.includes('distinguish language design goals from implemented behavior'));
console.log(\`PASS: \${required.length} publication files, \${mdFiles.length} Markdown front matters, \${permalinks.size} unique permalinks, balanced code fences, and local source links.\`);
