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

test('cover uses the exact ownership, native actors, and stateful positioning', () => {
  const start = html.indexOf('<p class="hero-summary">');
  const end = html.indexOf('</p>', start);
  assert.ok(start >= 0 && end > start);
  const cover = html.slice(start, end + 4);
  assert.match(cover, /<p class="hero-summary"><strong>Ownership-aware\.<\/strong><br><strong><em>True native actors\.<\/em><\/strong><br>For <strong>Stateful systems\.<\/strong><\/p>/);
  assert.doesNotMatch(cover, /Ownership-aware code\.|True actors\.|Stateful systems by design\./);
});

test('positioning and concurrency slides describe the Erlang + Rust ambition', () => {
  const slide4Start = html.indexOf('data-slide="4"');
  const slide5Start = html.indexOf('data-slide="5"', slide4Start);
  const slide6Start = html.indexOf('data-slide="6"', slide5Start);
  assert.ok(slide4Start >= 0 && slide5Start > slide4Start && slide6Start > slide5Start);
  const positioning = html.slice(slide4Start, slide5Start);
  const concurrency = html.slice(slide5Start, slide6Start);
  assert.match(positioning, /AttoPL is Erlang<br><span class="gradient-text">\+ Rust<\/span>/);
  assert.match(positioning, /supplant runtimes like Erlang\/Elixir, Java, Node\.js, Golang, and Python/);
  assert.match(positioning, /especially competitive for stateful \(not stateless\) backend services/);
  assert.match(positioning, /competing as a systems language for long-running processes is a goal/);
  assert.doesNotMatch(positioning, /Rust is the inspiration|Erlang is the challenge/);
  assert.match(concurrency, /separate heaps and stacks per actor/);
  assert.match(concurrency, /fault isolation and easier hot swapping/);
  assert.match(concurrency, /multiple threads in the main control flow and within actors/);
  assert.match(concurrency, /parallel message processing with checked state access/);
  assert.match(concurrency, /Actor isolation \+ checked state access/);
  assert.doesNotMatch(concurrency, /The ambition: run actors across multiple threads/);
});

test('security slide replaces the React/Python opinion slide with the TenantVM platform vision', () => {
  const slide8Start = html.indexOf('data-slide="8"');
  const slide9Start = html.indexOf('data-slide="9"', slide8Start);
  assert.ok(slide8Start >= 0 && slide9Start > slide8Start);
  const security = html.slice(slide8Start, slide9Start);
  assert.match(security, /SECURITY &amp; PLATFORM VISION/);
  assert.match(security, /untrusted guest code/);
  assert.match(security, /TenantVMs/);
  assert.match(security, /Virtual hardware/);
  assert.match(security, /Guest-code platforms/);
  assert.match(security, /faster, more secure browsers with a smaller memory footprint/);
  assert.match(security, /Temporal-like workflow engine/);
  assert.match(security, /Cloudflare Durable Objects-like platform/);
  assert.match(security, /New OSes &amp; microVMs/);
  assert.match(security, /Better than V8 for secure, memory-efficient multi-tenant code running in the same OS process/);
  assert.match(security, /requires rigorous security review/);
  assert.match(security, /reproducible benchmarks/);
  assert.equal([...security.matchAll(/class="security-card"/g)].length, 6);
  assert.doesNotMatch(security, /React|Python|opinion-cards|opinion-card|python-icon/);
  assert.match(css, /\.security-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(css, /\.opinion-card|\.python-icon/);
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

  // Focused native buttons must keep their own Space-key action.
  const focusedButton = new ElementStub();
  focusedButton.closest = () => focusedButton;
  documentListeners.keydown({
    key: ' ', target: focusedButton,
    preventDefault() { throw new Error('focused button keydown should not be hijacked'); }
  });
  assert.equal(window.location.hash, '#/2');

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
