import { loadCatalog, parseSnapshot, OPENROUTER_API, MODELS_PATH } from './api.js';
import * as D from './data.js';
import * as F from './format.js';
import { barChart, columnChart, scatterChart, heatmap, rampGradient, hideTip } from './charts.js';

const S1 = 'var(--series-1)';
const S2 = 'var(--series-2)';
const S3 = 'var(--series-3)';

const $ = (sel) => document.querySelector(sel);

const state = {
  catalog: null,
  models: [],
  images: null,
  videos: null,
  tableMode: new Set(),
  explorerSort: { key: 'blended', dir: 'asc' },
};

// ---------- storage (may be unavailable: private mode, blocked site data) ----------

function readStore(kind, key) {
  try {
    return window[kind].getItem(key);
  } catch {
    return null;
  }
}

function writeStore(kind, key, value) {
  try {
    if (value) window[kind].setItem(key, value);
    else window[kind].removeItem(key);
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

// ---------- shared bits ----------

const PRICE_SERIES = [
  { name: 'Input', color: S1 },
  { name: 'Output', color: S2 },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function priceBars(models) {
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
          sub: [{ value: F.usd(m.blended), label: 'blended / 1M' }, { value: m.id }],
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

function countBars(items, { label, format = F.int, labelOf = (r) => r.key, color = S1 }) {
  return {
    chart: {
      type: 'bar',
      spec: {
        series: [{ name: 'Models', color }],
        format,
        label,
        integer: true,
        rows: items.map((r) => ({ label: labelOf(r), values: [r.count] })),
      },
    },
    table: {
      columns: [
        { label: 'Category', value: labelOf },
        { label: 'Models', value: (r) => format(r.count), num: true },
      ],
      rows: items,
    },
  };
}

function columns(bins, { label, color = S1, capLabels = 'all', labelOf = (b) => b.label }) {
  return {
    chart: {
      type: 'column',
      spec: {
        label,
        color,
        capLabels,
        integer: true,
        format: F.int,
        valueLabel: 'models',
        rows: bins.map((b) => ({ label: labelOf(b), value: b.count })),
      },
    },
    table: {
      columns: [
        { label: 'Bin', value: labelOf },
        { label: 'Models', value: (b) => F.int(b.count), num: true },
      ],
      rows: bins,
    },
  };
}

/** Binary or share heatmap. cells[i][j] = { value 0..1, text, detail } */
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
        { label: '', value: (r) => r.label },
        ...colLabels.map((c, j) => ({ label: c, value: (r) => r.cells[j].text, num: true })),
      ],
      rows: rowLabels.map((l, i) => ({ label: l, cells: cells[i] })),
    },
  };
}

// Mid-ramp rather than the darkest step: a yes/no grid shouldn't read as a field of maximal values.
const yesNo = (v) => ({ value: v ? 0.6 : 0, text: v ? 'Yes' : '—' });

// ---------- card definitions ----------

