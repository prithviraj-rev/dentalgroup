// Read API for the Group overview, Cash & balance sheet, Budget and Practice KPIs tabs, the practice KPI
// import, transaction drill-down and the raw data status. Every figure comes from the ledger built out of
// raw QuickBooks records (server/raw). Mounted next to the existing /api router; it shares its filters
// (parseFilters) and office scoping but none of its data.
import { Router } from 'express';
import { deriveAll } from '../metrics.js';
import { addMonths, monthsBetween } from '../periods.js';
import { loadCategories, assignCategories } from '../categories.js';
import { loadCategoryViewConfig, classifyLine } from '../categoryView.js';
import { loadFinanceConfig, loadGroupConfig, loadPracticeConfig } from './config.js';
import { initFinanceSchema } from './store.js';
import { tagLines, groupOverview, figures } from './group.js';
import { parseCsv, importPracticeRows, practiceKpis, practiceTemplate } from './practice.js';
import { initRawSchema } from '../raw/sync.js';
import { initLedgerSchema } from '../raw/ledger.js';
import {
  accountBook, ledgerPl, ledgerBalances, ledgerCashFlow, rawAging, ledgerVendorSpend, rawBudgets, ledgerTransactions, rawStatus, AGING_BUCKETS, GRP_OF_TYPE,
} from '../raw/data.js';

