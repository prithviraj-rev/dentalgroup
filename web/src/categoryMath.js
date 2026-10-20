// Pure helpers for the Category compare tab: grouping offices into compared entities, category columns,
// measures (% of revenue, amount, monthly average), medians and shading. No React, so it can be tested.

const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const addAll = (into, from) => { for (const [k, v] of Object.entries(from || {})) add(into, k, v); };

/** Linear formula ({ grp: coef }) of a sum metric, mirroring server/metrics.js. */
export function metricFormula(appConfig, key) {
  const m = appConfig.metrics?.[key] || {};
  if (m.formula) return m.formula;
  const g = appConfig.groups;
  if (key === 'income') return Object.fromEntries(g.incomeGroups.map((x) => [x, 1]));
  if (key === 'expenses') return Object.fromEntries(g.expenseGroups.map((x) => [x, 1]));
  if (key === 'netIncome') return { ...Object.fromEntries(g.incomeGroups.map((x) => [x, 1])), ...Object.fromEntries(g.expenseGroups.map((x) => [x, -1])) };
  return { Income: 1 };
}
export const applyFormula = (formula, groups) => Object.entries(formula).reduce((s, [g, c]) => s + c * (groups?.[g] || 0), 0);

/** Headline figures for one { grp: amount } map. */
export function headline(appConfig, groups, denominator = 'revenue') {
  const revenue = applyFormula(metricFormula(appConfig, denominator), groups);
  const income = applyFormula(metricFormula(appConfig, 'income'), groups);
  const expenses = applyFormula(metricFormula(appConfig, 'expenses'), groups);
  const netIncome = income - expenses;
  return { revenue, income, expenses, netIncome, netMargin: income ? netIncome / income : null };
}

/**
 * Compared entities. compareBy 'office': one per office; otherwise one per office category of that
 * dimension (members summed). dimOrder: { dimId: [category labels in display order] } for stable colors.
 */
export function buildEntities(data, compareBy, { officeColor = () => 0, dimOrder = {} } = {}) {
  const mk = (key, label) => ({ key, label, realmIds: [], months: 0, groups: {}, cats: {}, periods: {}, kind: 'entity' });
  const merge = (e, o) => {
    e.realmIds.push(o.realmId);
    e.months = Math.max(e.months, o.months);
    addAll(e.groups, o.groups);
    addAll(e.cats, o.cats);
    for (const [k, p] of Object.entries(o.periods)) {
      e.periods[k] ||= { groups: {}, cats: {} };
      addAll(e.periods[k].groups, p.groups);
      addAll(e.periods[k].cats, p.cats);
    }
  };
  if (compareBy === 'office') {
    return data.offices.map((o) => {
      const e = mk(o.realmId, o.officeName);
      merge(e, o);
      e.colorSlot = officeColor(o.realmId);
      e.dims = o.dims;
      return e;
    });
  }
  const map = new Map();
  for (const o of data.offices) {
    const label = o.dims?.[compareBy] ?? 'Other';
    if (!map.has(label)) map.set(label, mk(`${compareBy}:${label}`, label));
    merge(map.get(label), o);
  }
  const order = dimOrder[compareBy] || [];
  return [...map.values()].map((e) => {
    const i = order.indexOf(e.label);
    return { ...e, colorSlot: i >= 0 ? i : order.length + [...map.keys()].indexOf(e.label) };
  });
}

/** Sum several entities into one (subtotal / portfolio). */
export function combine(entities, key, label, kind = 'subtotal') {
  const out = { key, label, kind, realmIds: [], months: 0, groups: {}, cats: {}, periods: {} };
  for (const e of entities) {
    out.realmIds.push(...e.realmIds);
    out.months = Math.max(out.months, e.months);
    addAll(out.groups, e.groups);
    addAll(out.cats, e.cats);
    for (const [k, p] of Object.entries(e.periods)) {
      out.periods[k] ||= { groups: {}, cats: {} };
      addAll(out.periods[k].groups, p.groups);
      addAll(out.periods[k].cats, p.cats);
    }
  }
  return out;
}

/**
 * Columns for the view and level: [{ label, members: [category labels], target, color, upIsGood }].
 * Columns that are zero for every office are dropped.
 */
export function columnsFor(cfg, view, level, offices) {
  const used = new Set();
  for (const o of offices) for (const [k, v] of Object.entries(o.cats)) if (Math.abs(v) >= 0.5) used.add(k);
  // Category amounts are keyed "e:<label>" (expense) or "r:<label>" (revenue).
  const prefix = view === 'revenue' ? 'r:' : 'e:';
  const cats = (view === 'revenue' ? cfg.revenue : cfg.expense).filter((c) => used.has(prefix + c.label));
  if (view === 'revenue' || level === 'category') {
    return cats.map((c) => ({ label: c.label, members: [prefix + c.label], names: [c.label], target: c.target, color: c.color, group: c.group, upIsGood: view === 'revenue' }));
  }
  return cfg.groups
    .map((g) => {
      const inGroup = cats.filter((c) => c.group === g.label);
      return { label: g.label, members: inGroup.map((c) => prefix + c.label), names: inGroup.map((c) => c.label), target: g.target, color: g.color, upIsGood: false };
    })
    .filter((g) => g.members.length);
}

export const amountOf = (cats, col) => col.members.reduce((s, m) => s + (cats?.[m] || 0), 0);

/** Value of a column for an entity (or one period of it) in a measure. null = not meaningful. */
export function measureValue(measure, amount, denom, months) {
  if (measure === 'pctRevenue') return denom > 0 ? amount / denom : null;
  if (measure === 'monthlyAvg') return months > 0 ? amount / months : null;
  return amount;
}

export function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Shading of a % of revenue cell against a reference (median or target).
 * Returns { tone: 'good' | 'bad' | null, strength: 0..1 }.
 */
export function shadeAgainst(value, ref, { upIsGood = false, clamp = 0.5, target = null } = {}) {
  if (value == null) return { tone: null, strength: 0 };
  if (target) {
    // Within target is good, outside is bad; strength grows with distance from the limit.
    if (target.max != null && value > target.max) return { tone: 'bad', strength: Math.min(1, (value - target.max) / (Math.abs(target.max) * clamp || 1)) };
    if (target.min != null && value < target.min) return { tone: 'bad', strength: Math.min(1, (target.min - value) / (Math.abs(target.min) * clamp || 1)) };
    const limit = target.max ?? target.min;
    return { tone: 'good', strength: Math.min(1, Math.abs(limit - value) / (Math.abs(limit) * clamp || 1)) * 0.6 };
  }
  if (ref == null || ref === 0) return { tone: null, strength: 0 };
  const rel = (value - ref) / Math.abs(ref);
  if (Math.abs(rel) < 0.02) return { tone: null, strength: 0 };
  const better = upIsGood ? rel > 0 : rel < 0;
  return { tone: better ? 'good' : 'bad', strength: Math.min(1, Math.abs(rel) / clamp) };
}

/** CSV text from a header row and rows of cells. */
export function toCsv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
