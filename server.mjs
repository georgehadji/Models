#!/usr/bin/env node
// Zero-dependency dev server: serves the app and proxies the three OpenRouter
// catalog endpoints under /api/openrouter/* so the browser never needs a
// cross-origin request. Usage: node server.mjs [--port 8000] [--host 127.0.0.1]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const UPSTREAM = process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';
const PROXY_PREFIX = '/api/openrouter';
const ALLOWED_PATHS = new Set(['/models', '/images/models', '/videos/models']);
// Per-model provider endpoints (latency/throughput); id parts limited to safe characters.
const ENDPOINTS_PATH = /^\/models\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~:-]+\/endpoints$/;
const CACHE_MS = 5 * 60 * 1000;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.PORT || 8000));
const HOST = arg('host', process.env.HOST || '127.0.0.1');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const cache = new Map();

async function proxy(req, res, url) {
  const path = url.pathname.slice(PROXY_PREFIX.length);
  if (req.method !== 'GET' || !(ALLOWED_PATHS.has(path) || ENDPOINTS_PATH.test(path))) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({ error: 'Only GET /models, /images/models, /videos/models and /models/{id}/endpoints are proxied' }),
    );
  }
  const target = UPSTREAM + path + url.search;
  const auth = req.headers.authorization;
  const cacheKey = `${target}|${auth ? 'auth' : 'anon'}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.writeHead(hit.status, { 'content-type': 'application/json', 'x-cache': 'hit' });
    return res.end(hit.body);
  }
  try {
    const upstream = await fetch(target, {
      headers: { accept: 'application/json', ...(auth ? { authorization: auth } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await upstream.text();
    if (upstream.ok) cache.set(cacheKey, { at: Date.now(), status: upstream.status, body });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Upstream request failed: ${err.message}` }));
  }
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(ROOT, rel));
  // Refuse traversal outside the app and dotfiles such as .git.
  if (!file.startsWith(ROOT + sep) || rel.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith(`${PROXY_PREFIX}/`)) return proxy(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`OpenRouter Model Atlas: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}/`);
});
