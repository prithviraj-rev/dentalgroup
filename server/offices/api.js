// Offices tab API: /api/office-view (portfolio of offices) and /api/office-view/:key (one office: statement, balance
// sheet, trends). Dental practice + sub-DSO are one office (config/offices.json). Every figure comes from the
// ledger built out of raw QuickBooks records; nothing here touches the existing tabs.
import path from 'node:path';
import { Router } from 'express';
import { loadCategories, assignCategories } from '../categories.js';
import { loadOfficesConfig, PERIODS, PERIOD_LABELS } from './config.js';
import { initOfficesSchema, listSavedOffices, saveOffice, deleteOffice } from './store.js';
import { resolveOffices, combinedOffices, bucketOf, periodWindow, buildStatement, flagsFor, balanceTree, canonicalBook, FLAGS, MEMO } from './offices.js';
import { analyze, metricDefs } from './analysis.js';
import { officePl, comparePl, monthlyPl } from './pl.js';
import { loadDashboardConfig, buildDashboard } from './dashboard.js';
import { accountBook, ledgerBalances, ledgerCashFlow, rawStatus, GRP_OF_TYPE, monthEnd } from '../raw/data.js';
import { addMonths, monthsBetween, bucketsFor } from '../periods.js';
import { isYearPeriod } from './config.js';
import { appConfig, ROOT } from '../config.js';

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
 * Cash basis: the same shape as plLines, read from the QuickBooks P&L report pulled with accounting_method=Cash
 * (pl_lines_cash, sync.cashBasis). Account names / paths and types come from the book (same account ids); rows the
 * report emits without an account id keep the report's name and group.
 */
function cashLines(db, ids, from, to, book) {
  const rows = db.prepare(`SELECT office_realm_id AS realmId, substr(period_start, 1, 7) AS month, account_id AS accountId, account_name AS name, grp, amount
    FROM pl_lines_cash WHERE office_realm_id ${list(ids)} AND substr(period_start, 1, 7) BETWEEN ? AND ?`).all(...ids, from, to);
  const out = [];
  for (const r of rows) {
    if (Math.abs(r.amount) < 0.005) continue;
    const a = book(r.realmId)[r.accountId];
    const grp = (a && GRP_OF_TYPE[a.type]) || r.grp;
    if (!grp) continue;
    out.push({ realmId: r.realmId, month: r.month, grp, accountId: r.accountId, account: a ? a.name : r.name, fullName: a ? a.fullName : r.name, entity: null, amount: round2(r.amount) });
  }
  return out;
}

/**
 * file: the offices config to use (default app.config.json offices.file); base: URL segment of the routes (default
 * office-view); analysis: also serve /analysis from this config. A second instance with another file and base gives a
 * second Offices tab (app.config.json officesSheet). Saved offices (combine) are shared between instances.
 * dashboard: { path, file, label } also serves the KPI dashboard (/api/<path>, config/kpi-dashboard.json) from this instance's rows.
 */
