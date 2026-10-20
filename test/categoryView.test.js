import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, upsertPlLines } from '../server/db.js';
import { appConfig } from '../server/config.js';
import { loadCategoryViewConfig, classifyLine, categoryViewData, publicCategoryViewConfig } from '../server/categoryView.js';
import { nextRunAt, validateSchedule } from '../server/scheduler.js';
import { seedLedger } from './fixtures/seed-ledger.js';
import { buildEntities, columnsFor, headline, measureValue, median, shadeAgainst, toCsv } from '../web/src/categoryMath.js';

const line = (account_id, account_name, grp, month, amount) => ({
  account_id, account_name, grp, period_start: `${month}-01`, period_end: `${month}-28`, amount,
});
const filters = (from, to, granularity = 'month') => ({ from, to, granularity, where: 'WHERE substr(period_start, 1, 7) BETWEEN @from AND @to', params: { from, to } });

test('the shipped category-view config loads and every expense category has a group', () => {
  const cv = loadCategoryViewConfig();
  assert.ok(cv.expense.rules.length > 5);
  const groups = new Set(cv.groups.map((g) => g.label));
  for (const r of cv.expense.rules) assert.ok(groups.has(r.group), r.label);
  const pub = publicCategoryViewConfig(cv);
  assert.ok(pub.revenue.some((c) => c.otherIncome), 'other income is its own revenue category');
  assert.equal(JSON.stringify(pub).includes('"re"'), false, 'no regexes leak to the browser');
});

test('bad category-view configs fail with the key named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  const write = (obj) => { const f = path.join(dir, `c${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const base = { groups: [{ label: 'G' }], expense: { other: { label: 'O', group: 'G' }, categories: [{ label: 'A', group: 'G', accounts: 'a' }] }, revenue: { categories: [] } };
  assert.throws(() => loadCategoryViewConfig(write({ ...base, expense: { ...base.expense, categories: [{ label: 'A', group: 'Nope', accounts: 'a' }] } })), /expense.categories\[0\].group/);
  assert.throws(() => loadCategoryViewConfig(write({ ...base, expense: { ...base.expense, categories: [{ label: 'A', group: 'G', accounts: '(' }] } })), /accounts is not a valid pattern/);
  assert.throws(() => loadCategoryViewConfig(write({ ...base, defaults: { measure: 'x' } })), /defaults.measure/);
  assert.throws(() => loadCategoryViewConfig(write({ ...base, expense: { ...base.expense, categories: [{ label: 'A', group: 'G', accounts: 'a', targetPct: { max: 'ten' } }] } })), /targetPct.max/);
  assert.ok(loadCategoryViewConfig(write(base)));
});

test('accounts are clubbed by name, detail type, then full path; other income stands alone', () => {
  const cv = loadCategoryViewConfig();
  assert.equal(classifyLine(cv, 'Expenses', 'Hygienist wages', null, null).label, 'Provider compensation');
  assert.equal(classifyLine(cv, 'COGS', 'Henry Schein', 'SuppliesMaterialsCogs', null).label, 'Dental supplies');
  assert.equal(classifyLine(cv, 'Expenses', 'Smith Labs', null, 'Lab:Smith Labs').label, 'Lab fees');
  assert.equal(classifyLine(cv, 'Expenses', 'Mystery', null, null).label, cv.expense.other.label);
  assert.equal(classifyLine(cv, 'OtherIncome', 'Interest earned', null, null).label, cv.revenue.otherIncome);
  assert.equal(classifyLine(cv, 'Income', 'Medicaid collections', null, null).kind, 'revenue');
});

