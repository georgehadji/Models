// Pure data layer: normalizes OpenRouter API payloads and computes the
// aggregates the charts draw. No DOM access, so it runs in Node tests too.
//
// Field names follow the OpenRouter Models API wire format (snake_case), as
// defined by the official @openrouter/sdk schemas.

export const PER_MILLION = 1e6;

/** Ratio of input to output tokens used for the "blended" price (3:1). */
export const BLEND_RATIO = 3;

const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * OpenRouter prices are strings in USD per single token (or per unit).
 * Negative values mark dynamic pricing (e.g. router models) and are treated
 * as unknown rather than as a real price.
 */
export function unitPrice(v) {
  const n = toNumber(v);
  return n == null || n < 0 ? null : n;
}

export function perMillion(v) {
  const n = unitPrice(v);
  return n == null ? null : n * PER_MILLION;
}

export function blendedPrice(inputPerM, outputPerM, ratio = BLEND_RATIO) {
  if (inputPerM == null || outputPerM == null) return null;
  return (ratio * inputPerM + outputPerM) / (ratio + 1);
}

export function authorOf(id) {
  const slash = String(id).indexOf('/');
  return slash > 0 ? id.slice(0, slash) : 'other';
}

// Capabilities derived from `supported_parameters`, modalities and pricing.
export const CAPABILITIES = [
  { key: 'tools', label: 'Tool calling', test: (m) => m.params.has('tools') },
  {
    key: 'structured',
    label: 'Structured outputs',
    test: (m) => m.params.has('structured_outputs') || m.params.has('response_format'),
  },
  { key: 'reasoning', label: 'Reasoning', test: (m) => m.reasoning.supported },
  { key: 'vision', label: 'Image input', test: (m) => m.inputModalities.includes('image') },
  { key: 'file', label: 'File input', test: (m) => m.inputModalities.includes('file') },
  { key: 'audioIn', label: 'Audio input', test: (m) => m.inputModalities.includes('audio') },
  { key: 'videoIn', label: 'Video input', test: (m) => m.inputModalities.includes('video') },
  { key: 'imageOut', label: 'Image output', test: (m) => m.outputModalities.includes('image') },
  {
    key: 'audioOut',
    label: 'Audio / speech output',
    test: (m) => m.outputModalities.includes('audio') || m.outputModalities.includes('speech'),
  },
  { key: 'webSearch', label: 'Native web search', test: (m) => m.params.has('web_search_options') },
  { key: 'caching', label: 'Prompt caching', test: (m) => m.price.cacheRead != null },
  { key: 'logprobs', label: 'Logprobs', test: (m) => m.params.has('logprobs') },
  { key: 'seed', label: 'Seed', test: (m) => m.params.has('seed') },
];

// Highest effort first, matching the API's own ordering of supported_efforts.
export const EFFORT_LEVELS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

