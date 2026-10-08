#!/usr/bin/env node
// Saves the OpenRouter model catalogs to data/snapshot.json so the app works
// offline or when the browser cannot reach the API. Usage: npm run snapshot
// Set OPENROUTER_API_KEY to send an Authorization header (optional).

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';
const OUT = fileURLToPath(new URL('../data/snapshot.json', import.meta.url));
const headers = { accept: 'application/json' };
if (process.env.OPENROUTER_API_KEY) headers.authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;

async function get(path, required) {
  try {
    const res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (required) throw new Error(`GET ${path} failed: ${err.message}`);
    console.warn(`warning: GET ${path} failed (${err.message}); continuing without it`);
    return null;
  }
}

const models = await get('/models?output_modalities=all', true);
const [images, videos] = await Promise.all([get('/images/models'), get('/videos/models')]);
const snapshot = { fetchedAt: new Date().toISOString(), source: BASE, models, images, videos };

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify(snapshot));
console.log(
  `Saved ${models.data.length} models, ${images?.data?.length ?? 0} image models, ` +
    `${videos?.data?.length ?? 0} video models to ${OUT}`,
);
