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

test('endpoints: median p50 latency and throughput across providers, fastest named, nulls ignored', () => {
  const s = D.normalizeEndpoints({
    data: {
      endpoints: [
        { provider_name: 'A', latency_last_30m: { p50: 1500, p90: 4000 }, throughput_last_30m: { p50: 40 } },
        { provider_name: 'B', latency_last_30m: { p50: 1200 }, throughput_last_30m: 90 },
        { provider_name: 'C', latency_last_30m: { p50: 3000 }, throughput_last_30m: null },
        { provider_name: 'D', latency_last_30m: null, throughput_last_30m: null },
      ],
    },
  });
  assert.equal(s.latency, 1500);
  assert.equal(s.throughput, 65);
  assert.equal(s.fastestLatency.name, 'B');
  assert.equal(s.fastestThroughput.name, 'B');
  assert.equal(s.measuredProviders, 3);
  const empty = D.normalizeEndpoints({ data: { endpoints: [{ provider_name: 'X', latency_last_30m: null }] } });
  assert.deepEqual([empty.latency, empty.throughput, empty.fastestLatency, empty.measuredProviders], [null, null, null, 0]);
  assert.equal(D.normalizeEndpoints({ data: [] }).providers.length, 0);
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
