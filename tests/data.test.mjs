import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/data.js';
import { parseSnapshot } from '../src/api.js';
import { makeCatalog } from './fixtures.mjs';

const raw = (over = {}) => ({
  id: 'acme/m1',
  name: 'Acme M1',
  created: 1_700_000_000,
  context_length: 131072,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt: '0.000001', completion: '0.000004' },
  top_provider: { max_completion_tokens: 8192, is_moderated: false },
  supported_parameters: [],
  ...over,
});

test('prices convert from USD per token to USD per 1M tokens', () => {
  const m = D.normalizeModel(raw());
  assert.equal(m.price.input, 1);
  assert.equal(m.price.output, 4);
  assert.equal(m.blended, (3 * 1 + 4) / 4);
  assert.equal(m.isFree, false);
  assert.equal(m.author, 'acme');
  assert.equal(m.maxOutput, 8192);
});

test('negative (dynamic) prices are unknown, not charted', () => {
  const m = D.normalizeModel(raw({ pricing: { prompt: '-1', completion: '-1' } }));
  assert.equal(m.price.input, null);
  assert.equal(m.blended, null);
  assert.equal(m.dynamicPricing, true);
  assert.equal(m.isFree, false);
});

test('free detection: zero token prices or :free suffix', () => {
  assert.equal(D.normalizeModel(raw({ pricing: { prompt: '0', completion: '0' } })).isFree, true);
  assert.equal(D.normalizeModel(raw({ id: 'acme/m1:free' })).isFree, true);
  // Zero token prices but a per-image price is not free.
  assert.equal(D.normalizeModel(raw({ pricing: { prompt: '0', completion: '0', image_output: '0.04' } })).isFree, false);
});

test('reasoning support comes from the reasoning object or supported_parameters', () => {
  assert.equal(D.normalizeModel(raw()).reasoning.supported, false);
  assert.equal(D.normalizeModel(raw({ supported_parameters: ['include_reasoning'] })).reasoning.supported, true);
  const m = D.normalizeModel(
    raw({ reasoning: { mandatory: true, supported_efforts: ['high', null, 'low'], supports_max_tokens: true } }),
  );
  assert.equal(m.reasoning.supported, true);
  assert.equal(m.reasoning.mandatory, true);
  assert.deepEqual(m.reasoning.efforts, ['high', 'low']);
  assert.equal(m.reasoning.supportsMaxTokens, true);
  assert.equal(D.normalizeModel(raw({ reasoning: { mandatory: false, supported_efforts: null } })).reasoning.efforts, null);
});

test('capabilities derive from parameters, modalities and pricing', () => {
  const m = D.normalizeModel(
    raw({
      supported_parameters: ['tools', 'response_format', 'web_search_options'],
      architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text', 'image'] },
      pricing: { prompt: '0.000001', completion: '0.000002', input_cache_read: '0.0000001' },
    }),
  );
  assert.equal(m.caps.tools, true);
  assert.equal(m.caps.structured, true);
  assert.equal(m.caps.webSearch, true);
  assert.equal(m.caps.vision, true);
  assert.equal(m.caps.file, true);
  assert.equal(m.caps.imageOut, true);
  assert.equal(m.caps.caching, true);
  assert.equal(m.caps.audioIn, false);
  assert.ok(Math.abs(m.price.cacheRead - 0.1) < 1e-9);
});

test('benchmarks are read from artificial_analysis and design_arena', () => {
  const m = D.normalizeModel(
    raw({
      benchmarks: {
        artificial_analysis: { intelligence_index: 61.2, coding_index: null, agentic_index: 40 },
        design_arena: [{ elo: 1200 }, { elo: 1350 }],
      },
    }),
  );
  assert.equal(m.bench.intelligence, 61.2);
  assert.equal(m.bench.coding, null);
  assert.equal(m.bench.arenaBestElo, 1350);
});

test('filterModels applies every filter together', () => {
  const models = makeCatalog().models.data.map(D.normalizeModel);
  const all = D.filterModels(models, {});
  assert.equal(all.length, models.length);
  const paid = D.filterModels(models, { pricing: 'paid' });
  assert.ok(paid.every((m) => !m.isFree && m.blended != null));
  const free = D.filterModels(models, { pricing: 'free' });
  assert.ok(free.length > 0 && free.every((m) => m.isFree));
  const combo = D.filterModels(models, { author: 'acme', capabilities: ['tools', 'reasoning'] });
  assert.ok(combo.every((m) => m.author === 'acme' && m.caps.tools && m.caps.reasoning));
  assert.ok(D.filterModels(models, { query: 'GLOBEX' }).every((m) => m.author === 'globex'));
});

