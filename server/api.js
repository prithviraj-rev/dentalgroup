// Read API for the dashboard.
import { Router } from 'express';
import { appConfig } from './config.js';
import { isMonth, bucketKey, bucketsFor } from './periods.js';
import { buildCoaTree } from './coa.js';

const GROUPS = appConfig.groups.order;
const round2 = (n) => Math.round(n * 100) / 100;

/** income = sum(incomeGroups); expenses = sum(expenseGroups); netIncome = income - expenses. */
export function derive(groups) {
  const sum = (keys) => keys.reduce((s, k) => s + (groups[k] || 0), 0);
  const income = sum(appConfig.groups.incomeGroups);
  const expenses = sum(appConfig.groups.expenseGroups);
  return { income: round2(income), expenses: round2(expenses), netIncome: round2(income - expenses) };
}

const emptyGroups = () => Object.fromEntries(GROUPS.map((g) => [g, 0]));
const roundGroups = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, round2(v)]));

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * office = all | <realmId> | <realmId>,<realmId>,... (compare mode, capped by compare.maxOffices)
 * Returns { offices: string[] | null } plus a WHERE fragment and its named params.
 */
function parseFilters(q) {
  const { granularities, defaultGranularity } = appConfig.dashboard;
  const granularity = granularities.includes(q.granularity) ? q.granularity : defaultGranularity;
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const from = isMonth(q.from) ? q.from : appConfig.dashboard.defaultRange.from;
  const to = isMonth(q.to) ? q.to : thisMonth;
  if (from > to) throw httpError(400, '`from` must be <= `to`');

  let offices = null;
  if (q.office && q.office !== 'all') {
    offices = [...new Set(String(q.office).split(',').map((s) => s.trim()).filter(Boolean))];
    if (offices.length === 0) offices = null;
    else if (offices.length > appConfig.compare.maxOffices) {
      throw httpError(400, `At most ${appConfig.compare.maxOffices} offices can be compared (compare.maxOffices in app.config.json)`);
    }
  }

  const params = { from, to };
  let where = 'WHERE substr(period_start, 1, 7) BETWEEN @from AND @to';
  if (offices) {
    offices.forEach((id, i) => { params[`o${i}`] = id; });
    where += ` AND office_realm_id IN (${offices.map((_, i) => `@o${i}`).join(', ')})`;
  }
  return { granularity, from, to, offices, where, params };
}

const officeParam = (offices) => (offices ? offices.join(',') : 'all');

export function createApiRouter(db) {
  const api = Router();

  // Behaviour config shared with the dashboard (never includes secrets).
  api.get('/config', (req, res) => res.json(appConfig));

  api.get('/offices', (req, res) => {
    const rows = db.prepare(`
      SELECT c.realm_id AS realmId, c.company_name AS officeName, c.connected_at AS connectedAt,
             (SELECT COUNT(*) FROM pl_lines p WHERE p.office_realm_id = c.realm_id) AS lineCount,
             (SELECT MAX(finished_at) FROM sync_logs s WHERE s.realm_id = c.realm_id AND s.status = 'success') AS lastSyncAt,
             (SELECT status FROM sync_logs s WHERE s.realm_id = c.realm_id ORDER BY id DESC LIMIT 1) AS lastSyncStatus
      FROM connections c ORDER BY c.company_name
    `).all();
    // colorIndex: stable palette slot per office (by name order) so colors follow the office, not the selection.
    res.json(rows.map((r, i) => ({ ...r, colorIndex: i })));
  });

  // Range of synced data + last sync, so the dashboard can pick sensible defaults.
  api.get('/meta', (req, res) => {
    const r = db.prepare(`
      SELECT MIN(substr(period_start, 1, 7)) AS minPeriod, MAX(substr(period_start, 1, 7)) AS maxPeriod,
             COUNT(*) AS lineCount FROM pl_lines
    `).get();
    const lastSync = db.prepare('SELECT MAX(finished_at) AS at FROM sync_logs').get()?.at || null;
    const connections = db.prepare('SELECT COUNT(*) AS n FROM connections').get().n;
    res.json({ ...r, lastSync, connections });
  });

  api.get('/sync/logs', (req, res) => {
    res.json(db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 50').all());
  });

  // Aggregated P&L for the selected office(s): per period and grp totals, income / expenses / netIncome
  // per period, and per-office per-period figures (for the office chart and compare mode).
  api.get('/pl', (req, res) => {
    let f;
    try { f = parseFilters(req.query); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
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
      granularity, from, to, office: officeParam(selected), selectedOffices: selected,
      periods, rows, totals, offices, hasData: monthly.length > 0,
    });
  });

  // Per-account totals for the breakdown table. Same filters as /pl.
  //   by=period (default): one column per period in the range
  //   by=office:           one column per selected office, totals over the range (compare mode)
  // Accounts are keyed by (grp, account_name) because account ids are only unique within one company.
  api.get('/pl/accounts', (req, res) => {
    let f;
    try { f = parseFilters(req.query); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
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
      granularity, from, to, office: officeParam(selected), by,
      periods: columns, // column descriptors: periods, or offices when by=office
      groups: GROUPS,
      accounts: list,
    });
  });

  // Raw chart of accounts for the selected office(s), straight from the `accounts` table.
  api.get('/accounts', (req, res) => {
    let f;
    try { f = parseFilters(req.query); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const { offices: selected, params } = f;
    const where = selected ? `WHERE office_realm_id IN (${selected.map((_, i) => `@o${i}`).join(', ')})` : '';
    const rows = db.prepare(`
      SELECT office_realm_id AS realmId, office_name AS officeName, account_id AS id, name, fully_qualified_name AS fullyQualifiedName,
             account_type AS accountType, account_sub_type AS accountSubType, classification, parent_id AS parentId,
             sub_account AS subAccount, active, current_balance AS currentBalance, currency, synced_at AS syncedAt
      FROM accounts ${where} ORDER BY office_name, fully_qualified_name
    `).all(params);
    res.json({ office: officeParam(selected), count: rows.length, accounts: rows.map((r) => ({ ...r, subAccount: Boolean(r.subAccount), active: Boolean(r.active) })) });
  });

  // P&L laid out on the chart of accounts. Same filters as /pl, plus balanceSheet=1 to include
  // Asset / Liability / Equity accounts (with their current balance, no period amounts).
  api.get('/coa', (req, res) => {
    let f;
    try { f = parseFilters(req.query); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
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
      granularity, from, to, office: officeParam(selected), includeBalanceSheet,
      periods: buckets,
      merged: Math.max(officeCount, accountOffices) > 1,
      hasAccounts: accounts.length > 0,
      hasData: lines.length > 0,
      ...tree,
    });
  });

  return api;
}
