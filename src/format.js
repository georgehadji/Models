export function compact(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}

function trim(n) {
  const digits = Math.abs(n) >= 100 ? 0 : 1;
  return Number(n.toFixed(digits)).toLocaleString('en-US');
}

export function tokens(n) {
  return n == null ? '—' : compact(n);
}

/** USD with precision that scales down for sub-cent values. */
export function usd(n) {
  if (n == null) return '—';
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

export function pct(share) {
  return share == null ? '—' : `${Math.round(share * 100)}%`;
}

export function int(n) {
  return n == null ? '—' : n.toLocaleString('en-US');
}

export function date(d) {
  return d ? d.toISOString().slice(0, 10) : '—';
}

export function monthLabel(d) {
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
