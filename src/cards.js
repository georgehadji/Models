// Card definitions for every section below "Pick for a project". Each card
// charts named models (no counts or distributions); build(ctx) returns the
// chart spec plus the same data as a table.

import * as D from './data.js';
import * as F from './format.js';
import * as R from './recommend.js';
import { pickState } from './pick-controls.js';

const S1 = 'var(--series-1)';
const S2 = 'var(--series-2)';
const S3 = 'var(--series-3)';

const PRICE_SERIES = [
  { name: 'Input', color: S1 },
  { name: 'Output', color: S2 },
];

const score = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));

/** Cost assumptions shared with the pick section, so every $/task figure agrees. */
function assumptions() {
  const s = pickState();
  return { input: s.task.input, output: s.task.output, reasoningTokens: s.reasoningTokens };
}

const taskNote = () => {
  const a = assumptions();
  return `${F.int(a.input)} input + ${F.int(a.output)} output tokens per task, reasoning tokens as set in Pick for a project`;
};

/** Highest Intelligence index first; unscored models follow alphabetically. */
function byIntelligence(models) {
  return [...models].sort(
    (a, b) => (b.bench.intelligence ?? -1) - (a.bench.intelligence ?? -1) || a.name.localeCompare(b.name),
  );
}

function priceBars(models, extraSub = () => []) {
  return {
    chart: {
      type: 'bar',
      spec: {
        series: PRICE_SERIES,
        format: F.usd,
        label: 'Input and output price per 1M tokens',
        rows: models.map((m) => ({
          label: m.name,
          values: [m.price.input, m.price.output],
          sub: [{ value: F.usd(m.blended), label: 'blended / 1M' }, ...extraSub(m), { value: m.id }],
        })),
      },
    },
    table: {
      columns: [
        { label: 'Model', value: (m) => m.name },
        { label: 'Input $/1M', value: (m) => F.usd(m.price.input), num: true },
        { label: 'Output $/1M', value: (m) => F.usd(m.price.output), num: true },
        { label: 'Blended $/1M', value: (m) => F.usd(m.blended), num: true },
      ],
      rows: models,
    },
  };
}

/** Model × column heatmap. cells[i][j] = { value 0..1, text, detail } */
function matrix(rowLabels, colLabels, cells, { label, dark }) {
  return {
    chart: {
      type: 'heatmap',
      spec: {
        label,
        dark,
        rows: rowLabels,
        cols: colLabels,
        cells: cells.map((row, i) =>
          row.map((c, j) => ({
            value: c.value,
            tip: { title: `${rowLabels[i]} · ${colLabels[j]}`, rows: [{ value: c.text, label: c.detail || '' }] },
          })),
        ),
      },
    },
    table: {
      columns: [
        { label: 'Model', value: (r) => r.label },
        ...colLabels.map((c, j) => ({ label: c, value: (r) => r.cells[j].text, num: true })),
      ],
      rows: rowLabels.map((l, i) => ({ label: l, cells: cells[i] })),
    },
  };
}

// Mid-ramp rather than the darkest step: a yes/no grid shouldn't read as a field of maximal values.
const yesNo = (v) => ({ value: v ? 0.6 : 0, text: v ? 'Yes' : '—' });

function unavailable(message) {
  return { chart: { type: 'empty', message }, table: { columns: [], rows: [] } };
}

function scatterPoint(m, x, y, rows, group = 0) {
  return { id: m.id, x, y, group, label: m.name, tip: { title: m.name, rows } };
}

const reasoningGroups = [
  { name: 'Reasoning', color: S1 },
  { name: 'Non-reasoning', color: S2 },
];

