// Pure data layer: normalizes OpenRouter API payloads and provides the
// filtering and ranking helpers the charts use. No DOM access, so it runs in Node tests too.
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
  // Long-prompt tiers: from min_prompt_tokens up, the whole request uses these prices.
  price.tiers = (Array.isArray(pricing.overrides) ? pricing.overrides : [])
    .map((o) => ({
      minPromptTokens: toNumber(o.min_prompt_tokens),
      input: perMillion(o.prompt),
      output: perMillion(o.completion),
      reasoning: perMillion(o.internal_reasoning),
    }))
    .filter((t) => t.minPromptTokens != null)
    .sort((a, b) => a.minPromptTokens - b.minPromptTokens);
  const dynamicPricing = ['prompt', 'completion'].some((k) => (toNumber(pricing[k]) ?? 0) < 0);
  const isFree =
    String(raw.id).endsWith(':free') ||
    (price.input === 0 && price.output === 0 && !price.request && !price.imageOutput);

  const r = raw.reasoning;
  const reasoning = {
    supported:
      !!r || params.has('reasoning') || params.has('include_reasoning') || params.has('reasoning_effort'),
    mandatory: !!r?.mandatory,
    // null = the API doesn't say; false = reasoning is off unless the request turns it on.
    defaultEnabled: typeof r?.default_enabled === 'boolean' ? r.default_enabled : null,
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
    // Design Arena Elo per category (e.g. website, uicomponent); highest if a category repeats.
    arena: arena.reduce((acc, e) => {
      const elo = toNumber(e.elo);
      if (e.category && elo != null) acc[e.category] = Math.max(acc[e.category] ?? -Infinity, elo);
      return acc;
    }, {}),
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

export function modalityCounts(models, which) {
  const field = which === 'input' ? 'inputModalities' : 'outputModalities';
  return countBy(models, (m) => m[field]);
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
