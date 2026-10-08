import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/data.js';
import * as R from '../src/recommend.js';
import { makeCatalog } from './fixtures.mjs';

const A = { input: 2000, output: 500, reasoningTokens: R.DEFAULT_REASONING_TOKENS };

/** Minimal wire-format model; prices in USD per 1M tokens for readability. */
function raw({ id, inP = 1, outP = 4, reasoningP, ctx = 1_000_000, params = ['tools', 'structured_outputs'], reasoning, coding, agentic, intelligence, arena, outputs = ['text'] }) {
  return {
    id,
    name: id,
    context_length: ctx,
    architecture: { input_modalities: ['text'], output_modalities: outputs },
    pricing: {
      prompt: String(inP / 1e6),
      completion: String(outP / 1e6),
      ...(reasoningP != null ? { internal_reasoning: String(reasoningP / 1e6) } : {}),
    },
    supported_parameters: params,
    ...(reasoning ? { reasoning } : {}),
    benchmarks: {
      artificial_analysis: { coding_index: coding ?? null, agentic_index: agentic ?? null, intelligence_index: intelligence ?? null },
      design_arena: arena || [],
    },
  };
}
const model = (o) => D.normalizeModel(raw(o));

test('effort levels: non-reasoning models only run at none', () => {
  const m = model({ id: 'a/plain', params: ['tools'] });
  assert.deepEqual(R.effortLevels(m), { levels: ['none'], defaultLevel: 'none', assumed: false });
});

test('effort levels: optional reasoning adds none; mandatory removes it; order is cheapest first', () => {
  const optional = model({ id: 'a/opt', reasoning: { mandatory: false, default_enabled: true, supported_efforts: ['high', 'low'], default_effort: 'high' } });
  assert.deepEqual(R.effortLevels(optional).levels, ['none', 'low', 'high']);
  assert.equal(R.effortLevels(optional).defaultLevel, 'high');

  const mandatory = model({ id: 'a/man', reasoning: { mandatory: true, supported_efforts: ['max', 'none', 'low'], default_effort: 'max' } });
  assert.deepEqual(R.effortLevels(mandatory).levels, ['low', 'max']);
});

test('effort levels: reasoning off by default means default level none; no allowlist is flagged as assumed', () => {
  const off = model({ id: 'a/off', reasoning: { mandatory: false, default_enabled: false, supported_efforts: ['low', 'high'], default_effort: 'high' } });
  assert.equal(R.effortLevels(off).defaultLevel, 'none');
  const open = model({ id: 'a/open', reasoning: { mandatory: true, supported_efforts: null } });
  assert.deepEqual(R.effortLevels(open), { levels: ['low', 'medium', 'high'], defaultLevel: 'medium', assumed: true });
  // Reasoning only advertised via supported_parameters: optional, and off unless requested.
  const paramOnly = model({ id: 'a/param', params: ['tools', 'reasoning'] });
  assert.deepEqual(R.effortLevels(paramOnly), { levels: ['none', 'low', 'medium', 'high'], defaultLevel: 'none', assumed: true });
});

test('nearestLevel picks the closest supported level, cheaper on ties', () => {
  assert.equal(R.nearestLevel(['low', 'high', 'max'], 'high'), 'high');
  assert.equal(R.nearestLevel(['low', 'high', 'max'], 'medium'), 'low');
  assert.equal(R.nearestLevel(['low', 'high', 'max'], 'xhigh'), 'high');
  assert.equal(R.nearestLevel(['none'], 'max'), 'none');
});

test('costPer1k adds reasoning tokens at the output price, or the separate reasoning price', () => {
  const m = model({ id: 'a/m', inP: 5, outP: 25 });
  // 1k × (2000 × 5 + 500 × 25) / 1e6 = 22.5; high adds 8000 × 25 / 1e3 = 200.
  assert.equal(R.costPer1k(m, 'none', A), 22.5);
  assert.equal(R.costPer1k(m, 'high', A), 222.5);
  const sep = model({ id: 'a/sep', inP: 5, outP: 25, reasoningP: 1 });
  assert.equal(R.costPer1k(sep, 'high', A), 30.5);
});

