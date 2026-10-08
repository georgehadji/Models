import { loadCatalog, parseSnapshot, OPENROUTER_API, MODELS_PATH } from './api.js';
import * as D from './data.js';
import * as F from './format.js';
import { barChart, scatterChart, heatmap, hideTip } from './charts.js';
import { CARDS } from './cards.js';
import { initPick, renderPick } from './pick.js';
import { resetSpeed } from './speed.js';

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
  const built = card.build(ctx);
  const chartHost = el.querySelector('.chart');
  const tableHost = el.querySelector('.table-wrap');
  const tableMode = state.tableMode.has(card.id) && built.chart.type !== 'empty';
  chartHost.hidden = tableMode;
  tableHost.hidden = !tableMode;
  if (tableMode) renderTable(tableHost, built.table.columns, built.table.rows);
  else drawChart(chartHost, built.chart);
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
  renderPick(ctx.models, { apiKey: $('#api-key').value.trim() });
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
  resetSpeed(); // latency/throughput are 30-minute figures; a refresh fetches them again
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
  keyInput.addEventListener('change', () => {
    writeStore('sessionStorage', 'atlas-api-key', keyInput.value.trim());
    renderAll(); // a key unlocks latency and throughput in the pick section
  });

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
  initPick(renderAll);

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
