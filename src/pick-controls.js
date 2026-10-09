// Form state for the "Pick for a project" section: presets, requirements,
// weights, task size, reasoning-token estimates and the effort used to
// compare the shortlist. Persisted per browser (best effort).

import { PRESETS, presetById, QUALITY, EFFORT_ORDER, DEFAULT_REASONING_TOKENS } from './recommend.js';

const STORE_KEY = 'atlas-pick';
const $ = (sel) => document.querySelector(sel);

function fromPreset(preset, reasoningTokens = { ...DEFAULT_REASONING_TOKENS }) {
  return {
    presetId: preset.id,
    require: [...preset.require],
    minContext: preset.minContext,
    maxBlended: preset.maxBlended,
    // Speed starts off: it needs an API key and one request per candidate model.
    weights: { speed: 0, ...preset.weights },
    task: { ...preset.task },
    reasoningTokens,
    compare: { all: 'default', rows: {} },
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && PRESETS.some((p) => p.id === saved.presetId && !p.link)) {
      const base = fromPreset(presetById(saved.presetId));
      return {
        ...base,
        ...saved,
        weights: { ...base.weights, ...saved.weights },
        task: { ...base.task, ...saved.task },
        reasoningTokens: { ...DEFAULT_REASONING_TOKENS, ...saved.reasoningTokens },
        compare: { all: saved.compare?.all || 'default', rows: { ...saved.compare?.rows } },
      };
    }
  } catch {
    /* storage unavailable or corrupt: start from the default preset */
  }
  return fromPreset(PRESETS[0]);
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const pickState = () => state;

/** Replace part of the state immutably, persist it and re-render. */
let onChange = () => {};
export function update(patch) {
  state = { ...state, ...patch };
  save();
  onChange();
}

const nonNegative = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function renderPresets() {
  const host = $('#pick-presets');
  host.replaceChildren(
    ...PRESETS.map((p) => {
      const el = document.createElement(p.link ? 'a' : 'button');
      el.className = `preset${p.link ? ' link' : ''}`;
      el.dataset.preset = p.id;
      if (p.link) {
        el.href = p.link;
      } else {
        el.type = 'button';
        el.setAttribute('role', 'radio');
        el.addEventListener('click', () => {
          update(fromPreset(p, state.reasoningTokens));
          syncForm();
        });
      }
      const b = document.createElement('b');
      b.textContent = p.label;
      const small = document.createElement('small');
      small.textContent = p.hint;
      el.append(b, small);
      return el;
    }),
  );
}

function renderEffortInputs() {
  $('#pick-effort-tokens').replaceChildren(
    ...EFFORT_ORDER.filter((e) => e !== 'none').map((level) => {
      const label = document.createElement('label');
      label.textContent = level;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '500';
      input.dataset.level = level;
      label.appendChild(input);
      return label;
    }),
  );
}

function renderCompareOptions() {
  $('#pick-compare').replaceChildren(
    new Option("Each model's default", 'default'),
    ...EFFORT_ORDER.map((e) => new Option(`All at ${e}`, e)),
  );
}

const showWeights = () => {
  for (const k of ['quality', 'cost', 'context', 'speed']) $(`#w-${k}`).nextElementSibling.textContent = String(state.weights[k]);
};

/** Push the state into the form controls. */
export function syncForm() {
  for (const el of document.querySelectorAll('#pick-presets [role="radio"]')) {
    el.setAttribute('aria-checked', String(el.dataset.preset === state.presetId));
  }
  for (const box of document.querySelectorAll('input[name="pick-req"]')) box.checked = state.require.includes(box.value);
  $('#pick-ctx').value = String(state.minContext);
  $('#pick-max').value = state.maxBlended == null ? '' : String(state.maxBlended);
  for (const k of ['quality', 'cost', 'context', 'speed']) $(`#w-${k}`).value = String(state.weights[k]);
  showWeights();
  $('#task-in').value = String(state.task.input);
  $('#task-out').value = String(state.task.output);
  for (const input of document.querySelectorAll('#pick-effort-tokens input')) {
    input.value = String(state.reasoningTokens[input.dataset.level]);
  }
  $('#pick-compare').value = state.compare.all;
  $('#pick-quality-note').textContent = `Quality uses the ${QUALITY[presetById(state.presetId).quality].label} for this preset.`;
}

/** Read the whole form back into state. */
function readForm() {
  const tokens = [...document.querySelectorAll('#pick-effort-tokens input')].map((i) => [
    i.dataset.level,
    nonNegative(i.value, state.reasoningTokens[i.dataset.level]),
  ]);
  update({
    require: [...document.querySelectorAll('input[name="pick-req"]:checked')].map((b) => b.value),
    minContext: Number($('#pick-ctx').value),
    maxBlended: $('#pick-max').value === '' ? null : Number($('#pick-max').value),
    weights: {
      quality: Number($('#w-quality').value),
      cost: Number($('#w-cost').value),
      context: Number($('#w-context').value),
      speed: Number($('#w-speed').value),
    },
    task: { input: nonNegative($('#task-in').value, state.task.input), output: nonNegative($('#task-out').value, state.task.output) },
    reasoningTokens: { ...state.reasoningTokens, ...Object.fromEntries(tokens) },
  });
  showWeights();
}

export function initPickControls(rerender) {
  onChange = rerender;
  renderPresets();
  renderEffortInputs();
  renderCompareOptions();
  syncForm();
  let debounce;
  $('#pick-form').addEventListener('input', (e) => {
    if (e.target.type === 'range') showWeightsLive(e.target);
    clearTimeout(debounce);
    debounce = setTimeout(readForm, e.target.type === 'range' || e.target.type === 'number' ? 150 : 0);
  });
  $('#pick-reset').addEventListener('click', () => {
    update(fromPreset(presetById(state.presetId), state.reasoningTokens));
    syncForm();
  });
  $('#pick-compare').addEventListener('change', (e) => update({ compare: { all: e.target.value, rows: {} } }));
}

function showWeightsLive(range) {
  range.nextElementSibling.textContent = range.value;
}
