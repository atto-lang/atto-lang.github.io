import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import { PUBLICATION_ASSETS } from './package-playground.mjs';

const html = readFileSync(new URL('../../deck/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../deck/deck.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../../deck/deck.js', import.meta.url), 'utf8');

test('the reviewed deck is exactly three allowlisted assets, with ten unique slides', () => {
  assert.deepEqual(PUBLICATION_ASSETS.filter(x => x.startsWith('deck/')),
    ['deck/index.html', 'deck/deck.css', 'deck/deck.js']);
  const ids = [...html.matchAll(/data-slide="([0-9]+)"/g)].map(x => Number(x[1]));
  assert.deepEqual(ids, Array.from({length:10}, (_,i) => i+1));
  for (let i = 1; i <= 10; i++) {
    assert.match(html, new RegExp('id="slide-' + i + '-title"'));
    assert.match(html, new RegExp('aria-labelledby="slide-' + i + '-title"'));
  }
  assert.match(html, /Atto Programming Language/);
  assert.match(html, /Durable Objects/);
  assert.match(html, /Temporal-style/);
  assert.match(html, /Secure multitenant compute/);
  assert.match(html, /not literal Rust source compatibility/);
  assert.match(html, /BEAM is not simply/);
  assert.match(html, /not a claim of feature parity/);
  assert.doesNotMatch(html, /href="\/deck\/"/);
});

test('CSP and reviewed local-only JS and CSS retain the release boundary', () => {
  assert.match(html, /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'/);
  assert.equal([...html.matchAll(/<script\b/gi)].length, 1);
  assert.match(html, /<script src="\.\/deck\.js" defer><\/script>/);
  assert.doesNotMatch(html, /\bon[a-z]+\s*=|<iframe\b|<object\b|<embed\b|javascript\s*:/i);
  assert.doesNotMatch(css, /@import\b|url\s*\(/i);
  assert.doesNotMatch(js, /\beval\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|innerHTML\s*=|document\.write/);
  assert.doesNotThrow(() => new Script(js, { filename: 'deck/deck.js' }));
  assert.match(css, /@media print/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 700px\)/);
});

test('keyboard, hash, touch, and button navigation move to the correct visible slide', () => {
  class ElementStub {
    constructor() {
      this.hidden = false;
      this.dataset = {};
      this.attrs = new Map();
      this.listeners = {};
      this.firstChild = { textContent: '01 ' };
    }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    setAttribute(key, value) { this.attrs.set(key, value); }
    removeAttribute(key) { this.attrs.delete(key); }
    getAttribute(key) { return this.attrs.get(key); }
    closest() { return null; }
  }
  const slides = Array.from({length:10}, () => new ElementStub());
  const jumps = Array.from({length:10}, () => new ElementStub());
  const elements = {
    '.deck-shell': new ElementStub(),
    '.slide-count': new ElementStub(),
    '.slide-stage': new ElementStub(),
    '.progress-track': new ElementStub()
  };
  const buttons = {
    previous: new ElementStub(),
    next: new ElementStub(),
    fullscreen: new ElementStub()
  };
  const documentListeners = {}, windowListeners = {};
  const document = {
    querySelector: name => elements[name],
    querySelectorAll: name => name === '.slide[data-slide]' ? slides : name === '.slide-jump a' ? jumps : [],
    getElementById: id => buttons[id],
    addEventListener: (name, fn) => { documentListeners[name] = fn; },
    fullscreenEnabled: false,
    title: ''
  };
  const window = {
    location: {hash: '#/1'},
    addEventListener: (name, fn) => { windowListeners[name] = fn; }
  };
  runInNewContext(js, { document, window, Element: ElementStub });
  assert.equal(slides[0].hidden, false);
  assert.equal(slides[1].hidden, true);
  assert.equal(buttons.previous.disabled, true);
  assert.equal(elements['.progress-track'].getAttribute('aria-valuenow'), '1');

  buttons.next.listeners.click();
  assert.equal(window.location.hash, '#/2');
  windowListeners.hashchange();
  assert.equal(slides[0].hidden, true);
  assert.equal(slides[1].hidden, false);
  assert.equal(jumps[1].getAttribute('aria-current'), 'step');

  documentListeners.keydown({key: 'End', preventDefault() {}, target: null});
  assert.equal(window.location.hash, '#/10');
  windowListeners.hashchange();
  assert.equal(buttons.next.disabled, true);
  assert.equal(elements['.deck-shell'].dataset.index, '10');

  documentListeners.keydown({key: 'Home', preventDefault() {}, target: null});
  windowListeners.hashchange();
  const stage = elements['.slide-stage'];
  stage.listeners.touchstart({touches:[{clientX:300,clientY:100}]});
  stage.listeners.touchend({changedTouches:[{clientX:140,clientY:104}]});
  assert.equal(window.location.hash, '#/2');
});
