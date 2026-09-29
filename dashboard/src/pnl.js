// Pure P&L aggregation helpers: month/quarter/year bucketing and derived metrics.

export const TYPES = ['Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense'];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Color follows the entity: each metric keeps its slot in every chart.
export const METRICS = {
  revenue: { label: 'Revenue', color: 'var(--series-1)' },
  costs: { label: 'Costs (COGS + expenses)', short: 'Costs', color: 'var(--series-2)' },
  netIncome: { label: 'Net income', color: 'var(--series-3)' },
  grossProfit: { label: 'Gross profit', color: 'var(--series-4)' },
};

export const YEAR_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

export const emptyTotals = () => Object.fromEntries(TYPES.map((t) => [t, 0]));

export function derive(t) {
  const revenue = t['Income'];
  const cogs = t['Cost of Goods Sold'];
  const opex = t['Expense'];
  const grossProfit = revenue - cogs;
  const netOperating = grossProfit - opex;
  const netIncome = netOperating + t['Other Income'] - t['Other Expense'];
  return { revenue, cogs, opex, grossProfit, netOperating, netIncome, costs: cogs + opex, otherIncome: t['Other Income'], otherExpense: t['Other Expense'] };
}

export const monthLabel = (p) => `${MONTH_NAMES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
export const monthShort = (p) => `${MONTH_NAMES[Number(p.slice(5, 7)) - 1]} '${p.slice(2, 4)}`;
export const MONTHS_OF_YEAR = MONTH_NAMES;

export function addMonths(period, n) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to` inclusive, so months without postings still show as zero. */
export function monthsBetween(from, to) {
  const out = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function bucketOf(period, granularity) {
  if (granularity === 'quarter') {
    const q = Math.ceil(Number(period.slice(5, 7)) / 3);
    return { key: `${period.slice(0, 4)}-Q${q}`, label: `Q${q} ${period.slice(0, 4)}` };
  }
  if (granularity === 'year') return { key: period.slice(0, 4), label: period.slice(0, 4) };
  return { key: period, label: monthShort(period) };
}

/**
 * Sum rows into ordered buckets across a month range.
 * Returns [{ key, label, months, totals, ...derived }], with `partial` set when a quarter/year
 * bucket doesn't have all its months inside the selected range.
 */
export function bucketize(rows, months, granularity) {
  const buckets = new Map();
  for (const p of months) {
    const b = bucketOf(p, granularity);
    if (!buckets.has(b.key)) buckets.set(b.key, { ...b, months: 0, totals: emptyTotals() });
    buckets.get(b.key).months++;
  }
  const inRange = new Set(months);
  for (const r of rows) {
    if (!inRange.has(r.period)) continue;
    buckets.get(bucketOf(r.period, granularity).key).totals[r.account_type] += r.amount;
  }
  const full = granularity === 'quarter' ? 3 : granularity === 'year' ? 12 : 1;
  return [...buckets.values()].map((b) => ({ ...b, partial: b.months < full, ...derive(b.totals) }));
}

export function totalsFor(rows, months) {
  const inRange = new Set(months);
  const t = emptyTotals();
  for (const r of rows) if (inRange.has(r.period)) t[r.account_type] += r.amount;
  return derive(t);
}

/** Per-account totals per bucket for the P&L statement table. */
export function accountMatrix(rows, months, granularity) {
  const inRange = new Set(months);
  const byType = Object.fromEntries(TYPES.map((t) => [t, new Map()]));
  for (const r of rows) {
    if (!inRange.has(r.period)) continue;
    const accounts = byType[r.account_type];
    if (!accounts) continue;
    const key = bucketOf(r.period, granularity).key;
    if (!accounts.has(r.account_name)) accounts.set(r.account_name, {});
    const cells = accounts.get(r.account_name);
    cells[key] = (cells[key] || 0) + r.amount;
    cells.total = (cells.total || 0) + r.amount;
  }
  return Object.fromEntries(
    TYPES.map((t) => [t, [...byType[t].entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, cells]) => ({ name, cells }))])
  );
}

/** Year-over-year: one row per month-of-year, one column per year, for a metric. */
export function yoySeries(rows, months, metric) {
  const monthly = bucketize(rows, months, 'month');
  const years = [...new Set(months.map((p) => p.slice(0, 4)))];
  const data = MONTH_NAMES.map((name, i) => ({ month: name, idx: i }));
  for (const b of monthly) {
    data[Number(b.key.slice(5, 7)) - 1][b.key.slice(0, 4)] = b[metric];
  }
  return { years, data };
}

/** Top-N accounts of the given types over the range; the tail folds into one "Other" row. */
export function topAccounts(rows, months, types, n = 8) {
  const inRange = new Set(months);
  const sums = new Map();
  for (const r of rows) {
    if (!inRange.has(r.period) || !types.includes(r.account_type)) continue;
    sums.set(r.account_name, (sums.get(r.account_name) || 0) + r.amount);
  }
  const sorted = [...sums.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  if (sorted.length <= n) return sorted;
  const tail = sorted.slice(n - 1);
  return [...sorted.slice(0, n - 1), { name: `Other (${tail.length} accounts)`, value: tail.reduce((s, r) => s + r.value, 0) }];
}

/** Per-office totals over the range for the office comparison chart. */
export function officeTotals(byOffice, months) {
  const inRange = new Set(months);
  const offices = new Map();
  for (const r of byOffice) {
    if (!inRange.has(r.period)) continue;
    if (!offices.has(r.realm_id)) offices.set(r.realm_id, { realm_id: r.realm_id, office: r.office_name, totals: emptyTotals() });
    offices.get(r.realm_id).totals[r.account_type] += r.amount;
  }
  return [...offices.values()].map((o) => ({ ...o, ...derive(o.totals) }));
}

// ---------- formatting ----------

const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtCompact = (v) => (v == null || Number.isNaN(v) ? '–' : compact.format(v));
export const fmtMoney = (v) => (v == null || Number.isNaN(v) ? '–' : whole.format(v));
export const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
export const pctChange = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) : null);
