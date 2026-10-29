// KPI dashboard: an Executive-style visual summary (tiles, trend, leaderboard, heatmap, cost structure, profit
// bridge, movers) computed from the office statements of one Offices instance (config/offices-sheet.json = the
// client's column-E account map, or config/offices.json). Pure functions over buildStatement() output so they can
// be tested without a database. Settings in config/kpi-dashboard.json, validated here against the statement rows.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { addMonths } from '../periods.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const isPct = (k) => String(k).startsWith('pct:');
const rowKeyOf = (k) => (isPct(k) ? String(k).slice(4) : String(k));
const UP_IS_GOOD = { collections: true, feesSubtotal: true, ebitda: true, cashFlow: true, cost: false, other: false, fees: false };
const EBITDA_SIGN = { collections: 1, cost: -1, other: -1, fees: -1 };

/** Metric descriptor for a row key or pct:<row key>. Throws naming the config key when it is not a statement row. */
export function metricDef(key, rows, where, name) {
  const row = rows.find((r) => r.key === rowKeyOf(key));
  if (!row) throw new Error(`${name}: ${where} "${key}" is not a row key of the statement (rows.list of the offices config)`);
  if (isPct(key) && row.role === 'collections') throw new Error(`${name}: ${where} "${key}" is the collections row as % of itself`);
  return {
    key, row: row.key, role: row.role, format: isPct(key) ? 'percent' : 'money',
    label: isPct(key) ? `${row.label} % of collections` : row.label,
    upIsGood: UP_IS_GOOD[row.role] ?? null,
  };
}

