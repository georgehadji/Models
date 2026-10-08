// Latency and throughput for shortlisted models, fetched on demand from each
// model's /endpoints listing (OpenRouter fills these only for requests with an
// API key). Results are cached in memory per key; a few requests run at once.

import { fetchEndpoints } from './api.js';
import { normalizeEndpoints } from './data.js';

const CONCURRENCY = 4;

let cache = new Map(); // id → { status: 'loading' | 'ok' | 'error', data?, error? }
let cacheKey = null;
let queue = [];
let running = 0;
let notify = () => {};
let notifyTimer;

/** Forget everything (new API key or catalog refresh). */
export function resetSpeed() {
  cache = new Map();
  queue = [];
}

export const speedOf = (id) => cache.get(id) || null;

function scheduleNotify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => notify(), 100);
}

function pump(apiKey) {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift();
    const store = cache;
    running++;
    fetchEndpoints(id, { apiKey })
      .then((json) => store.set(id, { status: 'ok', data: normalizeEndpoints(json) }))
      .catch((err) => store.set(id, { status: 'error', error: err.message }))
      .finally(() => {
        running--;
        // A reset while this was in flight means the result belongs to an old key; drop the notify.
        if (store === cache) scheduleNotify();
        pump(apiKey);
      });
  }
}

/**
 * Starts fetches for ids not yet known. Does nothing without a key, since the
 * API returns no latency or throughput anonymously.
 */
export function ensureSpeed(ids, apiKey, onUpdate) {
  notify = onUpdate;
  if (!apiKey) return;
  if (apiKey !== cacheKey) {
    resetSpeed();
    cacheKey = apiKey;
  }
  for (const id of ids) {
    if (cache.has(id)) continue;
    cache.set(id, { status: 'loading' });
    queue.push(id);
  }
  pump(apiKey);
}