const round2 = (n) => Math.round(n * 100) / 100;
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function createFinanceRouter(db, { parseFilters }) {
  initFinanceSchema(db);
  initRawSchema(db);
  initLedgerSchema(db);
  const fin = loadFinanceConfig();
  const g = loadGroupConfig();
  const pk = loadPracticeConfig();
  const cv = loadCategoryViewConfig();
  const officeCats = loadCategories();
  const router = Router();
  const isDebt = (sub, name) => fin.cash.debtSubsections.includes(sub) || Boolean(fin.cash.debtAccounts?.test(name));

  const allOffices = (scope) => db.prepare('SELECT realm_id AS realmId, company_name AS officeName FROM connections').all()
    .filter((o) => !scope || scope.realms.includes(o.realmId)).sort((a, b) => a.officeName.localeCompare(b.officeName));
  /** Offices selected by the filters (all in scope when the filter is "all"). */
  const selectedOffices = (f, scope) => {
    const list = allOffices(scope);
    return f.offices ? list.filter((o) => f.offices.includes(o.realmId)) : list;
  };
  const segmentMapper = (offices) => {
    const dim = officeCats.dimensions.find((d) => d.id === g.segmentDimension);
    if (!dim) return { label: null, of: () => 'All companies' };
    const map = assignCategories(db, dim, offices);
    return { label: dim.label, of: (id) => map[id] || dim.otherLabel };
  };
  const wrap = (fn) => (req, res) => {
    try { res.json(fn(req)); } catch (e) { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' }); }
  };
  const filtersOf = (req) => {
    try { return parseFilters(req.query, req.dashboardScope); } catch (e) { throw httpError(e.status || 400, e.message); }
  };
  /** Short data-source summary shown on every tab. */
  const sourceOf = (ids, book) => {
    const st = rawStatus(db, ids, book);
    const pulled = st.filter((s) => s.pulled);
    return {
      companies: ids.length, pulled: pulled.length,
      records: pulled.reduce((t, s) => t + s.records, 0),
      lastChange: pulled.map((s) => s.lastChange).filter(Boolean).sort().at(-1) || null,
      errors: pulled.filter((s) => s.errors).map((s) => ({ realmId: s.realmId, message: s.errorMessages })).slice(0, 5),
      balancesMatch: pulled.reduce((t, s) => t + s.balances.match, 0), balancesDiffer: pulled.reduce((t, s) => t + s.balances.differ, 0),
      unbalancedTxns: pulled.reduce((t, s) => t + (s.ledger?.unbalanced || 0), 0),
    };
  };

  // ---------- Raw data status ----------
  router.get('/raw/status', wrap((req) => {
    const offices = allOffices(req.dashboardScope);
    const names = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
    return { companies: rawStatus(db, offices.map((o) => o.realmId)).map((s) => ({ ...s, officeName: names[s.realmId] })) };
  }));

  // ---------- Group overview ----------
  router.get('/group-overview', wrap((req) => {
    const f = filtersOf(req);
    const offices = selectedOffices(f, req.dashboardScope);
    const ids = offices.map((o) => o.realmId);
    const seg = segmentMapper(offices);
    const book = accountBook(db);
    const fyStartMonth = String(g.forecast.fiscalYearStartMonth).padStart(2, '0');
    const fyStart = f.to.slice(5, 7) >= fyStartMonth ? `${f.to.slice(0, 4)}-${fyStartMonth}` : `${Number(f.to.slice(0, 4)) - 1}-${fyStartMonth}`;
    const start = [addMonths(f.from, -12), addMonths(fyStart, -12), addMonths(f.to, -23)].sort()[0];
    const rows = tagLines(ledgerPl(db, ids, start, f.to, book), g, seg.of);
    return { ...groupOverview(rows, { from: f.from, to: f.to, offices, segmentOf: seg.of, g, cv }), segmentLabel: seg.label, rules: g.rules.map((r) => r.label), scorecardConfig: g.scorecard, source: sourceOf(ids, book) };
  }));

  // ---------- Cash & balance sheet ----------
  router.get('/finance/cash', wrap((req) => {
    const f = filtersOf(req);
    const offices = selectedOffices(f, req.dashboardScope);
    const ids = offices.map((o) => o.realmId);
    const names = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
    const seg = segmentMapper(offices);
    const book = accountBook(db);
    const months = monthsBetween(f.from, f.to);
    const today = new Date().toISOString().slice(0, 10);
    const balMonths = months.filter((m) => m <= today.slice(0, 7));
    const per = ledgerBalances(db, ids, balMonths, book, isDebt);

    const finish = (s) => {
      if (!s) return null;
      const currentAssets = s.cash + s.ar + s.otherCurrentAssets;
      const currentLiabilities = s.ap + s.creditCards + s.otherCurrentLiabilities;
      const totalAssets = currentAssets + s.fixedAssets + s.otherAssets;
      const totalLiabilities = currentLiabilities + s.longTermLiabilities;
      return { ...s, currentAssets: round2(currentAssets), currentLiabilities: round2(currentLiabilities), totalAssets: round2(totalAssets), totalLiabilities: round2(totalLiabilities), workingCapital: round2(currentAssets - currentLiabilities), currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : null };
    };
    const bsMonths = balMonths.filter((m) => Object.values(per).some((x) => x[m]));
    const latest = bsMonths.at(-1) || null;
    const sumMonth = (m) => {
      const t = {};
      let n = 0;
      for (const id of ids) {
        const own = per[id]?.[m];
        if (!own) continue;
        n++;
        for (const [k, v] of Object.entries(own)) t[k] = (t[k] || 0) + v;
      }
      return n ? finish(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round2(v)]))) : null;
    };
    const trend = bsMonths.map((m) => ({ month: m, ...sumMonth(m) }));
    const companies = ids.filter((id) => per[id] && latest && per[id][latest]).map((id) => {
      const prev = bsMonths.length > 1 ? per[id][bsMonths.at(-2)] : null;
      return { realmId: id, officeName: names[id], segment: seg.of(id), asOf: latest, ...finish(per[id][latest]), prevCash: prev ? prev.cash : null, cashSeries: bsMonths.map((m) => per[id][m]?.cash ?? null) };
    }).sort((a, b) => b.cash - a.cash);

    // Cash flow (direct method) and profit-to-cash conversion.
    const cf = ledgerCashFlow(db, ids, f.from, f.to, book, isDebt);
    const cfMonthly = months.map((m) => {
      const x = ids.map((id) => cf[id]?.[m]).filter(Boolean);
      if (!x.length) return { month: m, empty: true };
      const s = (k) => round2(x.reduce((t, v) => t + v[k], 0));
      return { month: m, operating: s('operating'), investing: s('investing'), financing: s('financing'), netChange: round2(s('operating') + s('investing') + s('financing')) };
    });
    const pl = ledgerPl(db, ids, f.from, f.to, book);
    const conversion = ids.map((id) => {
      if (!cf[id]) return null;
      const cfMonths = new Set(Object.keys(cf[id]));
      const groups = {};
      for (const r of pl.filter((x) => x.realmId === id && cfMonths.has(x.month))) add(groups, r.grp, r.amount);
      const ni = deriveAll(groups).netIncome;
      const op = Object.values(cf[id]).reduce((t, v) => t + v.operating, 0);
      return { realmId: id, officeName: names[id], segment: seg.of(id), netIncome: round2(ni), operatingCashFlow: round2(op), conversion: ni > 0 ? op / ni : null };
    }).filter(Boolean).sort((a, b) => b.operatingCashFlow - a.operatingCashFlow);
    const withCf = cfMonthly.filter((m) => !m.empty);
    const recent = withCf.slice(-fin.cash.runwayMonths);
    const avgOperating = recent.length ? recent.reduce((t, m) => t + m.operating, 0) / recent.length : null;
    const cashNow = latest ? sumMonth(latest).cash : null;

    // Aging from open invoices / bills (as of today).
    const overdueBuckets = AGING_BUCKETS.slice(AGING_BUCKETS.indexOf(fin.aging.overdueFrom));
    const aging = Object.fromEntries(['ar', 'ap'].map((kind) => {
      const rows = rawAging(db, ids, kind, today);
      const sumB = (rs) => Object.fromEntries(AGING_BUCKETS.map((b) => [b, round2(rs.filter((r) => r.bucket === b).reduce((t, r) => t + r.amount, 0))]));
      const buckets = sumB(rows);
      const byCompany = ids.map((id) => {
        const mine = rows.filter((r) => r.realmId === id);
        if (!mine.length) return null;
        const bk = sumB(mine);
        return { realmId: id, officeName: names[id], buckets: bk, total: round2(Object.values(bk).reduce((t, v) => t + v, 0)), overdue: round2(overdueBuckets.reduce((t, b) => t + bk[b], 0)) };
      }).filter(Boolean).sort((a, b) => b.total - a.total);
      const parties = {};
      for (const r of rows) {
        const k = r.party.trim().toLowerCase();
        const p = (parties[k] ||= { party: r.party.trim(), companies: new Set(), rows: [] });
        p.companies.add(r.realmId);
        p.rows.push(r);
      }
      const topParties = Object.values(parties).map((p) => {
        const bk = sumB(p.rows);
        return { party: p.party, companies: p.companies.size, buckets: bk, total: round2(Object.values(bk).reduce((t, v) => t + v, 0)), overdue: round2(overdueBuckets.reduce((t, b) => t + bk[b], 0)) };
      }).sort((a, b) => b.overdue - a.overdue || b.total - a.total).slice(0, fin.aging.topParties);
      return [kind, { buckets, total: round2(Object.values(buckets).reduce((t, v) => t + v, 0)), overdue: round2(overdueBuckets.reduce((t, b) => t + buckets[b], 0)), byCompany, topParties, reportDate: today }];
    }));

    // Vendors.
    const vend = {};
    for (const r of ledgerVendorSpend(db, ids, f.from, f.to, book)) {
      if (fin.vendors.exclude?.test(r.vendor)) continue;
      const k = r.vendor.trim().toLowerCase();
      const v = (vend[k] ||= { vendor: r.vendor.trim(), companies: new Set(), total: 0, monthly: {} });
      v.companies.add(r.realmId);
      v.total += r.amount;
      add(v.monthly, r.month, r.amount);
    }
    const vendorTotal = Object.values(vend).reduce((t, v) => t + v.total, 0);
    const vendors = {
      total: round2(vendorTotal), count: Object.keys(vend).length,
      top: Object.values(vend).sort((a, b) => b.total - a.total).slice(0, fin.vendors.top).map((v) => ({ vendor: v.vendor, companies: v.companies.size, total: round2(v.total), share: vendorTotal ? v.total / vendorTotal : null, monthly: months.map((m) => round2(v.monthly[m] || 0)) })),
    };

    return {
      from: f.from, to: f.to, months, latest, segmentLabel: seg.label,
      summary: latest ? { ...sumMonth(latest), prior: bsMonths.length > 1 ? sumMonth(bsMonths.at(-2)) : null } : null,
      trend, companies,
      cashFlow: { monthly: cfMonthly, conversion, runway: { cash: cashNow, avgOperating: avgOperating == null ? null : round2(avgOperating), months: avgOperating != null && avgOperating < 0 && cashNow != null ? cashNow / -avgOperating : null, basisMonths: recent.length } },
      aging, vendors,
      source: sourceOf(ids, book),
      hasData: Boolean(latest) || withCf.length > 0 || aging.ar.total !== 0 || aging.ap.total !== 0 || vendors.count > 0,
    };
  }));

  // ---------- Budget vs actual ----------
  router.get('/finance/budget', wrap((req) => {
    const f = filtersOf(req);
    const offices = selectedOffices(f, req.dashboardScope);
    const ids = offices.map((o) => o.realmId);
    const names = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
    const months = monthsBetween(f.from, f.to);
    const book = accountBook(db);
    const brows = rawBudgets(db, ids, f.from, f.to);
    // One budget per company and month: preferName match first, else the newest.
    const chosen = {};
    const score = (x) => [fin.budget.preferName?.test(x.budgetName) ? 1 : 0, Number(x.budgetId) || 0];
    for (const r of brows) {
      const k = `${r.realmId}|${r.month}`;
      const cur = chosen[k];
      if (!cur) { chosen[k] = r; continue; }
      const [a1, a2] = score(r); const [b1, b2] = score(cur);
      if (a1 > b1 || (a1 === b1 && a2 > b2)) chosen[k] = r;
    }
    const picked = new Set(Object.values(chosen).map((r) => `${r.realmId}|${r.month}|${r.budgetId}`));
    const budgetLines = brows.filter((r) => picked.has(`${r.realmId}|${r.month}|${r.budgetId}`)).map((r) => {
      const a = book(r.realmId)[r.accountId];
      return { ...r, grp: a ? GRP_OF_TYPE[a.type] : null, account: a?.name || r.accountId, fullName: a?.fullName, subType: a?.subType };
    }).filter((r) => r.grp);
    const actualLines = ledgerPl(db, ids, f.from, f.to, book);
    const budgetMonths = new Set(budgetLines.map((r) => `${r.realmId}|${r.month}`));
    const lastActual = actualLines.map((r) => r.month).sort().at(-1) || null;
    // Budget to date: months up to the latest actual month, and only where the company has a budget.
    const comparable = (r) => budgetMonths.has(`${r.realmId}|${r.month}`) && lastActual && r.month <= lastActual;
    const sum = (rows) => { const gr = {}; for (const r of rows) add(gr, r.grp, r.amount); return figures(gr); };
    const monthly = months.map((m) => {
      const b = budgetLines.filter((r) => r.month === m);
      const a = actualLines.filter((r) => r.month === m && budgetMonths.has(`${r.realmId}|${m}`));
      return { month: m, budget: b.length ? sum(b) : null, actual: a.length ? sum(a) : null };
    });
    const perOffice = ids.map((id) => {
      const b = budgetLines.filter((r) => r.realmId === id && comparable(r));
      if (!b.length) return null;
      const a = actualLines.filter((r) => r.realmId === id && comparable(r));
      return { realmId: id, officeName: names[id], budgetName: [...new Set(b.map((r) => r.budgetName))].join(', '), budget: sum(b), actual: sum(a), months: new Set(b.map((r) => r.month)).size };
    }).filter(Boolean);
    const cat = {};
    const catAdd = (r, side) => {
      const c = classifyLine(cv, r.grp, r.account, r.subType, r.fullName);
      if (!c) return;
      const x = (cat[`${c.kind}|${c.label}`] ||= { kind: c.kind, label: c.label, budget: 0, actual: 0 });
      x[side] += r.amount;
    };
    budgetLines.filter(comparable).forEach((r) => catAdd(r, 'budget'));
    actualLines.filter(comparable).forEach((r) => catAdd(r, 'actual'));
    const src = sourceOf(ids, book);
    return {
      from: f.from, to: f.to, lastActual, hasBudgets: budgetLines.length > 0,
      companiesWithBudget: new Set(budgetLines.map((r) => r.realmId)).size, companies: ids.length,
      totals: { budget: sum(budgetLines.filter(comparable)), actual: sum(actualLines.filter(comparable)), budgetFullRange: sum(budgetLines) },
      monthly, offices: perOffice,
      categories: Object.values(cat).map((c) => ({ ...c, budget: round2(c.budget), actual: round2(c.actual) })).filter((c) => Math.abs(c.budget) + Math.abs(c.actual) >= 1).sort((a, b) => (a.kind === b.kind ? Math.abs(b.budget) - Math.abs(a.budget) : a.kind === 'revenue' ? -1 : 1)),
      source: src,
    };
  }));

  // ---------- Practice KPIs ----------
  router.get('/practice-kpis', wrap((req) => {
    const f = filtersOf(req);
    const offices = selectedOffices(f, req.dashboardScope);
    return practiceKpis(db, pk, g, { from: f.from, to: f.to, offices });
  }));
  router.get('/practice-kpis/template', (req, res) => {
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="practice-kpis-template.csv"');
    res.send(practiceTemplate(pk, allOffices(req.dashboardScope)));
  });
  router.post('/practice-kpis', (req, res) => {
    const scope = req.dashboardScope;
    if (scope && !scope.canManage) return res.status(403).json({ error: 'Your role does not allow importing data.' });
    try {
      const rows = typeof req.body?.csv === 'string' ? parseCsv(req.body.csv) : Array.isArray(req.body?.rows) ? req.body.rows : null;
      if (!rows) return res.status(400).json({ error: 'Send { csv: "<text>" } or { rows: [{ office, month, ...metrics }] }' });
      if (rows.length > 20000) return res.status(400).json({ error: 'At most 20000 rows per import' });
      res.json(importPracticeRows(db, pk, rows, { offices: allOffices(scope), source: String(req.body.source || 'import').slice(0, 60) }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---------- Transactions behind an account (from the raw ledger) ----------
  router.get('/transactions', wrap((req) => {
    const realmId = String(req.query.realmId || '');
    const scope = req.dashboardScope;
    if (!realmId || (scope && !scope.realms.includes(realmId))) throw httpError(403, 'Not allowed for this company');
    const accountIds = String(req.query.accountIds || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (!accountIds.length) throw httpError(400, 'accountIds is required');
    const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
    if (!isMonth(req.query.from) || !isMonth(req.query.to)) throw httpError(400, 'from and to must be YYYY-MM');
    const tx = ledgerTransactions(db, realmId, accountIds, req.query.from, req.query.to);
    return { realmId, accountIds, from: req.query.from, to: req.query.to, transactions: tx.slice(0, 500), count: tx.length, total: round2(tx.reduce((t, x) => t + x.amount, 0)) };
  }));

  return router;
}
