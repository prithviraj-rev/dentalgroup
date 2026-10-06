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
  return { key, ...m, color: `var(--series-${m.color})` };
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