export function normalizeModel(raw) {
  const pricing = raw.pricing || {};
  const arch = raw.architecture || {};
  const top = raw.top_provider || {};
  const params = new Set(raw.supported_parameters || []);
  const inputModalities = arch.input_modalities || [];
  const outputModalities = arch.output_modalities || [];

  const price = {
    input: perMillion(pricing.prompt),
    output: perMillion(pricing.completion),
    cacheRead: perMillion(pricing.input_cache_read),
    cacheWrite: perMillion(pricing.input_cache_write),
    reasoning: perMillion(pricing.internal_reasoning),
    audioInput: perMillion(pricing.audio),
    imageToken: perMillion(pricing.image_token),
    request: unitPrice(pricing.request),
    imageInput: unitPrice(pricing.image),
    imageOutput: unitPrice(pricing.image_output),
    webSearch: unitPrice(pricing.web_search),
    discount: toNumber(pricing.discount),
  };
  const dynamicPricing = ['prompt', 'completion'].some((k) => (toNumber(pricing[k]) ?? 0) < 0);
  const isFree =
    String(raw.id).endsWith(':free') ||
    (price.input === 0 && price.output === 0 && !price.request && !price.imageOutput);

  const r = raw.reasoning;
  const reasoning = {
    supported:
      !!r || params.has('reasoning') || params.has('include_reasoning') || params.has('reasoning_effort'),
    mandatory: !!r?.mandatory,
    efforts: Array.isArray(r?.supported_efforts) ? r.supported_efforts.filter(Boolean) : null,
    defaultEffort: r?.default_effort ?? null,
    supportsMaxTokens: !!r?.supports_max_tokens,
  };

  const aa = raw.benchmarks?.artificial_analysis;
  const arena = raw.benchmarks?.design_arena || [];
  const bench = {
    intelligence: toNumber(aa?.intelligence_index),
    coding: toNumber(aa?.coding_index),
    agentic: toNumber(aa?.agentic_index),
    arenaBestElo: arena.length ? Math.max(...arena.map((e) => e.elo)) : null,
  };

  const model = {
    id: raw.id,
    name: raw.name || raw.id,
    author: authorOf(raw.id),
    description: raw.description || '',
    created: raw.created ? new Date(raw.created * 1000) : null,
    contextLength: toNumber(raw.context_length) ?? toNumber(top.context_length),
    maxOutput: toNumber(top.max_completion_tokens),
    moderated: !!top.is_moderated,
    inputModalities,
    outputModalities,
    tokenizer: arch.tokenizer || null,
    params,
    price,
    blended: blendedPrice(price.input, price.output),
    dynamicPricing,
    isFree,
    reasoning,
    bench,
    knowledgeCutoff: raw.knowledge_cutoff || null,
    expirationDate: raw.expiration_date || null,
  };
  model.caps = Object.fromEntries(CAPABILITIES.map((c) => [c.key, !!c.test(model)]));
  return model;
}

export function normalizeVideoModel(raw) {
  const skus = Object.entries(raw.pricing_skus || {})
    .map(([key, value]) => ({ key, price: unitPrice(value) }))
    .filter((s) => s.price != null)
    .sort((a, b) => a.price - b.price);
  const durations = raw.supported_durations || [];
  return {
    id: raw.id,
    name: raw.name || raw.id,
    author: authorOf(raw.id),
    created: raw.created ? new Date(raw.created * 1000) : null,
    durations,
    maxDuration: durations.length ? Math.max(...durations) : null,
    resolutions: raw.supported_resolutions || [],
    aspectRatios: raw.supported_aspect_ratios || [],
    sizes: raw.supported_sizes || [],
    frameImages: raw.supported_frame_images || [],
    generateAudio: raw.generate_audio,
    seed: raw.seed,
    skus,
    cheapestSku: skus[0] || null,
  };
}

export function normalizeImageModel(raw) {
  const arch = raw.architecture || {};
  return {
    id: raw.id,
    name: raw.name || raw.id,
    author: authorOf(raw.id),
    inputModalities: arch.input_modalities || [],
    outputModalities: arch.output_modalities || [],
    parameters: Object.keys(raw.supported_parameters || {}),
    streaming: !!raw.supports_streaming,
  };
}

export function filterModels(models, f = {}) {
  const q = (f.query || '').trim().toLowerCase();
  return models.filter((m) => {
    if (q && !`${m.id} ${m.name}`.toLowerCase().includes(q)) return false;
    if (f.author && m.author !== f.author) return false;
    if (f.inputModality && !m.inputModalities.includes(f.inputModality)) return false;
    if (f.outputModality && !m.outputModalities.includes(f.outputModality)) return false;
    if (f.pricing === 'free' && !m.isFree) return false;
    if (f.pricing === 'paid' && (m.isFree || m.blended == null)) return false;
    for (const cap of f.capabilities || []) if (!m.caps[cap]) return false;
    return true;
  });
}

export function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function summary(models) {
  const paid = models.filter((m) => !m.isFree && m.price.input != null);
  return {
    total: models.length,
    authors: new Set(models.map((m) => m.author)).size,
    free: models.filter((m) => m.isFree).length,
    reasoning: models.filter((m) => m.reasoning.supported).length,
    medianInput: median(paid.map((m) => m.price.input)),
    medianOutput: median(paid.map((m) => m.price.output)),
    maxContext: models.reduce((best, m) => (m.contextLength > (best?.contextLength ?? 0) ? m : best), null),
  };
}

