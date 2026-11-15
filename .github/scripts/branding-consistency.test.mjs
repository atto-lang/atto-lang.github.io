import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {PUBLICATION_ASSETS} from './package-playground.mjs';

// The architecture sidebar and the verification sidebar are the visible brand
// headers for those dashboard layouts. Every page must also have a footer mark.
const pages = [
  {path:'index.html', head:'header', headerSrc:'./assets/atto-logo.svg', footerSrc:'./assets/atto-mark.svg'},
  {path:'play/index.html', head:'header', headerSrc:'/assets/atto-mark.svg', footerSrc:'/assets/atto-mark.svg'},
  {path:'whitepapers/index.html', head:'header', headerSrc:'/assets/atto-mark.svg', footerSrc:'/assets/atto-mark.svg'},
  {path:'_layouts/whitepaper.html', head:'header', headerSrc:'/assets/atto-mark.svg', footerSrc:'/assets/atto-mark.svg'},
  {path:'play/architecture/index.html', head:'aside', headerSrc:'/assets/atto-mark.svg', footerSrc:'/assets/atto-mark.svg'},
  {path:'verification/index.html', head:'aside', headerSrc:'../assets/atto-mark.svg', footerSrc:'../assets/atto-mark.svg'}
];
const root = new URL('../../', import.meta.url);
const get = path => readFileSync(new URL(path, root), 'utf8');

function landmark(html, tag) {
  const match = html.match(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'i'));
  assert.ok(match, 'missing ' + tag + ' landmark');
  return match[0];
}
function assetLinks(fragment) {
  return [...fragment.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(m => m[0]);
}

test('every public page family has official Atto imagery in brand navigation and footer', () => {
  for (const page of pages) {
    const html = get(page.path);
    const head = landmark(html,page.head);
    const footer = landmark(html,'footer');
    for (const [context, expected] of [[head,page.headerSrc],[footer,page.footerSrc]]) {
      const images = assetLinks(context);
      assert.ok(images.some(img=>img.includes('src="' + expected + '"')),
        page.path + ' missing brand image ' + expected);
      for (const img of images.filter(img=>img.includes('atto-'))) {
        assert.match(img, /\bwidth="[0-9]+"/);
        assert.match(img, /\bheight="[0-9]+"/);
        assert.match(img, /\balt="[^"]*"/);
        assert.doesNotMatch(img, /\bon[a-z]+\s*=|javascript:|https?:\/\//i);
      }
    }
    assert.match(footer, /href="(?:\/|\.\/|\.\.\/)"[^>]*aria-label="AttoLang (?:home|homepage)"/i,
      page.path + ': missing accessible footer home link');
    assert.ok(head.includes('aria-label="AttoLang '),
      page.path + ': missing accessible brand navigation label');
  }
});

test('shared logo assets are local, packaged, and readable from all routes', () => {
  for (const asset of ['assets/atto-logo.svg','assets/atto-mark.svg']) {
    assert.ok(PUBLICATION_ASSETS.includes(asset), asset + ' missing from release allowlist');
    assert.ok(existsSync(new URL(asset,root)), asset + ' missing from repository');
    const svg = get(asset);
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<title\b/);
    assert.match(svg, /<desc\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|<image\b|(?:href|xlink:href)\s*=|javascript:|@import/i);
  }
  for (const page of pages) {
    const html = get(page.path);
    for (const img of assetLinks(html)) {
      const match = img.match(/\bsrc="([^"]*atto-(?:logo|mark)\.svg)"/);
      if (!match) continue;
      assert.ok(/^(?:\/assets\/|\.\/assets\/|\.\.\/assets\/)atto-(?:logo|mark)\.svg$/.test(match[1]),
        page.path + ': logo reference not same-origin and rooted at shared assets');
    }
  }
});

test('architecture dashboard manifest pins branding page and CSS to exact bytes', () => {
  const manifest=JSON.parse(get('play/architecture/site-manifest.json'));
  for (const path of ['index.html','styles.css']) {
    const bytes=readFileSync(new URL('play/architecture/' + path, root));
    const sha=createHash('sha256').update(bytes).digest('hex');
    assert.equal(manifest.files[path],sha,'stale architecture release digest: ' + path);
  }
});

test('header and footer branding does not add executable markup', () => {
  for (const page of pages) {
    const html=get(page.path);
    for (const block of [landmark(html,page.head),landmark(html,'footer')]) {
      assert.doesNotMatch(block, /<script\b|<iframe\b|<object\b|<embed\b|<svg\b|javascript:|<[^>]+\bon[a-z]+\s*=/i,
        page.path + ': active content in brand area');
    }
  }
  const verification=get('verification/index.html');
  assert.match(verification,/img-src 'self' data:/);
  const architecture=get('play/architecture/index.html');
  assert.match(architecture,/img-src 'self' data:/);
});

test('all six layouts provide PNG fallbacks, touch icon and social preview metadata',()=>{
  const pngs=['assets/favicon-32x32.png','assets/apple-touch-icon.png','assets/atto-social-preview.png'];
  for(const png of pngs)assert.ok(PUBLICATION_ASSETS.includes(png),'missing packaged asset '+png);
  for(const page of pages){
    const html=get(page.path);
    assert.match(html,/<link rel="icon" type="image\/png" sizes="32x32"/);
    assert.match(html,/<link rel="apple-touch-icon" sizes="180x180"/);
    assert.match(html,/<meta property="og:image" content="https:\/\/atto-lang.github.io\/assets\/atto-social-preview.png">/);
    assert.match(html,/<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html,/<meta property="og:image:width" content="1200">/);
    assert.match(html,/<meta property="og:image:height" content="630">/);
    assert.doesNotMatch(html,/<script[^>]*src="https?:\/\//i);
  }
});
test('responsive nav and footer branding preserve compact viewport affordances',()=>{
  for(const cssPath of ['assets/site.css','play/styles.css',
     'whitepapers/assets/css/whitepapers.css','play/architecture/styles.css']){
    const css=get(cssPath);
    assert.match(css,/@media\(max-width:/);
    assert.doesNotMatch(css,/@import\b|url\s*\(/i);
  }
});
