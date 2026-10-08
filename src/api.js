// Fetches model catalogs from OpenRouter.
//
// Sources are tried in order until one answers:
//   1. the OpenRouter API directly from the browser,
//   2. the same-origin proxy that `server.mjs` exposes (avoids CORS/network
//      restrictions on the direct call),
//   3. a local snapshot written by `npm run snapshot`.

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const PROXY_API = 'api/openrouter';
const SNAPSHOT_URL = 'data/snapshot.json';

// `output_modalities=all` is required: the endpoint defaults to text-output models only.
export const MODELS_PATH = '/models?output_modalities=all';
export const IMAGE_MODELS_PATH = '/images/models';
export const VIDEO_MODELS_PATH = '/videos/models';

async function getJSON(url, apiKey, signal) {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fromBase(base, apiKey, signal) {
  const models = await getJSON(base + MODELS_PATH, apiKey, signal);
  // Image and video catalogs are optional extras; a failure there must not
  // block the main dashboard.
  const [images, videos] = await Promise.allSettled([
    getJSON(base + IMAGE_MODELS_PATH, apiKey, signal),
    getJSON(base + VIDEO_MODELS_PATH, apiKey, signal),
  ]);
  return {
    models: models.data || [],
    images: images.status === 'fulfilled' ? images.value.data || [] : null,
    videos: videos.status === 'fulfilled' ? videos.value.data || [] : null,
    errors: [images, videos].filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  };
}

/** Accepts a snapshot file or a raw `/models` response. */
export function parseSnapshot(json) {
  if (Array.isArray(json?.data)) return { models: json.data, images: null, videos: null, fetchedAt: null };
  if (Array.isArray(json?.models?.data)) {
    return {
      models: json.models.data,
      images: json.images?.data ?? null,
      videos: json.videos?.data ?? null,
      fetchedAt: json.fetchedAt ?? null,
    };
  }
  throw new Error('Unrecognized JSON: expected an OpenRouter /models response or a snapshot file');
}

export async function loadCatalog({ apiKey, signal } = {}) {
  const attempts = [];
  for (const [source, base] of [
    ['OpenRouter API', OPENROUTER_API],
    ['local proxy', PROXY_API],
  ]) {
    try {
      const result = await fromBase(base, apiKey, signal);
      return { ...result, source, fetchedAt: new Date().toISOString(), attempts };
    } catch (err) {
      if (signal?.aborted) throw err;
      attempts.push(`${source}: ${err.message}`);
    }
  }
  try {
    const snap = parseSnapshot(await getJSON(SNAPSHOT_URL, null, signal));
    return { ...snap, source: 'local snapshot', errors: [], attempts };
  } catch (err) {
    attempts.push(`local snapshot: ${err.message}`);
  }
  const error = new Error('Could not load models from any source');
  error.attempts = attempts;
  throw error;
}
