// Group overview: segment P&Ls, intercompany eliminations, EBITDA, trailing twelve months, full-year
// forecast, office scorecard and alerts. Pure functions over P&L line rows so they can be tested.
import { appConfig } from '../config.js';
import { deriveAll } from '../metrics.js';
import { addMonths, monthsBetween } from '../periods.js';
import { classifyLine } from '../categoryView.js';

const round2 = (n) => Math.round(n * 100) / 100;
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const INCOME = new Set(appConfig.groups.incomeGroups);
const EXPENSE = new Set(appConfig.groups.expenseGroups);

/** Headline figures from { grp: amount } plus EBITDA add-backs. */
export function figures(groups, addBack = 0) {
  const d = deriveAll(groups);
  const ebitda = d.netIncome + addBack;
  return { revenue: d.revenue, income: d.income, expenses: d.expenses, netIncome: d.netIncome, netMargin: d.netMargin, ebitda: round2(ebitda), ebitdaMargin: d.income ? ebitda / d.income : null };
}

const matchAcct = (re, r) => Boolean(re && (re.test(r.account) || (r.fullName && re.test(r.fullName))));
const inSegments = (segs, seg) => !segs.length || segs.includes(seg);

/**
 * Tag each P&L line: ebitda add-back, intercompany rule side. rows: { realmId, month, grp, account, fullName, amount }.
 * segmentOf: realmId -> segment label.
 */
export function tagLines(rows, g, segmentOf) {
  for (const r of rows) {
    r.addBack = EXPENSE.has(r.grp) && matchAcct(g.ebitdaAddBack, r);
    r.ic = null;
    for (const rule of g.rules) {
      const seg = segmentOf(r.realmId);
      if (INCOME.has(r.grp) && inSegments(rule.income.segments, seg) && matchAcct(rule.income.re, r)) { r.ic = { rule: rule.label, side: 'income' }; break; }
      if (EXPENSE.has(r.grp) && inSegments(rule.expense.segments, seg) && matchAcct(rule.expense.re, r)) { r.ic = { rule: rule.label, side: 'expense' }; break; }
    }
  }
  return matchIntercompany(rows);
}

/**
 * Only the matched part of each rule is eliminated, month by month: min(income side, expense side).
 * Both sides lose the same amount, so consolidated net income never moves; whatever is left on the larger
 * side (e.g. rent paid to outside landlords) stays in the figures and shows as unmatched.
 * Sets r.icAmount = the part of the line that is eliminated.
 */
export function matchIntercompany(rows) {
  const tot = {};
  for (const r of rows) {
    if (!r.ic) continue;
    const k = `${r.ic.rule}|${r.month}`;
    tot[k] ||= { income: 0, expense: 0 };
    tot[k][r.ic.side] += r.amount;
  }
  for (const r of rows) {
    r.icAmount = 0;
    if (!r.ic) continue;
    const t = tot[`${r.ic.rule}|${r.month}`];
    const matched = t.income > 0 && t.expense > 0 ? Math.min(t.income, t.expense) : 0;
    const side = t[r.ic.side];
    r.icAmount = side ? r.amount * (matched / side) : 0;
  }
  return rows;
}

/** Sum rows into { groups, addBack, icGroups (intercompany part of groups), icAddBack }. */
function sumRows(rows) {
  const out = { groups: {}, addBack: 0, icGroups: {}, icAddBack: 0 };
  for (const r of rows) {
    add(out.groups, r.grp, r.amount);
    if (r.addBack) out.addBack += r.amount;
    if (r.icAmount) { add(out.icGroups, r.grp, r.icAmount); if (r.addBack) out.icAddBack += r.icAmount; }
  }
  return out;
}
const consolidatedOf = (s) => {
  const groups = { ...s.groups };
  for (const [k, v] of Object.entries(s.icGroups)) groups[k] = (groups[k] || 0) - v;
  return figures(groups, s.addBack - s.icAddBack);
};