test('topBy skips nulls and respects direction', () => {
  const ms = [{ name: 'a', v: 3 }, { name: 'b', v: null }, { name: 'c', v: 1 }, { name: 'd', v: 2 }];
  assert.deepEqual(D.topBy(ms, (m) => m.v, 2, 'asc').map((m) => m.name), ['c', 'd']);
  assert.deepEqual(D.topBy(ms, (m) => m.v, 5, 'desc').map((m) => m.name), ['a', 'd', 'c']);
});

test('histograms put every priced model in exactly one bin', () => {
  const models = makeCatalog().models.data.map(D.normalizeModel);
  const priced = models.filter((m) => m.price.input != null).length;
  assert.equal(D.priceHistogram(models).reduce((s, b) => s + b.count, 0), priced);
  const hist = D.priceHistogram([{ price: { input: 0 } }, { price: { input: 0.1 } }, { price: { input: 99 } }]);
  assert.equal(hist[0].count, 1); // Free
  assert.equal(hist.find((b) => b.label === '$0.10–0.50').count, 1); // lower bound inclusive
  assert.equal(hist.at(-1).count, 1);
  const ctx = D.contextHistogram([{ contextLength: 8192 }, { contextLength: 8193 }, { contextLength: 2e6 }]);
  assert.deepEqual(ctx.map((b) => b.count), [1, 1, 0, 0, 0, 1]);
});

test('releasesByMonth buckets by UTC month and ignores older models', () => {
  const now = new Date(Date.UTC(2026, 9, 15));
  const at = (y, mo) => ({ created: new Date(Date.UTC(y, mo, 2)) });
  const b = D.releasesByMonth([at(2026, 9), at(2026, 9), at(2026, 8), at(2020, 0), { created: null }], 3, now);
  assert.deepEqual(b.map((x) => [x.key, x.count]), [['2026-08', 0], ['2026-09', 1], ['2026-10', 2]]);
});

test('reasoningStats counts effort allowlists and unrestricted models', () => {
  const models = [
    raw({ id: 'a/1', reasoning: { mandatory: true, supported_efforts: ['high', 'low'] } }),
    raw({ id: 'a/2', reasoning: { mandatory: false, supported_efforts: null, supports_max_tokens: true } }),
    raw({ id: 'a/3' }),
  ].map(D.normalizeModel);
  const s = D.reasoningStats(models);
  assert.equal(s.total, 2);
  assert.equal(s.mandatory, 1);
  assert.equal(s.optional, 1);
  assert.equal(s.maxTokens, 1);
  assert.equal(s.unrestrictedEfforts, 1);
  assert.equal(s.effortCounts.find((e) => e.level === 'high').count, 1);
  assert.equal(s.effortCounts.find((e) => e.level === 'medium').count, 0);
});

test('authorCapabilityMatrix shares are per author', () => {
  const models = [
    raw({ id: 'x/1', supported_parameters: ['tools'] }),
    raw({ id: 'x/2' }),
    raw({ id: 'y/1', supported_parameters: ['tools'] }),
  ].map(D.normalizeModel);
  const mx = D.authorCapabilityMatrix(models);
  const toolsCol = mx.cols.findIndex((c) => c.key === 'tools');
  assert.deepEqual(mx.rows.map((r) => r.key), ['x', 'y']);
  assert.equal(mx.cells[0][toolsCol].share, 0.5);
  assert.equal(mx.cells[1][toolsCol].share, 1);
});

test('video models: SKUs parsed and sorted, max duration computed', () => {
  const v = D.normalizeVideoModel({
    id: 'acme/v',
    name: 'V',
    supported_durations: [5, 10],
    pricing_skus: { b: '0.5', a: '0.1', bad: 'n/a' },
  });
  assert.equal(v.maxDuration, 10);
  assert.deepEqual(v.skus.map((s) => s.key), ['a', 'b']);
  assert.equal(v.cheapestSku.price, 0.1);
  assert.equal(D.normalizeVideoModel({ id: 'acme/w', supported_durations: null }).maxDuration, null);
});

test('toCSV escapes quotes, commas and newlines', () => {
  const csv = D.toCSV([{ label: 'a', value: (r) => r.a }, { label: 'b', value: (r) => r.b }], [{ a: 'x,"y"', b: null }]);
  assert.equal(csv, 'a,b\n"x,""y""",');
});

test('parseSnapshot accepts snapshot files and raw /models responses', () => {
  const cat = makeCatalog();
  const snap = parseSnapshot({ fetchedAt: 't', ...cat });
  assert.equal(snap.models.length, cat.models.data.length);
  assert.equal(snap.videos.length, 4);
  const rawOnly = parseSnapshot(cat.models);
  assert.equal(rawOnly.images, null);
  assert.throws(() => parseSnapshot({ nope: 1 }));
});
