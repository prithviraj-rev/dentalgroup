// Analysis tab: one office-statement metric (a row of the office statement, or a row as % of net collections)
// split by office, office category, statement row or QuickBooks account over month / quarter / year buckets.
// Pure functions over office statements (buildStatement output), so they can be tested without a database.

const round2 = (n) => Math.round(n * 100) / 100;
const ACCOUNT_ROLES = new Set(['collections', 'cost', 'other', 'fees']);
const ROW_ROLES = new Set(['cost', 'other', 'fees']);

export const isPct = (metric) => String(metric).startsWith('pct:');
export const rowKeyOf = (metric) => (isPct(metric) ? String(metric).slice(4) : String(metric));

/**
 * Check the analysis settings (app.config.json analysis.*) against the office statement rows (config/offices.json).
 * Throws naming the key. Returns the metric descriptors: [{ key, label, format: money | percent, account }].
 */
export function metricDefs(analysisCfg, rows) {
  const coll = rows.find((r) => r.role === 'collections');
  if (!coll || analysisCfg.percentOf !== coll.key) throw new Error(`app.config.json: analysis.percentOf must be the collections row key of config/offices.json ("${coll?.key}")`);
  return analysisCfg.metrics.map((m) => {
    const row = rows.find((r) => r.key === rowKeyOf(m));
    if (!row) throw new Error(`app.config.json: analysis.metrics "${m}" is not a row key of config/offices.json rows.list`);
    if (isPct(m) && row.key === coll.key) throw new Error(`app.config.json: analysis.metrics "${m}" is the collections row as % of itself`);
    return { key: m, label: isPct(m) ? `${row.label} % of ${coll.label.toLowerCase()}` : row.label, format: isPct(m) ? 'percent' : 'money', account: ACCOUNT_ROLES.has(row.role), role: row.role };
  });
}

/**
 * Aggregate statements into series. offices: [{ key, name }]; statementOf(office) -> buildStatement() output;
 * categoryOf(office) -> label (only for by = category); buckets: bucketsFor() output; by: office | category | row | account.
 * Returns { rows: [{ key, label, periods: { bucketKey: value }, total }], totals: { periods, total }, hasData }.
 * Percent metrics divide by the collections row; a bucket with no collections is null.
 */
export function analyze({ offices, statementOf, categoryOf = () => 'Other', buckets, metric, by, percentOf }) {
  const pct = isPct(metric);
  const rowKey = rowKeyOf(metric);
  const bucketOf = {};
  for (const b of buckets) for (const m of b.months) bucketOf[m] = b.key;
  const series = new Map();
  const slot = (key, label) => {
    if (!series.has(key)) series.set(key, { key, label, num: {}, den: {} });
    return series.get(key);
  };
  const addInto = (target, months) => {
    for (const [m, v] of Object.entries(months)) { const b = bucketOf[m]; if (b) target[b] = (target[b] || 0) + v; }
  };
  for (const o of offices) {
    const st = statementOf(o);
    const coll = st.rows.find((r) => r.key === percentOf);
    const row = st.rows.find((r) => r.key === rowKey);
    if (!row || !coll) continue;
    const parts = by === 'office' ? [[o.key, o.name, row.months]]
      : by === 'category' ? [[categoryOf(o), categoryOf(o), row.months]]
        : by === 'row' ? st.rows.filter((r) => ROW_ROLES.has(r.role)).map((r) => [r.key, r.label, r.months])
          : row.children.map((c) => [c.fullName, c.allocated ? c.fullName : c.fullName.split(':')[0], c.months]);
    for (const [key, label, months] of parts) {
      const s = slot(key, label);
      addInto(s.num, months);
      addInto(s.den, coll.months);
    }
  }
  const value = (num, den) => (pct ? (den ? round2(num / den * 10000) / 10000 : null) : round2(num));
  const sum = (o) => Object.values(o).reduce((t, v) => t + v, 0);
  const rows = [...series.values()].map((s) => ({
    key: s.key, label: s.label,
    periods: Object.fromEntries(buckets.map((b) => [b.key, value(s.num[b.key] || 0, s.den[b.key] || 0)])),
    total: value(sum(s.num), sum(s.den)),
    _n: sum(s.num),
  }));
  rows.sort((a, b) => (pct ? b._n - a._n : b.total - a.total) || a.label.localeCompare(b.label));
  const numAll = {}; const denAll = {};
  const addBuckets = (target, src) => { for (const [k, v] of Object.entries(src)) target[k] = (target[k] || 0) + v; }; // already per bucket
  for (const s of series.values()) { addBuckets(numAll, s.num); if (by === 'office' || by === 'category') addBuckets(denAll, s.den); }
  // The denominator is the same collections for every row/account series of an office; take it once per office.
  if (by === 'row' || by === 'account') {
    for (const o of offices) { const coll = statementOf(o).rows.find((r) => r.key === percentOf); if (coll) addInto(denAll, coll.months); }
  }
  const totals = {
    periods: Object.fromEntries(buckets.map((b) => [b.key, value(numAll[b.key] || 0, denAll[b.key] || 0)])),
    total: value(sum(numAll), sum(denAll)),
  };
  const hasData = rows.some((r) => r._n !== 0) || sum(denAll) !== 0;
  return { rows: rows.map(({ _n, ...r }) => r), totals, hasData };
}
