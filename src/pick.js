// Renders the "Pick for a project" section: tier cards with fallbacks, the
// misleading-price callout, the cost-by-effort table, effort curves, the
// quality/cost scatter and the shortlist capability table. All text goes in
// through textContent (model names and ids come from the API).

import * as R from './recommend.js';
import * as F from './format.js';
import { lineChart, scatterChart } from './charts.js';
import { initPickControls, pickState, update } from './pick-controls.js';
import { ensureSpeed, speedOf } from './speed.js';

const $ = (sel) => document.querySelector(sel);
const TIER_COLOR = { best: 'var(--series-1)', value: 'var(--series-3)', budget: 'var(--series-2)' };
const SHORTLIST_SIZE = 10;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k === 'style') for (const [prop, val] of Object.entries(v)) node.style.setProperty(prop, val);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

/** Model name without the "Provider: " prefix, for chart labels. */
const shortName = (m) => m.name.replace(/^[^:]{1,40}:\s+/, '');
const fmtQ = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const cost = (v) => (v == null ? '—' : F.usd(v));
const yesNo = (b) => el('span', { class: b ? 'yes' : 'no', text: b ? '✓' : '–', 'aria-label': b ? 'yes' : 'no' });

// ---------- model ----------

function compute(models) {
  const s = pickState();
  const preset = R.presetById(s.presetId);
  const quality = R.QUALITY[preset.quality];
  const assumptions = { input: s.task.input, output: s.task.output, reasoningTokens: s.reasoningTokens };
  const req = { quality: preset.quality, require: s.require, minContext: s.minContext, maxBlended: s.maxBlended, allowBatch: preset.allowBatch };
  const { list, excluded } = R.candidates(models, req, assumptions);
  const scored = R.score(list, s.weights);
  const tiers = scored.length ? R.rankTiers(scored) : [];
  const short = R.shortlist(scored, tiers, SHORTLIST_SIZE);
  const roles = new Map();
  for (const t of tiers) {
    if (t.pick) roles.set(t.pick.m.id, { tier: t.key, kind: 'pick', label: `${t.label} pick` });
    if (t.fallback) roles.set(t.fallback.m.id, { tier: t.key, kind: 'fallback', label: `${t.label} fallback` });
  }
  return { s, preset, quality, assumptions, scored, tiers, short, roles, excluded };
}

// ---------- summary + tier cards ----------

// ---------- speed (latency / throughput) ----------

let lastApiKey = '';

const fmtLatency = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtThroughput = (tps) => (tps == null ? '—' : `${Math.round(tps)} tok/s`);

/** { latency, throughput, detail } for display; values are text. */
function speedText(id) {
  if (!lastApiKey) return { latency: '—', throughput: '—', detail: 'Add an API key to see latency and throughput' };
  const s = speedOf(id);
  if (!s || s.status === 'loading') return { latency: '…', throughput: '…', detail: 'Loading' };
  if (s.status === 'error') return { latency: '—', throughput: '—', detail: `Could not load: ${s.error}` };
  const d = s.data;
  if (!d.measuredProviders) return { latency: '—', throughput: '—', detail: 'No provider measured in the last 30 minutes' };
  const fastest = d.fastestLatency ? `fastest: ${d.fastestLatency.name} ${fmtLatency(d.fastestLatency.latency)}` : '';
  return {
    latency: fmtLatency(d.latency),
    throughput: fmtThroughput(d.throughput),
    detail: `Median p50 of ${d.measuredProviders} provider${d.measuredProviders === 1 ? '' : 's'}, last 30 min${fastest ? ` · ${fastest}` : ''}`,
  };
}

const speedLine = (id) => {
  const s = speedText(id);
  return lastApiKey ? `Latency ${s.latency} · throughput ${s.throughput} (${s.detail})` : null;
};

