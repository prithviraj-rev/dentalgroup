// Read API for the dashboard.
import { Router } from 'express';
import { appConfig } from './config.js';
import { isMonth, bucketKey, bucketsFor, addMonths } from './periods.js';
import { buildCoaTree } from './coa.js';
import { deriveAll, metricDefs, linear, validateMetrics } from './metrics.js';
import { loadCategories, assignCategories } from './categories.js';
import { loadExecutiveConfig, executiveData, publicExecutiveConfig } from './executive.js';

const GROUPS = appConfig.groups.order;
const round2 = (n) => Math.round(n * 100) / 100;

/** Every configured metric (income, expenses, netIncome, gross profit, margins, ...) for a { grp: amount } map. */
export const derive = (groups) => deriveAll(groups);

const emptyGroups = () => Object.fromEntries(GROUPS.map((g) => [g, 0]));
const roundGroups = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, round2(v)]));

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * office = all | <realmId> | <realmId>,<realmId>,... (compare mode, capped by compare.maxOffices)
 * Returns { offices: string[] | null } plus a WHERE fragment and its named params.
 */
/**
 * scope: null = every company; otherwise { realms: [...] } from the caller's platform session. The office
 * filter is intersected with it, and "all" means "all companies in scope".
 */
export function parseFilters(q, scope = null) {
  const { granularities, defaultGranularity } = appConfig.dashboard;
  const granularity = granularities.includes(q.granularity) ? q.granularity : defaultGranularity;
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const to = isMonth(q.to) ? q.to : thisMonth;
  const defFrom = appConfig.dashboard.defaultRange.from;
  const from = isMonth(q.from) ? q.from : defFrom <= to ? defFrom : addMonths(to, -11);
  if (from > to) throw httpError(400, '`from` must be <= `to`');

  let offices = null;
  if (q.office && q.office !== 'all') {
    offices = [...new Set(String(q.office).split(',').map((s) => s.trim()).filter(Boolean))];
    if (offices.length === 0) offices = null;
    else if (appConfig.compare.maxOffices != null && offices.length > appConfig.compare.maxOffices) {
      throw httpError(400, `At most ${appConfig.compare.maxOffices} offices can be compared (compare.maxOffices in app.config.json)`);
    }
  }
  const requestedAll = !offices;
  if (scope) {
    const allowed = new Set(scope.realms);
    offices = offices ? offices.filter((id) => allowed.has(id)) : [...allowed];
    if (offices.length === 0) offices = ['__none__']; // nothing visible: match no rows
  }

  const params = { from, to };
  let where = 'WHERE substr(period_start, 1, 7) BETWEEN @from AND @to';
  if (offices) {
    offices.forEach((id, i) => { params[`o${i}`] = id; });
    where += ` AND office_realm_id IN (${offices.map((_, i) => `@o${i}`).join(', ')})`;
  }
  return { granularity, from, to, offices, where, params, requestedAll };
}

const officeParam = (offices, requestedAll = false) => (!offices || requestedAll ? 'all' : offices.join(','));