/** Full-year outlook for the fiscal year that contains `to`. */
export function forecastYear(byMonth, to, fc) {
  const startMonth = String(fc.fiscalYearStartMonth).padStart(2, '0');
  const fyStart = to.slice(5, 7) >= startMonth ? `${to.slice(0, 4)}-${startMonth}` : `${Number(to.slice(0, 4)) - 1}-${startMonth}`;
  const fyMonths = monthsBetween(fyStart, addMonths(fyStart, 11));
  const has = (m) => byMonth[m] && Object.keys(byMonth[m].groups).length > 0;
  const actualMonths = fyMonths.filter((m) => m <= to && has(m));
  const remaining = fyMonths.filter((m) => m > to);
  const keys = ['revenue', 'expenses', 'netIncome', 'ebitda'];
  const fig = (m) => (has(m) ? consolidatedOf(byMonth[m]) : null);
  const ytd = Object.fromEntries(keys.map((k) => [k, actualMonths.reduce((s, m) => s + fig(m)[k], 0)]));
  // Last year's same months (like-for-like) and its remaining months.
  const lyYtdMonths = actualMonths.map((m) => addMonths(m, -12)).filter(has);
  const lyRemaining = remaining.map((m) => addMonths(m, -12));
  let method = fc.method;
  if (method === 'seasonal' && (lyYtdMonths.length < actualMonths.length || !lyRemaining.every(has))) method = 'runRate';
  const recent = actualMonths.slice(-fc.runRateMonths);
  const monthly = [];
  for (const m of actualMonths) monthly.push({ month: m, kind: 'actual', ...Object.fromEntries(keys.map((k) => [k, round2(fig(m)[k])])) });
  for (const m of remaining) {
    const est = {};
    for (const k of keys) {
      if (method === 'seasonal') {
        const lyYtd = lyYtdMonths.reduce((s, x) => s + fig(x)[k], 0);
        const ratio = lyYtd ? ytd[k] / lyYtd : 1;
        est[k] = fig(addMonths(m, -12))[k] * (Number.isFinite(ratio) ? ratio : 1);
      } else {
        est[k] = recent.length ? recent.reduce((s, x) => s + fig(x)[k], 0) / recent.length : 0;
      }
    }
    monthly.push({ month: m, kind: 'forecast', ...Object.fromEntries(keys.map((k) => [k, round2(est[k])])) });
  }
  const fullYear = Object.fromEntries(keys.map((k) => [k, round2(monthly.reduce((s, x) => s + x[k], 0))]));
  const lyFull = fyMonths.map((m) => addMonths(m, -12)).every(has)
    ? Object.fromEntries(keys.map((k) => [k, round2(fyMonths.reduce((s, m) => s + fig(addMonths(m, -12))[k], 0))])) : null;
  return {
    fiscalYear: `${fyStart} to ${fyMonths[11]}`, method: actualMonths.length ? method : null,
    actualMonths: actualMonths.length, remainingMonths: remaining.length,
    ytd: Object.fromEntries(keys.map((k) => [k, round2(ytd[k])])), fullYear, lastYear: lyFull, monthly,
  };
}

/**
 * Everything for the Group overview tab.
 * rows: P&L lines from (from - 12 months, or the prior fiscal year start) to `to`, tagged by tagLines.
 * offices: [{ realmId, officeName }]; segmentOf: realmId -> label; cv: category-view config (targets).
 */