const CARDS = [
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
    id: 'price-hist',
    section: 'pricing',
    title: 'Input price distribution',
    sub: () => 'Models per input-price band (USD per 1M input tokens)',
    build: (c) => columns(D.priceHistogram(c.models), { label: 'Models per input price band' }),
  },
  {
    id: 'price-hist-out',
    section: 'pricing',
    title: 'Output price distribution',
    sub: () => 'Models per output-price band (USD per 1M output tokens)',
    build: (c) =>
      columns(D.priceHistogram(c.models, (m) => m.price.output), { label: 'Models per output price band', color: S2 }),
  },
  {
    id: 'price-context',
    section: 'pricing',
    wide: true,
    title: 'Price vs context window',
    sub: () => 'Blended USD per 1M tokens vs context length, both log scale · free models omitted',
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
            groups: [
              { name: 'Reasoning', color: S1 },
              { name: 'Non-reasoning', color: S2 },
            ],
            xLog: true,
            yLog: true,
            xTitle: 'Context window (tokens)',
            yTitle: 'Blended $ / 1M tokens',
            xFormat: F.tokens,
            yFormat: F.usd,
            points: pts.map((m) => ({
              id: m.id,
              x: m.contextLength,
              y: m.blended,
              group: m.reasoning.supported ? 0 : 1,
              label: m.name,
              tip: {
                title: m.name,
                rows: [
                  { value: F.usd(m.blended), label: 'blended / 1M' },
                  { value: F.tokens(m.contextLength), label: 'context' },
                  { value: m.reasoning.supported ? 'Reasoning' : 'Non-reasoning', color: m.reasoning.supported ? S1 : S2 },
                ],
              },
            })),
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
  {
    id: 'cap-coverage',
    section: 'capabilities',
    title: 'Capability coverage',
    sub: (c) => `Share of the ${F.int(c.models.length)} filtered models supporting each capability`,
    build: (c) => {
      const rows = D.capabilityCoverage(c.models).sort((a, b) => b.share - a.share);
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [{ name: 'Share of models', color: S1 }],
            format: F.pct,
            label: 'Capability coverage',
            rows: rows.map((r) => ({ label: r.label, values: [r.share], sub: [{ value: F.int(r.count), label: 'models' }] })),
          },
        },
        table: {
          columns: [
            { label: 'Capability', value: (r) => r.label },
            { label: 'Models', value: (r) => F.int(r.count), num: true },
            { label: 'Share', value: (r) => F.pct(r.share), num: true },
          ],
          rows,
        },
      };
    },
  },
  {
    id: 'by-author',
    section: 'capabilities',
    title: 'Models per provider',
    sub: (c) => `Top ${c.top} model authors (prefix of the model id)`,
    build: (c) => countBars(D.countBy(c.models, (m) => m.author).slice(0, c.top), { label: 'Models per provider' }),
  },
  {
    id: 'cap-matrix',
    section: 'capabilities',
    wide: true,
    scale: true,
    title: 'Capabilities by provider',
    sub: (c) => `Share of each provider's models supporting a capability · top ${Math.min(c.top, 15)} providers by model count`,
    build: (c) => {
      const mx = D.authorCapabilityMatrix(c.models, Math.min(c.top, 15));
      return matrix(
        mx.rows.map((r) => `${r.key} (${r.total})`),
        mx.cols.map((col) => col.label),
        mx.cells.map((row) => row.map((cell) => ({ value: cell.share, text: F.pct(cell.share), detail: `${cell.count} of ${cell.total} models` }))),
        { label: 'Capabilities by provider', dark: c.dark },
      );
    },
  },
  {
    id: 'mod-input',
    section: 'capabilities',
    title: 'Input modalities',
    sub: () => 'Models accepting each input type',
    build: (c) => countBars(D.modalityCounts(c.models, 'input'), { label: 'Input modalities', labelOf: (r) => cap(r.key) }),
  },
  {
    id: 'mod-output',
    section: 'capabilities',
    title: 'Output modalities',
    sub: () => 'Models producing each output type',
    build: (c) => countBars(D.modalityCounts(c.models, 'output'), { label: 'Output modalities', labelOf: (r) => cap(r.key) }),
  },
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
    id: 'ctx-hist',
    section: 'context',
    title: 'Context window distribution',
    sub: () => 'Models per context-length band (tokens; K = 1,024)',
    build: (c) => columns(D.contextHistogram(c.models), { label: 'Models per context band' }),
  },
  {
    id: 'reason-effort',
    section: 'reasoning',
    title: 'Supported reasoning effort levels',
    sub: (c) => {
      const s = D.reasoningStats(c.models);
      return `Models whose effort allowlist includes each level · ${F.int(s.unrestrictedEfforts)} reasoning models publish no allowlist (any effort accepted)`;
    },
    build: (c) =>
      countBars(D.reasoningStats(c.models).effortCounts.map((e) => ({ key: e.level, count: e.count })), {
        label: 'Reasoning effort levels',
      }),
  },
  {
    id: 'reason-author',
    section: 'reasoning',
    title: 'Reasoning models per provider',
    sub: (c) => `Top ${c.top} providers by number of reasoning-capable models`,
    build: (c) => countBars(D.reasoningStats(c.models).byAuthor.slice(0, c.top), { label: 'Reasoning models per provider' }),
  },
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
      const fmt = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));
      return {
        chart: {
          type: 'bar',
          spec: {
            series: [
              { name: 'Intelligence', color: S1 },
              { name: 'Coding', color: S2 },
              { name: 'Agentic', color: S3 },
            ],
            format: fmt,
            label: 'Artificial Analysis indices',
            empty: 'No benchmark scores for the current filters.',
            rows: rows.map((m) => ({ label: m.name, values: [m.bench.intelligence, m.bench.coding, m.bench.agentic] })),
          },
        },
        table: {
          columns: [
            { label: 'Model', value: (m) => m.name },
            { label: 'Intelligence', value: (m) => fmt(m.bench.intelligence), num: true },
            { label: 'Coding', value: (m) => fmt(m.bench.coding), num: true },
            { label: 'Agentic', value: (m) => fmt(m.bench.agentic), num: true },
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
    sub: () => 'Intelligence Index vs blended USD per 1M tokens (log) · top 6 scores labeled',
    build: (c) => {
      const pts = c.models.filter((m) => m.bench.intelligence != null && m.blended > 0);
      const labelIds = new Set(D.topBy(pts, (m) => m.bench.intelligence, 6).map((m) => m.id));
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
            labelIds,
            points: pts.map((m) => ({
              id: m.id,
              x: m.blended,
              y: m.bench.intelligence,
              group: 0,
              label: m.name,
              tip: {
                title: m.name,
                rows: [
                  { value: String(m.bench.intelligence), label: 'Intelligence Index' },
                  { value: F.usd(m.blended), label: 'blended / 1M' },
                ],
              },
            })),
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
  {
    id: 'releases',
    section: 'timeline',
    wide: true,
    title: 'Models added per month',
    sub: () => 'By the model’s created date on OpenRouter · last 24 months (UTC)',
    build: (c) =>
      columns(D.releasesByMonth(c.models, 24), {
        label: 'Models added per month',
        capLabels: 'max',
        labelOf: (b) => F.monthLabel(b.date),
      }),
  },
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

function unavailable(message) {
  return { chart: { type: 'empty', message }, table: { columns: [], rows: [] } };
}

// ---------- rendering ----------

function ensureCard(card) {
  let el = document.getElementById(`card-${card.id}`);
  if (el) return el;
  el = document.createElement('article');
  el.className = `card${card.wide ? ' wide' : ''}`;
  el.id = `card-${card.id}`;
  const head = document.createElement('div');
  head.className = 'card-head';
  const titles = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = card.title;
  const sub = document.createElement('p');
  sub.className = 'card-sub';
  titles.append(h, sub);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Table';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.addEventListener('click', () => {
    const on = !state.tableMode.has(card.id);
    on ? state.tableMode.add(card.id) : state.tableMode.delete(card.id);
    toggle.textContent = on ? 'Chart' : 'Table';
    toggle.setAttribute('aria-pressed', String(on));
    renderAll();
  });
  head.append(titles, toggle);
  el.appendChild(head);

  if (card.legend) {
    const ul = document.createElement('ul');
    ul.className = 'legend';
    for (const s of card.legend) {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = `swatch${s.dot ? ' dot' : ''}`;
      sw.style.background = s.color;
      li.append(sw, document.createTextNode(s.name));
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }
  if (card.scale) {
    const scale = document.createElement('div');
    scale.className = 'scale';
    scale.innerHTML = '<span>0%</span><span class="scale-bar"></span><span>100%</span><span class="cell-empty-key"></span><span>none</span>';
    el.appendChild(scale);
  }
  const chart = document.createElement('div');
  chart.className = 'chart';
  const table = document.createElement('div');
  table.className = 'table-wrap';
  table.hidden = true;
  el.append(chart, table);
  document.querySelector(`[data-section="${card.section}"]`).appendChild(el);
  return el;
}

function drawChart(host, chart) {
  switch (chart.type) {
    case 'bar':
      return barChart(host, chart.spec);
    case 'column':
      return columnChart(host, chart.spec);
    case 'scatter':
      return scatterChart(host, chart.spec);
    case 'heatmap':
      return heatmap(host, chart.spec);
    default: {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = chart.message;
      host.replaceChildren(p);
    }
  }
}

function renderTable(host, columns, rows, sort) {
  const table = document.createElement('table');
  const thead = table.createTHead().insertRow();
  for (const col of columns) {
    const th = document.createElement('th');
    if (col.num) th.className = 'num';
    if (sort && col.key) {
      const b = document.createElement('button');
      b.type = 'button';
      const active = sort.state.key === col.key;
      b.textContent = col.label + (active ? (sort.state.dir === 'asc' ? ' ↑' : ' ↓') : '');
      th.setAttribute('aria-sort', active ? (sort.state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      b.addEventListener('click', () => sort.onSort(col.key));
      th.appendChild(b);
    } else {
      th.textContent = col.label;
    }
    thead.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const col of columns) {
      const td = tr.insertCell();
      if (col.num) td.className = 'num';
      if (col.wrap) td.classList.add('wrap');
      td.textContent = col.value(row);
      if (col.subValue) {
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = col.subValue(row);
        td.appendChild(s);
      }
    }
  }
  host.replaceChildren(table);
}

function renderCard(card, ctx) {
  const el = ensureCard(card);
  el.querySelector('.card-sub').textContent = card.sub(ctx);
  const scaleBar = el.querySelector('.scale-bar');
  if (scaleBar) scaleBar.style.background = rampGradient(ctx.dark);
  const built = card.build(ctx);
  const chartHost = el.querySelector('.chart');
  const tableHost = el.querySelector('.table-wrap');
  const tableMode = state.tableMode.has(card.id) && built.chart.type !== 'empty';
  chartHost.hidden = tableMode;
  tableHost.hidden = !tableMode;
  if (tableMode) renderTable(tableHost, built.table.columns, built.table.rows);
  else drawChart(chartHost, built.chart);
}

function tile(label, value, note) {
  const el = document.createElement('div');
  el.className = 'kpi';
  const l = document.createElement('div');
  l.className = 'kpi-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'kpi-value';
  v.textContent = value;
  el.append(l, v);
  if (note) {
    const n = document.createElement('div');
    n.className = 'kpi-note';
    n.textContent = note;
    n.title = note;
    el.appendChild(n);
  }
  return el;
}

function renderKpis(ctx) {
  const s = D.summary(ctx.models);
  const filtered = ctx.models.length !== ctx.all.length;
  $('#kpis').replaceChildren(
    tile('Models', F.int(s.total), filtered ? `of ${F.int(ctx.all.length)} in the catalog` : 'in the catalog'),
    tile('Providers', F.int(s.authors), 'distinct model authors'),
    tile('Free models', F.int(s.free), s.total ? `${F.pct(s.free / s.total)} of models` : ''),
    tile('Reasoning-capable', F.int(s.reasoning), s.total ? `${F.pct(s.reasoning / s.total)} of models` : ''),
    tile('Median input price', F.usd(s.medianInput), 'per 1M tokens, paid models'),
    tile('Median output price', F.usd(s.medianOutput), 'per 1M tokens, paid models'),
    tile('Largest context', F.tokens(s.maxContext?.contextLength), s.maxContext?.name || ''),
    tile(
      'Image / video models',
      `${F.int(ctx.models.filter((m) => m.outputModalities.includes('image')).length)} / ${ctx.videos ? F.int(ctx.videos.length) : '—'}`,
      'image-output LLMs / video generators',
    ),
  );
}

function renderReasoningKpis(ctx) {
  const r = D.reasoningStats(ctx.models);
  $('#reasoning-kpis').replaceChildren(
    tile('Reasoning models', F.int(r.total), ctx.models.length ? `${F.pct(r.total / ctx.models.length)} of filtered models` : ''),
    tile('Always-on reasoning', F.int(r.mandatory), 'reasoning cannot be disabled'),
    tile('Optional reasoning', F.int(r.optional), 'can be toggled per request'),
    tile('Accept reasoning.max_tokens', F.int(r.maxTokens), 'token budget instead of / besides effort'),
    tile('Separately priced reasoning', F.int(r.separateReasoningPrice), 'pricing.internal_reasoning > 0'),
  );
}

const EXPLORER_COLUMNS = [
  { key: 'name', label: 'Model', value: (m) => m.name, subValue: (m) => m.id, sort: (m) => m.name.toLowerCase(), csv: (m) => m.id },
  { key: 'author', label: 'Provider', value: (m) => m.author, sort: (m) => m.author },
  { key: 'context', label: 'Context', num: true, value: (m) => F.tokens(m.contextLength), sort: (m) => m.contextLength, csv: (m) => m.contextLength },
  { key: 'maxOut', label: 'Max output', num: true, value: (m) => F.tokens(m.maxOutput), sort: (m) => m.maxOutput, csv: (m) => m.maxOutput },
  { key: 'input', label: 'Input $/1M', num: true, value: (m) => F.usd(m.price.input), sort: (m) => m.price.input, csv: (m) => m.price.input },
  { key: 'output', label: 'Output $/1M', num: true, value: (m) => F.usd(m.price.output), sort: (m) => m.price.output, csv: (m) => m.price.output },
  { key: 'blended', label: 'Blended $/1M', num: true, value: (m) => F.usd(m.blended), sort: (m) => m.blended, csv: (m) => m.blended },
  { key: 'cacheRead', label: 'Cache read $/1M', num: true, value: (m) => F.usd(m.price.cacheRead), sort: (m) => m.price.cacheRead, csv: (m) => m.price.cacheRead },
  { key: 'reasoningPrice', label: 'Reasoning $/1M', num: true, value: (m) => F.usd(m.price.reasoning), sort: (m) => m.price.reasoning, csv: (m) => m.price.reasoning },
  { key: 'imageOut', label: '$/image out', num: true, value: (m) => F.usd(m.price.imageOutput), sort: (m) => m.price.imageOutput, csv: (m) => m.price.imageOutput },
  { key: 'modalities', label: 'Modalities', value: (m) => `${m.inputModalities.join('+')} → ${m.outputModalities.join('+')}` },
  {
    key: 'reasoning',
    label: 'Reasoning',
    value: (m) =>
      !m.reasoning.supported ? '—' : `${m.reasoning.mandatory ? 'always' : 'optional'}${m.reasoning.efforts ? ` · ${m.reasoning.efforts.join('/')}` : ''}`,
  },
  { key: 'caps', label: 'Capabilities', wrap: true, value: (m) => D.CAPABILITIES.filter((c) => m.caps[c.key]).map((c) => c.label).join(', ') },
  { key: 'intel', label: 'Intelligence', num: true, value: (m) => (m.bench.intelligence == null ? '—' : String(m.bench.intelligence)), sort: (m) => m.bench.intelligence, csv: (m) => m.bench.intelligence },
  { key: 'created', label: 'Added', value: (m) => F.date(m.created), sort: (m) => m.created?.getTime(), csv: (m) => F.date(m.created) },
];

function sortedExplorerRows(models) {
  const { key, dir } = state.explorerSort;
  const col = EXPLORER_COLUMNS.find((c) => c.key === key);
  const acc = col.sort || col.value;
  const sign = dir === 'asc' ? 1 : -1;
  return [...models].sort((a, b) => {
    const va = acc(a);
    const vb = acc(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls last in both directions
    if (vb == null) return -1;
    return sign * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

function renderExplorer(ctx) {
  const cols = EXPLORER_COLUMNS.map((c) => ({ ...c, key: c.sort ? c.key : null }));
  renderTable($('#explorer-table'), cols, sortedExplorerRows(ctx.models), {
    state: state.explorerSort,
    onSort: (key) => {
      const s = state.explorerSort;
      state.explorerSort = { key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' };
      renderExplorer(currentContext());
    },
  });
}

function readFilters() {
  return {
    query: $('#f-query').value,
    author: $('#f-author').value,
    inputModality: $('#f-input').value,
    outputModality: $('#f-output').value,
    pricing: $('#f-pricing').value,
    capabilities: [...document.querySelectorAll('input[name="cap"]:checked')].map((i) => i.value),
  };
}

/** Image/video catalogs only carry id/name, so only search and provider filters apply to them. */
function filterCatalog(items, f) {
  if (!items) return null;
  const q = f.query.trim().toLowerCase();
  return items.filter((m) => (!q || `${m.id} ${m.name}`.toLowerCase().includes(q)) && (!f.author || m.author === f.author));
}

function currentContext() {
  const f = readFilters();
  return {
    models: D.filterModels(state.models, f),
    all: state.models,
    images: filterCatalog(state.images, f),
    videos: filterCatalog(state.videos, f),
    top: Number($('#f-top').value),
    dark: isDark(),
  };
}

function renderAll() {
  if (!state.catalog) return;
  hideTip();
  const ctx = currentContext();
  renderKpis(ctx);
  renderReasoningKpis(ctx);
  for (const card of CARDS) renderCard(card, ctx);
  renderExplorer(ctx);
}

// ---------- data loading ----------

function fillSelect(select, entries, allLabel) {
  const current = select.value;
  select.replaceChildren(new Option(allLabel, ''));
  for (const { key, count } of entries) select.appendChild(new Option(`${key} (${count})`, key));
  select.value = entries.some((e) => e.key === current) ? current : '';
}

function ingest(catalog) {
  state.catalog = catalog;
  state.models = catalog.models.filter((m) => m && m.id).map(D.normalizeModel);
  state.images = catalog.images ? catalog.images.filter((m) => m && m.id).map(D.normalizeImageModel) : null;
  state.videos = catalog.videos ? catalog.videos.filter((m) => m && m.id).map(D.normalizeVideoModel) : null;

  fillSelect($('#f-author'), D.countBy(state.models, (m) => m.author).sort((a, b) => a.key.localeCompare(b.key)), 'All providers');
  fillSelect($('#f-input'), D.modalityCounts(state.models, 'input'), 'Any input');
  fillSelect($('#f-output'), D.modalityCounts(state.models, 'output'), 'Any output');

  const when = catalog.fetchedAt ? new Date(catalog.fetchedAt).toLocaleString() : 'unknown time';
  const missing = [!state.images && 'image catalog', !state.videos && 'video catalog'].filter(Boolean);
  const status = $('#status');
  status.textContent = `${F.int(state.models.length)} models · ${catalog.source} · ${when}${missing.length ? ` · ${missing.join(' and ')} unavailable` : ''}`;
  status.classList.toggle('warn', catalog.source !== 'OpenRouter API' || missing.length > 0);
  $('#export').disabled = false;
  $('#error').hidden = true;
  renderAll();
}

function showError(err) {
  const box = $('#error');
  box.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = err.message;
  const p = document.createElement('p');
  p.textContent =
    'The browser could not reach OpenRouter directly (network or CORS restrictions) and no local proxy or snapshot was found. ' +
    'Run "npm start" to serve the app with its built-in proxy, run "npm run snapshot" to save a local copy, ' +
    `or use Import JSON with a file saved from ${OPENROUTER_API}${MODELS_PATH}.`;
  const pre = document.createElement('pre');
  pre.textContent = (err.attempts || []).join('\n');
  box.append(strong, p, pre);
  box.hidden = false;
  $('#status').textContent = 'No data loaded';
  $('#status').classList.add('warn');
}

let inflight;
async function load() {
  inflight?.abort();
  inflight = new AbortController();
  const main = $('#main');
  main.classList.add('loading');
  $('#status').textContent = state.catalog ? 'Refreshing…' : 'Loading models…';
  try {
    const apiKey = $('#api-key').value.trim() || null;
    ingest(await loadCatalog({ apiKey, signal: inflight.signal }));
  } catch (err) {
    if (err.name !== 'AbortError') {
      if (state.catalog) $('#status').textContent = `Refresh failed: ${err.message}`;
      else showError(err);
    }
  } finally {
    main.classList.remove('loading');
  }
}

function download(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- wiring ----------

function init() {
  const savedTheme = readStore('localStorage', 'atlas-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;

  const keyInput = $('#api-key');
  keyInput.value = readStore('sessionStorage', 'atlas-api-key') || '';
  keyInput.addEventListener('change', () => writeStore('sessionStorage', 'atlas-api-key', keyInput.value.trim()));

  let debounce;
  $('#filters').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(renderAll, e.target.type === 'search' ? 150 : 0);
  });
  $('#f-reset').addEventListener('click', () => {
    $('#filters').reset();
    renderAll();
  });
  $('#refresh').addEventListener('click', load);
  $('#theme').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeStore('localStorage', 'atlas-theme', next);
    renderAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);

  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const snap = parseSnapshot(JSON.parse(await file.text()));
      ingest({ ...snap, source: `imported ${file.name}`, fetchedAt: snap.fetchedAt || new Date(file.lastModified).toISOString() });
    } catch (err) {
      showError(Object.assign(new Error(`Import failed: ${err.message}`), { attempts: [] }));
    }
    e.target.value = '';
  });
  $('#export').addEventListener('click', () => {
    const c = state.catalog;
    const snapshot = {
      fetchedAt: c.fetchedAt,
      source: c.source,
      models: { data: c.models },
      images: c.images ? { data: c.images } : null,
      videos: c.videos ? { data: c.videos } : null,
    };
    download('openrouter-snapshot.json', 'application/json', JSON.stringify(snapshot));
  });
  $('#csv').addEventListener('click', () => {
    if (!state.catalog) return;
    const cols = EXPLORER_COLUMNS.map((c) => ({ label: c.label, value: c.csv || c.value }));
    download('openrouter-models.csv', 'text/csv', D.toCSV(cols, sortedExplorerRows(currentContext().models)));
  });

  let lastWidth = 0;
  let resizeTimer;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 120);
  }).observe($('#main'));

  load();
}

init();
