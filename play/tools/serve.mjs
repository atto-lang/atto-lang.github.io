/**
 * Loopback-only development server. Serves the exact reviewed static-asset
 * allowlists; intentionally refuses source tests, packaging scripts and
 * release-candidate documents. This server is never a production asset.
 */
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, PUBLICATION_ASSETS } from '../../.github/scripts/package-playground.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED = new Set([
  ...ASSETS.map(name => '/play/' + name),
  ...PUBLICATION_ASSETS.map(name => '/' + name)
]);
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.atto': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
});

function allowedAsset(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') ||
      /[\x00-\x1f\\]/.test(url)) return null;
  try {
    const parsed = new URL(url, 'http://localhost');
    const path = decodeURIComponent(parsed.pathname);
    if (path.includes('\\') || path.includes('\0') ||
        path.split('/').includes('..')) return null;
    const asset = path === '/' ? '/index.html' :
      path.endsWith('/') ? path + 'index.html' : path;
    return ALLOWED.has(asset) ? asset.slice(1) : null;
  } catch {
    return null;
  }
}

export function createDevServer({ root = ROOT } = {}) {
  const workingRoot = resolve(root);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // A loopback bind is not enough: DNS rebinding can make a browser send
    // same-origin requests with an attacker-controlled Host header. Never
    // serve the pinned compiler or Atto source to an untrusted origin.
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    const port = server.address()?.port;
    const host = request.headers.host;
    const allowedHost = typeof host === 'string' &&
      (host.toLowerCase() === '127.0.0.1:' + port ||
       host.toLowerCase() === 'localhost:' + port);
    // Browsers cannot forge Origin; reject cross-origin reads even when the
    // TCP destination and Host appear local. Ordinary same-origin GETs work.
    if (!allowedHost ||
        (request.headers.origin !== undefined &&
         request.headers.origin !== 'http://' + host.toLowerCase())) {
      response.writeHead(403);
      response.end('Forbidden origin');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    const name = allowedAsset(request.url);
    if (name === null) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    try {
      const base = await realpath(workingRoot);
      const absolute = await realpath(resolve(workingRoot, name));
      if (!absolute.startsWith(base + sep)) throw new Error('Outside root');
      const bytes = await readFile(absolute);
      response.writeHead(200, {
        'Content-Type': MIME[extname(name)] || 'application/octet-stream',
        'Content-Length': bytes.length
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configured = process.env.ATTO_PLAY_PORT ?? '8080';
  if (!/^\d{1,5}$/.test(configured) || Number(configured) > 65535) {
    throw new Error('ATTO_PLAY_PORT must be an integer from 0 through 65535');
  }
  const server = createDevServer();
  server.on('error', error => { console.error(error); process.exitCode = 1; });
  server.listen(Number(configured), '127.0.0.1', () => {
    console.log('AttoLang playground (localhost only): http://127.0.0.1:' +
      server.address().port + '/play/');
  });
}
