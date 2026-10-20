// Metric definitions from app.config.json: base metrics (income / expenses / netIncome via
// groups.incomeGroups / expenseGroups), linear formulas over P&L groups, and ratios of other metrics.
import { appConfig } from './config.js';

const round2 = (n) => Math.round(n * 100) / 100;
const BASE = ['income', 'expenses', 'netIncome'];

export function metricDefs(cfg = appConfig) {
  const defs = {};
  const groupSum = (groups) => Object.fromEntries(groups.map((g) => [g, 1]));
  for (const [key, m] of Object.entries(cfg.metrics)) {
    if (key.startsWith('$')) continue;
    let formula = m.formula || null;
    if (!formula && key === 'income') formula = groupSum(cfg.groups.incomeGroups);
    if (!formula && key === 'expenses') formula = groupSum(cfg.groups.expenseGroups);
    if (!formula && key === 'netIncome') {
      formula = { ...groupSum(cfg.groups.incomeGroups), ...Object.fromEntries(cfg.groups.expenseGroups.map((g) => [g, -1])) };
    }
    defs[key] = { key, ...m, formula, kind: m.ratio ? 'ratio' : 'sum', format: m.ratio ? 'percent' : 'money' };
  }
  return defs;
}

/** Linear value of a sum metric for a { grp: amount } map. */
export function linear(def, groups) {
  let v = 0;
  for (const [g, coef] of Object.entries(def.formula || {})) v += coef * (groups[g] || 0);
  return v;
}

/** Every metric for one { grp: amount } map. Ratios are null when the denominator is 0. */
export function deriveAll(groups, cfg = appConfig) {
  const defs = metricDefs(cfg);
  const out = {};
  for (const d of Object.values(defs)) if (d.kind === 'sum') out[d.key] = round2(linear(d, groups));
  for (const d of Object.values(defs)) {
    if (d.kind !== 'ratio') continue;
    const den = out[d.ratio.denominator];
    out[d.key] = den ? Math.round((out[d.ratio.numerator] / den) * 10000) / 10000 : null;
  }
  for (const k of BASE) if (!(k in out)) out[k] = 0;
  return out;
}

export function validateMetrics(cfg) {
  const groups = new Set(cfg.groups.order);
  const keys = Object.keys(cfg.metrics).filter((k) => !k.startsWith('$'));
  for (const k of keys) {
    const m = cfg.metrics[k];
    if (m.formula && m.ratio) throw new Error(`app.config.json: metrics.${k} has both formula and ratio`);
    if (m.formula) for (const g of Object.keys(m.formula)) if (!groups.has(g)) throw new Error(`app.config.json: metrics.${k}.formula uses unknown group "${g}"`);
    if (m.ratio) {
      for (const side of ['numerator', 'denominator']) {
        const ref = m.ratio[side];
        if (!keys.includes(ref)) throw new Error(`app.config.json: metrics.${k}.ratio.${side} "${ref}" is not a metric`);
        if (cfg.metrics[ref].ratio) throw new Error(`app.config.json: metrics.${k}.ratio.${side} must not itself be a ratio`);
      }
    }
    if (!m.formula && !m.ratio && !BASE.includes(k)) throw new Error(`app.config.json: metrics.${k} needs a formula or a ratio`);
  }
}