/** Top `n` models by a numeric accessor, skipping null values. */
export function topBy(models, accessor, n, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return models
    .filter((m) => accessor(m) != null)
    .sort((a, b) => sign * (accessor(a) - accessor(b)) || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const keys = [].concat(keyOf(item));
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export const PRICE_BINS = [
  { label: 'Free', test: (v) => v === 0 },
  { label: '< $0.10', max: 0.1 },
  { label: '$0.10–0.50', max: 0.5 },
  { label: '$0.50–1', max: 1 },
  { label: '$1–3', max: 3 },
  { label: '$3–10', max: 10 },
  { label: '$10–30', max: 30 },
  { label: '≥ $30', max: Infinity },
];

/** Histogram of a $/M price into fixed, ordered bins. */
export function priceHistogram(models, accessor = (m) => m.price.input) {
  const counts = PRICE_BINS.map((b) => ({ label: b.label, count: 0 }));
  for (const m of models) {
    const v = accessor(m);
    if (v == null) continue;
    const idx = v === 0 ? 0 : PRICE_BINS.findIndex((b, i) => i > 0 && v < b.max);
    counts[idx].count++;
  }
  return counts;
}

export const CONTEXT_BINS = [
  { label: '≤ 8K', max: 8192 },
  { label: '≤ 32K', max: 32768 },
  { label: '≤ 128K', max: 131072 },
  { label: '≤ 256K', max: 262144 },
  { label: '≤ 1M', max: 1048576 },
  { label: '> 1M', max: Infinity },
];

export function contextHistogram(models) {
  const counts = CONTEXT_BINS.map((b) => ({ label: b.label, count: 0 }));
  for (const m of models) {
    if (m.contextLength == null) continue;
    counts[CONTEXT_BINS.findIndex((b) => m.contextLength <= b.max)].count++;
  }
  return counts;
}

export function capabilityCoverage(models) {
  return CAPABILITIES.map((c) => {
    const count = models.filter((m) => m.caps[c.key]).length;
    return { key: c.key, label: c.label, count, share: models.length ? count / models.length : 0 };
  });
}

/** Authors (rows, by model count) × capabilities (cols); cell = share of that author's models. */
export function authorCapabilityMatrix(models, topAuthors = 12) {
  const authors = countBy(models, (m) => m.author).slice(0, topAuthors);
  return {
    rows: authors.map((a) => ({ key: a.key, total: a.count })),
    cols: CAPABILITIES,
    cells: authors.map((a) => {
      const own = models.filter((m) => m.author === a.key);
      return CAPABILITIES.map((c) => {
        const count = own.filter((m) => m.caps[c.key]).length;
        return { count, total: own.length, share: count / own.length };
      });
    }),
  };
}

export function modalityCounts(models, which) {
  const field = which === 'input' ? 'inputModalities' : 'outputModalities';
  return countBy(models, (m) => m[field]);
}

/** Models released per calendar month (UTC), oldest first, over the last `months`. */
export function releasesByMonth(models, months = 24, now = new Date()) {
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ key: d.toISOString().slice(0, 7), date: d, count: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const m of models) {
    if (!m.created) continue;
    const i = index.get(m.created.toISOString().slice(0, 7));
    if (i != null) buckets[i].count++;
  }
  return buckets;
}

export function reasoningStats(models) {
  const rm = models.filter((m) => m.reasoning.supported);
  const effortCounts = EFFORT_LEVELS.map((level) => ({
    level,
    count: rm.filter((m) => m.reasoning.efforts?.includes(level)).length,
  }));
  return {
    total: rm.length,
    mandatory: rm.filter((m) => m.reasoning.mandatory).length,
    optional: rm.filter((m) => !m.reasoning.mandatory).length,
    maxTokens: rm.filter((m) => m.reasoning.supportsMaxTokens).length,
    unrestrictedEfforts: rm.filter((m) => m.reasoning.efforts == null).length,
    separateReasoningPrice: rm.filter((m) => m.price.reasoning != null && m.price.reasoning > 0).length,
    effortCounts,
    byAuthor: countBy(rm, (m) => m.author),
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(columns, rows) {
  return [columns.map((c) => csvCell(c.label)), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))))]
    .map((line) => line.join(','))
    .join('\n');
}
