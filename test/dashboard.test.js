import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOfficesConfig } from '../server/offices/config.js';
import { loadAppConfig } from '../server/config.js';
import { buildStatement, periodWindow } from '../server/offices/offices.js';
import { loadDashboardConfig, buildDashboard, metricDef } from '../server/offices/dashboard.js';
import { monthsBetween } from '../server/periods.js';

const sheet = loadOfficesConfig(path.resolve('config/offices-sheet.json'));
const tmp = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-')), 'kpi-dashboard.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
const base = JSON.parse(fs.readFileSync(new URL('../config/kpi-dashboard.json', import.meta.url), 'utf8'));

test('kpi-dashboard config: every metric is a statement row of the source config; bad keys fail naming the key', () => {
  const d = loadDashboardConfig(path.resolve('config/kpi-dashboard.json'), sheet.rows);
  assert.deepEqual(d.tiles.map((t) => [t.key, t.format, t.upIsGood]), [['netCollections', 'money', true], ['officeEbitda', 'money', true], ['pct:officeEbitda', 'percent', true], ['operatingCashFlow', 'money', true]]);
  assert.equal(d.tiles[2].label, 'Office EBITDA % of collections');
  assert.ok(d.shares.every((s) => s.upIsGood === false), 'cost rows: up is bad');
  assert.equal(d.leaderboard.defaultSort, 'netCollections');
  assert.deepEqual(d.costStructure.rows.map((r) => r.key), ['providerComp', 'staffPayroll', 'trainingHiring', 'marketing', 'dentalSupplies', 'laboratory', 'occupancy', 'legalProfessional', 'otherExpenses', 'managementFees'], 'empty list = every cost, other and fees row in statement order');
  assert.throws(() => loadDashboardConfig(tmp({ ...base, tiles: ['nope'] }), sheet.rows), /tiles "nope" is not a row key/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, tiles: ['pct:netCollections'] }), sheet.rows), /% of itself/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, shares: ['pct:providerComp'] }), sheet.rows), /shares "pct:providerComp" must be a money row/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, leaderboard: { ...base.leaderboard, defaultSort: 'officeEbitda', columns: ['netCollections'] } }), sheet.rows), /leaderboard.defaultSort/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, heatmap: { metric: 'pct:officeEbitda', clampPercent: 0 } }), sheet.rows), /heatmap.clampPercent/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, costStructure: { rows: ['netCollections'] } }), sheet.rows), /costStructure.rows "netCollections"/);
  assert.throws(() => loadDashboardConfig(tmp({ ...base, movers: { count: 0 } }), sheet.rows), /movers.count/);
  assert.equal(metricDef('partnerWithdrawal', sheet.rows, 'x', 'f').upIsGood, null, 'item rows are neutral');
  // app.config.json: the tab block.
  const app = loadAppConfig();
  assert.equal(app.kpiDashboard.source, 'officesSheet');
  const appTmp = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-app-')), 'app.config.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  assert.throws(() => loadAppConfig(appTmp({ kpiDashboard: { source: 'sheet' } })), /kpiDashboard.source/);
  assert.throws(() => loadAppConfig(appTmp({ kpiDashboard: { apiPath: 'office-sheet' } })), /kpiDashboard.apiPath/);
});

const office = (key, companies) => ({ key, name: key, city: null, state: null, companies: companies.map((realmId) => ({ realmId, name: realmId })), aliases: [] });
const L = (realmId, month, grp, account, amount, fullName = null) => ({ realmId, month, grp, accountId: account, account, fullName: fullName || account, entity: null, amount });