test('candidates exclude variants, free models, unmet requirements and unscored models, and count each', () => {
  const models = [
    model({ id: 'a/ok', coding: 70 }),
    model({ id: 'a/ok:batch', coding: 70 }),
    model({ id: 'a/free', inP: 0, outP: 0, coding: 70 }),
    model({ id: 'a/notools', params: [], coding: 70 }),
    model({ id: 'a/embed', outputs: ['embeddings'], coding: 70 }),
    model({ id: 'a/short', ctx: 8000, coding: 70 }),
    model({ id: 'a/pricey', inP: 50, outP: 50, coding: 70 }),
    model({ id: 'a/unscored' }),
  ];
  const req = { quality: 'coding', require: ['tools'], minContext: 100000, maxBlended: 15 };
  const { list, excluded } = R.candidates(models, req, A);
  assert.deepEqual(list.map((c) => c.m.id), ['a/ok']);
  assert.deepEqual(excluded, { variant: 1, unpriced: 0, free: 1, capability: 2, context: 1, price: 1, noBenchmark: 1 });
  assert.deepEqual(R.candidates(models, { ...req, allowBatch: true }, A).list.map((c) => c.m.id), ['a/ok', 'a/ok:batch']);
});

test('design quality averages the website and UI-component Elo', () => {
  const m = model({
    id: 'a/web',
    arena: [
      { arena: 'models', category: 'website', elo: 1300 },
      { arena: 'models', category: 'uicomponent', elo: 1320 },
      { arena: 'models', category: 'svg', elo: 1500 },
    ],
  });
  assert.equal(R.QUALITY.design.get(m), 1310);
});

// Three providers: a premium model, a cheap strong one and a very cheap weaker one.
function field() {
  return [
    model({ id: 'p/top', inP: 5, outP: 25, coding: 80 }),
    model({ id: 'p/top-mini', inP: 1, outP: 5, coding: 72 }),
    model({ id: 'q/strong', inP: 0.5, outP: 3, coding: 77 }),
    model({ id: 'q/mid', inP: 0.3, outP: 1.5, coding: 70 }),
    model({ id: 'r/cheap', inP: 0.1, outP: 0.4, coding: 66 }),
    model({ id: 'r/weak', inP: 0.02, outP: 0.05, coding: 40 }),
  ];
}
const REQ = { quality: 'coding', require: [], minContext: 0, maxBlended: 100 };
const W = { quality: 60, cost: 30, context: 10 };

test('tiers: best = top quality, value = best score, budget = cheapest in the upper half; all distinct', () => {
  const scored = R.score(R.candidates(field(), REQ, A).list, W);
  const tiers = R.rankTiers(scored);
  const picks = Object.fromEntries(tiers.map((t) => [t.key, t.pick.m.id]));
  assert.equal(picks.best, 'p/top');
  assert.equal(picks.value, 'q/strong');
  // r/cheap and r/weak cost less but sit in the bottom half by quality.
  assert.equal(picks.budget, 'q/mid');
  assert.equal(new Set(Object.values(picks)).size, 3);
});

test('fallbacks come from a different provider than their pick and never repeat a pick', () => {
  const scored = R.score(R.candidates(field(), REQ, A).list, W);
  const tiers = R.rankTiers(scored);
  const picks = new Set(tiers.map((t) => t.pick.m.id));
  for (const t of tiers) {
    assert.ok(t.fallback, `${t.key} has a fallback`);
    assert.notEqual(t.fallback.m.author, t.pick.m.author, `${t.key} fallback provider`);
    assert.ok(!picks.has(t.fallback.m.id));
    assert.equal(t.sameAuthor, false);
  }
});

test('"Lowest cost" is never more expensive than "Best value", even when cost dominates the weights', () => {
  // The cheapest model overall sits just below the quality median, so budget skips it but value would love it.
  const models = [
    model({ id: 'p/top', inP: 5, outP: 25, coding: 80 }),
    model({ id: 'q/a', inP: 1, outP: 4, coding: 70 }),
    model({ id: 'r/b', inP: 0.5, outP: 2, coding: 66 }),
    model({ id: 's/c', inP: 0.3, outP: 1, coding: 64 }),
    model({ id: 't/cheapest', inP: 0.02, outP: 0.08, coding: 63 }),
    model({ id: 'u/d', inP: 0.4, outP: 1.5, coding: 50 }),
  ];
  for (const w of [W, { quality: 20, cost: 75, context: 5 }]) {
    const tiers = R.rankTiers(R.score(R.candidates(models, REQ, A).list, w));
    const by = Object.fromEntries(tiers.map((t) => [t.key, t.pick]));
    assert.ok(by.budget.cost <= by.value.cost, `budget ${by.budget.m.id} vs value ${by.value.m.id}`);
  }
  const fixture = makeCatalog({ count: 120 }).models.data.map(D.normalizeModel);
  for (const p of R.PRESETS.filter((x) => !x.link)) {
    const assumptions = { input: p.task.input, output: p.task.output, reasoningTokens: R.DEFAULT_REASONING_TOKENS };
    const { list } = R.candidates(fixture, { ...p, minContext: 0, maxBlended: 100 }, assumptions);
    if (list.length < 3) continue;
    const by = Object.fromEntries(R.rankTiers(R.score(list, p.weights)).map((t) => [t.key, t.pick]));
    assert.ok(by.budget.cost <= by.value.cost, p.id);
  }
});

