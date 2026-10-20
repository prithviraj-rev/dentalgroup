// Executive view: one call returning everything the visual summary needs for a date range and office
// selection, plus the same range one year earlier.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from './config.js';
import { deriveAll, metricDefs } from './metrics.js';
import { addMonths, monthsBetween, bucketLabel } from './periods.js';

const SECTIONS = ['kpis', 'trend', 'leaderboard', 'scatter', 'heatmap', 'revenueMix', 'costStructure', 'bridge', 'movers'];
const round2 = (n) => Math.round(n * 100) / 100;

function compileRules(block, name, file) {
  if (!block || !Array.isArray(block.rules)) throw new Error(`${file}: ${name}.rules must be a list`);
  return {
    other: block.other || 'Other',
    rules: block.rules.map((r, i) => {
      if (!r.bucket) throw new Error(`${file}: ${name}.rules[${i}] needs a bucket`);
      let re = null;
      if (r.accounts) {
        try { re = new RegExp(r.accounts, 'i'); } catch (e) { throw new Error(`${file}: ${name}.rules[${i}].accounts is not a valid pattern: ${e.message}`); }
      }
      return { bucket: r.bucket, re, subTypes: new Set(r.subTypes || []) };
    }),
    order: [...new Set([...block.rules.map((r) => r.bucket), block.other || 'Other'])],
  };
}

export function loadExecutiveConfig(file = path.resolve(ROOT, appConfig.executive?.file || 'config/executive.json')) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }
  const defs = metricDefs();
  for (const s of raw.sections || []) if (!SECTIONS.includes(s)) throw new Error(`${name}: unknown section "${s}" (use ${SECTIONS.join(' | ')})`);
  for (const m of [...(raw.kpis?.metrics || []), raw.heatmap?.metric, raw.leaderboard?.sparkMetric].filter(Boolean)) {
    if (!defs[m]) throw new Error(`${name}: unknown metric "${m}"`);
  }
  const cost = compileRules(raw.costBuckets, 'costBuckets', name);
  const mix = compileRules(raw.revenueMix, 'revenueMix', name);
  for (const b of raw.kpis?.bucketShares || []) if (!cost.order.includes(b)) throw new Error(`${name}: kpis.bucketShares "${b}" is not a cost bucket`);
  return {
    sections: raw.sections || SECTIONS,
    kpis: { metrics: raw.kpis?.metrics || ['revenue', 'netIncome'], bucketShares: raw.kpis?.bucketShares || [] },
    trend: { rollingMonths: raw.trend?.rollingMonths ?? 3 },
    leaderboard: { defaultSort: raw.leaderboard?.defaultSort || 'revenue', sparkMetric: raw.leaderboard?.sparkMetric || 'netIncome' },
    scatter: { labelTop: raw.scatter?.labelTop ?? 6 },
    heatmap: { metric: raw.heatmap?.metric || 'netMargin', clampPercent: raw.heatmap?.clampPercent ?? 30 },
    movers: { count: raw.movers?.count ?? 8 },
    cost,
    mix,
  };
}

const classify = (ruleset, accountName, subType) => {
  for (const r of ruleset.rules) {
    if ((r.re && r.re.test(accountName)) || (subType && r.subTypes.has(subType))) return r.bucket;
  }
  return ruleset.other;
};

/** Public part of the config for the browser. */
export const publicExecutiveConfig = (x) => ({
  sections: x.sections, kpis: x.kpis, trend: x.trend, leaderboard: x.leaderboard, scatter: x.scatter, heatmap: x.heatmap, movers: x.movers,
  costBuckets: x.cost.order, revenueMix: x.mix.order,
});

/**
 * @param f parsed filters from api.js (from, to, offices, where, params)
 */
