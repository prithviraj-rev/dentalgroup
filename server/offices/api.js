// Offices tab API: /api/office-view (portfolio of offices) and /api/office-view/:key (one office: statement, balance
// sheet, trends). Dental practice + sub-DSO are one office (config/offices.json). Every figure comes from the
// ledger built out of raw QuickBooks records; nothing here touches the existing tabs.
import { Router } from 'express';
import { loadCategories, assignCategories } from '../categories.js';
import { loadOfficesConfig, PERIODS } from './config.js';
import { initOfficesSchema, listSavedOffices, saveOffice, deleteOffice, mergeExplicit } from './store.js';
import { resolveOffices, periodWindow, buildStatement, flagsFor, balanceTree, FLAGS, MEMO } from './offices.js';
import { analyze, metricDefs } from './analysis.js';
import { officePl, monthlyPl } from './pl.js';
import { accountBook, ledgerBalances, ledgerCashFlow, rawStatus, GRP_OF_TYPE, monthEnd } from '../raw/data.js';
import { addMonths, monthsBetween, bucketsFor } from '../periods.js';
import { appConfig } from '../config.js';

const round2 = (n) => Math.round(n * 100) / 100;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const list = (ids) => (ids.length ? `IN (${ids.map(() => '?').join(',')})` : "IN ('')");

/** P&L lines by company, month, account and payee / customer (income and expenses positive). */
function plLines(db, ids, from, to, book) {
  const rows = db.prepare(`SELECT realm_id AS realmId, substr(txn_date, 1, 7) AS month, account_id AS accountId, entity_name AS entity, SUM(amount) AS amount
    FROM ledger WHERE realm_id ${list(ids)} AND substr(txn_date, 1, 7) BETWEEN ? AND ? GROUP BY realm_id, month, account_id, entity_name`).all(...ids, from, to);
  const out = [];
  for (const r of rows) {
    const a = book(r.realmId)[r.accountId];
    const grp = a && GRP_OF_TYPE[a.type];
    if (!grp) continue;
    const amount = grp === 'Income' || grp === 'OtherIncome' ? -r.amount : r.amount;
    if (Math.abs(amount) < 0.005) continue;
    out.push({ realmId: r.realmId, month: r.month, grp, accountId: r.accountId, account: a.name, fullName: a.fullName, entity: r.entity || null, amount: round2(amount) });
  }
  return out;
}

/**
 * file: the offices config to use (default app.config.json offices.file); base: URL segment of the routes (default
 * office-view); analysis: also serve /analysis from this config. A second instance with another file and base gives a
 * second Offices tab (app.config.json officesSheet). Saved offices (combine) are shared between instances.
 */