test('fallback prefers a model close to its pick in quality over a much weaker one', () => {
  // value pick is cheap and mid-quality; next by score is far weaker, a slightly pricier one is close.
  const models = [
    model({ id: 'p/top', inP: 5, outP: 25, coding: 80 }),
    model({ id: 'q/value', inP: 0.05, outP: 0.2, coding: 60 }),
    model({ id: 'r/junk', inP: 0.01, outP: 0.02, coding: 10 }),
    model({ id: 's/close', inP: 0.5, outP: 2, coding: 58 }),
    model({ id: 't/alt', inP: 4, outP: 20, coding: 78 }),
    model({ id: 'u/mid', inP: 0.2, outP: 1, coding: 62 }),
  ];
  const tiers = R.rankTiers(R.score(R.candidates(models, REQ, A).list, { quality: 20, cost: 75, context: 5 }));
  const value = tiers.find((t) => t.key === 'value');
  assert.notEqual(value.fallback.m.id, 'r/junk');
});

test('fallback uses the same provider only when no other provider qualifies, and says so', () => {
  const only = [model({ id: 'p/a', coding: 80 }), model({ id: 'p/b', coding: 70 }), model({ id: 'p/c', coding: 60 }), model({ id: 'p/d', coding: 50 })];
  const tiers = R.rankTiers(R.score(R.candidates(only, REQ, A).list, W));
  const best = tiers.find((t) => t.key === 'best');
  assert.equal(best.sameAuthor, true);
  assert.equal(best.fallback.m.author, 'p');
});

test('frontier keeps only models no cheaper model beats on quality', () => {
  const pts = [
    { cost: 1, quality: 50, m: { id: 'a' } },
    { cost: 2, quality: 40, m: { id: 'b' } },
    { cost: 3, quality: 70, m: { id: 'c' } },
    { cost: 5, quality: 65, m: { id: 'd' } },
    { cost: 9, quality: 80, m: { id: 'e' } },
  ];
  assert.deepEqual(R.frontier(pts).map((p) => p.m.id), ['a', 'c', 'e']);
});

test('shortlist puts picks then fallbacks first, without duplicates', () => {
  const scored = R.score(R.candidates(field(), REQ, A).list, W);
  const tiers = R.rankTiers(scored);
  const list = R.shortlist(scored, tiers, 5);
  assert.equal(list.length, 5);
  assert.deepEqual(list.slice(0, 3).map((c) => c.m.id), tiers.map((t) => t.pick.m.id));
  assert.equal(new Set(list.map((c) => c.m.id)).size, 5);
});

test('every LLM preset produces three picks with fallbacks on the synthetic catalog', () => {
  const models = makeCatalog({ count: 120 }).models.data.map(D.normalizeModel);
  let ran = 0;
  for (const p of R.PRESETS.filter((x) => !x.link)) {
    const req = { ...p, minContext: 0, maxBlended: 100 };
    const assumptions = { input: p.task.input, output: p.task.output, reasoningTokens: R.DEFAULT_REASONING_TOKENS };
    const { list } = R.candidates(models, req, assumptions);
    // The synthetic catalog has no agentic+tools overlap and no Design Arena data.
    if (list.length < 6) continue;
    ran++;
    const tiers = R.rankTiers(R.score(list, p.weights));
    assert.ok(tiers.every((t) => t.pick && t.fallback), `${p.id}: ${list.length} candidates`);
  }
  assert.ok(ran >= 4, `only ${ran} presets had enough candidates`);
});
