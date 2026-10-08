// Small SVG chart kit: horizontal bars, columns, scatter and heatmap.
// Marks follow one spec everywhere: thin bars with a 4px rounded data-end,
// hairline solid grid, 2px surface ring on dots, and a hover/focus tooltip on
// every mark. All label text is inserted with textContent (API data is untrusted).

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

export function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, content, attrs = {}) {
  const node = svgEl('text', { x, y, ...attrs }, parent);
  node.textContent = content;
  return node;
}

let measureCtx;
export function textWidth(s, font = FONT) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(s).width;
}

export function truncate(s, maxWidth) {
  if (textWidth(s) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${s.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

// ---------- scales ----------

function niceStep(raw, integer) {
  if (integer && raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  // 2.5 × 10^0 would put fractional ticks on a count axis.
  const allow25 = !integer || p >= 10;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && allow25 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function linearTicks(min, max, count = 4, integer = false) {
  if (!(max > min)) max = min + 1;
  const step = niceStep((max - min) / count, integer);
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = lo; v <= max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function logTicks(min, max) {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const ticks = [];
  for (let e = lo; e <= Math.max(hi, lo + 1); e++) ticks.push(10 ** e);
  return ticks;
}

function scale(domain, range, log) {
  const [d0, d1] = log ? domain.map(Math.log10) : domain;
  const [r0, r1] = range;
  return (v) => r0 + (((log ? Math.log10(v) : v) - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

// ---------- tooltip ----------

let tipNode;
function tooltip() {
  if (!tipNode) {
    tipNode = document.createElement('div');
    tipNode.className = 'tooltip';
    tipNode.setAttribute('role', 'tooltip');
    document.body.appendChild(tipNode);
  }
  return tipNode;
}

/** content: { title, rows: [{ value, label, color }] } — values lead, labels follow. */
function renderTip(content) {
  const tip = tooltip();
  tip.replaceChildren();
  if (content.title) {
    const t = document.createElement('div');
    t.className = 'tooltip-title';
    t.textContent = content.title;
    tip.appendChild(t);
  }
  for (const row of content.rows || []) {
    const r = document.createElement('div');
    r.className = 'tooltip-row';
    if (row.color) {
      const key = document.createElement('span');
      key.className = 'tooltip-key';
      key.style.background = row.color;
      r.appendChild(key);
    }
    const v = document.createElement('strong');
    v.textContent = row.value;
    r.appendChild(v);
    if (row.label) {
      const l = document.createElement('span');
      l.textContent = row.label;
      r.appendChild(l);
    }
    tip.appendChild(r);
  }
  tip.classList.add('visible');
}

function placeTip(x, y) {
  const tip = tooltip();
  const { width, height } = tip.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - width - 8);
  const top = y + 14 + height > window.innerHeight ? y - height - 10 : y + 14;
  tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
}

export function hideTip() {
  tipNode?.classList.remove('visible');
}

function bindTip(node, getContent, onActive) {
  node.addEventListener('pointerenter', (e) => {
    onActive?.(true);
    renderTip(getContent());
    placeTip(e.clientX, e.clientY);
  });
  node.addEventListener('pointermove', (e) => placeTip(e.clientX, e.clientY));
  node.addEventListener('pointerleave', () => {
    onActive?.(false);
    hideTip();
  });
  node.addEventListener('focus', () => {
    onActive?.(true);
    renderTip(getContent());
    const r = node.getBoundingClientRect();
    placeTip(r.left + r.width / 2, r.top + r.height / 2);
  });
  node.addEventListener('blur', () => {
    onActive?.(false);
    hideTip();
  });
}

// ---------- mark geometry ----------

function hBarPath(x0, y, w, h, r = 4) {
  r = Math.min(r, w, h / 2);
  const x1 = x0 + w;
  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
}

function vBarPath(x, base, w, h, r = 4) {
  r = Math.min(r, h, w / 2);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

function rootSvg(host, width, height, label) {
  host.replaceChildren();
  const svg = svgEl('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': label,
    class: 'chart-svg',
  });
  host.appendChild(svg);
  return svg;
}

function emptyState(host, message) {
  host.replaceChildren();
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = message;
  host.appendChild(p);
}

// ---------- horizontal bar chart (1+ series per row) ----------

/**
 * spec: {
 *   rows: [{ label, values: number[], sub? }],
 *   series: [{ name, color }],
 *   format: (v) => string,
 *   label: accessible name,
 * }
 */
export function barChart(host, spec) {
  const { rows, series, format } = spec;
  if (!rows.length) return emptyState(host, spec.empty || 'No models match the current filters.');
  const width = Math.max(300, host.clientWidth);
  const n = series.length;
  const barH = n === 1 ? 16 : 11;
  const band = n === 1 ? 28 : n * barH + (n - 1) * 2 + 14;
  const labelW = Math.min(spec.labelWidth ?? 200, Math.round(width * 0.36));
  const max = Math.max(...rows.flatMap((r) => r.values.filter((v) => v != null)), 0);
  const ticks = linearTicks(0, max || 1, width < 520 ? 3 : 4, spec.integer);
  const valueW = Math.max(...rows.flatMap((r) => r.values.map((v) => textWidth(format(v), '11px system-ui')))) + 10;
  const top = 22;
  const plotX = labelW;
  const plotW = width - labelW - valueW - 4;
  const height = top + rows.length * band + 4;
  const x = scale([0, ticks.at(-1)], [plotX, plotX + plotW]);
  const svg = rootSvg(host, width, height, spec.label);

  const grid = svgEl('g', { class: 'grid' }, svg);
  for (const t of ticks) {
    svgEl('line', { x1: x(t), x2: x(t), y1: top - 4, y2: height, class: t === 0 ? 'baseline' : 'gridline' }, grid);
    text(grid, x(t), 12, format(t), { class: 'tick', 'text-anchor': t === 0 ? 'start' : 'middle' });
  }

  rows.forEach((row, i) => {
    const y0 = top + i * band;
    const g = svgEl('g', { class: 'row', tabindex: 0, 'aria-label': `${row.label}: ${row.values.map(format).join(', ')}` }, svg);
    svgEl('rect', { x: 0, y: y0, width, height: band, class: 'hit' }, g);
    const label = text(g, labelW - 10, y0 + band / 2 + 4, truncate(row.label, labelW - 14), {
      class: 'row-label',
      'text-anchor': 'end',
    });
    svgEl('title', {}, label).textContent = row.label;
    const groupH = n * barH + (n - 1) * 2;
    row.values.forEach((v, s) => {
      const by = y0 + (band - groupH) / 2 + s * (barH + 2);
      if (v == null) return;
      const w = x(v) - plotX;
      if (w > 0.5) {
        const path = svgEl('path', { d: hBarPath(plotX, by, w, barH), class: 'mark' }, g);
        path.style.fill = series[s].color;
      }
      text(g, plotX + Math.max(w, 0) + 5, by + barH / 2 + 4, format(v), { class: 'value' });
    });
    bindTip(
      g,
      () => ({
        title: row.label,
        rows: [
          ...series.map((s, si) => ({ value: format(row.values[si]), label: s.name, color: s.color })),
          ...(row.sub || []).map((s) => ({ value: s.value, label: s.label })),
        ],
      }),
      (on) => g.classList.toggle('active', on),
    );
  });
}

// ---------- column chart (ordered bins / time) ----------

/**
 * spec: { rows: [{ label, value, tip? }], color, format, capLabels: 'all'|'max'|'none', label, xTitle }
 */
export function columnChart(host, spec) {
  const { rows, format } = spec;
  if (!rows.length || rows.every((r) => !r.value)) return emptyState(host, spec.empty || 'No data for the current filters.');
  const width = Math.max(300, host.clientWidth);
  const height = 250;
  const m = { top: 20, right: 8, bottom: 30, left: 40 };
  const max = Math.max(...rows.map((r) => r.value));
  const ticks = linearTicks(0, max, 4, spec.integer);
  const y = scale([0, ticks.at(-1)], [height - m.bottom, m.top]);
  const plotW = width - m.left - m.right;
  const band = plotW / rows.length;
  const barW = Math.min(24, band * 0.7);
  const svg = rootSvg(host, width, height, spec.label);

  for (const t of ticks) {
    svgEl('line', { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: t === 0 ? 'baseline' : 'gridline' }, svg);
    text(svg, m.left - 6, y(t) + 4, spec.tickFormat ? spec.tickFormat(t) : format(t), { class: 'tick', 'text-anchor': 'end' });
  }

  const maxLabelW = Math.max(...rows.map((r) => textWidth(r.label, '11px system-ui')));
  const every = Math.max(1, Math.ceil((maxLabelW + 8) / band));
  const maxIdx = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0);

  rows.forEach((row, i) => {
    const cx = m.left + band * i + band / 2;
    const g = svgEl('g', { class: 'row', tabindex: 0, 'aria-label': `${row.label}: ${format(row.value)}` }, svg);
    svgEl('rect', { x: m.left + band * i, y: m.top, width: band, height: height - m.top - m.bottom, class: 'hit' }, g);
    const h = y(0) - y(row.value);
    if (h > 0.5) {
      const path = svgEl('path', { d: vBarPath(cx - barW / 2, y(0), barW, h), class: 'mark' }, g);
      path.style.fill = spec.color;
    }
    const showCap = spec.capLabels === 'all' || (spec.capLabels === 'max' && i === maxIdx);
    if (showCap && row.value) text(g, cx, y(row.value) - 6, format(row.value), { class: 'value', 'text-anchor': 'middle' });
    if (i % every === 0) text(svg, cx, height - m.bottom + 16, row.label, { class: 'tick', 'text-anchor': 'middle' });
    bindTip(
      g,
      () => row.tip || { title: row.label, rows: [{ value: format(row.value), label: spec.valueLabel || '', color: spec.color }] },
      (on) => g.classList.toggle('active', on),
    );
  });
}

// ---------- scatter ----------

/**
 * spec: {
 *   points: [{ id, x, y, group, label, tip }], groups: [{ name, color }],
 *   xLog, yLog, xTitle, yTitle, xFormat, yFormat, labelIds: Set, label
 * }
 */
export function scatterChart(host, spec) {
  const pts = spec.points.filter(
    (p) => p.x != null && p.y != null && (!spec.xLog || p.x > 0) && (!spec.yLog || p.y > 0),
  );
  if (!pts.length) return emptyState(host, spec.empty || 'No models with both values under the current filters.');
  const width = Math.max(300, host.clientWidth);
  const height = 340;
  const m = { top: 14, right: 16, bottom: 44, left: 56 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xTicks = spec.xLog ? logTicks(Math.min(...xs), Math.max(...xs)) : linearTicks(Math.min(0, ...xs), Math.max(...xs));
  const yTicks = spec.yLog ? logTicks(Math.min(...ys), Math.max(...ys)) : linearTicks(spec.yZero ? 0 : Math.min(...ys), Math.max(...ys));
  const x = scale([xTicks[0], xTicks.at(-1)], [m.left, width - m.right], spec.xLog);
  const y = scale([yTicks[0], yTicks.at(-1)], [height - m.bottom, m.top], spec.yLog);
  const svg = rootSvg(host, width, height, spec.label);

  const skipEvery = width < 480 && xTicks.length > 6 ? 2 : 1;
  xTicks.forEach((t, i) => {
    svgEl('line', { x1: x(t), x2: x(t), y1: m.top, y2: height - m.bottom, class: i === 0 ? 'baseline' : 'gridline' }, svg);
    const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
    if (i % skipEvery === 0) text(svg, x(t), height - m.bottom + 16, spec.xFormat(t), { class: 'tick', 'text-anchor': anchor });
  });
  yTicks.forEach((t, i) => {
    svgEl('line', { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: i === 0 ? 'baseline' : 'gridline' }, svg);
    text(svg, m.left - 6, y(t) + 4, spec.yFormat(t), { class: 'tick', 'text-anchor': 'end' });
  });
  text(svg, m.left + (width - m.left - m.right) / 2, height - 6, spec.xTitle, { class: 'axis-title', 'text-anchor': 'middle' });
  text(svg, 12, m.top + (height - m.top - m.bottom) / 2, spec.yTitle, {
    class: 'axis-title',
    'text-anchor': 'middle',
    transform: `rotate(-90 12 ${m.top + (height - m.top - m.bottom) / 2})`,
  });

  const dots = svgEl('g', {}, svg);
  const placed = pts.map((p) => ({ p, cx: x(p.x), cy: y(p.y) }));
  for (const d of placed) {
    const c = svgEl('circle', { cx: d.cx, cy: d.cy, r: 4, class: 'dot' }, dots);
    c.style.fill = spec.groups[d.p.group].color;
  }

  // Selective direct labels; skip any that would collide with one already placed.
  const boxes = [];
  for (const d of placed.filter((d) => spec.labelIds?.has(d.p.id))) {
    const w = textWidth(d.p.label, '11px system-ui');
    const right = d.cx + 7 + w < width - m.right;
    const bx = right ? d.cx + 7 : d.cx - 7 - w;
    const box = { x0: bx - 2, x1: bx + w + 2, y0: d.cy - 10, y1: d.cy + 4 };
    if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
    boxes.push(box);
    text(svg, bx, d.cy + 1, d.p.label, { class: 'point-label' });
  }

  // Nearest-point hover layer: the pointer only has to be closest, within 24px.
  const ring = svgEl('circle', { r: 7, class: 'focus-ring', visibility: 'hidden' }, svg);
  const overlay = svgEl('rect', {
    x: m.left,
    y: m.top,
    width: width - m.left - m.right,
    height: height - m.top - m.bottom,
    class: 'overlay',
    tabindex: 0,
    'aria-label': `${spec.label}. Use arrow keys to step through ${placed.length} points.`,
  }, svg);
  const order = [...placed].sort((a, b) => a.cx - b.cx);
  let active = -1;
  const activate = (d, clientX, clientY) => {
    ring.setAttribute('cx', d.cx);
    ring.setAttribute('cy', d.cy);
    ring.setAttribute('visibility', 'visible');
    renderTip(d.p.tip);
    placeTip(clientX, clientY);
  };
  const clear = () => {
    ring.setAttribute('visibility', 'hidden');
    hideTip();
  };
  overlay.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = null;
    let bestD = 24 * 24;
    for (const d of placed) {
      const dd = (d.cx - px) ** 2 + (d.cy - py) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    if (best) activate(best, e.clientX, e.clientY);
    else clear();
  });
  overlay.addEventListener('pointerleave', clear);
  overlay.addEventListener('blur', clear);
  overlay.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) + order.length) % order.length;
    const d = order[active];
    const r = svg.getBoundingClientRect();
    activate(d, r.left + d.cx, r.top + d.cy);
  });
}

// ---------- heatmap ----------

const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Sequential blue: light mode runs light→dark; dark mode runs dark→light so "near zero" recedes into the surface. */
export function rampColor(t, dark) {
  const steps = dark ? [...RAMP].reverse() : RAMP;
  const pos = Math.max(0, Math.min(1, t)) * (steps.length - 1);
  const i = Math.min(steps.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(steps[i]);
  const b = hexToRgb(steps[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}

export function rampGradient(dark) {
  const steps = dark ? [...RAMP].reverse() : RAMP;
  return `linear-gradient(90deg, ${steps.join(', ')})`;
}

/**
 * spec: { rows: [label], cols: [label], cells: [[{ value (0..1) | null, tip }]], dark, label }
 * A null/0 value draws the empty-cell token so "none" differs from "a little".
 */
export function heatmap(host, spec) {
  const { rows, cols, cells } = spec;
  if (!rows.length) return emptyState(host, spec.empty || 'No data for the current filters.');
  const available = Math.max(300, host.clientWidth);
  const rowLabelW = Math.min(spec.rowLabelWidth ?? 150, Math.round(available * 0.34));
  // Rotated column labels run up and to the right; reserve room for the last one.
  const lastExtent = textWidth(cols.at(-1), '11px system-ui') * 0.72;
  const cellW = Math.max(26, Math.min(64, (available - rowLabelW - lastExtent - 4) / cols.length));
  const cellH = 26;
  const headerH = Math.min(120, Math.max(...cols.map((c) => textWidth(c, '11px system-ui'))) * 0.72 + 18);
  const width = rowLabelW + cols.length * cellW + Math.max(4, lastExtent - cellW / 2 + 8);
  const height = headerH + rows.length * cellH + 4;
  const svg = rootSvg(host, width, height, spec.label);

  cols.forEach((c, j) => {
    const cx = rowLabelW + j * cellW + cellW / 2;
    text(svg, cx, headerH - 6, c, { class: 'tick', transform: `rotate(-45 ${cx} ${headerH - 6})` });
  });
  rows.forEach((r, i) => {
    const y0 = headerH + i * cellH;
    const label = text(svg, rowLabelW - 8, y0 + cellH / 2 + 4, truncate(r, rowLabelW - 12), { class: 'row-label', 'text-anchor': 'end' });
    svgEl('title', {}, label).textContent = r;
    cols.forEach((c, j) => {
      const cell = cells[i][j];
      // 2px surface gap between cells comes from drawing each cell 2px smaller.
      const rect = svgEl('rect', {
        x: rowLabelW + j * cellW + 1,
        y: y0 + 1,
        width: cellW - 2,
        height: cellH - 2,
        rx: 3,
        class: 'cell',
        tabindex: 0,
        'aria-label': `${r}, ${c}: ${cell.tip.rows[0].value}`,
      }, svg);
      if (cell.value) rect.style.fill = rampColor(cell.value, spec.dark);
      else rect.classList.add('cell-empty');
      bindTip(rect, () => cell.tip, (on) => rect.classList.toggle('active', on));
    });
  });
}