export function createApiRouter(db) {
  const api = Router();
  validateMetrics(appConfig);
  const categories = loadCategories();
  const executive = loadExecutiveConfig();
  const DIM_LABELS = appConfig.analysis.dimensionLabels || {};

  const inScope = (scope) => (scope ? ((id) => scope.realms.includes(id)) : () => true);
  const allOffices = (scope = null) => db.prepare(`
    SELECT realm_id AS realmId, company_name AS officeName FROM connections
    UNION SELECT DISTINCT office_realm_id, office_name FROM pl_lines WHERE office_realm_id NOT IN (SELECT realm_id FROM connections)`).all()
    .filter((o) => inScope(scope)(o.realmId));

  // Office categories per dimension: [{ id, label, categories: [{ label, realmIds }] }]
  api.get('/office-categories', (req, res) => {
    const offices = allOffices(req.dashboardScope);
    res.json({
      dimensions: categories.dimensions.map((d) => {
        const map = assignCategories(db, d, offices);
        const by = {};
        for (const o of offices) (by[map[o.realmId]] ||= []).push(o.realmId);
        return {
          id: d.id, label: d.label,
          categories: Object.entries(by).map(([label, realmIds]) => ({ label, realmIds })).sort((a, b) => (a.label === d.otherLabel) - (b.label === d.otherLabel) || a.label.localeCompare(b.label)),
        };
      }),
    });
  });

  /**
   * One metric broken down by a dimension, per period.
   *   by = office | category:<id> | grp | accountType | accountSubType | account
   *   metric = any key in app.config.json metrics (sums and ratios)
   * Same filters as /pl. Rows are every group with per-period values and a total, largest first.
   */
  api.get('/breakdown', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { granularity, from, to, offices: selected, where, params } = f;
    const defs = metricDefs();
    const metric = defs[req.query.metric] ? req.query.metric : appConfig.analysis.defaultMetric;
    const def = defs[metric];
    const by = String(req.query.by || appConfig.analysis.defaultBy);
    const catDim = by.startsWith('category:') ? categories.dimensions.find((d) => d.id === by.slice(9)) : null;
    if (!['office', 'grp', 'accountType', 'accountSubType', 'account'].includes(by) && !catDim) {
      return res.status(400).json({ error: `Unknown group-by "${by}"` });
    }

    const keyExpr = {
      office: 'p.office_realm_id',
      grp: 'p.grp',
      accountType: "COALESCE(a.account_type, 'Not in chart of accounts')",
      accountSubType: "COALESCE(NULLIF(a.account_sub_type, ''), 'No detail type')",
      account: 'p.account_name',
    }[catDim ? 'office' : by];
    const whereP = where.replace(/\bperiod_start\b/g, 'p.period_start').replace(/\boffice_realm_id\b/g, 'p.office_realm_id');
    const rows = db.prepare(`
      SELECT ${keyExpr} AS k, substr(p.period_start, 1, 7) AS month, p.grp, SUM(p.amount) AS amount
      FROM pl_lines p LEFT JOIN accounts a ON a.office_realm_id = p.office_realm_id AND a.account_id = p.account_id
      ${whereP} GROUP BY k, month, p.grp`).all(params);

    // Labels for keys.
    const offices = allOffices(req.dashboardScope);
    const officeName = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
    const catOf = catDim ? assignCategories(db, catDim, offices) : null;
    const labelOf = (k) => {
      if (catOf) return catOf[k] || catDim.otherLabel;
      if (by === 'office') return officeName[k] || k;
      if (by === 'grp') return appConfig.groups.labels[k] || k;
      return k;
    };

    const buckets = bucketsFor(from, to, granularity);
    const series = new Map(); // label -> { periods: { bucket: {grp: amt} }, total: {grp: amt} }
    for (const r of rows) {
      // Offices are keyed by company id (two companies may share a name); everything else by its label.
      const key = by === 'office' ? r.k : labelOf(r.k);
      if (!series.has(key)) series.set(key, { label: labelOf(r.k), periods: Object.fromEntries(buckets.map((b) => [b.key, {}])), total: {} });
      const s = series.get(key);
      const bk = bucketKey(r.month, granularity);
      if (!s.periods[bk]) continue;
      s.periods[bk][r.grp] = (s.periods[bk][r.grp] || 0) + r.amount;
      s.total[r.grp] = (s.total[r.grp] || 0) + r.amount;
    }

    const value = (groups) => (def.kind === 'ratio' ? deriveAll(groups)[metric] : round2(linear(def, groups)));
    const relevant = def.kind === 'sum'
      ? (s) => Object.keys(s.total).some((g) => def.formula[g])
      : (s) => Object.keys(s.total).length > 0;
    const out = [...series.entries()].filter(([, s]) => relevant(s)).map(([key, s]) => ({
      key, label: s.label,
      periods: Object.fromEntries(Object.entries(s.periods).map(([k, g]) => [k, Object.keys(g).length ? value(g) : null])),
      total: value(s.total),
    }));
    out.sort((a, b) => Math.abs(b.total ?? 0) - Math.abs(a.total ?? 0));

    const allGroups = {};
    const perPeriod = Object.fromEntries(buckets.map((b) => [b.key, {}]));
    for (const s of series.values()) {
      for (const [g, v] of Object.entries(s.total)) allGroups[g] = (allGroups[g] || 0) + v;
      for (const [bk, gs] of Object.entries(s.periods)) for (const [g, v] of Object.entries(gs)) perPeriod[bk][g] = (perPeriod[bk][g] || 0) + v;
    }

    res.json({
      granularity, from, to, office: officeParam(selected, f.requestedAll), by, metric,
      metricDef: { key: metric, label: def.label, format: def.format, kind: def.kind, upIsGood: def.upIsGood },
      byLabel: catDim ? catDim.label : DIM_LABELS[by] || by,
      periods: buckets.map((b) => ({ key: b.key, label: b.label })),
      rows: out,
      totals: { periods: Object.fromEntries(Object.entries(perPeriod).map(([k, g]) => [k, Object.keys(g).length ? value(g) : null])), total: value(allGroups) },
      hasData: rows.length > 0,
    });
  });

  // Behaviour config shared with the dashboard (never includes secrets).
  api.get('/config', (req, res) => res.json({ ...appConfig, executiveView: publicExecutiveConfig(executive) }));

  // Executive view: KPIs, trend, per-office performance, payer mix, cost structure, movers vs last year.
  api.get('/executive', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const data = executiveData(db, executive, f);
    const offices = data.offices.map((o) => ({ realmId: o.realmId, officeName: o.officeName }));
    const cats = {};
    for (const d of categories.dimensions) cats[d.id] = assignCategories(db, d, offices);
    res.json({ ...data, offices: data.offices.map((o) => ({ ...o, categories: Object.fromEntries(Object.entries(cats).map(([k, m]) => [k, m[o.realmId]])) })) });
  });

  api.get('/offices', (req, res) => {
    const rows = db.prepare(`
      SELECT c.realm_id AS realmId, c.company_name AS officeName, c.legal_name AS legalName, c.city, c.state, c.connected_at AS connectedAt,
             (SELECT COUNT(*) FROM pl_lines p WHERE p.office_realm_id = c.realm_id) AS lineCount,
             (SELECT MAX(finished_at) FROM sync_logs s WHERE s.realm_id = c.realm_id AND s.status = 'success') AS lastSyncAt,
             (SELECT status FROM sync_logs s WHERE s.realm_id = c.realm_id ORDER BY id DESC LIMIT 1) AS lastSyncStatus
      FROM connections c ORDER BY c.company_name
    `).all().filter((r) => inScope(req.dashboardScope)(r.realmId));
    // colorIndex: stable palette slot per office (by name order) so colors follow the office, not the selection.
    res.json(rows.map((r, i) => ({ ...r, colorIndex: i })));
  });

  // Range of synced data + last sync, so the dashboard can pick sensible defaults.
  api.get('/meta', (req, res) => {
    const scope = req.dashboardScope;
    const ids = scope ? scope.realms : null;
    const list = ids ? `IN (${ids.map(() => '?').join(',') || "''"})` : null;
    const r = db.prepare(`
      SELECT MIN(substr(period_start, 1, 7)) AS minPeriod, MAX(substr(period_start, 1, 7)) AS maxPeriod,
             COUNT(*) AS lineCount FROM pl_lines ${list ? `WHERE office_realm_id ${list}` : ''}
    `).get(...(ids || []));
    const lastSync = db.prepare(`SELECT MAX(finished_at) AS at FROM sync_logs ${list ? `WHERE realm_id ${list}` : ''}`).get(...(ids || []))?.at || null;
    const connections = db.prepare(`SELECT COUNT(*) AS n FROM connections ${list ? `WHERE realm_id ${list}` : ''}`).get(...(ids || [])).n;
    // What the caller may do, so the dashboard can hide buttons the server would refuse.
    const can = { sync: !scope || scope.canSync, connect: !scope || scope.canManage, manageConnections: !scope };
    res.json({ ...r, lastSync, connections, can });
  });

  api.get('/sync/logs', (req, res) => {
    res.json(db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 200').all().filter((l) => inScope(req.dashboardScope)(l.realm_id)).slice(0, 50));
  });

  // Aggregated P&L for the selected office(s): per period and grp totals, income / expenses / netIncome
  // per period, and per-office per-period figures (for the office chart and compare mode).
  api.get('/pl', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { granularity, from, to, offices: selected, where, params } = f;

    const buckets = bucketsFor(from, to, granularity);
    const byKey = new Map(buckets.map((b) => [b.key, { ...b, groups: emptyGroups() }]));

    const monthly = db.prepare(`
      SELECT substr(period_start, 1, 7) AS month, grp, SUM(amount) AS amount
      FROM pl_lines ${where} GROUP BY month, grp
    `).all(params);
    for (const r of monthly) {
      const b = byKey.get(bucketKey(r.month, granularity));
      if (b) b.groups[r.grp] = (b.groups[r.grp] || 0) + r.amount;
    }

    const periods = [...byKey.values()].map((b) => {
      const groups = roundGroups(b.groups);
      return { key: b.key, label: b.label, months: b.months.length, groups, ...derive(groups) };
    });
    const rows = periods.flatMap((p) => GROUPS.map((grp) => ({ period: p.key, grp, amount: p.groups[grp] })));

    const totalGroups = emptyGroups();
    for (const p of periods) for (const [k, v] of Object.entries(p.groups)) totalGroups[k] += v;
    const totals = { groups: roundGroups(totalGroups), ...derive(totalGroups) };

    const perOffice = db.prepare(`
      SELECT office_realm_id AS realmId, office_name AS officeName, substr(period_start, 1, 7) AS month, grp, SUM(amount) AS amount
      FROM pl_lines ${where} GROUP BY office_realm_id, office_name, month, grp ORDER BY office_name
    `).all(params);
    const map = new Map();
    for (const r of perOffice) {
      if (!map.has(r.realmId)) {
        map.set(r.realmId, {
          realmId: r.realmId, officeName: r.officeName,
          periods: Object.fromEntries(buckets.map((b) => [b.key, emptyGroups()])),
        });
      }
      const slot = map.get(r.realmId).periods[bucketKey(r.month, granularity)];
      if (slot) slot[r.grp] = (slot[r.grp] || 0) + r.amount;
    }
    const offices = [...map.values()].map((o) => {
      const sum = emptyGroups();
      for (const g of Object.values(o.periods)) for (const [k, v] of Object.entries(g)) sum[k] += v;
      return {
        realmId: o.realmId,
        officeName: o.officeName,
        periods: Object.fromEntries(Object.entries(o.periods).map(([k, g]) => [k, derive(g)])),
        totals: { groups: roundGroups(sum), ...derive(sum) },
      };
    });
    // Keep the caller's order in compare mode so the UI can line things up with its selection.
    if (selected) offices.sort((a, b) => selected.indexOf(a.realmId) - selected.indexOf(b.realmId));

    res.json({
      granularity, from, to, office: officeParam(selected, f.requestedAll), selectedOffices: selected,
      periods, rows, totals, offices, hasData: monthly.length > 0,
    });
  });

  // Per-account totals for the breakdown table. Same filters as /pl.
  //   by=period (default): one column per period in the range
  //   by=office:           one column per selected office, totals over the range (compare mode)
  // Accounts are keyed by (grp, account_name) because account ids are only unique within one company.
  api.get('/pl/accounts', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { granularity, from, to, offices: selected, where, params } = f;
    const by = req.query.by === 'office' ? 'office' : 'period';

    let columns;
    let rows;
    if (by === 'office') {
      const officeRows = db.prepare(`
        SELECT DISTINCT office_realm_id AS realmId, office_name AS officeName FROM pl_lines ${where} ORDER BY office_name
      `).all(params);
      if (selected) officeRows.sort((a, b) => selected.indexOf(a.realmId) - selected.indexOf(b.realmId));
      columns = officeRows.map((o) => ({ key: o.realmId, label: o.officeName }));
      rows = db.prepare(`
        SELECT grp, account_name AS accountName, office_realm_id AS col, SUM(amount) AS amount,
               GROUP_CONCAT(DISTINCT account_id) AS accountIds
        FROM pl_lines ${where} GROUP BY grp, account_name, office_realm_id
      `).all(params);
    } else {
      columns = bucketsFor(from, to, granularity).map((b) => ({ key: b.key, label: b.label }));
      rows = db.prepare(`
        SELECT grp, account_name AS accountName, substr(period_start, 1, 7) AS col, SUM(amount) AS amount,
               GROUP_CONCAT(DISTINCT account_id) AS accountIds
        FROM pl_lines ${where} GROUP BY grp, account_name, col
      `).all(params).map((r) => ({ ...r, col: bucketKey(r.col, granularity) }));
    }

    const accounts = new Map();
    for (const r of rows) {
      const key = `${r.grp}|${r.accountName}`;
      if (!accounts.has(key)) {
        accounts.set(key, {
          grp: r.grp, accountName: r.accountName, accountIds: new Set(),
          periods: Object.fromEntries(columns.map((c) => [c.key, 0])), total: 0,
        });
      }
      const a = accounts.get(key);
      String(r.accountIds || '').split(',').filter(Boolean).forEach((id) => a.accountIds.add(id));
      if (r.col in a.periods) { a.periods[r.col] += r.amount; a.total += r.amount; }
    }

    const list = [...accounts.values()]
      .map((a) => ({
        ...a,
        accountIds: [...a.accountIds],
        periods: roundGroups(a.periods),
        total: round2(a.total),
      }))
      .sort((a, b) => GROUPS.indexOf(a.grp) - GROUPS.indexOf(b.grp) || Math.abs(b.total) - Math.abs(a.total));

    res.json({
      granularity, from, to, office: officeParam(selected, f.requestedAll), by,
      periods: columns, // column descriptors: periods, or offices when by=office
      groups: GROUPS,
      accounts: list,
    });
  });

  // Raw chart of accounts for the selected office(s), straight from the `accounts` table.
  api.get('/accounts', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { offices: selected, params } = f;
    const where = selected ? `WHERE office_realm_id IN (${selected.map((_, i) => `@o${i}`).join(', ')})` : '';
    const rows = db.prepare(`
      SELECT office_realm_id AS realmId, office_name AS officeName, account_id AS id, name, fully_qualified_name AS fullyQualifiedName,
             account_type AS accountType, account_sub_type AS accountSubType, classification, parent_id AS parentId,
             sub_account AS subAccount, active, current_balance AS currentBalance, currency, synced_at AS syncedAt
      FROM accounts ${where} ORDER BY office_name, fully_qualified_name
    `).all(params);
    res.json({ office: officeParam(selected, f.requestedAll), count: rows.length, accounts: rows.map((r) => ({ ...r, subAccount: Boolean(r.subAccount), active: Boolean(r.active) })) });
  });

  // P&L laid out on the chart of accounts. Same filters as /pl, plus balanceSheet=1 to include
  // Asset / Liability / Equity accounts (with their current balance, no period amounts).
  api.get('/coa', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { granularity, from, to, offices: selected, where, params } = f;
    const includeBalanceSheet = req.query.balanceSheet === '1' || req.query.balanceSheet === 'true';
    const buckets = bucketsFor(from, to, granularity).map((b) => ({ key: b.key, label: b.label }));

    const officeWhere = selected ? `WHERE office_realm_id IN (${selected.map((_, i) => `@o${i}`).join(', ')})` : '';
    const accounts = db.prepare(`SELECT * FROM accounts ${officeWhere}`).all(params);
    const officeCount = db.prepare(`SELECT COUNT(DISTINCT office_realm_id) AS n FROM pl_lines ${where}`).get(params).n;
    const accountOffices = new Set(accounts.map((a) => a.office_realm_id)).size;

    const lines = db.prepare(`
      SELECT office_realm_id AS realmId, account_id AS accountId, account_name AS accountName, grp,
             substr(period_start, 1, 7) AS month, SUM(amount) AS amount
      FROM pl_lines ${where} GROUP BY office_realm_id, account_id, account_name, grp, month
    `).all(params).map((l) => ({ ...l, period: bucketKey(l.month, granularity) }));

    const tree = buildCoaTree({ accounts, lines, buckets, merge: Math.max(officeCount, accountOffices) > 1, includeBalanceSheet });
    res.json({
      granularity, from, to, office: officeParam(selected, f.requestedAll), includeBalanceSheet,
      periods: buckets,
      merged: Math.max(officeCount, accountOffices) > 1,
      hasAccounts: accounts.length > 0,
      hasData: lines.length > 0,
      ...tree,
    });
  });

  return api;
}