test('kpi dashboard: per-office and portfolio metrics, % of collections, same month last year, movers', () => {
  const dcfg = loadDashboardConfig(path.resolve('config/kpi-dashboard.json'), sheet.rows);
  const window = { from: '2026-04', to: '2026-05', priorFrom: '2025-04', priorTo: '2025-05' };
  const stMonths = monthsBetween('2025-04', '2026-05');
  const months = ['2026-04', '2026-05'];
  const A = office('a', ['A']);
  const B = office('b', ['B']);
  const linesA = [
    L('A', '2026-04', 'Income', '402.1 Cash', 1000, '402 Income:402.1 Cash'), L('A', '2026-05', 'Income', '402.1 Cash', 1000, '402 Income:402.1 Cash'),
    L('A', '2025-04', 'Income', '402.1 Cash', 800, '402 Income:402.1 Cash'), L('A', '2025-05', 'Income', '402.1 Cash', 800, '402 Income:402.1 Cash'),
    L('A', '2026-04', 'Expenses', '521 Dental Supplies', 100), L('A', '2026-05', 'Expenses', '521 Dental Supplies', 100),
    L('A', '2025-04', 'Expenses', '521 Dental Supplies', 50), L('A', '2025-05', 'Expenses', '521 Dental Supplies', 50),
    L('A', '2026-05', 'Expenses', '650 Management Fee', 200),
    L('A', '2026-05', 'OtherExpenses', '802.1 Management Profit', 300, '802 Profits:802.1 Management Profit'),
  ];
  const linesB = [
    L('B', '2026-04', 'Income', '402.1 Cash', 500, '402 Income:402.1 Cash'),
    L('B', '2026-04', 'Expenses', '536 Lab Fees', 250),
  ];
  const fig = (o, lines, cashFlow) => ({ ...o, flags: [], cash: null, statement: buildStatement(lines, o, sheet, { window, months: stMonths, cashFlow }) });
  const d = buildDashboard({ offices: [fig(A, linesA, { '2026-04': 10, '2026-05': 20 }), fig(B, linesB, {})], months, rows: sheet.rows, dcfg });

  const a = d.offices.find((o) => o.key === 'a').values;
  assert.deepEqual(a.netCollections, { period: 2000, prior: 1600, monthly: { '2026-04': 1000, '2026-05': 1000 }, priorMonthly: { '2026-04': 800, '2026-05': 800 } });
  assert.equal(a.officeEbitda.period, 2000 - 200 - 200, 'collections - supplies - fees; the partner withdrawal (item row) is outside EBITDA');
  assert.equal(a.partnerWithdrawal.period, 300);
  assert.deepEqual(a['pct:dentalSupplies'], { period: 0.1, prior: 0.0625, monthly: { '2026-04': 0.1, '2026-05': 0.1 }, priorMonthly: { '2026-04': 0.0625, '2026-05': 0.0625 } });
  assert.equal(a.operatingCashFlow.period, 30);
  const b = d.offices.find((o) => o.key === 'b').values;
  assert.equal(b['pct:laboratory'].monthly['2026-05'], null, 'no collections that month: no percentage');
  assert.equal(b.netCollections.priorMonthly['2026-04'], 0, 'nothing booked last year');

  assert.equal(d.totals.netCollections.period, 2500);
  assert.equal(d.totals.netCollections.priorMonthly['2026-04'], 800, 'portfolio same month last year');
  assert.equal(d.totals['pct:laboratory'].period, 0.1, '250 / 2500');
  assert.equal(d.totals['pct:officeEbitda'].period, (1600 + 250) / 2500);

  const m = Object.fromEntries(d.movers.map((x) => [x.account, x]));
  assert.equal(m['402 Income'].impact, 2500 - 1600, 'collections up helps');
  assert.equal(m['521 Dental Supplies'].impact, -(200 - 100), 'costs up hurts');
  assert.equal(m['650 Management Fee'].impact, -200);
  assert.ok(!m['802.1 Management Profit'], 'item rows are not movers');
  assert.equal(d.movers[0].account, '402 Income', 'largest first');
  assert.ok(d.metrics.some((x) => x.key === 'pct:officeEbitda' && x.format === 'percent'));
});