export const CARDS = [
  // ---------- pricing ----------
  {
    id: 'price-low',
    section: 'pricing',
    title: 'Cheapest paid models',
    sub: (c) => `Top ${c.top} by blended price · USD per 1M tokens`,
    legend: PRICE_SERIES,
    build: (c) => priceBars(D.topBy(c.models.filter((m) => !m.isFree && m.blended > 0), (m) => m.blended, c.top, 'asc')),
  },
  {
    id: 'price-high',
    section: 'pricing',
    title: 'Most expensive models',
    sub: (c) => `Top ${c.top} by blended price · USD per 1M tokens`,
    legend: PRICE_SERIES,
    build: (c) => priceBars(D.topBy(c.models, (m) => m.blended, c.top, 'desc')),
  },
  {
    id: 'price-task',
    section: 'pricing',
    title: 'Cheapest per task at default effort',
    sub: (c) => `Top ${c.top} text-output models by estimated $ per 1,000 tasks, at each model's default reasoning effort · ${taskNote()}`,
    build: (c) => {
      const a = assumptions();
      // Text output only: embedding, rerank and speech models don't complete tasks.
      const rows = c.models
        .filter((m) => !m.isFree && m.blended > 0 && m.outputModalities.includes('text'))
        .map((m) => {
          const { defaultLevel } = R.effortLevels(m);
          return { m, level: defaultLevel, cost: R.costPer1k(m, defaultLevel, a) };
        })
        .filter((r) => r.cost > 0)
        .sort((x, y) => x.cost - y.cost || x.m.name.localeCompare(y.m.name))
        .slice(0, c.top);
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [{ name: '$ per 1k tasks', color: S1 }],
            format: F.usd,
            label: 'Cheapest models per task at default effort',
            rows: rows.map((r) => ({
              label: r.m.name,
              values: [r.cost],
              sub: [{ value: r.level, label: 'default effort' }, { value: F.usd(r.m.blended), label: 'blended / 1M' }, { value: r.m.id }],
            })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (r) => r.m.name },
            { label: 'Default effort', value: (r) => r.level },
            { label: '$ / 1k tasks', value: (r) => F.usd(r.cost), num: true },
            { label: 'Blended $/1M', value: (r) => F.usd(r.m.blended), num: true },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'price-io',
    section: 'pricing',
    title: 'Input vs output price',
    sub: () => 'USD per 1M tokens, both log scale · 3 cheapest and 3 most expensive labelled',
    legend: [
      { name: 'Reasoning', color: S1, dot: true },
      { name: 'Non-reasoning', color: S2, dot: true },
    ],
    build: (c) => {
      const pts = c.models.filter((m) => m.price.input > 0 && m.price.output > 0);
      const labelIds = new Set([
        ...D.topBy(pts, (m) => m.blended, 3, 'asc').map((m) => m.id),
        ...D.topBy(pts, (m) => m.blended, 3, 'desc').map((m) => m.id),
      ]);
      return {
        chart: {
          type: 'scatter',
          spec: {
            label: 'Input price against output price',
            groups: reasoningGroups,
            xLog: true,
            yLog: true,
            xTitle: 'Input $ / 1M tokens',
            yTitle: 'Output $ / 1M tokens',
            xFormat: F.usd,
            yFormat: F.usd,
            labelIds,
            points: pts.map((m) =>
              scatterPoint(m, m.price.input, m.price.output, [
                { value: F.usd(m.price.input), label: 'input / 1M' },
                { value: F.usd(m.price.output), label: 'output / 1M' },
              ], m.reasoning.supported ? 0 : 1),
            ),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Input $/1M', value: (m) => F.usd(m.price.input), num: true },
            { label: 'Output $/1M', value: (m) => F.usd(m.price.output), num: true },
          ],
          rows: D.topBy(pts, (m) => m.blended, pts.length, 'asc'),
        },
      };
    },
  },
  {
    id: 'price-context',
    section: 'pricing',
    wide: true,
    title: 'Price vs context window',
    sub: () => 'Blended USD per 1M tokens vs context length, both log scale · free models omitted · 6 largest contexts labelled',
    legend: [
      { name: 'Reasoning', color: S1, dot: true },
      { name: 'Non-reasoning', color: S2, dot: true },
    ],
    build: (c) => {
      const pts = c.models.filter((m) => m.blended > 0 && m.contextLength > 0);
      return {
        chart: {
          type: 'scatter',
          spec: {
            label: 'Blended price versus context window',
            groups: reasoningGroups,
            xLog: true,
            yLog: true,
            xTitle: 'Context window (tokens)',
            yTitle: 'Blended $ / 1M tokens',
            xFormat: F.tokens,
            yFormat: F.usd,
            labelIds: new Set(D.topBy(pts, (m) => m.contextLength, 6).map((m) => m.id)),
            points: pts.map((m) =>
              scatterPoint(m, m.contextLength, m.blended, [
                { value: F.usd(m.blended), label: 'blended / 1M' },
                { value: F.tokens(m.contextLength), label: 'context' },
              ], m.reasoning.supported ? 0 : 1),
            ),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Context', value: (m) => F.tokens(m.contextLength), num: true },
            { label: 'Blended $/1M', value: (m) => F.usd(m.blended), num: true },
            { label: 'Reasoning', value: (m) => (m.reasoning.supported ? 'Yes' : 'No') },
          ],
          rows: D.topBy(pts, (m) => m.blended, pts.length, 'asc'),
        },
      };
    },
  },

  // ---------- capabilities ----------
  {
    id: 'cap-models',
    section: 'capabilities',
    wide: true,
    title: 'Capabilities and modalities by model',
    sub: (c) => `Top ${c.top} filtered models by Intelligence index (unscored models follow) · each row is one model`,
    build: (c) => {
      const models = byIntelligence(c.models).slice(0, c.top);
      return matrix(
        models.map((m) => m.name),
        D.CAPABILITIES.map((cap) => cap.label),
        models.map((m) => D.CAPABILITIES.map((cap) => yesNo(m.caps[cap.key]))),
        { label: 'Capabilities by model', dark: c.dark },
      );
    },
  },

  // ---------- context ----------
  {
    id: 'ctx-top',
    section: 'context',
    title: 'Largest context windows',
    sub: (c) => `Top ${c.top} by context length, with the top provider's max output tokens`,
    legend: [
      { name: 'Context window', color: S1 },
      { name: 'Max output', color: S2 },
    ],
    build: (c) => {
      const rows = D.topBy(c.models, (m) => m.contextLength, c.top, 'desc');
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [
              { name: 'Context window', color: S1 },
              { name: 'Max output', color: S2 },
            ],
            format: F.tokens,
            label: 'Largest context windows',
            rows: rows.map((m) => ({ label: m.name, values: [m.contextLength, m.maxOutput], sub: [{ value: m.id }] })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Context', value: (m) => F.int(m.contextLength), num: true },
            { label: 'Max output', value: (m) => F.int(m.maxOutput), num: true },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'ctx-price',
    section: 'context',
    title: 'Cheapest models with a 1M+ context',
    sub: (c) => `Top ${c.top} paid models with a context window of at least 1M tokens, by blended price · USD per 1M tokens`,
    legend: PRICE_SERIES,
    build: (c) =>
      priceBars(
        D.topBy(c.models.filter((m) => !m.isFree && m.blended > 0 && m.contextLength >= 1e6), (m) => m.blended, c.top, 'asc'),
        (m) => [{ value: F.tokens(m.contextLength), label: 'context' }],
      ),
  },

  // ---------- reasoning ----------
  {
    id: 'reason-effort',
    section: 'reasoning',
    wide: true,
    title: 'Reasoning effort levels by model',
    sub: (c) =>
      `Top ${c.top} reasoning models by Intelligence index · strongest cell = default effort (${c.dark ? 'lightest in dark theme' : 'darkest in light theme'}) · palest = level assumed, no effort list published`,
    build: (c) => {
      const models = byIntelligence(c.models.filter((m) => m.reasoning.supported)).slice(0, c.top);
      const a = assumptions();
      return matrix(
        models.map((m) => m.name),
        R.EFFORT_ORDER,
        models.map((m) => {
          const { levels, defaultLevel, assumed } = R.effortLevels(m);
          return R.EFFORT_ORDER.map((level) => {
            if (!levels.includes(level)) return { value: 0, text: '—', detail: 'not offered' };
            const detail = `${F.usd(R.costPer1k(m, level, a))} per 1k tasks`;
            if (level === defaultLevel) return { value: 1, text: 'Default', detail };
            return assumed && level !== 'none' ? { value: 0.3, text: 'Assumed', detail } : { value: 0.55, text: 'Yes', detail };
          });
        }),
        { label: 'Reasoning effort levels by model', dark: c.dark },
      );
    },
  },
  {
    id: 'reason-spread',
    section: 'reasoning',
    wide: true,
    title: 'Cost from lowest to highest effort',
    sub: (c) => `Top ${c.top} reasoning models by Intelligence index · estimated $ per 1,000 tasks · ${taskNote()}`,
    legend: [
      { name: 'Lowest effort', color: S3 },
      { name: 'Default effort', color: S1 },
      { name: 'Highest effort', color: S2 },
    ],
    build: (c) => {
      const a = assumptions();
      const rows = byIntelligence(c.models.filter((m) => m.reasoning.supported && m.blended > 0))
        .slice(0, c.top)
        .map((m) => {
          const costs = R.effortCosts(m, a);
          const { defaultLevel } = R.effortLevels(m);
          return { m, low: costs[0], high: costs.at(-1), def: costs.find((x) => x.level === defaultLevel) };
        });
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [
              { name: 'Lowest effort', color: S3 },
              { name: 'Default effort', color: S1 },
              { name: 'Highest effort', color: S2 },
            ],
            format: F.usd,
            label: 'Cost per 1,000 tasks at lowest, default and highest effort',
            rows: rows.map((r) => ({
              label: r.m.name,
              values: [r.low.cost, r.def.cost, r.high.cost],
              sub: [{ value: `${r.low.level} · ${r.def.level} · ${r.high.level}`, label: 'levels' }, { value: r.m.id }],
            })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (r) => r.m.name },
            { label: 'Lowest', value: (r) => `${F.usd(r.low.cost)} (${r.low.level})`, num: true },
            { label: 'Default', value: (r) => `${F.usd(r.def.cost)} (${r.def.level})`, num: true },
            { label: 'Highest', value: (r) => `${F.usd(r.high.cost)} (${r.high.level})`, num: true },
          ],
          rows,
        },
      };
    },
  },

  // ---------- benchmarks ----------
  {
    id: 'bench-top',
    section: 'benchmarks',
    title: 'Artificial Analysis indices',
    sub: (c) => `Top ${c.top} by Intelligence Index`,
    legend: [
      { name: 'Intelligence', color: S1 },
      { name: 'Coding', color: S2 },
      { name: 'Agentic', color: S3 },
    ],
    build: (c) => {
      const rows = D.topBy(c.models, (m) => m.bench.intelligence, c.top, 'desc');
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [
              { name: 'Intelligence', color: S1 },
              { name: 'Coding', color: S2 },
              { name: 'Agentic', color: S3 },
            ],
            format: score,
            label: 'Artificial Analysis indices',
            empty: 'No benchmark scores for the current filters.',
            rows: rows.map((m) => ({ label: m.name, values: [m.bench.intelligence, m.bench.coding, m.bench.agentic] })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Intelligence', value: (m) => score(m.bench.intelligence), num: true },
            { label: 'Coding', value: (m) => score(m.bench.coding), num: true },
            { label: 'Agentic', value: (m) => score(m.bench.agentic), num: true },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'bench-value',
    section: 'benchmarks',
    title: 'Intelligence vs price',
    sub: () => 'Intelligence Index vs blended USD per 1M tokens (log) · top 6 scores labelled',
    build: (c) => {
      const pts = c.models.filter((m) => m.bench.intelligence != null && m.blended > 0);
      return {
        chart: {
          type: 'scatter',
          spec: {
            label: 'Intelligence index versus blended price',
            empty: 'No priced models with benchmark scores for the current filters.',
            groups: [{ name: 'Models', color: S1 }],
            xLog: true,
            xTitle: 'Blended $ / 1M tokens',
            yTitle: 'Intelligence Index',
            xFormat: F.usd,
            yFormat: (v) => String(v),
            labelIds: new Set(D.topBy(pts, (m) => m.bench.intelligence, 6).map((m) => m.id)),
            points: pts.map((m) =>
              scatterPoint(m, m.blended, m.bench.intelligence, [
                { value: String(m.bench.intelligence), label: 'Intelligence Index' },
                { value: F.usd(m.blended), label: 'blended / 1M' },
              ]),
            ),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Intelligence', value: (m) => String(m.bench.intelligence), num: true },
            { label: 'Blended $/1M', value: (m) => F.usd(m.blended), num: true },
          ],
          rows: D.topBy(pts, (m) => m.bench.intelligence, pts.length),
        },
      };
    },
  },

  // ---------- timeline ----------
  {
    id: 'releases',
    section: 'timeline',
    wide: true,
    title: 'Release date vs intelligence',
    sub: () => 'Each dot is a model: its created date on OpenRouter against its Intelligence Index · models without a score are omitted · 8 newest labelled',
    build: (c) => {
      const pts = c.models.filter((m) => m.created && m.bench.intelligence != null);
      return {
        chart: {
          type: 'scatter',
          spec: {
            label: 'Release date against Intelligence index',
            empty: 'No models with a release date and an Intelligence score for the current filters.',
            groups: [{ name: 'Models', color: S1 }],
            xFromMin: true,
            xTitle: 'Added to OpenRouter',
            yTitle: 'Intelligence Index',
            xFormat: (t) => F.monthLabel(new Date(t)),
            yFormat: (v) => String(v),
            labelIds: new Set(D.topBy(pts, (m) => m.created.getTime(), 8).map((m) => m.id)),
            points: pts.map((m) =>
              scatterPoint(m, m.created.getTime(), m.bench.intelligence, [
                { value: F.date(m.created), label: 'added' },
                { value: String(m.bench.intelligence), label: 'Intelligence Index' },
              ]),
            ),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Added', value: (m) => F.date(m.created) },
            { label: 'Intelligence', value: (m) => String(m.bench.intelligence), num: true },
          ],
          rows: D.topBy(pts, (m) => m.created.getTime(), pts.length),
        },
      };
    },
  },

  // ---------- image generation ----------
  {
    id: 'img-price',
    section: 'images',
    title: 'Image-output models: price per generated image',
    sub: (c) => `Lowest ${c.top} by pricing.image_output (USD per output image)`,
    build: (c) => {
      const imgModels = c.models.filter((m) => m.outputModalities.includes('image'));
      const rows = D.topBy(imgModels, (m) => m.price.imageOutput, c.top, 'asc');
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [{ name: 'Per image', color: S1 }],
            format: F.usd,
            label: 'Price per generated image',
            empty: imgModels.length
              ? 'Image-output models match, but none publish a per-image price. See the token prices card.'
              : 'No image-output models match the current filters.',
            rows: rows.map((m) => ({
              label: m.name,
              values: [m.price.imageOutput],
              sub: [{ value: F.usd(m.price.imageToken), label: 'per 1M image tokens' }, { value: m.id }],
            })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: '$/image', value: (m) => F.usd(m.price.imageOutput), num: true },
            { label: '$/1M image tokens', value: (m) => F.usd(m.price.imageToken), num: true },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'img-tokens',
    section: 'images',
    title: 'Image-output models: token prices',
    sub: (c) => `Top ${c.top} image-output models by blended price · USD per 1M tokens`,
    legend: PRICE_SERIES,
    build: (c) =>
      priceBars(D.topBy(c.models.filter((m) => m.outputModalities.includes('image')), (m) => m.blended, c.top, 'asc')),
  },
  {
    id: 'img-params',
    section: 'images',
    wide: true,
    title: 'Image API parameters by model',
    sub: (c) => `From /images/models · top ${c.top} models by number of supported parameters`,
    build: (c) => {
      if (!c.images) return unavailable('Image model catalog (/images/models) was not available from this data source.');
      const models = [...c.images].sort((a, b) => b.parameters.length - a.parameters.length).slice(0, c.top);
      const params = D.countBy(c.images, (m) => m.parameters).slice(0, 12).map((p) => p.key);
      return matrix(
        models.map((m) => m.name),
        [...params, 'streaming'],
        models.map((m) => [...params.map((p) => yesNo(m.parameters.includes(p))), yesNo(m.streaming)]),
        { label: 'Image API parameters by model', dark: c.dark },
      );
    },
  },

  // ---------- video generation ----------
  {
    id: 'vid-duration',
    section: 'videos',
    title: 'Longest supported video duration',
    sub: (c) => `Top ${c.top} video models by maximum supported duration (seconds)`,
    build: (c) => {
      if (!c.videos) return unavailable('Video model catalog (/videos/models) was not available from this data source.');
      const rows = D.topBy(c.videos, (v) => v.maxDuration, c.top, 'desc');
      const sec = (v) => (v == null ? '—' : `${v}s`);
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [{ name: 'Max duration', color: S1 }],
            format: sec,
            label: 'Maximum video duration',
            empty: 'No video models match the current filters.',
            rows: rows.map((v) => ({ label: v.name, values: [v.maxDuration], sub: [{ value: v.durations.join(', ') + ' s', label: 'supported' }] })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (v) => v.name },
            { label: 'Durations (s)', value: (v) => v.durations.join(', ') },
            { label: 'Resolutions', value: (v) => v.resolutions.join(', ') },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'vid-price',
    section: 'videos',
    title: 'Lowest listed video pricing SKU',
    sub: () => 'USD · SKU units differ between models (see the SKU name in the tooltip or table)',
    build: (c) => {
      if (!c.videos) return unavailable('Video model catalog (/videos/models) was not available from this data source.');
      const rows = D.topBy(c.videos, (v) => v.cheapestSku?.price, c.top, 'asc');
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [{ name: 'Lowest SKU price', color: S1 }],
            format: F.usd,
            label: 'Lowest listed video pricing SKU',
            empty: 'No video models with pricing SKUs match the current filters.',
            rows: rows.map((v) => ({
              label: v.name,
              values: [v.cheapestSku.price],
              sub: [{ value: v.cheapestSku.key, label: 'SKU' }, { value: String(v.skus.length), label: 'SKUs listed' }],
            })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (v) => v.name },
            { label: 'Cheapest SKU', value: (v) => v.cheapestSku.key },
            { label: 'Price', value: (v) => F.usd(v.cheapestSku.price), num: true },
            { label: 'All SKUs', value: (v) => v.skus.map((s) => `${s.key}=${F.usd(s.price)}`).join('; ') },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'vid-matrix',
    section: 'videos',
    wide: true,
    title: 'Video model capabilities',
    sub: (c) => `Resolutions and generation features · ${c.videos ? `${c.videos.length} models` : 'unavailable'}`,
    build: (c) => {
      if (!c.videos) return unavailable('Video model catalog (/videos/models) was not available from this data source.');
      const order = ['360p', '480p', '720p', '768p', '1080p', '1K', '2K', '4K'];
      const present = new Set(c.videos.flatMap((v) => v.resolutions));
      const res = [...order.filter((r) => present.has(r)), ...[...present].filter((r) => !order.includes(r))];
      const vids = [...c.videos].sort((a, b) => a.name.localeCompare(b.name));
      return matrix(
        vids.map((v) => v.name),
        [...res, 'Audio', 'Seed', 'First frame', 'Last frame'],
        vids.map((v) => [
          ...res.map((r) => yesNo(v.resolutions.includes(r))),
          yesNo(v.generateAudio),
          yesNo(v.seed),
          yesNo(v.frameImages.includes('first_frame')),
          yesNo(v.frameImages.includes('last_frame')),
        ]),
        { label: 'Video model capabilities', dark: c.dark },
      );
    },
  },
];