test('category data is per office and per period, and the browser math benchmarks it', () => {
  const db = openDb(':memory:');
  // Category compare reads the ledger built from raw QuickBooks records.
  seedLedger(db, 'A', [
    ['1', 'Insurance collections', 'Income', '2026-01', 1000], ['1', 'Insurance collections', 'Income', '2026-02', 1000],
    ['2', 'Dental supplies', 'Expenses', '2026-01', 50], ['2', 'Dental supplies', 'Expenses', '2026-02', 70],
    ['3', 'Lab fees', 'COGS', '2026-01', 100],
  ]);
  seedLedger(db, 'B', [
    ['1', 'Insurance collections', 'Income', '2026-01', 500],
    ['2', 'Dental supplies', 'Expenses', '2026-01', 100],
  ]);
  const cv = loadCategoryViewConfig();
  const data = categoryViewData(db, cv, filters('2026-01', '2026-02'), [{ realmId: 'A', officeName: 'Office A' }, { realmId: 'B', officeName: 'Office B' }]);
  const a = data.offices.find((o) => o.realmId === 'A');
  assert.equal(a.cats['e:Dental supplies'], 120);
  assert.equal(a.periods['2026-02'].cats['e:Dental supplies'], 70);
  assert.equal(a.cats['r:Insurance'], 2000, 'revenue Insurance does not collide with expense Insurance');
  assert.equal(a.months, 2);
  assert.ok(data.accounts.some((x) => x.realmId === 'B' && x.category === 'Dental supplies' && x.amount === 100));

  const pub = publicCategoryViewConfig(cv);
  data.offices = data.offices.map((o) => ({ ...o, dims: { brand: o.realmId === 'A' ? 'X' : 'Y' } }));
  const ents = buildEntities(data, 'office');
  const cols = columnsFor(pub, 'expense', 'category', data.offices);
  assert.deepEqual(cols.map((c) => c.label).sort(), ['Dental supplies', 'Lab fees']);
  const supplies = cols.find((c) => c.label === 'Dental supplies');
  const pct = ents.map((e) => measureValue('pctRevenue', e.cats['e:Dental supplies'], headline(appConfig, e.groups).revenue, e.months));
  assert.deepEqual(pct.map((v) => Math.round(v * 1000) / 1000), [0.06, 0.2]);
  assert.equal(measureValue('monthlyAvg', 120, 2000, 2), 60);
  assert.equal(median(pct), 0.13);
  assert.equal(shadeAgainst(0.2, 0.13).tone, 'bad', 'costs above the median are unfavorable');
  assert.equal(shadeAgainst(0.05, null, { target: supplies.target }).tone, 'good');
  assert.equal(shadeAgainst(0.2, null, { target: supplies.target }).tone, 'bad');

  const byBrand = buildEntities(data, 'brand', { dimOrder: { brand: ['Y', 'X'] } });
  assert.equal(byBrand.find((e) => e.label === 'Y').colorSlot, 0, 'group colors follow the dimension order');
  const groupsLevel = columnsFor(pub, 'expense', 'group', data.offices);
  assert.ok(groupsLevel.find((g) => g.label === 'Clinical').members.includes('e:Lab fees'));
  db.close();
});

test('csv export quotes commas and quotes', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', 1.23456789, null]]), '"a,b","say ""hi""",1.2346,');
});

test('daily schedule: next run is the next wall-clock time in the zone, across DST', () => {
  // 2026-10-13 12:00 UTC = 07:00 in Chicago (CDT, UTC-5): next 03:00 is tomorrow 08:00 UTC.
  assert.equal(new Date(nextRunAt('03:00', 'America/Chicago', Date.UTC(2026, 9, 13, 12))).toISOString(), '2026-10-14T08:00:00.000Z');
  // 2026-10-13 07:00 UTC = 02:00 CDT: today's 03:00 is still ahead.
  assert.equal(new Date(nextRunAt('03:00', 'America/Chicago', Date.UTC(2026, 9, 13, 7))).toISOString(), '2026-10-13T08:00:00.000Z');
  // DST ends 2026-11-01: 03:00 CST is 09:00 UTC.
  assert.equal(new Date(nextRunAt('03:00', 'America/Chicago', Date.UTC(2026, 10, 1, 6))).toISOString(), '2026-11-01T09:00:00.000Z');
  assert.throws(() => validateSchedule({ time: '25:00', timezone: 'UTC' }), /sync.schedule.time/);
  assert.throws(() => validateSchedule({ time: '03:00', timezone: 'Mars/Base' }), /timezone/);
  assert.doesNotThrow(() => validateSchedule(appConfig.sync.schedule));
});