function renderSummary(p) {
  const x = p.excluded;
  const parts = [
    x.noBenchmark && `${x.noBenchmark} without a ${p.quality.short} score`,
    x.capability && `${x.capability} missing a required capability`,
    x.context && `${x.context} below the minimum context`,
    x.price && `${x.price} over the price limit`,
    x.free && `${x.free} free`,
    x.variant && `${x.variant} :batch, :free or other variants`,
    x.unpriced && `${x.unpriced} without a usable price`,
  ].filter(Boolean);
  const speedHint = lastApiKey ? '' : ' Add your OpenRouter API key (top right) to see latency and throughput.';
  $('#pick-summary').textContent = `${F.int(p.scored.length)} candidate models. Left out: ${parts.join(' · ') || 'none'}.${speedHint}`;
}

function reasoningLine(c) {
  const r = c.m.reasoning;
  if (!r.supported) return 'No reasoning: a single cost level';
  const levels = c.levels.filter((l) => l !== 'none').join(' · ');
  if (r.mandatory) return `Always reasons · ${levels}`;
  return c.defaultLevel === 'none' ? `Reasoning optional, off unless requested · ${levels}` : `Reasoning optional, on by default · ${levels}`;
}

function capsLine(m) {
  const caps = [['tools', 'tools'], ['structured', 'structured outputs'], ['vision', 'image input'], ['file', 'file input'], ['audioIn', 'audio input']]
    .filter(([k]) => m.caps[k])
    .map(([, label]) => label);
  return `${F.tokens(m.contextLength)} context${caps.length ? ` · ${caps.join(' · ')}` : ''}`;
}

function whyLines(t, p) {
  const c = t.pick;
  const qs = p.scored.map((x) => x.quality);
  const rank = `${p.quality.short} ${fmtQ(c.quality)} · #${R.rankOf(qs, c.quality)} of ${p.scored.length}`;
  const lines = [];
  if (t.key === 'best') lines.push({ text: `Highest ${p.quality.short} of the ${p.scored.length} candidates (${fmtQ(c.quality)})` });
  if (t.key === 'value') lines.push({ text: `Best balance at your weights · score ${Math.round(c.score * 100)}/100` }, { text: rank });
  if (t.key === 'budget') {
    const median = R.qualityMedian(p.scored);
    const above = p.scored.filter((x) => x.quality >= median).length;
    lines.push({ text: `Cheapest of the ${above} models at or above the median ${p.quality.short} (${fmtQ(median)})` }, { text: rank });
  }
  lines.push({ text: `${cost(c.cost)} per 1k tasks at ${c.defaultLevel} (default)` }, { text: capsLine(c.m) }, { text: reasoningLine(c) });
  const speed = speedLine(c.m.id);
  if (speed) lines.push({ text: speed });
  if (c.assumed) lines.push({ text: 'No effort list published: low/medium/high assumed', warn: true });
  return lines;
}

function pills(c, p) {
  return el(
    'div',
    { class: 'pills', 'aria-label': `${c.m.name}: cost per 1k tasks by effort` },
    R.effortCosts(c.m, p.assumptions).map(({ level, cost: v }) =>
      el('div', { class: `pill${level === c.defaultLevel ? ' default' : ''}`, title: level === c.defaultLevel ? 'default effort' : null }, [
        document.createTextNode(level),
        el('b', { text: cost(v) }),
      ]),
    ),
  );
}

function copyButton(textToCopy) {
  const button = el('button', { type: 'button', text: 'Copy' });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  });
  return button;
}

function fallbackBlock(t, p) {
  const label = el('div', { class: 'label', text: 'Fallback' });
  if (!t.fallback) return el('div', { class: 'fallback' }, [label, el('div', { class: 'meta', text: 'No other candidate qualifies.' })]);
  const f = t.fallback;
  const snippet = `"models": ["${t.pick.m.id}", "${f.m.id}"]`;
  return el('div', { class: 'fallback' }, [
    label,
    el('div', { class: 'name', text: f.m.name }),
    el('div', { class: 'model-id', text: f.m.id }),
    el('div', { class: 'meta', text: `${p.quality.short} ${fmtQ(f.quality)} · ${cost(f.cost)} per 1k tasks at ${f.defaultLevel} · ${f.m.author}` }),
    lastApiKey ? el('div', { class: 'meta', text: `Latency ${speedText(f.m.id).latency} · ${speedText(f.m.id).throughput}` }) : null,
    t.sameAuthor ? el('div', { class: 'meta', text: '! Same provider: no other provider qualifies.' }) : null,
    el('div', { class: 'snippet' }, [
      el('code', { text: snippet, title: 'OpenRouter request field: tries the pick first, then the fallback' }),
      copyButton(snippet),
    ]),
  ]);
}

