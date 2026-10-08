// Pure recommendation logic for the "Pick for a project" section: presets,
// per-task cost by reasoning effort, requirement filtering, scoring, tiers
// with fallbacks and the quality/cost frontier. No DOM access, so it runs in
// Node tests too.

/** Effort levels from cheapest to most expensive. */
export const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * OpenRouter publishes which efforts a model accepts, not how many reasoning
 * tokens each one spends, so these are editable estimates.
 */
export const DEFAULT_REASONING_TOKENS = {
  none: 0,
  minimal: 500,
  low: 1000,
  medium: 3000,
  high: 8000,
  xhigh: 16000,
  max: 32000,
};

// Levels assumed when a reasoning model publishes no effort allowlist.
const UNLISTED_LEVELS = ['low', 'medium', 'high'];

const mean = (values) => {
  const v = values.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export const QUALITY = {
  coding: { label: 'Coding index', short: 'Coding', get: (m) => m.bench.coding },
  agentic: { label: 'Agentic index', short: 'Agentic', get: (m) => m.bench.agentic },
  intelligence: { label: 'Intelligence index', short: 'Intelligence', get: (m) => m.bench.intelligence },
  design: {
    label: 'Design Arena Elo (website, UI component)',
    short: 'Design Elo',
    get: (m) => {
      const v = mean([m.bench.arena?.website, m.bench.arena?.uicomponent]);
      return v == null ? null : Math.round(v);
    },
  },
};

/**
 * LLM presets set the quality metric, hard requirements, weights and task size.
 * `link` presets jump to a section instead (image and video generation use
 * other catalogs and have no quality benchmark in the API).
 */
export const PRESETS = [
  {
    id: 'coding',
    label: 'Coding agent',
    hint: 'Coding index · tools · long context',
    quality: 'coding',
    require: ['tools'],
    minContext: 200000,
    maxBlended: 15,
    weights: { quality: 60, cost: 30, context: 10 },
    task: { input: 2000, output: 500 },
  },
  {
    id: 'agent',
    label: 'Agentic workflow',
    hint: 'Agentic index · tools · structured outputs',
    quality: 'agentic',
    require: ['tools', 'structured'],
    minContext: 128000,
    maxBlended: 15,
    weights: { quality: 60, cost: 30, context: 10 },
    task: { input: 4000, output: 800 },
  },
  {
    id: 'chat',
    label: 'Chat assistant',
    hint: 'Intelligence index · low cost',
    quality: 'intelligence',
    require: [],
    minContext: 32000,
    maxBlended: 10,
    weights: { quality: 50, cost: 45, context: 5 },
    task: { input: 1500, output: 400 },
  },
  {
    id: 'rag',
    label: 'Long-document RAG',
    hint: 'Context ≥ 500K · cheap input',
    quality: 'intelligence',
    require: [],
    minContext: 500000,
    maxBlended: 10,
    weights: { quality: 35, cost: 40, context: 25 },
    task: { input: 100000, output: 800 },
  },
  {
    id: 'extract',
    label: 'Bulk extraction',
    hint: 'Structured outputs · lowest cost',
    quality: 'intelligence',
    require: ['structured'],
    minContext: 32000,
    maxBlended: 3,
    weights: { quality: 25, cost: 70, context: 5 },
    task: { input: 3000, output: 300 },
    allowBatch: true,
  },
  {
    id: 'web',
    label: 'Website / UI',
    hint: 'Design Arena: website, UI',
    quality: 'design',
    require: [],
    minContext: 64000,
    maxBlended: 15,
    weights: { quality: 65, cost: 30, context: 5 },
    task: { input: 3000, output: 4000 },
  },
  {
    id: 'vision',
    label: 'Vision',
    hint: 'Image input · Intelligence index',
    quality: 'intelligence',
    require: ['vision'],
    minContext: 32000,
    maxBlended: 10,
    weights: { quality: 55, cost: 40, context: 5 },
    task: { input: 3000, output: 500 },
  },
  { id: 'images', label: 'Image generation', hint: '$ per image', link: '#images' },
  { id: 'videos', label: 'Video generation', hint: 'Duration · resolution', link: '#videos' },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

/** Suffix after ':' in a model id (e.g. "batch", "free"), or null. */
export function variantOf(id) {
  const i = String(id).lastIndexOf(':');
  return i > 0 ? id.slice(i + 1) : null;
}

/**
 * Effort levels a model can run at, cheapest first, and the one it uses when a
 * request doesn't say. `assumed` marks reasoning models without an allowlist.
 */
export function effortLevels(m) {
  const r = m.reasoning;
  if (!r.supported) return { levels: ['none'], defaultLevel: 'none', assumed: false };
  const listed = r.efforts;
  let levels = EFFORT_ORDER.filter((e) => (listed || UNLISTED_LEVELS).includes(e));
  if (!r.mandatory && !levels.includes('none')) levels = ['none', ...levels];
  if (r.mandatory && levels.length > 1) levels = levels.filter((e) => e !== 'none');
  let defaultLevel;
  // Optional reasoning counts as off by default unless the API says it is on.
  if (!r.mandatory && r.defaultEnabled !== true && levels.includes('none')) defaultLevel = 'none';
  else if (levels.includes(r.defaultEffort)) defaultLevel = r.defaultEffort;
  else if (levels.includes('medium')) defaultLevel = 'medium';
  else defaultLevel = levels[Math.floor(levels.length / 2)];
  return { levels, defaultLevel, assumed: !listed };
}

/** The supported level closest to `wanted` in EFFORT_ORDER (ties go to the cheaper one). */
export function nearestLevel(levels, wanted) {
  if (levels.includes(wanted)) return wanted;
  const target = EFFORT_ORDER.indexOf(wanted);
  return [...levels].sort(
    (a, b) =>
      Math.abs(EFFORT_ORDER.indexOf(a) - target) - Math.abs(EFFORT_ORDER.indexOf(b) - target) ||
      EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b),
  )[0];
}

/**
 * Estimated USD per 1,000 tasks at an effort level. Reasoning tokens use the
 * model's separate reasoning price when it has one, else its output price.
 * assumptions: { input, output, reasoningTokens: { [level]: tokens } }
 */
export function costPer1k(m, effort, assumptions) {
  const { input: inP, output: outP, reasoning } = m.price;
  if (inP == null || outP == null) return null;
  const reasoningP = reasoning > 0 ? reasoning : outP;
  const reasoningTokens = effort === 'none' ? 0 : assumptions.reasoningTokens[effort] ?? 0;
  const perTask = (inP * assumptions.input + outP * assumptions.output + reasoningP * reasoningTokens) / 1e6;
  return perTask * 1000;
}

/** Cost at every supported level: [{ level, cost }] cheapest level first. */
export function effortCosts(m, assumptions) {
  return effortLevels(m).levels.map((level) => ({ level, cost: costPer1k(m, level, assumptions) }));
}

/**
 * Models that meet the requirements, each with its quality score and cost at
 * its default effort, plus counts of what was left out and why.
 * req: { quality, require[], minContext, maxBlended, allowBatch }
 */
export function candidates(models, req, assumptions) {
  const quality = QUALITY[req.quality];
  const excluded = { variant: 0, unpriced: 0, free: 0, capability: 0, context: 0, price: 0, noBenchmark: 0 };
  const list = [];
  for (const m of models) {
    const variant = variantOf(m.id);
    if (variant && !(req.allowBatch && variant === 'batch')) {
      excluded.variant++;
      continue;
    }
    if (m.dynamicPricing || m.blended == null) {
      excluded.unpriced++;
      continue;
    }
    if (m.isFree || m.blended === 0) {
      excluded.free++;
      continue;
    }
    // Text output is implied: embedding, rerank and speech models can't do these tasks.
    if (!m.outputModalities.includes('text') || !(req.require || []).every((c) => m.caps[c])) {
      excluded.capability++;
      continue;
    }
    if ((m.contextLength ?? 0) < (req.minContext || 0)) {
      excluded.context++;
      continue;
    }
    if (req.maxBlended != null && m.blended > req.maxBlended) {
      excluded.price++;
      continue;
    }
    const q = quality.get(m);
    if (q == null) {
      excluded.noBenchmark++;
      continue;
    }
    const { levels, defaultLevel, assumed } = effortLevels(m);
    const cost = costPer1k(m, defaultLevel, assumptions);
    if (!(cost > 0)) {
      excluded.unpriced++;
      continue;
    }
    list.push({ m, quality: q, cost, levels, defaultLevel, assumed });
  }
  return { list, excluded };
}

const normalizer = (values, log) => {
  const v = values.map((x) => (log ? Math.log(x) : x));
  const lo = Math.min(...v);
  const span = Math.max(...v) - lo;
  return (x) => (span > 0 ? ((log ? Math.log(x) : x) - lo) / span : 1);
};

/** Weighted 0..1 score: quality up, cost down (log), context up (log). Returns new objects. */
export function score(list, weights) {
  if (!list.length) return [];
  const q = normalizer(list.map((c) => c.quality), false);
  const cost = normalizer(list.map((c) => c.cost), true);
  const ctx = normalizer(list.map((c) => c.m.contextLength || 1), true);
  const total = weights.quality + weights.cost + weights.context || 1;
  return list.map((c) => ({
    ...c,
    score: (weights.quality * q(c.quality) + weights.cost * (1 - cost(c.cost)) + weights.context * ctx(c.m.contextLength || 1)) / total,
  }));
}

const byName = (a, b) => a.m.name.localeCompare(b.m.name);

/** Lower median of candidate quality: the floor the budget tier must meet. */
export function qualityMedian(list) {
  const sorted = list.map((c) => c.quality).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

/** Lowest-cost model in the upper half by quality: the cheapest pick that isn't a big quality drop. */
function budgetOrder(list) {
  const medianQ = qualityMedian(list);
  return list.filter((c) => c.quality >= medianQ).sort((a, b) => a.cost - b.cost || b.quality - a.quality || byName(a, b));
}

export const TIERS = [
  { key: 'best', label: 'Best quality', order: (l) => [...l].sort((a, b) => b.quality - a.quality || a.cost - b.cost || byName(a, b)) },
  { key: 'value', label: 'Best value', order: (l) => [...l].sort((a, b) => b.score - a.score || byName(a, b)) },
  { key: 'budget', label: 'Lowest cost', order: budgetOrder },
];

/**
 * Three distinct picks, each with a fallback: the next model in the same
 * tier's ordering from a different provider, preferring ones close to the
 * pick's quality (same provider only if no other provider qualifies, flagged
 * with `sameAuthor`).
 */
export function rankTiers(scored) {
  const taken = new Set();
  const byScore = TIERS[1].order(scored);
  const pickFor = (t, order) => {
    const pick = order.find((c) => !taken.has(c.m.id)) || null;
    if (pick) taken.add(pick.m.id);
    return { key: t.key, label: t.label, order, pick, fallback: null, sameAuthor: false };
  };
  // A tier's own order can run out (budget only looks at the upper half); continue by score.
  const withRest = (own) => [...own, ...byScore.filter((c) => !own.includes(c))];
  const [bestT, valueT, budgetT] = TIERS;
  const best = pickFor(bestT, withRest(bestT.order(scored)));
  const budget = pickFor(budgetT, withRest(budgetT.order(scored)));
  // Value never undercuts the budget pick, so "Lowest cost" stays the cheapest of the three.
  const floor = budget.pick?.cost ?? 0;
  const valueOwn = valueT.order(scored);
  const value = pickFor(valueT, withRest([...valueOwn.filter((c) => c.cost >= floor), ...valueOwn.filter((c) => c.cost < floor)]));
  const tiers = [best, value, budget];
  // A fallback should be a near substitute: within 10% of the quality range below its pick when possible.
  const qs = scored.map((c) => c.quality);
  const tolerance = 0.1 * (Math.max(...qs) - Math.min(...qs));
  for (const t of tiers) {
    if (!t.pick) continue;
    const open = t.order.filter((c) => !taken.has(c.m.id));
    const close = open.filter((c) => c.quality >= t.pick.quality - tolerance);
    const free = [...close, ...open.filter((c) => !close.includes(c))];
    const other = free.find((c) => c.m.author !== t.pick.m.author);
    t.fallback = other || free[0] || null;
    t.sameAuthor = !other && !!t.fallback;
    if (t.fallback) taken.add(t.fallback.m.id);
  }
  return tiers.map(({ order, ...rest }) => rest);
}

/** Picks and fallbacks first, then the best-scoring rest, up to `size` models. */
export function shortlist(scored, tiers, size = 10) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (c && !seen.has(c.m.id) && out.length < size) {
      seen.add(c.m.id);
      out.push(c);
    }
  };
  for (const t of tiers) add(t.pick);
  for (const t of tiers) add(t.fallback);
  for (const c of [...scored].sort((a, b) => b.score - a.score || byName(a, b))) add(c);
  return out;
}

/** Models no other model beats on both lower cost and higher quality, cheapest first. */
export function frontier(list) {
  const out = [];
  let bestQ = -Infinity;
  for (const c of [...list].sort((a, b) => a.cost - b.cost || b.quality - a.quality)) {
    if (c.quality > bestQ) {
      out.push(c);
      bestQ = c.quality;
    }
  }
  return out;
}

/** 1-based rank of `value` among `values` (higher is better). */
export function rankOf(values, value) {
  return values.filter((v) => v > value).length + 1;
}
