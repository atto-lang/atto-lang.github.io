import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PUBLICATION_ASSETS} from './package-playground.mjs';

const page=readFileSync(new URL('../../atto-the-pl/index.html',import.meta.url),'utf8');
const home=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../../assets/site.css',import.meta.url),'utf8');

test('Atto the PL has a standalone discoverable and allowlisted route',()=>{
  assert.ok(PUBLICATION_ASSETS.includes('atto-the-pl/index.html'));
  assert.match(home,/href="\.\/atto-the-pl\/">Atto the PL 🦙<\/a>/);
  assert.match(home,/Read Atto's story/);
  assert.match(page,/<link rel="canonical" href="https:\/\/atto-lang.github.io\/atto-the-pl\/">/);
  assert.match(page,/<h1 id="llama-title">Atto the PL/);
  assert.match(page,/The Programmable Llama/);
  for (const word of ['AttoPL','AttoLang','Lima','llambdas','actors','carrot']) {
    assert.ok(page.includes(word),'missing mascot story keyword: '+word);
  }
});
test('mascot page is static, accessible, branded and uses approved local assets',()=>{
  assert.match(page,/<a class="skip" href="#content">/);
  assert.match(page,/<main id="content">/);
  assert.match(page,/<nav aria-label="Main navigation">/);
  assert.match(page,/<header class="nav wrap">/);
  assert.match(page,/<footer class="wrap site-footer">/);
  assert.match(page,/src="\/assets\/atto-logo.svg"/);
  assert.match(page,/src="\/assets\/atto-mark.svg"/);
  assert.match(page,/<meta http-equiv="Content-Security-Policy"/);
  assert.match(page,/default-src 'none'/);
  assert.match(page,/href="\/assets\/site.css"/);
  assert.match(page,/aria-current="page"/);
  assert.doesNotMatch(page,/<script\b|<iframe\b|<object\b|<embed\b|\bon[a-z]+\s*=|javascript\s*:/i);
  assert.doesNotMatch(page,/<link[^>]+href="https?:\/\/(?!atto-lang.github.io\/atto-the-pl\/)/i);
  assert.match(css,/\.llama-hero\{display:grid/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.doesNotMatch(css,/@import\b|url\s*\(/i);
});