function renderTiers(p) {
  const host = $('#pick-tiers');
  if (!p.tiers.length) {
    host.replaceChildren(el('p', { class: 'empty', text: 'No models meet these requirements. Loosen a requirement or the filter bar.' }));
    return;
  }
  host.replaceChildren(
    ...p.tiers.map((t) =>
      el('article', { class: 'card tier', style: { '--tier': TIER_COLOR[t.key] } }, [
        el('div', { class: 'kicker', text: t.label }),
        el('h4', { class: 'tier-name', text: t.pick.m.name }),
        el('div', { class: 'model-id', text: t.pick.m.id }),
        el('ul', { class: 'why' }, whyLines(t, p).map((l) => el('li', { class: l.warn ? 'warn' : null, text: l.text }))),
        el('div', { class: 'pills-caption', text: `$ per 1k tasks by effort · default outlined · ${F.usd(t.pick.m.blended)} / 1M blended` }),
        pills(t.pick, p),
        fallbackBlock(t, p),
      ]),
    ),
  );
}

/** Flags a shortlisted model that is cheapest per token but not per task at its default effort. */
function renderCallout(p) {
  const box = $('#pick-callout');
  box.hidden = true;
  if (p.short.length < 2) return;
  const cheapestToken = [...p.short].sort((a, b) => a.m.blended - b.m.blended)[0];
  const cheaperTask = p.short.filter((c) => c !== cheapestToken && c.cost < cheapestToken.cost).sort((a, b) => a.cost - b.cost);
  if (!cheaperTask.length || cheapestToken.cost < 2 * cheaperTask[0].cost) return;
  const other = cheaperTask[0];
  const lowest = R.effortCosts(cheapestToken.m, p.assumptions)[0];
  const ratio = cheapestToken.cost / other.cost;
  box.replaceChildren(
    el('strong', { text: 'Per-token price can mislead. ' }),
    document.createTextNode(
      `${cheapestToken.m.name} is the cheapest of the shortlist per token (${F.usd(cheapestToken.m.blended)} / 1M blended), ` +
        `but at its default ${cheapestToken.defaultLevel} effort it costs about ${cost(cheapestToken.cost)} per 1k tasks: ` +
        `${ratio.toFixed(1)}× ${other.m.name} at its default.` +
        (lowest.level !== cheapestToken.defaultLevel ? ` At ${lowest.level} effort it drops to ${cost(lowest.cost)}.` : ''),
    ),
  );
  box.hidden = false;
}

// ---------- effort table ----------

function levelsIn(list) {
  const used = new Set(list.flatMap((c) => c.levels));
  return R.EFFORT_ORDER.filter((l) => used.has(l));
}

function roleCell(c, p) {
  const role = p.roles.get(c.m.id);
  const tag = el('span', { class: 'tag', style: role ? { background: TIER_COLOR[role.tier] } : null });
  return el('td', {}, [tag, document.createTextNode(c.m.name), el('span', { class: 'sub', text: role ? role.label : c.m.id })]);
}

