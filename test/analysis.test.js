import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOfficesConfig } from '../server/offices/config.js';
import { loadAppConfig } from '../server/config.js';
import { analyze, metricDefs } from '../server/offices/analysis.js';
import { bucketsFor } from '../server/periods.js';

const cfg = loadOfficesConfig();
const app = loadAppConfig();

test('analysis metrics in app.config.json are office statement rows; bad keys fail naming the key', () => {
  const defs = metricDefs(app.analysis, cfg.rows);
  assert.ok(defs.find((d) => d.key === 'netCollections' && d.format === 'money' && d.account === true));
  assert.ok(defs.find((d) => d.key === 'pct:officeEbitda' && d.format === 'percent' && d.account === false));
  assert.throws(() => metricDefs({ ...app.analysis, metrics: ['nope'] }, cfg.rows), /analysis.metrics "nope"/);
  assert.throws(() => metricDefs({ ...app.analysis, metrics: ['pct:netCollections'] }, cfg.rows), /% of itself/);
  assert.throws(() => metricDefs({ ...app.analysis, percentOf: 'officeEbitda' }, cfg.rows), /analysis.percentOf/);
  const tmp = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-')), 'app.config.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  assert.throws(() => loadAppConfig(tmp({ analysis: { metrics: ['pct:'] } })), /analysis.metrics has invalid/);
  assert.throws(() => loadAppConfig(tmp({ analysis: { dimensions: ['office', 'grp'] } })), /analysis.dimensions/);
});

// Two offices, two months. Statements as buildStatement() returns them (rows with months and children).
const row = (key, role, months, children = []) => ({ key, role, label: key, months, children });
const stA = { rows: [
  row('netCollections', 'collections', { '2026-01': 1000, '2026-02': 2000 }),
  row('providerComp', 'cost', { '2026-01': 300, '2026-02': 500 }, [
    { fullName: "500 Doctor's payroll", account: "500 Doctor's payroll", months: { '2026-01': 250, '2026-02': 400 } },
    { fullName: 'Payroll taxes, share allocated to this row', account: 'Payroll taxes (allocated)', allocated: true, months: { '2026-01': 50, '2026-02': 100 } },
  ]),
  row('staffPayroll', 'cost', { '2026-01': 100, '2026-02': 100 }),
  row('otherExpenses', 'other', { '2026-01': 50, '2026-02': 50 }),
  row('ebitdaBeforeFees', 'feesSubtotal', { '2026-01': 550, '2026-02': 1350 }),
  row('managementFees', 'fees', { '2026-01': 100, '2026-02': 100 }),
  row('officeEbitda', 'ebitda', { '2026-01': 450, '2026-02': 1250 }),
] };
const stB = { rows: [
  row('netCollections', 'collections', { '2026-01': 0, '2026-02': 1000 }),
  row('providerComp', 'cost', { '2026-01': 200, '2026-02': 200 }, [
    { fullName: '501 Associate Dentist', account: '501 Associate Dentist', months: { '2026-01': 200, '2026-02': 200 } },
  ]),
  row('staffPayroll', 'cost', { '2026-01': 0, '2026-02': 0 }),
  row('otherExpenses', 'other', { '2026-01': 0, '2026-02': 0 }),
  row('ebitdaBeforeFees', 'feesSubtotal', { '2026-01': -200, '2026-02': 800 }),
  row('managementFees', 'fees', { '2026-01': 0, '2026-02': 0 }),
  row('officeEbitda', 'ebitda', { '2026-01': -200, '2026-02': 800 }),
] };
const offices = [{ key: 'a', name: 'Office A', companies: [{ realmId: '1' }] }, { key: 'b', name: 'Office B', companies: [{ realmId: '2' }] }];
const statementOf = (o) => (o.key === 'a' ? stA : stB);
const months = bucketsFor('2026-01', '2026-02', 'month');
const base = { offices, statementOf, buckets: months, percentOf: 'netCollections' };

test('by office: amounts and % of collections, sorted largest first, group totals', () => {
  const amt = analyze({ ...base, metric: 'providerComp', by: 'office' });
  assert.deepEqual(amt.rows.map((r) => [r.label, r.periods['2026-01'], r.periods['2026-02'], r.total]), [['Office A', 300, 500, 800], ['Office B', 200, 200, 400]]);
  assert.deepEqual(amt.totals, { periods: { '2026-01': 500, '2026-02': 700 }, total: 1200 });
  const pct = analyze({ ...base, metric: 'pct:providerComp', by: 'office' });
  const b = pct.rows.find((r) => r.key === 'b');
  assert.equal(b.periods['2026-01'], null, 'no collections -> no ratio');
  assert.equal(b.periods['2026-02'], 0.2);
  assert.equal(b.total, 0.4);
  assert.equal(pct.totals.periods['2026-01'], 0.5, '500 / 1000 (B has no collections in January)');
  assert.equal(pct.totals.total, 0.3, '1200 / 4000');
  assert.equal(pct.hasData, true);
});

test('by category merges offices; by row lists every cost row; by account merges accounts across offices', () => {
  const cat = analyze({ ...base, metric: 'officeEbitda', by: 'category', categoryOf: () => 'Dental Companies' });
  assert.deepEqual(cat.rows, [{ key: 'Dental Companies', label: 'Dental Companies', periods: { '2026-01': 250, '2026-02': 2050 }, total: 2300 }]);
  const rows = analyze({ ...base, metric: 'providerComp', by: 'row' });
  assert.deepEqual(rows.rows.map((r) => [r.key, r.total]), [['providerComp', 1200], ['managementFees', 200], ['staffPayroll', 200], ['otherExpenses', 100]], 'largest first, ties by label');
  assert.equal(rows.totals.total, 1700, 'all costs');
  const rowsPct = analyze({ ...base, metric: 'pct:providerComp', by: 'row' });
  assert.equal(rowsPct.totals.total, 0.425, 'all costs / all collections = 1700 / 4000');
  assert.equal(rowsPct.rows.find((r) => r.key === 'providerComp').total, 0.3);
  const acc = analyze({ ...base, metric: 'providerComp', by: 'account' });
  assert.deepEqual(acc.rows.map((r) => [r.label, r.total]), [["500 Doctor's payroll", 650], ['501 Associate Dentist', 400], ['Payroll taxes, share allocated to this row', 150]]);
  assert.equal(acc.totals.total, 1200);
  const accPct = analyze({ ...base, metric: 'pct:providerComp', by: 'account' });
  assert.equal(accPct.totals.total, 0.3, 'row / collections');
});

test('quarter buckets and empty selections', () => {
  const q = analyze({ ...base, buckets: bucketsFor('2026-01', '2026-02', 'quarter'), metric: 'netCollections', by: 'office' });
  assert.deepEqual(q.rows.map((r) => [r.key, r.periods['2026-Q1']]), [['a', 3000], ['b', 1000]]);
  assert.deepEqual(q.totals, { periods: { '2026-Q1': 4000 }, total: 4000 }, 'totals are summed per bucket, not per month');
  const y = analyze({ ...base, buckets: bucketsFor('2026-01', '2026-02', 'year'), metric: 'pct:providerComp', by: 'row' });
  assert.equal(y.totals.total, 0.425);
  assert.equal(y.totals.periods['2026'], 0.425);
  const none = analyze({ ...base, offices: [], metric: 'netCollections', by: 'office' });
  assert.equal(none.hasData, false);
  assert.deepEqual(none.rows, []);
});
