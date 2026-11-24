import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the expressions extracted from the production Astro layout.
// Host-source evidence only, not a deployed-browser or CSP receipt.
const layout = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
function expression(variable, guard) {
  const prefix = 'const ' + variable + ' = ' + guard + ' ? ';
  const start = layout.indexOf(prefix);
  assert.ok(start >= 0, 'missing ' + variable + ' guarded serializer');
  assert.equal(layout.indexOf(prefix, start + prefix.length), -1);
  const end = layout.indexOf(' : null;', start + prefix.length);
  assert.ok(end > start, 'serializer must have explicit null fallback');
  return layout.slice(start + prefix.length, end);
}
const context = {
  Astro: { site: new URL('https://atto-lang.github.io/') },
  canonical: new URL('https://atto-lang.github.io/docs/'),
  title: '', description: '',
  article: { published: '2026-11-07', modified: '2026-11-07', author: '' }
};
const serialize = (expr, values = context) => {
  const names = ['Astro', 'canonical', 'title', 'description', 'article'];
  return Function(...names, 'return (' + expr + ');')(...names.map(k => values[k]));
};
const articleExpr = expression('articleJsonLd', 'article');
const websiteExpr = expression('websiteJsonLd', 'home');
const hostile = [
  '</script><script>alert(1)</script>',
  '</ScRiPt><svg onload=alert(1)>',
  '<!-- <script>bad()</script> -->',
  '<img src=x onerror=alert(1)>',
  '<svg><foreignObject><script>bad()</script></foreignObject></svg>',
  '<<script>script',
  '</script\u2028><script>',
  '<\u2029script>alert(1)</script>',
  '<script type="application/ld+json">{"x":"y"}</script>',
  'a\\b</script><script>continue()</script>',
  '\u0000<iframe srcdoc="<script>bad()</script>">',
  'emoji-💡</script><script>new()</script>'
];
for (const [i, value] of hostile.entries()) {
  test('article JSON-LD executes escaping for hostile payload ' + (i + 1), () => {
    const fields = { ...context, title: value, description: value,
      article: { ...context.article, author: value } };
    const json = serialize(articleExpr, fields);
    assert.equal(typeof json, 'string');
    assert.equal(json.includes('<'), false,
      'literal opening angle bracket escapes the script context');
    assert.ok(json.includes('\\u003c'), 'escape must be JSON-safe unicode form');
    const actual = JSON.parse(json);
    assert.equal(actual.headline, value);
    assert.equal(actual.description, value);
    assert.equal(actual.author.name, value);
    assert.equal(actual.mainEntityOfPage, context.canonical.href);
  });
}
test('homepage serializer runs the real expression with canonical site URL', () => {
  const json = serialize(websiteExpr);
  const value = JSON.parse(json);
  assert.equal(value['@type'], 'WebSite');
  assert.equal(value.name, 'AttoLang');
  assert.deepEqual(value.alternateName, ['Oreslang', 'OresLang']);
  assert.equal(value.url, 'https://atto-lang.github.io/');
  assert.equal(json.includes('<'), false);
});
test('article serializer preserves Unicode and semantic JSON round trip', () => {
  const title = '¡AttoLang! «quotes» \u2028\u2029 😀 𠜎';
  const actual = JSON.parse(serialize(articleExpr, { ...context, title }));
  assert.equal(actual.headline, title);
  assert.equal(actual.datePublished, '2026-11-07');
  assert.equal(actual.dateModified, '2026-11-07');
});
test('mutation deleting the actual escape exposes a script breakout', () => {
  const stripped = articleExpr.replace(/\.replace\([^)]*\)/u, '');
  assert.notEqual(stripped, articleExpr, 'mutation must remove source escape');
  const json = serialize(stripped, { ...context, title: hostile[0] });
  assert.ok(json.includes('</script>'), 'deleting escape must expose regression');
});
test('mutation replacing the escape with literal angle brackets is detected', () => {
  const tampered = articleExpr.replace(/\.replace\([^)]*\)/u, '.replace(/</g, "<")');
  assert.notEqual(tampered, articleExpr);
  assert.ok(serialize(tampered, { ...context, title: hostile[1] }).includes('<'));
});
test('script sinks remain only the two escaped JSON-LD serializers', () => {
  const sinks = layout.match(/<script\s+type="application\/ld\+json"\s+set:html=\{(\w+)\}\s*\/>/gu) ?? [];
  assert.equal(sinks.length, 2);
  assert.ok(sinks.some(s => s.includes('articleJsonLd')));
  assert.ok(sinks.some(s => s.includes('websiteJsonLd')));
  assert.ok(!layout.includes('set:html={JSON.stringify('));
});
test('escaping replacement remains attached to both production expressions', () => {
  const title = '</script><iframe srcdoc=x>';
  assert.equal(serialize(articleExpr, { ...context, title }).includes('<'), false);
  assert.equal(serialize(websiteExpr).includes('<'), false);
  assert.match(articleExpr, /\.replace\(\/<\/g,/u);
  assert.match(websiteExpr, /\.replace\(\/<\/g,/u);
});