export function loadDashboardConfig(file, rows) {
  const name = path.relative(ROOT, file) || file;
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${name}: ${e.message}`); }
  const list = (v, where, { min = 0, max = 12 } = {}) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`${name}: ${where} must be a list of ${min}..${max} metric keys (row key or pct:<row key>)`);
    return v.map((k) => metricDef(k, rows, where, name));
  };
  const num = (v, def, where, { min, max }) => { const x = v ?? def; if (typeof x !== 'number' || !(x >= min && x <= max)) throw new Error(`${name}: ${where} must be a number ${min}..${max}`); return x; };
  const tiles = list(raw.tiles, 'tiles', { min: 1, max: 8 });
  const shares = list(raw.shares || [], 'shares', { max: 8 });
  for (const s of shares) if (s.format !== 'money' || s.role === 'collections') throw new Error(`${name}: shares "${s.key}" must be a money row other than collections (it is shown as % of collections)`);
  const tr = raw.trend || {};
  const trend = { bars: metricDef(tr.bars || 'netCollections', rows, 'trend.bars', name), line: metricDef(tr.line || 'officeEbitda', rows, 'trend.line', name) };
  if (trend.bars.format !== 'money' || trend.line.format !== 'money') throw new Error(`${name}: trend.bars and trend.line must be money rows`);
  const lb = raw.leaderboard || {};
  const columns = list(lb.columns, 'leaderboard.columns', { min: 1, max: 12 });
  if (lb.defaultSort && !columns.some((c) => c.key === lb.defaultSort)) throw new Error(`${name}: leaderboard.defaultSort must be one of leaderboard.columns`);
  const spark = metricDef(lb.spark || trend.line.key, rows, 'leaderboard.spark', name);
  const hm = raw.heatmap || {};
  const heatmap = { metric: metricDef(hm.metric || 'pct:officeEbitda', rows, 'heatmap.metric', name), clampPercent: num(hm.clampPercent, 30, 'heatmap.clampPercent', { min: 1, max: 100 }) };
  const csRows = raw.costStructure?.rows?.length ? list(raw.costStructure.rows, 'costStructure.rows', { max: 20 }) : rows.filter((r) => ['cost', 'other', 'fees'].includes(r.role)).map((r) => metricDef(r.key, rows, 'costStructure.rows', name));
  for (const r of csRows) if (!['cost', 'other', 'fees'].includes(r.role) || r.format !== 'money') throw new Error(`${name}: costStructure.rows "${r.key}" must be a cost, other or fees row`);
  const movers = { count: Math.round(num(raw.movers?.count, 8, 'movers.count', { min: 1, max: 30 })) };
  const bridge = { enabled: raw.bridge?.enabled !== false };
  // offices.buckets: only offices in these page.portfolio.buckets of the source Offices config (null = every office).
  const buckets = raw.offices?.buckets ?? null;
  if (buckets !== null && (!Array.isArray(buckets) || !buckets.length || buckets.some((b) => typeof b !== 'string'))) throw new Error(`${name}: offices.buckets must be null or a non-empty list of bucket keys`);
  return { tiles, shares, trend, leaderboard: { columns, defaultSort: lb.defaultSort || columns[0].key, spark }, heatmap, costStructure: { rows: csRows }, movers, bridge, buckets };
}

/**
 * Value of a metric for one statement: { period, prior, monthly, priorMonthly } (priorMonthly[m] = the month a year
 * before m; the statement must have been built with those months). Percent metrics divide by the collections row;
 * null when collections are 0.
 */
function metricValues(st, def, months, coll) {
  const row = st.rows.find((r) => r.key === def.row);
  if (!row) return { period: null, prior: null, monthly: {}, priorMonthly: {} };
  const at = (r, m) => r.months[m] || 0;
  const pct = (a, b) => (b ? round4(a / b) : null);
  const v = def.format === 'money' ? (m) => round2(at(row, m)) : (m) => pct(at(row, m), at(coll, m));
  const hasMonth = (m) => row.months[m] !== undefined || (coll && coll.months[m] !== undefined);
  return {
    period: def.format === 'money' ? round2(row.period) : pct(row.period, coll.period),
    prior: def.format === 'money' ? round2(row.prior) : pct(row.prior, coll.prior),
    monthly: Object.fromEntries(months.map((m) => [m, v(m)])),
    priorMonthly: Object.fromEntries(months.map((m) => { const p = addMonths(m, -12); return [m, hasMonth(p) ? v(p) : null]; })),
  };
}

/**
 * offices: [{ key, name, city, state, companies, flags, cash, statement }] (officeFigures output, offices with data);
 * months: the months of the range; rows: the statement rows (cfg.rows); dcfg: loadDashboardConfig() output.
 */
export function buildDashboard({ offices, months, rows, dcfg }) {
  const metricKeys = [...new Set([...rows.map((r) => r.key), ...rows.filter((r) => r.role !== 'collections').map((r) => `pct:${r.key}`)])];
  const defs = Object.fromEntries(metricKeys.map((k) => [k, metricDef(k, rows, 'metric', 'dashboard')]));
  const collKey = rows.find((r) => r.role === 'collections').key;
  // Per office.
  const out = offices.map((o) => {
    const st = o.statement;
    const coll = st.rows.find((r) => r.key === collKey);
    const values = Object.fromEntries(metricKeys.map((k) => [k, metricValues(st, defs[k], months, coll)]));
    return { key: o.key, name: o.name, city: o.city, state: o.state, companies: o.companies.map((c) => c.realmId), flags: (o.flags || []).length, cash: o.cash ?? null, values };
  });
  // Portfolio totals: money metrics summed, percent metrics from the sums.
  const totals = {};
  for (const k of metricKeys) {
    const d = defs[k];
    if (d.format === 'money') {
      const sumBy = (pick) => Object.fromEntries(months.map((m) => { const vs = out.map((o) => pick(o.values[k])[m]).filter((x) => x != null); return [m, vs.length ? round2(vs.reduce((t, x) => t + x, 0)) : null]; }));
      totals[k] = { period: round2(out.reduce((t, o) => t + (o.values[k].period || 0), 0)), prior: round2(out.reduce((t, o) => t + (o.values[k].prior || 0), 0)), monthly: sumBy((v) => v.monthly), priorMonthly: sumBy((v) => v.priorMonthly) };
    }
  }
  for (const k of metricKeys) {
    const d = defs[k];
    if (d.format !== 'percent') continue;
    const num = totals[d.row]; const den = totals[collKey];
    const pct = (a, b) => (b ? round4(a / b) : null);
    totals[k] = { period: pct(num.period, den.period), prior: pct(num.prior, den.prior), monthly: Object.fromEntries(months.map((m) => [m, pct(num.monthly[m], den.monthly[m])])), priorMonthly: Object.fromEntries(months.map((m) => [m, pct(num.priorMonthly[m], den.priorMonthly[m])])) };
  }
  // Movers: the accounts behind the rows that moved EBITDA the most vs the prior period (collections up = good, costs up = bad).
  const acc = new Map();
  for (const o of offices) for (const r of o.statement.rows) {
    const sign = EBITDA_SIGN[r.role];
    if (!sign) continue;
    for (const c of r.children) {
      const k = `${r.key}|${c.account}`;
      const a = acc.get(k) || { account: c.account, row: r.key, rowLabel: r.label, period: 0, prior: 0, offices: 0, sign };
      a.period += c.period; a.prior += c.prior; a.offices += 1;
      acc.set(k, a);
    }
  }
  const movers = [...acc.values()].map((a) => ({ ...a, period: round2(a.period), prior: round2(a.prior), impact: round2(a.sign * (a.period - a.prior)) }))
    .filter((a) => Math.abs(a.impact) >= 0.5).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, dcfg.movers.count * 3);
  return { offices: out, totals, movers, metrics: Object.values(defs) };
}
