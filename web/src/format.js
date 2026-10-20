// Formatting + lookups driven by app.config.json (fetched from GET /api/config at startup).

let cfg = null;
let money;
let compact;

export function configureFormat(appConfig) {
  cfg = appConfig;
  const { locale, currency } = appConfig.dashboard;
  money = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
}
configureFormat({ dashboard: { locale: 'en-US', currency: 'USD' } });

export const fmtMoney = (n) => money.format(n || 0);
export const fmtCompact = (n) => {
  const v = n || 0;
  const symbol = money.formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';
  return `${v < 0 ? '-' : ''}${symbol}${compact.format(Math.abs(v))}`;
};
export const fmtPct = (p) => (p == null || !Number.isFinite(p) ? 'n/a' : `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`);

/** Relative change; null when the comparison base is zero. */
export const pctChange = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) : null);

export const groupLabel = (g) => cfg?.groups?.labels?.[g] || g;
export const groupColor = (g) => `var(--series-${cfg?.groups?.colors?.[g] || 1})`;

/** Metric descriptor from config: { key, label, upIsGood, color }. */
export function metric(key) {
  const m = cfg?.metrics?.[key] || { label: key, upIsGood: true, color: 1 };
  return { key, ...m, format: m.ratio ? 'percent' : 'money', color: `var(--series-${m.color || 1})` };
}

export const isPercent = (key) => metric(key).format === 'percent';

/** Format a metric value: money for sums, percentage for ratios. null -> en dash. */
export function fmtMetric(key, v, compact = false) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (isPercent(key)) return `${(v * 100).toFixed(1)}%`;
  return compact ? fmtCompact(v) : fmtMoney(v);
}

/** Change between two values of a metric: % change for money, percentage points for ratios. */
export function fmtChange(key, cur, prev) {
  if (prev == null || cur == null) return 'n/a';
  if (isPercent(key)) {
    const d = (cur - prev) * 100;
    return `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`;
  }
  return fmtPct(pctChange(cur, prev));
}

export const officeColor = (colorIndex) => `var(--series-${(colorIndex % 8) + 1})`;

export function addMonths(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