function renderEffortTable(p) {
  const host = $('#pick-effort-table');
  if (!p.short.length) return host.replaceChildren(el('p', { class: 'empty', text: 'No candidates.' }));
  const levels = levelsIn(p.short);
  const all = p.short.flatMap((c) => R.effortCosts(c.m, p.assumptions).map((e) => e.cost)).filter((v) => v > 0);
  const lo = Math.log(Math.min(...all));
  const span = Math.log(Math.max(...all)) - lo || 1;
  const shade = (v) => `color-mix(in srgb, var(--series-2) ${Math.round(6 + ((Math.log(v) - lo) / span) * 54)}%, var(--surface))`;
  const head = el('tr', {}, [
    el('th', { text: 'Model' }),
    ...levels.map((l) => el('th', { class: 'num', text: l })),
    el('th', { class: 'num', text: '$ in / out per 1M' }),
  ]);
  const rows = p.short.map((c) => {
    const byLevel = new Map(R.effortCosts(c.m, p.assumptions).map((e) => [e.level, e.cost]));
    return el('tr', {}, [
      roleCell(c, p),
      ...levels.map((l) =>
        byLevel.has(l)
          ? el('td', {
              class: `cost-cell${l === c.defaultLevel ? ' default' : ''}`,
              style: byLevel.get(l) > 0 ? { background: shade(byLevel.get(l)) } : null,
              text: cost(byLevel.get(l)),
              title: `${c.m.name} at ${l}${l === c.defaultLevel ? ' (default)' : ''}${c.assumed && l !== 'none' ? ' · level assumed' : ''}`,
            })
          : el('td', { class: 'na', text: '·', 'aria-label': 'not offered' }),
      ),
      el('td', { class: 'num', text: `${F.usd(c.m.price.input)} / ${F.usd(c.m.price.output)}` }),
    ]);
  });
  host.replaceChildren(el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)]));
}

// ---------- charts ----------

function renderCurves(p) {
  const entries = p.tiers
    .flatMap((t) => [
      t.pick && { c: t.pick, tier: t.key, dashed: false, role: `${t.label} pick` },
      t.fallback && { c: t.fallback, tier: t.key, dashed: true, role: `${t.label} fallback` },
    ])
    .filter(Boolean);
  lineChart($('#pick-curves'), {
    label: 'Cost per 1,000 tasks by reasoning effort for the picks and fallbacks',
    empty: 'No picks for the current requirements.',
    categories: levelsIn(entries.map((e) => e.c)),
    yLog: true,
    yFormat: F.usd,
    yTitle: '$ per 1k tasks',
    series: entries.map(({ c, tier, dashed, role }) => ({
      name: shortName(c.m),
      color: TIER_COLOR[tier],
      dashed,
      points: R.effortCosts(c.m, p.assumptions).map(({ level, cost: v }) => ({
        x: level,
        y: v,
        ring: level === c.defaultLevel,
        tip: {
          title: c.m.name,
          rows: [
            { value: cost(v), label: `per 1k tasks at ${level}${level === c.defaultLevel ? ' (default)' : ''}`, color: TIER_COLOR[tier] },
            { value: role },
          ],
        },
      })),
    })),
  });
}

function renderScatter(p) {
  $('#pick-scatter-title').textContent = `${p.quality.short} vs cost at default effort`;
  const shortIds = new Set(p.short.map((c) => c.m.id));
  scatterChart($('#pick-scatter'), {
    label: `${p.quality.label} against cost per 1,000 tasks`,
    empty: 'No candidates for the current requirements.',
    groups: [{ name: 'Candidates', color: 'var(--text-muted)' }],
    xLog: true,
    xTitle: '$ per 1k tasks at default effort (log)',
    yTitle: p.quality.short,
    xFormat: F.usd,
    yFormat: fmtQ,
    labelIds: shortIds,
    labelAll: true,
    frontierIds: R.frontier(p.scored).map((c) => c.m.id),
    points: p.scored.map((c) => {
      const role = p.roles.get(c.m.id);
      const listed = shortIds.has(c.m.id);
      return {
        id: c.m.id,
        x: c.cost,
        y: c.quality,
        group: 0,
        label: shortName(c.m),
        color: role ? TIER_COLOR[role.tier] : listed ? 'var(--text-secondary)' : null,
        r: role?.kind === 'pick' ? 6 : role ? 5 : listed ? 4.5 : 3.5,
        muted: !listed,
        strong: role?.kind === 'pick',
        tip: {
          title: c.m.name,
          rows: [
            { value: fmtQ(c.quality), label: p.quality.short },
            { value: cost(c.cost), label: `per 1k tasks at ${c.defaultLevel}` },
            { value: role ? role.label : listed ? 'shortlisted' : c.m.id },
          ],
        },
      };
    }),
  });
}

// ---------- capabilities at a chosen effort ----------

function effortFor(c, compare) {
  const chosen = compare.rows[c.m.id];
  if (chosen && c.levels.includes(chosen)) return { level: chosen, note: null };
  if (compare.all === 'default') return { level: c.defaultLevel, note: 'default' };
  const level = R.nearestLevel(c.levels, compare.all);
  return { level, note: level === compare.all ? null : `no ${compare.all}: nearest` };
}

