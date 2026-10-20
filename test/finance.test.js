import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { initFinanceSchema } from '../server/finance/store.js';
import { loadFinanceConfig, loadGroupConfig, loadPracticeConfig } from '../server/finance/config.js';
import { tagLines, groupOverview, forecastYear } from '../server/finance/group.js';
import { parseCsv, toMonth, importPracticeRows, practiceKpis } from '../server/finance/practice.js';
import { loadCategoryViewConfig } from '../server/categoryView.js';
import { initRawSchema, syncRaw, loadRawConfig } from '../server/raw/sync.js';
import { buildLedger, postingsFor } from '../server/raw/ledger.js';
import { ledgerPl, rawAging, ledgerVendorSpend, ledgerBalances, rawStatus } from '../server/raw/data.js';
import { seedLedger } from './fixtures/seed-ledger.js';

const SANDBOX = JSON.parse(fs.readFileSync(new URL('./fixtures/qbo-raw-sandbox.json', import.meta.url), 'utf8'));
const R = 'sandbox';
/** A DB holding the real raw records of an Intuit sandbox company, with its ledger built. */
function sandboxDb() {
  const db = openDb(':memory:');
  initRawSchema(db);
  const ins = db.prepare(`INSERT INTO qbo_raw (realm_id, entity, id, sync_token, txn_date, updated_at, json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const { entity, record } of SANDBOX) ins.run(R, entity, String(record.Id), record.SyncToken ?? null, record.TxnDate || null, null, JSON.stringify(record), 'test');
  buildLedger(db, R);
  return db;
}

test('shipped configs load', () => {
  assert.ok(loadFinanceConfig().cash.runwayMonths >= 1);
  assert.ok(loadGroupConfig().rules.length >= 1);
  assert.ok(loadPracticeConfig().derived.some((d) => d.key === 'collectionRate'));
  assert.ok(loadRawConfig().entities.includes('Invoice'));
});

test('ledger from real sandbox raw records: balanced, P&L matches QuickBooks', () => {
  const db = sandboxDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id = '__unbalanced'").get().n, 0, 'every transaction balances');
  const t = {};
  for (const r of ledgerPl(db, [R], '2026-05', '2026-09')) t[`${r.month}|${r.grp}`] = Math.round(((t[`${r.month}|${r.grp}`] || 0) + r.amount) * 100) / 100;
  // Values from the company's QuickBooks Profit and Loss (verified once against QuickBooks).
  assert.equal(t['2026-05|Income'], 391.25);
  assert.equal(t['2026-06|Expenses'], 408.08);
  assert.equal(t['2026-07|OtherExpenses'], 250);
  assert.equal(t['2026-08|Income'], 5114.27);
  assert.equal(t['2026-08|Expenses'], 2344.16);
  assert.equal(t['2026-08|OtherExpenses'], 2666);
  assert.equal(t['2026-09|Income'], 3232.25);
  assert.equal(t['2026-09|Expenses'], 1673.39);
  db.close();
});

test('aging, vendor spend and balances from raw records match QuickBooks', () => {
  const db = sandboxDb();
  const b = (kind) => { const o = {}; for (const r of rawAging(db, [R], kind, '2026-10-13')) o[r.bucket] = Math.round(((o[r.bucket] || 0) + r.amount) * 100) / 100; return o; };
  assert.deepEqual(b('ar'), { '1-30': 4114.52, '31-60': 1011, '61-90': 156 });
  assert.deepEqual(b('ap'), { '1-30': 755, '31-60': 847.67 });
  const spend = ledgerVendorSpend(db, [R], '2026-05', '2026-09');
  assert.equal(Math.round(spend.reduce((t, r) => t + r.amount, 0) * 100) / 100, 8232.59, 'QuickBooks Expenses by Vendor total');
  assert.ok(spend.some((r) => r.vendor === 'No vendor recorded'));
  const st = rawStatus(db, [R])[0];
  assert.ok(st.balances.match >= 14, `balance sheet accounts matching QuickBooks: ${st.balances.match}`);
  const bal = ledgerBalances(db, [R], ['2026-10'])[R]['2026-10'];
  assert.equal(bal.ap, 1602.67);
  assert.equal(bal.ar, 5281.52);
  db.close();
});

test('postings: each transaction type balances with the right sides', () => {
  const accounts = { 1: { type: 'Income' }, 2: { type: 'Expense' }, 9: { type: 'Bank' } };
  const ctx = { accounts, items: { 7: { income: '1' } }, d: { ar: 'AR', ap: 'AP', undeposited: 'UF', income: '1', expense: '2' }, taxAccount: () => null };
  const sum = (ps) => Math.round(ps.reduce((t, p) => t + p.amount, 0) * 100) / 100;
  const inv = postingsFor('Invoice', { TxnDate: '2026-01-05', TotalAmt: 100, CustomerRef: { value: '3', name: 'Delta' }, Line: [{ DetailType: 'SalesItemLineDetail', Amount: 100, SalesItemLineDetail: { ItemRef: { value: '7' } } }, { DetailType: 'SubTotalLineDetail', Amount: 100 }] }, ctx);
  assert.deepEqual(inv.map((p) => [p.account, p.amount]), [['1', -100], ['AR', 100]]);
  assert.equal(inv[0].entityName, 'Delta');
  const bill = postingsFor('Bill', { TxnDate: '2026-01-05', TotalAmt: 40, VendorRef: { value: '5', name: 'Schein' }, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 40, AccountBasedExpenseLineDetail: { AccountRef: { value: '2' } } }] }, ctx);
  assert.deepEqual(bill.map((p) => [p.account, p.amount]), [['2', 40], ['AP', -40]]);
  const card = postingsFor('Purchase', { TxnDate: '2026-01-05', TotalAmt: 10, Credit: true, AccountRef: { value: '9' }, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 10, AccountBasedExpenseLineDetail: { AccountRef: { value: '2' } } }] }, ctx);
  assert.deepEqual(card.map((p) => [p.account, p.amount]), [['2', -10], ['9', 10]], 'card refund reverses');
  const je = postingsFor('JournalEntry', { TxnDate: '2026-01-05', Line: [{ Amount: 5, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '2' } } }, { Amount: 5, JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '9' } } }] }, ctx);
  assert.equal(sum(je), 0);
  const subtotalOnly = postingsFor('Invoice', { TxnDate: '2026-01-05', TotalAmt: 75, Line: [{ DetailType: 'SubTotalLineDetail', Amount: 75 }] }, ctx);
  assert.deepEqual(subtotalOnly.map((p) => [p.account, p.amount]), [['1', -75], ['AR', 75]], 'invoice returned without item lines books to income');
  const off = postingsFor('Bill', { TxnDate: '2026-01-05', TotalAmt: 50, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: 40, AccountBasedExpenseLineDetail: { AccountRef: { value: '2' } } }] }, ctx);
  assert.equal(off.at(-1).account, '__unbalanced', 'a transaction that does not balance is flagged, not hidden');
});

test('raw sync: full pull then changes only, deletes applied, ledger rebuilt', async () => {
  const db = openDb(':memory:');
  const cfg = { enabled: true, entities: ['Account', 'Item', 'Invoice'], pageSize: 1000, cdc: true, fullRefreshDays: 7 };
  const acct = [{ Id: '1', Name: 'Sales', AccountType: 'Income' }, { Id: '2', Name: 'A/R', AccountType: 'Accounts Receivable' }];
  const inv = (id, amt) => ({ Id: id, TxnDate: '2026-01-10', TotalAmt: amt, Line: [{ DetailType: 'SalesItemLineDetail', Amount: amt, SalesItemLineDetail: { ItemAccountRef: { value: '1' } } }] });
  const calls = [];
  const cdc = { CDCResponse: [{ QueryResponse: [{ Invoice: [inv('11', 50), { Id: '10', status: 'Deleted' }] }] }], time: '2026-01-11T00:00:00Z' };
  const get = async (p, q) => {
    calls.push(p);
    if (p === 'cdc') return cdc;
    const e = q.query.match(/from (\w+)/)[1];
    return { QueryResponse: { Account: { Account: acct }, Item: { Item: [] }, Invoice: { Invoice: [inv('10', 100)] } }[e] };
  };
  const first = await syncRaw(db, 'A', cfg, { get, now: new Date('2026-01-10T00:00:00Z') });
  assert.equal(first.mode, 'full');
  assert.equal(ledgerPl(db, ['A'], '2026-01', '2026-01')[0].amount, 100);
  const second = await syncRaw(db, 'A', cfg, { get, now: new Date('2026-01-11T00:00:00Z') });
  assert.equal(second.mode, 'changes');
  assert.equal(calls.filter((c) => c === 'cdc').length, 1);
  assert.equal(ledgerPl(db, ['A'], '2026-01', '2026-01')[0].amount, 50, 'deleted invoice gone, new one in');
  db.close();
});

const plRowsOf = (db, ids) => ledgerPl(db, ids, '2025-01', '2026-12');

test('intercompany eliminations remove both sides; EBITDA adds back D&A and interest', () => {
  const db = openDb(':memory:');
  seedLedger(db, 'P', [['1', 'Insurance collections', 'Income', '2026-01', 1000], ['2', 'Management fee', 'Expenses', '2026-01', 100], ['3', 'Depreciation', 'OtherExpenses', '2026-01', 50], ['4', 'Staff wages', 'Expenses', '2026-01', 300]]);
  seedLedger(db, 'M', [['1', 'Management fee income', 'Income', '2026-01', 100], ['2', 'Office rent', 'Expenses', '2026-01', 20]]);
  const g = loadGroupConfig();
  const seg = (id) => (id === 'P' ? 'Dental Companies' : 'Dental Management');
  const rows = tagLines(plRowsOf(db, ['P', 'M']), g, seg);
  const d = groupOverview(rows, { from: '2026-01', to: '2026-01', offices: [{ realmId: 'P', officeName: 'Practice' }, { realmId: 'M', officeName: 'ManageCo' }], segmentOf: seg, g, cv: loadCategoryViewConfig() });
  assert.equal(d.totals.reported.revenue, 1100);
  assert.equal(d.totals.consolidated.revenue, 1000, 'management fee income eliminated');
  assert.equal(d.totals.consolidated.netIncome, d.totals.reported.netIncome, 'matched sides leave net income unchanged');
  const mf = d.eliminations.find((e) => e.label === 'Management fees');
  assert.equal(mf.eliminated, 100);
  assert.equal(mf.difference, 0);
  const p = d.scorecard.find((o) => o.realmId === 'P');
  assert.equal(p.netIncome, 550);
  assert.equal(p.ebitda, 600, 'depreciation added back');
  db.close();
});

test('unmatched intercompany amounts stay in the figures; net income unchanged', () => {
  const db = openDb(':memory:');
  seedLedger(db, 'P', [['1', 'Sales', 'Income', '2026-01', 1000], ['2', 'Rent', 'Expenses', '2026-01', 300]]);
  seedLedger(db, 'R', [['1', 'Rental income', 'Income', '2026-01', 100]]);
  const g = loadGroupConfig();
  const seg = (id) => (id === 'P' ? 'Dental Companies' : 'Dental RE (Y)');
  const d = groupOverview(tagLines(plRowsOf(db, ['P', 'R']), g, seg), { from: '2026-01', to: '2026-01', offices: [{ realmId: 'P', officeName: 'Practice' }, { realmId: 'R', officeName: 'Realty' }], segmentOf: seg, g, cv: loadCategoryViewConfig() });
  const rent = d.eliminations.find((e) => e.label === 'Rent to group real estate');
  assert.equal(rent.eliminated, 100);
  assert.equal(rent.difference, -200);
  assert.equal(d.totals.consolidated.expenses, 200, 'only the matched 100 of rent is removed');
  assert.equal(d.totals.consolidated.netIncome, d.totals.reported.netIncome);
  db.close();
});

test('forecast: seasonal uses last year shape, falls back to run rate', () => {
  const g = loadGroupConfig();
  const byMonth = {};
  const put = (m, rev) => { byMonth[m] = { groups: { Income: rev }, addBack: 0, icGroups: {}, icAddBack: 0 }; };
  for (let i = 1; i <= 12; i++) put(`2025-${String(i).padStart(2, '0')}`, i === 12 ? 200 : 100);
  for (let i = 1; i <= 9; i++) put(`2026-${String(i).padStart(2, '0')}`, 110);
  const f = forecastYear(byMonth, '2026-09', g.forecast);
  assert.equal(f.method, 'seasonal');
  assert.equal(f.monthly.find((m) => m.month === '2026-12').revenue, 220, 'December keeps its seasonal bump, scaled by +10%');
  assert.equal(f.lastYear.revenue, 1300);
  const r = forecastYear({ '2026-07': byMonth['2026-07'], '2026-08': byMonth['2026-08'], '2026-09': byMonth['2026-09'] }, '2026-09', g.forecast);
  assert.equal(r.method, 'runRate');
  assert.equal(r.fullYear.revenue, 330 + 3 * 110);
});

test('practice KPI import: CSV parsing, header aliases, ratios with the ledger P&L', () => {
  assert.equal(toMonth('3/15/2026'), '2026-03');
  assert.equal(toMonth('Sep 2026'), '2026-09');
  const rows = parseCsv('Practice,Month,Gross Production,Collections,Visits,"New Pts",Active Pts\r\n"Office A",2026-08,"$10,000",9500,100,12,900\r\nOffice A,2026-09,12000,11000,110,8,950\r\nNowhere,2026-09,1,1,1,1,1\r\n');
  const db = openDb(':memory:');
  initFinanceSchema(db);
  seedLedger(db, 'A', [['1', 'Sales', 'Income', '2026-08', 9000], ['2', 'Staff wages', 'Expenses', '2026-08', 4000], ['2', 'Staff wages', 'Expenses', '2026-09', 5000], ['2', 'Staff wages', 'Expenses', '2026-07', 99999]]);
  const pk = loadPracticeConfig();
  const r = importPracticeRows(db, pk, rows, { offices: [{ realmId: 'A', officeName: 'Office A' }] });
  assert.equal(r.offices, 1);
  assert.equal(r.skippedCount, 1);
  const k = practiceKpis(db, pk, loadGroupConfig(), { from: '2026-07', to: '2026-09', offices: [{ realmId: 'A', officeName: 'Office A' }] });
  assert.equal(k.totals.production, 22000);
  assert.equal(k.totals.activePatients, 950, 'stock metric takes the latest month');
  assert.equal(k.totals.pl.expenses, 9000, 'July P&L excluded: no KPIs that month');
  assert.equal(k.totals.expensesPctCollections, Math.round((9000 / 20500) * 10000) / 10000);
  db.close();
});