export function groupOverview(rows, { from, to, offices, segmentOf, g, cv }) {
  const names = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
  const inRange = (m) => m >= from && m <= to;
  const priorFrom = addMonths(from, -12);
  const priorTo = addMonths(to, -12);
  const cur = rows.filter((r) => inRange(r.month));
  const prior = rows.filter((r) => r.month >= priorFrom && r.month <= priorTo);

  // Year-over-year compares only months that have data in both years (like the Executive tab).
  const monthsWithData = new Set(rows.map((r) => r.month));
  const overlap = new Set(monthsBetween(from, to).filter((m) => monthsWithData.has(m) && monthsWithData.has(addMonths(m, -12))));
  const curO = cur.filter((r) => overlap.has(r.month));
  const priorO = prior.filter((r) => overlap.has(addMonths(r.month, 12)));

  // Segments: reported, intercompany, consolidated.
  const segLabels = [...new Set(cur.map((r) => segmentOf(r.realmId)))].sort();
  const segments = segLabels.map((label) => {
    const s = sumRows(cur.filter((r) => segmentOf(r.realmId) === label));
    const p = sumRows(priorO.filter((r) => segmentOf(r.realmId) === label));
    const c = sumRows(curO.filter((r) => segmentOf(r.realmId) === label));
    return {
      label, offices: new Set(cur.filter((r) => segmentOf(r.realmId) === label).map((r) => r.realmId)).size,
      reported: figures(s.groups, s.addBack), consolidated: consolidatedOf(s),
      prior: Object.keys(p.groups).length ? figures(p.groups, p.addBack) : null,
      comparable: Object.keys(p.groups).length ? figures(c.groups, c.addBack) : null,
      intercompany: { income: round2([...appConfig.groups.incomeGroups].reduce((t, k) => t + (s.icGroups[k] || 0), 0)), expense: round2([...appConfig.groups.expenseGroups].reduce((t, k) => t + (s.icGroups[k] || 0), 0)) },
    };
  });
  const all = sumRows(cur);
  const allPrior = sumRows(priorO);
  const allComparable = sumRows(curO);

  // Eliminations per rule, with the accounts behind each side.
  const eliminations = g.rules.map((rule) => {
    const lines = cur.filter((r) => r.ic?.rule === rule.label);
    const side = (s) => {
      const acc = {};
      for (const r of lines.filter((x) => x.ic.side === s)) add(acc, `${r.realmId}\u0000${r.account}`, r.amount);
      const list = Object.entries(acc).map(([k, amount]) => { const [realmId, account] = k.split('\u0000'); return { realmId, officeName: names[realmId] || realmId, segment: segmentOf(realmId), account, amount: round2(amount) }; })
        .filter((x) => Math.abs(x.amount) >= 0.5).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      return { total: round2(list.reduce((t, x) => t + x.amount, 0)), accounts: list };
    };
    const income = side('income');
    const expense = side('expense');
    const eliminated = round2(lines.filter((x) => x.ic.side === 'income').reduce((t, x) => t + x.icAmount, 0));
    return { label: rule.label, income, expense, eliminated, difference: round2(income.total - expense.total) };
  });

  // Monthly consolidated series for the range, with last year aligned.
  const byMonth = {};
  for (const r of rows) {
    byMonth[r.month] ||= { groups: {}, addBack: 0, icGroups: {}, icAddBack: 0 };
    const b = byMonth[r.month];
    add(b.groups, r.grp, r.amount);
    if (r.addBack) b.addBack += r.amount;
    if (r.icAmount) { add(b.icGroups, r.grp, r.icAmount); if (r.addBack) b.icAddBack += r.icAmount; }
  }
  const hasM = (m) => byMonth[m] && Object.keys(byMonth[m].groups).length > 0;
  const monthly = monthsBetween(from, to).map((m) => ({
    month: m,
    reported: hasM(m) ? figures(byMonth[m].groups, byMonth[m].addBack) : null,
    consolidated: hasM(m) ? consolidatedOf(byMonth[m]) : null,
    lastYear: hasM(addMonths(m, -12)) ? consolidatedOf(byMonth[addMonths(m, -12)]) : null,
  }));
  const lastActual = [...monthsBetween(from, to)].reverse().find(hasM) || to;
  const ttmMonths = monthsBetween(addMonths(lastActual, -11), lastActual).filter(hasM);
  const ttmSum = { groups: {}, addBack: 0, icGroups: {}, icAddBack: 0 };
  for (const m of ttmMonths) {
    for (const [k, v] of Object.entries(byMonth[m].groups)) add(ttmSum.groups, k, v);
    for (const [k, v] of Object.entries(byMonth[m].icGroups)) add(ttmSum.icGroups, k, v);
    ttmSum.addBack += byMonth[m].addBack; ttmSum.icAddBack += byMonth[m].icAddBack;
  }

  // Office scorecard (reported figures: an office's own P&L includes what it pays the group).
  const targets = Object.fromEntries(cv.expense.rules.filter((r) => r.target).map((r) => [r.label, r.target]));
  const scorecard = offices.map((o) => {
    const mine = cur.filter((r) => r.realmId === o.realmId);
    if (!mine.length) return null;
    const s = sumRows(mine);
    const f = figures(s.groups, s.addBack);
    // Like-for-like growth: only months present in both years for this office.
    const months = new Set(mine.map((r) => r.month));
    const lyMonths = new Set(prior.filter((r) => r.realmId === o.realmId && months.has(addMonths(r.month, 12))).map((r) => r.month));
    const curComparable = sumRows(mine.filter((r) => lyMonths.has(addMonths(r.month, -12))));
    const priorComparable = sumRows(prior.filter((r) => r.realmId === o.realmId && lyMonths.has(r.month)));
    const pr = deriveAll(priorComparable.groups).revenue;
    const cr = deriveAll(curComparable.groups).revenue;
    // Cost targets met (share of revenue over the range).
    const cats = {};
    for (const r of mine) {
      if (!EXPENSE.has(r.grp)) continue;
      const c = classifyLine(cv, r.grp, r.account, r.subType, r.fullName);
      if (c) add(cats, c.label, r.amount);
    }
    let met = 0; let total = 0;
    if (f.revenue > 0) {
      for (const [label, t] of Object.entries(targets)) {
        if (!cats[label]) continue;
        total++;
        const share = cats[label] / f.revenue;
        if ((t.max == null || share <= t.max) && (t.min == null || share >= t.min)) met++;
      }
    }
    const spark = monthsBetween(from, to).map((m) => {
      const x = mine.filter((r) => r.month === m);
      return x.length ? round2(deriveAll(sumRows(x).groups).netIncome) : null;
    });
    return {
      realmId: o.realmId, officeName: o.officeName, segment: segmentOf(o.realmId), ...f,
      revenueGrowth: pr > 0 ? (cr - pr) / pr : null, targetsMet: total ? met : null, targetsTotal: total, spark,
    };
  }).filter(Boolean);

  return {
    from, to, segmentDimension: g.segmentDimension,
    totals: {
      reported: figures(all.groups, all.addBack), consolidated: consolidatedOf(all),
      prior: Object.keys(allPrior.groups).length ? consolidatedOf(allPrior) : null,
      comparable: Object.keys(allPrior.groups).length ? consolidatedOf(allComparable) : null,
      overlapMonths: overlap.size, months: monthsBetween(from, to).filter((m) => monthsWithData.has(m)).length,
    },
    segments, eliminations, monthly,
    ttm: { from: ttmMonths[0] || null, to: ttmMonths.at(-1) || null, months: ttmMonths.length, ...consolidatedOf(ttmSum) },
    forecast: forecastYear(byMonth, to, g.forecast),
    scorecard,
    alerts: alertsFor(rows, { from, to, offices, g, cv, names }),
    hasData: cur.length > 0,
  };
}