function effortSelect(c, level, compare) {
  const select = el('select', { 'aria-label': `Effort for ${c.m.name}` }, c.levels.map((l) => new Option(l, l)));
  select.value = level;
  select.addEventListener('change', () => update({ compare: { ...compare, rows: { ...compare.rows, [c.m.id]: select.value } } }));
  return select;
}

const num = (label, value) => ({ label, num: true, cell: (c) => el('td', { class: 'num', text: value(c) }) });

/** Shortlist columns; `row` carries the effort each model is compared at. */
const CAP_COLUMNS = [
  num('Coding', (c) => fmtQ(c.m.bench.coding)),
  num('Agentic', (c) => fmtQ(c.m.bench.agentic)),
  num('Intelligence', (c) => fmtQ(c.m.bench.intelligence)),
  num('Context', (c) => F.tokens(c.m.contextLength)),
  num('Max output', (c) => F.tokens(c.m.maxOutput)),
  { label: 'Latency p50', num: true, cell: (c) => el('td', { class: 'num', text: speedText(c.m.id).latency, title: speedText(c.m.id).detail }) },
  { label: 'Throughput p50', num: true, cell: (c) => el('td', { class: 'num', text: speedText(c.m.id).throughput, title: speedText(c.m.id).detail }) },
  { label: 'Inputs', cell: (c) => el('td', { text: c.m.inputModalities.join(', ') }) },
  { label: 'Tools', cell: (c) => el('td', {}, [yesNo(c.m.caps.tools)]) },
  { label: 'Structured', cell: (c) => el('td', {}, [yesNo(c.m.caps.structured)]) },
  {
    label: 'Reasoning',
    cell: (c) => el('td', { text: !c.m.reasoning.supported ? 'none' : c.m.reasoning.mandatory ? 'always on' : 'optional' }),
  },
  {
    label: 'Effort',
    cell: (c, row) => el('td', {}, [effortSelect(c, row.level, row.compare), row.note ? el('span', { class: 'note', text: row.note }) : null]),
  },
  { label: '$ / 1k tasks', num: true, cell: (c, row) => el('td', { class: 'num', text: cost(R.costPer1k(c.m, row.level, row.assumptions)) }) },
  num('$ / 1M blended', (c) => F.usd(c.m.blended)),
];

function renderCaps(p) {
  const host = $('#pick-caps');
  if (!p.short.length) return host.replaceChildren(el('p', { class: 'empty', text: 'No candidates.' }));
  // The three AA indices are always shown; a Design Elo preset adds its own column.
  const columns = p.preset.quality === 'design' ? [num(p.quality.short, (c) => fmtQ(c.quality)), ...CAP_COLUMNS] : CAP_COLUMNS;
  const compare = p.s.compare;
  const rows = p.short.map((c) => {
    const row = { ...effortFor(c, compare), compare, assumptions: p.assumptions };
    return el('tr', {}, [roleCell(c, p), ...columns.map((col) => col.cell(c, row))]);
  });
  const head = el('tr', {}, [el('th', { text: 'Model' }), ...columns.map((col) => el('th', { class: col.num ? 'num' : null, text: col.label }))]);
  host.replaceChildren(el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)]));
}

// ---------- entry points ----------

let lastModels = [];

/** options.apiKey: needed for latency/throughput, which OpenRouter only returns to authenticated requests. */
export function renderPick(models, { apiKey = '' } = {}) {
  lastModels = models;
  lastApiKey = apiKey;
  const p = compute(models);
  ensureSpeed(p.short.map((c) => c.m.id), apiKey, () => renderPick(lastModels, { apiKey: lastApiKey }));
  renderSummary(p);
  renderTiers(p);
  renderCallout(p);
  renderEffortTable(p);
  renderCurves(p);
  renderScatter(p);
  renderCaps(p);
}

/** rerender: redraws the whole page, since other cards share the pick section's cost assumptions. */
export function initPick(rerender = () => renderPick(lastModels, { apiKey: lastApiKey })) {
  initPickControls(rerender);
}