export function createOfficesRouter(db, { parseFilters, file = undefined, base = 'office-view', analysis = true, dashboard = null }) {
  const cfg = loadOfficesConfig(file);
  const officeCats = loadCategories();
  initOfficesSchema(db);
  const router = Router();
  const P = `/${base}`;
  // Analysis tab settings (app.config.json analysis.*), checked against the statement rows so a bad key fails at startup.
  const analysisCfg = appConfig.analysis;
  const analysisMetrics = analysis ? metricDefs(analysisCfg, cfg.rows) : [];
  const dcfg = dashboard ? loadDashboardConfig(path.resolve(ROOT, dashboard.file), cfg.rows) : null;
  if (dcfg?.buckets) for (const b of dcfg.buckets) if (!cfg.page.portfolio.buckets?.list.some((x) => x.key === b)) throw new Error(`${dashboard.file}: offices.buckets "${b}" is not a bucket key of ${path.basename(file || 'config/offices.json')} page.portfolio.buckets`);
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
    const years = cfg.periods.options.includes('years');
    const period = cfg.periods.options.includes(req.query.period) || (years && isYearPeriod(req.query.period)) ? req.query.period : cfg.periods.default;
    const bcfg = appConfig.dashboard.basis;
    const basis = bcfg.available.includes(req.query.basis) ? req.query.basis : bcfg.default; // accrual = ledger, cash = cash-basis report
    const thisMonth = new Date().toISOString().slice(0, 7);
    const asOf = cfg.periods.asOf === 'lastFullMonth' && f.to >= thisMonth && f.from < f.to ? addMonths(f.to, -1) : f.to; // the current month is not finished
    return { ...f, period, basis, asOf, window: periodWindow(asOf, period, cfg.periods.fiscalYearStartMonth, f.from) };
  };
  /** Offices visible for the request: all in scope (config pairs + automatic pairing), narrowed to those containing a selected company. */
  const officesOf = (req, f) => {
    const companies = companiesInScope(req.dashboardScope);
    let offices = resolveOffices(companies, cfg, categoryOf(companies));
    if (f.offices) offices = offices.filter((o) => o.companies.some((c) => f.offices.includes(c.realmId)));
    return offices;
  };
  /** Combined offices the user saved, as extra views next to the offices (same scoping). */
  const combosOf = (req, f) => {
    let combos = combinedOffices(listSavedOffices(db), companiesInScope(req.dashboardScope));
    if (f.offices) combos = combos.filter((o) => o.companies.some((c) => f.offices.includes(c.realmId)));
    return combos;
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
    const loans = {}; // loan principal movements by month (negative = repayment)
    for (const id of ids) for (const [m, v] of Object.entries(ctx.cashFlow[id] || {})) { cashFlow[m] = (cashFlow[m] || 0) + v.operating + (cfg.cashFlow.includeLoanPayments ? v.loans || 0 : 0); loans[m] = (loans[m] || 0) + (v.loans || 0); }
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
    const vsPrior = coll.prior > 0 ? round2((coll.period - coll.prior) / coll.prior * 10000) / 10000 : null;
    const ebitdaMargin = coll.period ? round2(ebitda.period / coll.period * 10000) / 10000 : null;
    // values: every statement row's period total plus the derived figures page.portfolio.columns may name.
    const inWindow = (map) => round2(Object.entries(map).filter(([m]) => m >= f.window.from && m <= f.window.to).reduce((t, [, v]) => t + v, 0));
    const loanPayments = round2(-inWindow(loans)); // positive = net repaid in the period
    const values = Object.fromEntries(st.rows.map((r) => [r.key, r.period]));
    Object.assign(values, {
      operatingCosts: round2(st.rows.filter((r) => r.role === 'cost' || r.role === 'other').reduce((t, r) => t + r.period, 0)),
      totalExpenses: round2(st.rows.filter((r) => r.role === 'cost' || r.role === 'other' || r.role === 'fees').reduce((t, r) => t + r.period, 0)), // incl. the pass-through management fees
      loanPayments, withdrawals: round2((st.rows.find((r) => r.key === 'partnerWithdrawal')?.period || 0) + loanPayments),
      cash: now?.cash ?? null, ar: now?.ar ?? null, ap: now?.ap ?? null, ebitdaMargin, vsPrior,
    });
    const priorValues = Object.fromEntries(st.rows.map((r) => [r.key, r.prior]));
    return {
      key: o.key, name: o.name, short: o.short || null, note: o.note || null, city: o.city, state: o.state, id: o.id, saved: o.saved, combined: Boolean(o.combined), companies: o.companies.map((c) => ({ realmId: c.realmId, name: c.name, displayName: cfg.naming.companies?.[c.realmId]?.name || c.name, short: cfg.naming.companies?.[c.realmId]?.short || null })),
      bucket: bucketOf(o, cfg.page.portfolio.buckets, ctx.categoryOf), values, prior: priorValues,
      netCollections: coll.period, priorNetCollections: coll.prior, vsPrior,
      ebitdaBeforeFees: before.period, managementFees: fees.period, officeEbitda: ebitda.period, ebitdaMargin,
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
      lines: f.basis === 'cash' ? cashLines(db, ids, start, f.to, book) : plLines(db, ids, start, f.to, book), months, basis: f.basis,
      cashFlow: ledgerCashFlow(db, ids, start, f.to, book),
      balances: ledgerBalances(db, ids, balMonths, book),
      activity: lastActivity(ids, f.asOf), source: sourceOf(ids, book),
      categoryOf: categoryOf(companiesInScope(null).filter((c) => ids.includes(c.realmId))),
    };
  };
  // "years" in the options becomes one button per calendar year, the latest (as of the window) first.
  const periodsOut = (f) => ({
    key: f.period, ...f.window,
    options: cfg.periods.options.flatMap((p) => (p === 'years'
      ? Array.from({ length: cfg.periods.yearButtons }, (_, i) => { const y = Number(f.asOf.slice(0, 4)) - i; return [`year:${y}`, String(y)]; })
      : [[p, PERIOD_LABELS[p]]])),
  });

  // ---------- Combine companies (saved offices, stored in the database) ----------
  const canManage = (req) => !req.dashboardScope || Boolean(req.dashboardScope.canManage);
  router.get(`${P}/setup`, wrap((req) => {
    const companies = companiesInScope(req.dashboardScope);
    const offices = resolveOffices(companies, cfg, categoryOf(companies));
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
    return { ...saved, key: `combined-${saved.id}` }; // the key the page opens straight away
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
    const book = canonicalBook(accountBook(db), ids); // one spelling per account across the office's companies
    const ctx = context(ids, f, book);
    // Buckets with show: false (e.g. the holding company on its own) are left out of the list; their companies stay in the picker and the other tabs.
    const hidden = new Set((cfg.page.portfolio.buckets?.list || []).filter((b) => b.show === false).map((b) => b.key));
    const rows = offices.map((o) => officeFigures(o, f, ctx)).filter((o) => (o.hasData || o.cash != null) && !hidden.has(o.bucket));
    // Combined offices (user-made views) are listed separately and never counted in the totals or flags.
    const combos = combosOf(req, f);
    const comboIds = idsOf(combos).filter((id) => !ids.includes(id));
    const comboCtx = comboIds.length ? context([...ids, ...comboIds], f, canonicalBook(accountBook(db), [...ids, ...comboIds])) : ctx;
    const combined = combos.map((o) => officeFigures(o, f, comboCtx)).map(({ statement: _s, row: _r, ...o }) => ({ ...o, combined: true }));
    const tot = { netCollections: 0, priorNetCollections: 0, officeEbitda: 0, cash: 0, ar: 0 };
    for (const r of rows) { tot.netCollections += r.netCollections; tot.priorNetCollections += r.priorNetCollections; tot.officeEbitda += r.officeEbitda; tot.cash += r.cash || 0; tot.ar += r.ar || 0; }
    const flagCounts = FLAGS.map(([key, label, tone]) => ({ key, label, tone, count: rows.filter((r) => r.flags.some((x) => x.key === key)).length })).filter((x) => x.count);
    const { statement, row, ...strip } = rows[0] || {};
    return {
      asOf: f.asOf, to: f.to, from: f.from, period: periodsOut(f), basis: f.basis,
      totals: { ...Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round2(v)])), vsPrior: tot.priorNetCollections > 0 ? (tot.netCollections - tot.priorNetCollections) / tot.priorNetCollections : null, ebitdaMargin: tot.netCollections ? tot.officeEbitda / tot.netCollections : null, flagged: rows.filter((r) => r.flags.length).length },
      flags: flagCounts,
      offices: rows.map(({ statement: _s, row: _r, ...o }) => o),
      combined,
      hasData: rows.length > 0,
      page: cfg.page,
      buckets: cfg.page.portfolio.buckets ? cfg.page.portfolio.buckets.list.filter((b) => b.show !== false).map(({ key, label, columns }) => ({ key, label, columns })) : null,
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  // ---------- Company groups (page.portfolio.buckets) for the header picker: every company in scope with its office's bucket ----------
  // picker (by company) when configured, else page.portfolio.buckets (by office). names = display names (naming.companies) for the chips.
  router.get(`${P}/groups`, wrap((req) => {
    const b = cfg.picker || cfg.page.portfolio.buckets;
    if (!b) return { groups: null, names: {} };
    const companies = companiesInScope(req.dashboardScope);
    const cat = categoryOf(companies);
    const offices = resolveOffices(companies, cfg, cat);
    const realmsOf = Object.fromEntries(b.list.map((x) => [x.key, []]));
    if (cfg.picker) for (const c of companies) realmsOf[bucketOf({ companies: [c] }, b, cat)].push(c.realmId);
    else for (const o of offices) realmsOf[bucketOf(o, b, cat)].push(...o.companies.map((c) => c.realmId));
    const names = {};
    for (const o of offices) names[o.companies[0].realmId] = o.name;
    return { groups: b.list.map((x, i) => ({ key: x.key, label: x.label, color: (i % 8) + 1, realmIds: realmsOf[x.key] })), names };
  }));

  // ---------- Compare offices: the statement rows side by side, one column per office, consolidated first ----------
  router.get(`${P}/compare`, wrap((req) => {
    const f = filtersOf(req);
    const keys = String(req.query.keys || '').split(',').map((k) => k.trim()).filter(Boolean);
    if (keys.length < 2 || keys.length > 40) throw httpError(400, 'keys must list 2..40 office keys');
    const all = [...officesOf(req, { ...f, offices: null }), ...combosOf(req, { ...f, offices: null })];
    const offices = keys.map((k) => all.find((o) => o.key === k)).filter(Boolean);
    if (offices.length < 2) throw httpError(404, 'Offices not found');
    const ids = idsOf(offices);
    const book = canonicalBook(accountBook(db), ids);
    const ctx = context(ids, f, book);
    const figures = offices.map((o) => officeFigures(o, f, ctx));
    const rowKeys = cfg.rows.map((r) => r.key);
    const sumOf = (pick) => Object.fromEntries(rowKeys.map((k) => [k, round2(figures.reduce((t, o) => t + (pick(o)[k] || 0), 0))]));
    // The QuickBooks accounts behind every row, per office (statement children with activity) and merged across the
    // offices by account name for the consolidated column.
    const accountsOf = (st) => Object.fromEntries(st.rows.map((r) => [r.key, r.children.filter((c) => c.period || c.prior).map(({ account, fullName, period, prior, companies }) => ({ account, fullName, period, prior, companies }))]));
    const merged = Object.fromEntries(rowKeys.map((k) => [k, new Map()]));
    for (const fig of figures) for (const [k, list] of Object.entries(accountsOf(fig.statement))) for (const c of list) {
      const m = merged[k].get(c.fullName) || { account: c.account, fullName: c.fullName, period: 0, prior: 0, offices: 0 };
      m.period = round2(m.period + c.period); m.prior = round2(m.prior + c.prior); m.offices += 1;
      merged[k].set(c.fullName, m);
    }
    const sorted = (a, b) => (cfg.statement.sortAccounts === 'number' ? a.fullName.localeCompare(b.fullName, undefined, { numeric: true }) : Math.abs(b.period) - Math.abs(a.period) || a.fullName.localeCompare(b.fullName));
    // The combined profit and loss over the period months, one column per office (the detail under the statement).
    const months = monthsBetween(f.window.from, f.window.to);
    const pl = cfg.page.sections.includes('pl') ? comparePl({ offices, book, lines: ctx.lines, months }) : null;
    return {
      asOf: f.asOf, to: f.to, from: f.from, period: periodsOut(f), basis: f.basis, months,
      rows: cfg.rows.map(({ key, label, role }) => ({ key, label, role })),
      collectionsKey: cfg.rows.find((r) => r.role === 'collections')?.key || null,
      consolidated: { values: sumOf((o) => o.values), prior: sumOf((o) => o.prior), accounts: Object.fromEntries(rowKeys.map((k) => [k, [...merged[k].values()].sort(sorted)])) },
      offices: figures.map(({ statement, row: _r, flags: _f, ...o }) => ({ ...o, accounts: accountsOf(statement) })),
      pl,
      page: cfg.page,
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  // ---------- One office ----------
  router.get(`${P}/:key`, wrap((req) => {
    const f = filtersOf(req);
    const o = [...officesOf(req, f), ...combosOf(req, f)].find((x) => x.key === req.params.key);
    if (!o) throw httpError(404, 'Office not found');
    const ids = o.companies.map((c) => c.realmId);
    const book = canonicalBook(accountBook(db), ids); // one spelling per account across the office's companies
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
    // With an explicit period the P&L covers that period's months (the office page lets the P&L and the statement use
    // different periods); otherwise the header months.
    const plMonths = req.query.period ? monthsBetween(f.window.from, f.window.to) : ctx.months;
    const pl = cfg.page.sections.includes('pl') ? officePl({ companies: o.companies, book, lines: ctx.lines, months: plMonths }) : null;
    const srcs = ids.map((id) => ctx.source.byCompany[id]).filter(Boolean);
    return {
      office: head, asOf: f.asOf, to: f.to, from: f.from, months: ctx.months, plMonths, period: periodsOut(f), basis: f.basis,
      badges: {
        balancesMatch: srcs.reduce((t, s) => t + (s.balances?.match || 0), 0), balancesDiffer: srcs.reduce((t, s) => t + (s.balances?.differ || 0), 0),
        lastChange: srcs.map((s) => s.lastChange).filter(Boolean).sort()[0] || null, pulled: srcs.filter((s) => s.pulled).length, errors: srcs.filter((s) => s.errors > 0).length,
        unbalanced: srcs.reduce((t, s) => t + (s.ledger?.unbalanced || 0), 0),
      },
      statement: { rows: statement.rows, memo: statement.memo, internal: statement.internal, internalPeriod: statement.internalPeriod, memoLabels: MEMO.map(([k, l]) => [k, l]) },
      balanceSheet: { asOf: f.asOf, prior: f.window.priorTo, sections },
      pl,
      trend,
      page: cfg.page,
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
    const book = canonicalBook(accountBook(db), ids); // one spelling per account across the office's companies
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

  // ---------- KPI dashboard ----------
  // Executive-style summary over the office statements of this instance: the header date range is the period (the
  // unfinished current month left out), compared with the same months a year earlier. Settings: config/kpi-dashboard.json.
  if (dashboard) router.get(`/${dashboard.path}`, wrap((req) => {
    const f = filtersOf(req);
    const to = f.asOf < f.to ? f.asOf : f.to;
    const from = f.from <= to ? f.from : to;
    const window = { key: 'range', label: `${from} to ${to}`, from, to, priorFrom: addMonths(from, -12), priorTo: addMonths(to, -12) };
    const f2 = { ...f, from, to, asOf: to, window };
    let offices = officesOf(req, f);
    if (dcfg.buckets) { const cat = categoryOf(companiesInScope(req.dashboardScope)); offices = offices.filter((o) => dcfg.buckets.includes(bucketOf(o, cfg.page.portfolio.buckets, cat))); }
    const ids = idsOf(offices);
    const book = canonicalBook(accountBook(db), ids); // one spelling per account across the office's companies
    const ctx = context(ids, f2, book);
    const months = ctx.months;
    ctx.months = monthsBetween(window.priorFrom, to); // statements carry last year's months too (same month last year)
    const figures = offices.map((o) => officeFigures(o, f2, ctx)).filter((o) => o.hasData);
    const d = buildDashboard({ offices: figures, months, rows: cfg.rows, dcfg });
    return {
      from, to, asOf: to, prior: { from: window.priorFrom, to: window.priorTo }, months, basis: f.basis,
      rows: cfg.rows.map(({ key, label, role }) => ({ key, label, role })),
      ...d, hasData: figures.length > 0,
      config: { ...dcfg, label: dashboard.label, base },
      source: (({ byCompany, ...s }) => s)(ctx.source),
    };
  }));

  return router;
}