/** Alerts: cost spikes vs trailing average, revenue drops vs last year, loss streaks, categories over target. */
export function alertsFor(rows, { from, to, offices, g, cv, names }) {
  const a = g.alerts;
  const out = [];
  const months = monthsBetween(from, to);
  const targets = Object.fromEntries(cv.expense.rules.filter((r) => r.target).map((r) => [r.label, r.target]));
  for (const o of offices) {
    const mine = rows.filter((r) => r.realmId === o.realmId);
    if (!mine.length) continue;
    const per = {};
    for (const r of mine) {
      per[r.month] ||= { groups: {}, cats: {} };
      add(per[r.month].groups, r.grp, r.amount);
      if (EXPENSE.has(r.grp)) {
        const c = classifyLine(cv, r.grp, r.account, r.subType, r.fullName);
        if (c) add(per[r.month].cats, c.label, r.amount);
      }
    }
    const withData = months.filter((m) => per[m]);
    const last = withData.at(-1);
    if (!last) continue;
    const name = names[o.realmId] || o.officeName;
    const rev = (m) => (per[m] ? deriveAll(per[m].groups).revenue : 0);

    // Cost category spike in the latest month vs its trailing average share.
    const trail = withData.slice(-1 - a.trailingMonths, -1);
    if (trail.length && rev(last) > 0) {
      const cats = new Set(Object.keys(per[last].cats));
      for (const c of cats) {
        const share = per[last].cats[c] / rev(last);
        const shares = trail.filter((m) => rev(m) > 0).map((m) => (per[m].cats[c] || 0) / rev(m));
        if (!shares.length) continue;
        const avg = shares.reduce((s, x) => s + x, 0) / shares.length;
        if (share >= a.minShare && share - avg >= a.spikePts) {
          out.push({ severity: share - avg >= a.spikePts * 2 ? 'high' : 'medium', kind: 'spike', realmId: o.realmId, officeName: name, month: last, category: c,
            message: `${c} was ${(share * 100).toFixed(1)}% of revenue in ${last}, up ${((share - avg) * 100).toFixed(1)} pts on the ${trail.length}-month average (${(avg * 100).toFixed(1)}%).`, impact: round2(-(share - avg) * rev(last)) });
        }
      }
    }
    // Revenue drop vs same month last year.
    const ly = rev(addMonths(last, -12));
    if (ly > 0 && (rev(last) - ly) / ly <= -a.revenueDrop) {
      const d = (rev(last) - ly) / ly;
      out.push({ severity: d <= -2 * a.revenueDrop ? 'high' : 'medium', kind: 'revenueDrop', realmId: o.realmId, officeName: name, month: last,
        message: `Revenue in ${last} was ${(d * 100).toFixed(0)}% below ${addMonths(last, -12)}.`, impact: round2(rev(last) - ly) });
    }
    // Loss streak.
    let streak = 0;
    for (const m of [...withData].reverse()) { if (deriveAll(per[m].groups).netIncome < 0) streak++; else break; }
    if (streak >= a.lossStreakMonths) {
      out.push({ severity: streak >= a.lossStreakMonths * 2 ? 'high' : 'medium', kind: 'lossStreak', realmId: o.realmId, officeName: name, month: last,
        message: `Net loss in each of the last ${streak} months.`, impact: round2(withData.slice(-streak).reduce((s, m) => s + deriveAll(per[m].groups).netIncome, 0)) });
    }
    // Over target across the range.
    if (a.overTarget) {
      const total = { groups: {}, cats: {} };
      for (const m of withData) { for (const [k, v] of Object.entries(per[m].groups)) add(total.groups, k, v); for (const [k, v] of Object.entries(per[m].cats)) add(total.cats, k, v); }
      const r = deriveAll(total.groups).revenue;
      if (r > 0) {
        for (const [c, t] of Object.entries(targets)) {
          const share = (total.cats[c] || 0) / r;
          if (!total.cats[c]) continue;
          if (t.max != null && share > t.max) {
            out.push({ severity: share > t.max * 1.25 ? 'medium' : 'low', kind: 'overTarget', realmId: o.realmId, officeName: name, month: null, category: c,
              message: `${c} is ${(share * 100).toFixed(1)}% of revenue over the range, above the ${(t.max * 100).toFixed(0)}% target.`, impact: round2(-(share - t.max) * r) });
          }
        }
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || Math.abs(y.impact) - Math.abs(x.impact)).slice(0, a.max);
}
