import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const homepage = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../assets/site.css', import.meta.url), 'utf8');
const repositories = [
  'atto-spec', 'atto-platform-conformance', 'atto-compilers-parity-testing',
  'atto-source.java', 'atto-source.llvm', 'atto-source.wasm',
  'atto-source.net', 'atto-source.forge', 'atto-source.rs',
  'atto-design-patterns', 'atto-vscode'
];

function inspect(markup) {
  const section = markup.match(/<section class="ecosystem wrap" id="ecosystem" aria-labelledby="ecosystem-title">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(section, 'landmark needs a labelled section');
  assert.match(section, /<h2 id="ecosystem-title">/);
  assert.match(markup, /<nav aria-label="Main navigation">[\s\S]*?<a href="#ecosystem">Ecosystem<\/a>/);
  assert.match(section, /does not certify a feature, backend, release, or cross-backend parity/);
  assert.match(section, /require authorized GitHub access; visitors without permission may see a 404 page/);
  assert.equal((section.match(/<article class="resource-card">/g) || []).length, 3);
  for (const name of repositories) {
    const link = 'href="https://github.com/atto-lang/' + name + '" rel="noopener noreferrer"';
    assert.ok(section.includes(link), 'expected safe repository link: ' + name);
  }
  for (const route of ['./play/', './whitepapers/'])
    assert.ok(section.includes('href="' + route + '"'), 'missing local route: ' + route);
  assert.doesNotMatch(section, /<script\b|\bon[a-z]+\s*=|javascript\s*:/i);
  assert.doesNotMatch(section, /target="_blank"/i);
}

test('homepage repository guide has a visible keyboard-accessible navigation target', () => inspect(homepage));
test('guide rejects missing contracts and unexpected external destinations', () => {
  assert.throws(() => inspect(homepage.replace('id="ecosystem"', 'id="other"')));
  assert.throws(() => inspect(homepage.replace('does not certify', 'does certify')));
  assert.throws(() => inspect(homepage.replace('https://github.com/atto-lang/atto-source.llvm', 'https://example.invalid/compiler')));
});
test('guide remains responsive and has no new external assets or scripts', () => {
  assert.match(css, /\.resource-grid\{display:grid/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(homepage, /default-src 'none'/);
  assert.doesNotMatch(homepage, /<script\b|https?:\/\/[^" ]+\.(?:js|css)/i);
});

test('official atto logo and square mark are present in every public navigation', () => {
  for (const file of ['atto-logo.svg', 'atto-mark.svg']) {
    const svg = readFileSync(new URL('../../assets/' + file, import.meta.url), 'utf8');
    assert.ok(existsSync(new URL('../../assets/' + file, import.meta.url)), 'missing brand SVG: ' + file);
    assert.match(svg, /<title\b/);
    assert.match(svg, /<desc\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bon[a-z]+\s*=|javascript\s*:|(?:href|xlink:href)\s*=/i);
  }
  assert.match(homepage, /src="\.\/assets\/atto-logo\.svg"/);
  for (const route of ['play/index.html', 'whitepapers/index.html', '_layouts/whitepaper.html']) {
    const content = readFileSync(new URL('../../' + route, import.meta.url), 'utf8');
    assert.match(content, /src="\/assets\/atto-mark\.svg"/);
    assert.match(content, /rel="icon" type="image\/svg\+xml" href="\/assets\/atto-mark\.svg"/);
  }
  const packager = readFileSync(new URL('./package-playground.mjs', import.meta.url), 'utf8');
  assert.match(packager, /'assets\/atto-logo\.svg'/);
  assert.match(packager, /'assets\/atto-mark\.svg'/);
});