export function executiveData(db, x, f) {
  const incomeGroups = new Set(['Income']);
  const expenseGroups = new Set(appConfig.groups.expenseGroups);
  const months = monthsBetween(f.from, f.to);
  const priorFrom = addMonths(f.from, -12);
  const priorTo = addMonths(f.to, -12);

  const q = (from, to) => db.prepare(`
    SELECT p.office_realm_id AS realmId, p.office_name AS officeName, substr(p.period_start, 1, 7) AS month, p.grp,
           p.account_name AS account, a.account_sub_type AS subType, SUM(p.amount) AS amount
    FROM pl_lines p LEFT JOIN accounts a ON a.office_realm_id = p.office_realm_id AND a.account_id = p.account_id
    ${f.where.replace(/\bperiod_start\b/g, 'p.period_start').replace(/\boffice_realm_id\b/g, 'p.office_realm_id')}
    GROUP BY p.office_realm_id, p.office_name, month, p.grp, p.account_name, a.account_sub_type`).all({ ...f.params, from, to });

  const cur = q(f.from, f.to);
  const prior = q(priorFrom, priorTo);

  const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };

  // Portfolio monthly groups, current and prior (prior aligned onto current month keys).
  const monthGroups = Object.fromEntries(months.map((m) => [m, {}]));
  const priorMonthGroups = Object.fromEntries(months.map((m) => [m, {}]));
  const totalGroups = {};
  const priorTotalGroups = {};
  const offices = new Map();
  const office = (r) => {
    if (!offices.has(r.realmId)) {
      offices.set(r.realmId, {
        realmId: r.realmId, officeName: r.officeName, groups: {}, priorGroups: {},
        months: Object.fromEntries(months.map((m) => [m, {}])), cost: {}, mix: {},
      });
    }
    return offices.get(r.realmId);
  };
  const portfolioCost = {};
  const portfolioMix = {};
  const accountsNow = {};
  const accountsPrior = {};

  for (const r of cur) {
    if (!monthGroups[r.month]) continue;
    add(monthGroups[r.month], r.grp, r.amount);
    add(totalGroups, r.grp, r.amount);
    const o = office(r);
    add(o.groups, r.grp, r.amount);
    add(o.months[r.month], r.grp, r.amount);
    if (expenseGroups.has(r.grp)) {
      const b = classify(x.cost, r.account, r.subType);
      add(o.cost, b, r.amount);
      add(portfolioCost, b, r.amount);
    } else if (incomeGroups.has(r.grp)) {
      const b = classify(x.mix, r.account, r.subType);
      add(o.mix, b, r.amount);
      add(portfolioMix, b, r.amount);
    }
    add(accountsNow, `${r.grp}|${r.account}`, r.amount);
  }
  // Like-for-like: last year's month only counts if this year has data for the same month (for the group,
  // and per office), so a not-yet-synced month or an office that joined mid-year does not skew YoY.
  const curMonths = new Set(cur.filter((r) => monthGroups[r.month]).map((r) => r.month));
  const officeMonths = new Map();
  for (const r of cur) {
    if (!officeMonths.has(r.realmId)) officeMonths.set(r.realmId, new Set());
    officeMonths.get(r.realmId).add(r.month);
  }
  for (const r of prior) {
    const m = addMonths(r.month, 12);
    if (!curMonths.has(m)) continue;
    add(priorMonthGroups[m], r.grp, r.amount);
    add(priorTotalGroups, r.grp, r.amount);
    add(accountsPrior, `${r.grp}|${r.account}`, r.amount);
    if (officeMonths.get(r.realmId)?.has(m) && offices.has(r.realmId)) {
      const o = offices.get(r.realmId);
      add(o.priorGroups, r.grp, r.amount);
      (o.priorMonths ||= new Set()).add(m);
    }
  }

  const priorMonthsWithData = Object.values(priorMonthGroups).filter((g) => Object.keys(g).length).length;
  // Months present in both years: year-over-year figures use only these, on both sides.
  const overlap = new Set(months.filter((m) => Object.keys(priorMonthGroups[m]).length && Object.keys(monthGroups[m]).length));
  const sumMonths = (byMonth, set) => {
    const g = {};
    for (const m of set) for (const [k, v] of Object.entries(byMonth[m] || {})) add(g, k, v);
    return g;
  };
  // Account totals for the overlapping months only (the "now" side of What changed).
  const accountsNowOverlap = {};
  for (const r of cur) if (overlap.has(r.month)) add(accountsNowOverlap, `${r.grp}|${r.account}`, r.amount);
  const hasPrior = Object.keys(priorTotalGroups).length > 0;
  const series = months.map((m) => ({
    key: m, label: bucketLabel(m, 'month'),
    ...deriveAll(monthGroups[m]),
    prior: Object.keys(priorMonthGroups[m]).length ? deriveAll(priorMonthGroups[m]) : null,
    hasData: Object.keys(monthGroups[m]).length > 0,
  }));

  const roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));
  const officeList = [...offices.values()]
    .filter((o) => Object.keys(o.groups).length > 0)
    .map((o) => ({
      realmId: o.realmId, officeName: o.officeName,
      totals: deriveAll(o.groups),
      prior: Object.keys(o.priorGroups).length ? deriveAll(o.priorGroups) : null,
      comparable: o.priorMonths ? deriveAll(sumMonths(o.months, o.priorMonths)) : null,
      monthly: months.map((m) => (Object.keys(o.months[m]).length ? { key: m, ...deriveAll(o.months[m]) } : { key: m, empty: true })),
      cost: roundObj(o.cost),
      mix: roundObj(o.mix),
    }))
    .sort((a, b) => b.totals.revenue - a.totals.revenue);

  // Accounts whose change moved net income the most (income up = good, expense up = bad).
  let movers = [];
  if (hasPrior) {
    const keys = new Set([...Object.keys(accountsNowOverlap), ...Object.keys(accountsPrior)]);
    movers = [...keys].map((k) => {
      const [grp, ...rest] = k.split('|');
      const now = accountsNowOverlap[k] || 0;
      const before = accountsPrior[k] || 0;
      const sign = appConfig.groups.incomeGroups.includes(grp) ? 1 : appConfig.groups.expenseGroups.includes(grp) ? -1 : 0;
      return { account: rest.join('|'), grp, current: round2(now), prior: round2(before), change: round2(now - before), impact: round2(sign * (now - before)) };
    }).filter((m) => m.impact !== 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, x.movers.count * 2);
  }

  const otherIncome = (totalGroups.OtherIncome || 0);
  return {
    from: f.from, to: f.to,
    prior: { from: priorFrom, to: priorTo, hasData: hasPrior, months: priorMonthsWithData, currentMonths: curMonths.size, overlapMonths: overlap.size },
    series,
    totals: deriveAll(totalGroups),
    priorTotals: hasPrior ? deriveAll(priorTotalGroups) : null,
    // Current figures over the same months as priorTotals: compare against these, not against totals.
    comparableTotals: hasPrior ? deriveAll(sumMonths(monthGroups, overlap)) : null,
    offices: officeList,
    cost: { order: x.cost.order, portfolio: roundObj(portfolioCost) },
    mix: { order: x.mix.order, portfolio: roundObj(portfolioMix) },
    otherIncome: round2(otherIncome),
    movers,
    hasData: cur.length > 0,
  };
}