export function createOfficesRouter(db, { parseFilters, file = undefined, base = 'office-view', analysis = true }) {
  const cfg = loadOfficesConfig(file);
  const officeCats = loadCategories();
  initOfficesSchema(db);
  const router = Router();
  const P = `/${base}`;
  // Analysis tab settings (app.config.json analysis.*), checked against the statement rows so a bad key fails at startup.
  const analysisCfg = appConfig.analysis;
  const analysisMetrics = analysis ? metricDefs(analysisCfg, cfg.rows) : [];
  if (analysis) for (const d of analysisCfg.dimensions) {
    if (d.startsWith('category:') && !officeCats.dimensions.some((x) => x.id === d.slice(9))) throw new Error(`app.config.json: analysis.dimensions "${d}" is not a dimension id in config/dashboard-categories.json`);
  }

  const companiesInScope = (scope) => db.prepare('SELECT realm_id AS realmId, company_name AS officeName, city, state FROM connections').all()
    .filter((c) => !scope || scope.realms.includes(c.realmId));
  const categoryOf = (companies) => {
    const dim = officeCats.dimensions.find((d) => d.id === cfg.autoPair.dimension);
    if (!dim) return () => null;
    const map = assignCategories(db, dim, companies);
    return (id) => map[id] || null;
  };
  const wrap = (fn) => (req, res) => {
    try { res.json(fn(req)); } catch (e) { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' }); }
  };
  const filtersOf = (req) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { throw httpError(e.status || 400, e.message); }
    const period = PERIODS.includes(req.query.period) ? req.query.period : cfg.periods.default;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const asOf = cfg.periods.asOf === 'lastFullMonth' && f.to >= thisMonth && f.from < f.to ? addMonths(f.to, -1) : f.to; // the current month is not finished
    return { ...f, period, asOf, window: periodWindow(asOf, period, cfg.periods.fiscalYearStartMonth) };
  };
  /** Offices visible for the request: all in scope, narrowed to those containing a selected company. */
  const officesOf = (req, f) => {
    const companies = companiesInScope(req.dashboardScope);
    let offices = resolveOffices(companies, { ...cfg, offices: mergeExplicit(listSavedOffices(db), cfg.offices) }, categoryOf(companies));
    if (f.offices) offices = offices.filter((o) => o.companies.some((c) => f.offices.includes(c.realmId)));
    return offices;
  };
  const idsOf = (offices) => offices.flatMap((o) => o.companies.map((c) => c.realmId));
  const sourceOf = (ids, book) => {
    const st = rawStatus(db, ids, book);
    const pulled = st.filter((s) => s.pulled);
    return {
      companies: ids.length, pulled: pulled.length, records: pulled.reduce((t, s) => t + s.records, 0),
      lastChange: pulled.map((s) => s.lastChange).filter(Boolean).sort().at(-1) || null,
      errors: pulled.filter((s) => s.errors).map((s) => ({ realmId: s.realmId, message: s.errorMessages })).slice(0, 5),
      balancesMatch: pulled.reduce((t, s) => t + s.balances.match, 0), balancesDiffer: pulled.reduce((t, s) => t + s.balances.differ, 0),
      unbalancedTxns: pulled.reduce((t, s) => t + (s.ledger?.unbalanced || 0), 0),
      byCompany: Object.fromEntries(st.map((s) => [s.realmId, s])),
    };
  };
  const lastActivity = (ids, asOf) => Object.fromEntries(db.prepare(`SELECT realm_id AS id, MAX(substr(txn_date, 1, 7)) AS m FROM ledger WHERE realm_id ${list(ids)} AND substr(txn_date, 1, 7) <= ? GROUP BY realm_id`).all(...ids, asOf).map((r) => [r.id, r.m]));

  /** Statement + balances for one office, over the months needed by the table, the period and the prior period. */
  const officeFigures = (o, f, ctx) => {
    const ids = o.companies.map((c) => c.realmId);
    const lines = ctx.lines.filter((l) => ids.includes(l.realmId));
    const cashFlow = {};
    for (const id of ids) for (const [m, v] of Object.entries(ctx.cashFlow[id] || {})) cashFlow[m] = (cashFlow[m] || 0) + v.operating + (cfg.cashFlow.includeLoanPayments ? v.loans || 0 : 0);
    const st = buildStatement(lines, o, cfg, { window: f.window, months: ctx.months, cashFlow });
    const bal = (m) => { const t = { cash: 0, ar: 0, ap: 0, any: false }; for (const id of ids) { const b = ctx.balances[id]?.[m]; if (!b) continue; t.any = true; t.cash += b.cash; t.ar += b.ar; t.ap += b.ap; } return t.any ? t : null; };
    const now = bal(f.asOf); const prior = bal(f.window.priorTo);
    const row = (key) => st.rows.find((r) => r.key === key);
    const coll = st.rows.find((r) => r.role === 'collections'); const ebitda = st.rows.find((r) => r.role === 'ebitda'); const before = st.rows.find((r) => r.role === 'feesSubtotal'); const fees = st.rows.find((r) => r.role === 'fees'); const cf = st.rows.find((r) => r.role === 'cashFlow');
    const nMonths = monthsBetween(f.window.from, f.window.to).length;
    const act = ids.map((id) => ctx.activity[id]).filter(Boolean).sort().at(-1) || null;
    const srcs = ids.map((id) => ctx.source.byCompany[id]).filter(Boolean);
    const flags = flagsFor({
      collections: coll.period, prior: coll.prior, ebitda: ebitda.period, cash: now?.cash ?? null, ar: now?.ar ?? null,
      monthlyCosts: (coll.period - ebitda.period) / nMonths, monthlyCollections: coll.period / nMonths,
      uncategorized: st.uncategorizedPeriod, internalUnmatched: st.internalPeriod.expense - st.internalPeriod.income,
      lastChange: srcs.map((s) => s.lastChange).filter(Boolean).sort()[0] || null, lastActivity: act, pullErrors: srcs.some((s) => s.errors > 0),
    }, cfg, { asOf: f.asOf });
    return {
      key: o.key, name: o.name, city: o.city, state: o.state, id: o.id, saved: o.saved, companies: o.companies.map((c) => ({ realmId: c.realmId, name: c.name })),
      netCollections: coll.period, priorNetCollections: coll.prior, vsPrior: coll.prior > 0 ? round2((coll.period - coll.prior) / coll.prior * 10000) / 10000 : null,
      ebitdaBeforeFees: before.period, managementFees: fees.period, officeEbitda: ebitda.period, ebitdaMargin: coll.period ? round2(ebitda.period / coll.period * 10000) / 10000 : null,
      operatingCashFlow: cf ? cf.period : null,
      cash: now?.cash ?? null, ar: now?.ar ?? null, ap: now?.ap ?? null, priorCash: prior?.cash ?? null, priorAr: prior?.ar ?? null, priorAp: prior?.ap ?? null,
      lastActivity: act, flags, hasData: lines.length > 0, statement: st, row,
    };
  };

  const context = (ids, f, book, { trend = false } = {}) => {
    const start = [f.from, f.window.priorFrom, trend ? addMonths(f.asOf, -(cfg.trendMonths - 1)) : f.from].sort()[0];
    const months = monthsBetween(f.from, f.to);
    const balMonths = trend ? monthsBetween(addMonths(f.asOf, -(cfg.trendMonths - 1)), f.asOf) : [f.window.priorTo, f.asOf];
    return {
      lines: plLines(db, ids, start, f.to, book), months,
      cashFlow: ledgerCashFlow(db, ids, start, f.to, book),
      balances: ledgerBalances(db, ids, balMonths, book),
      activity: lastActivity(ids, f.asOf), source: sourceOf(ids, book),
    };
  };
  const periodsOut = (f) => ({ key: f.period, ...f.window, options: PERIODS.map((p) => [p, { month: 'Month', quarter: 'Last full quarter', ytd: 'YTD', ttm: 'TTM' }[p]]) });

  // ---------- Combine companies (saved offices, stored in the database) ----------
  const canManage = (req) => !req.dashboardScope || Boolean(req.dashboardScope.canManage);
  router.get(`${P}/setup`, wrap((req) => {
    const companies = companiesInScope(req.dashboardScope);
    const offices = resolveOffices(companies, { ...cfg, offices: mergeExplicit(listSavedOffices(db), cfg.offices) }, categoryOf(companies));
    const officeOf = {};
    for (const o of offices) for (const c of o.companies) officeOf[c.realmId] = { key: o.key, name: o.name, saved: o.saved, id: o.id };
    const cat = categoryOf(companies);
    return {
      canManage: canManage(req), namePattern: cfg.naming.pattern,
      companies: companies.sort((a, b) => a.officeName.localeCompare(b.officeName)).map((c) => ({ realmId: c.realmId, name: c.officeName, city: c.city, state: c.state, group: cat(c.realmId), office: officeOf[c.realmId] || null })),
      saved: listSavedOffices(db).map((s) => ({ ...s, companies: s.companies.filter((id) => companies.some((c) => c.realmId === id)) })).filter((s) => s.companies.length),
    };
  }));
  router.post(`${P}/setup`, wrap((req) => {
    if (!canManage(req)) throw httpError(403, 'Your role does not allow changing offices.');
    const allowed = new Set(companiesInScope(req.dashboardScope).map((c) => c.realmId));
    const companies = (req.body?.companies || []).map(String);
    if (companies.some((c) => !allowed.has(c))) throw httpError(403, 'A company is not in your organization.');
    const saved = saveOffice(db, { id: req.body?.id, name: req.body?.name, city: req.body?.city, state: req.body?.state, companies, aliases: req.body?.aliases });
    // The office key the page can open straight away.
    const all = companiesInScope(req.dashboardScope);
    const office = resolveOffices(all, { ...cfg, offices: mergeExplicit(listSavedOffices(db), cfg.offices) }, categoryOf(all)).find((o) => o.id === saved.id);
    return { ...saved, key: office?.key || null };
  }));
  router.delete(`${P}/setup/:id`, wrap((req) => {
    if (!canManage(req)) throw httpError(403, 'Your role does not allow changing offices.');
    return deleteOffice(db, req.params.id);
  }));

  // ---------- Portfolio ----------
  router.get(P, wrap((req) => {
    const f = filtersOf(req);
    const offices = officesOf(req, f);
    const ids = idsOf(offices);
    const book = accountBook(db);
    const ctx = context(ids, f, book);
    const rows = offices.map((o) => officeFigures(o, f, ctx)).filter((o) => o.hasData || o.cash != null);
    const tot = { netCollections: 0, priorNetCollections: 0, officeEbitda: 0, cash: 0, ar: 0 };
    for (const r of rows) { tot.netCollections += r.netCollections; tot.priorNetCollections += r.priorNetCollections; tot.officeEbitda += r.officeEbitda; tot.cash += r.cash || 0; tot.ar += r.ar || 0; }
    const flagCounts = FLAGS.map(([key, label, tone]) => ({ key, label, tone, count: rows.filter((r) => r.flags.some((x) => x.key === key)).length })).filter((x) => x.count);
    const { statement, row, ...strip } = rows[0] || {};
    return {
      asOf: f.asOf, to: f.to, from: f.from, period: periodsOut(f),
      totals: { ...Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round2(v)])), vsPrior: tot.priorNetCollections > 0 ? (tot.netCollections - tot.priorNetCollections) / tot.priorNetCollections : null, ebitdaMargin: tot.netCollections ? tot.officeEbitda / tot.netCollections : null, flagged: rows.filter((r) => r.flags.length).length },
      flags: flagCounts,
      offices: rows.map(({ statement: _s, row: _r, ...o }) => o),
      hasData: rows.length > 0,
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  // ---------- One office ----------
  router.get(`${P}/:key`, wrap((req) => {
    const f = filtersOf(req);
    const o = officesOf(req, f).find((x) => x.key === req.params.key);
    if (!o) throw httpError(404, 'Office not found');
    const ids = o.companies.map((c) => c.realmId);
    const book = accountBook(db);
    const ctx = context(ids, f, book, { trend: true });
    const fig = officeFigures(o, f, ctx);
    const { statement, row, ...head } = fig;
    // Balance sheet at the as-of month end and a year earlier, by account (both companies merged by account path).
    const balAt = (m) => Object.fromEntries(db.prepare(`SELECT realm_id || '|' || account_id AS k, SUM(amount) AS s FROM ledger WHERE realm_id ${list(ids)} AND txn_date <= ? GROUP BY realm_id, account_id`).all(...ids, monthEnd(m)).map((r) => [r.k, r.s]));
    const nowB = balAt(f.asOf); const priorB = balAt(f.window.priorTo);
    const balances = [...new Set([...Object.keys(nowB), ...Object.keys(priorB)])].map((k) => { const [realmId, accountId] = k.split('|'); return { realmId, accountId, now: nowB[k] || 0, prior: priorB[k] || 0 }; });
    const sections = balanceTree(balances, (id) => book(id));
    // Trends: last trendMonths months of collections, EBITDA and month-end cash.
    const trendMonths = monthsBetween(addMonths(f.asOf, -(cfg.trendMonths - 1)), f.asOf);
    const booked = monthlyPl(ctx.lines, trendMonths);
    const trend = trendMonths.map((m) => {
      let cash = null;
      for (const id of ids) { const b = ctx.balances[id]?.[m]; if (b) cash = (cash || 0) + b.cash; }
      return { month: m, netCollections: round2(statement.all.collections[m] || 0), officeEbitda: round2(statement.all.officeEbitda[m] || 0), cash, revenue: booked[m].revenue, netIncome: booked[m].netIncome };
    });
    // Combined profit and loss as booked: accounts merged by section, type and account path; by month and by company.
    const pl = officePl({ companies: o.companies, book, lines: ctx.lines, months: ctx.months });
    const srcs = ids.map((id) => ctx.source.byCompany[id]).filter(Boolean);
    return {
      office: head, asOf: f.asOf, to: f.to, from: f.from, months: ctx.months, period: periodsOut(f),
      badges: {
        balancesMatch: srcs.reduce((t, s) => t + (s.balances?.match || 0), 0), balancesDiffer: srcs.reduce((t, s) => t + (s.balances?.differ || 0), 0),
        lastChange: srcs.map((s) => s.lastChange).filter(Boolean).sort()[0] || null, pulled: srcs.filter((s) => s.pulled).length, errors: srcs.filter((s) => s.errors > 0).length,
        unbalanced: srcs.reduce((t, s) => t + (s.ledger?.unbalanced || 0), 0),
      },
      statement: { rows: statement.rows, memo: statement.memo, internal: statement.internal, internalPeriod: statement.internalPeriod, memoLabels: MEMO.map(([k, l]) => [k, l]) },
      balanceSheet: { asOf: f.asOf, prior: f.window.priorTo, sections },
      pl,
      trend,
      hasData: fig.hasData,
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  // ---------- Analysis tab ----------
  // One statement metric by office / office category / statement row / QuickBooks account over the selected periods,
  // computed from the same office statements as the Offices tab (pairs, internal charges, payroll split).
  if (analysis) router.get('/analysis', wrap((req) => {
    const f = filtersOf(req);
    const metric = analysisCfg.metrics.includes(req.query.metric) ? req.query.metric : analysisCfg.defaultMetric;
    const def = analysisMetrics.find((m) => m.key === metric);
    const requestedBy = analysisCfg.dimensions.includes(req.query.by) ? req.query.by : analysisCfg.defaultBy;
    // Subtotals (EBITDA, cash flow) have no accounts of their own: fall back to offices.
    const by = requestedBy === 'account' && !def.account ? 'office' : requestedBy;
    const catDim = by.startsWith('category:') ? officeCats.dimensions.find((d) => d.id === by.slice(9)) : null;
    const labels = analysisCfg.dimensionLabels || {};
    const byLabel = catDim ? `${catDim.label} (office category)` : labels[by] || by;

    const companies = companiesInScope(req.dashboardScope);
    const offices = officesOf(req, f);
    const ids = idsOf(offices);
    const book = accountBook(db);
    const ctx = context(ids, f, book);
    const statements = new Map();
    const statementOf = (o) => {
      if (!statements.has(o.key)) statements.set(o.key, officeFigures(o, f, ctx).statement);
      return statements.get(o.key);
    };
    const catMap = catDim ? assignCategories(db, catDim, companies) : {};
    const categoryOf = (o) => catMap[o.companies[0].realmId] || catDim?.otherLabel || 'Other';
    const buckets = bucketsFor(f.from, f.to, f.granularity);
    const out = analyze({ offices, statementOf, categoryOf, buckets, metric, by: catDim ? 'category' : by, percentOf: analysisCfg.percentOf });
    return {
      from: f.from, to: f.to, granularity: f.granularity, periods: buckets.map(({ key, label }) => ({ key, label })),
      metric, metricDef: { key: def.key, label: def.label, format: def.format }, by, requestedBy, byLabel,
      fallback: by !== requestedBy ? `${def.label} is a subtotal with no accounts of its own; shown by office instead.` : null,
      rows: out.rows, totals: out.totals, hasData: out.hasData, offices: offices.length,
      config: {
        percentOf: analysisCfg.percentOf,
        metrics: analysisMetrics.map(({ key, label, format, account }) => ({ key, label, format, account })),
        dimensions: analysisCfg.dimensions.map((d) => {
          if (d.startsWith('category:')) { const dim = officeCats.dimensions.find((x) => x.id === d.slice(9)); return { id: d, label: `${dim.label} (office category)` }; }
          return { id: d, label: labels[d] || d };
        }),
      },
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  return router;
}
