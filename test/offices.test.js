import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOfficesConfig } from '../server/offices/config.js';
import { resolveOffices, bucketOf, combinedOffices, periodWindow, isPartnerName, eliminateInternal, classifyLine, buildStatement, flagsFor, balanceTree, canonicalBook } from '../server/offices/offices.js';
import { officePl, comparePl, monthlyPl } from '../server/offices/pl.js';

test('client-sheet offices config: extends offices.json, rows hold exactly the account numbers of the sheet', () => {
  const sheet = loadOfficesConfig(path.resolve('config/offices-sheet.json'));
  assert.equal(sheet.rows.length, 17, 'the sheet (2026-10-26) has 17 rows: Small Equipment Lease struck out, Legal & Professional, Partner withdrawal and the two non-operating rows added');
  assert.deepEqual(sheet.rows.map((r) => r.key), ['netCollections', 'providerComp', 'staffPayroll', 'trainingHiring', 'marketing', 'dentalSupplies', 'laboratory', 'occupancy', 'legalProfessional', 'otherExpenses', 'ebitdaBeforeFees', 'managementFees', 'officeEbitda', 'partnerWithdrawal', 'operatingCashFlow', 'nonOperatingIncome', 'nonOperatingExpenses']);
  assert.equal(sheet.internal.income.unmatched, cfg.internal.income.unmatched, 'inherited');
  assert.deepEqual(sheet.payrollTaxes.allocateTo, ['providerComp', 'staffPayroll'], 'the sheet lists 576 and 506 under both payroll rows: split in proportion');
  assert.equal(sheet.cashFlow.includeLoanPayments, true);
  assert.equal(cfg.cashFlow.includeLoanPayments, false);
  assert.equal(sheet.statement.rollUpSubAccounts, 'matched');
  assert.deepEqual(sheet.page.sections, ['statement', 'pl', 'sideBySide'], 'statement plus the QuickBooks-style profit and loss, then the Side by side card on Compare');
  assert.deepEqual(cfg.page.sections, ['tiles', 'statement', 'pl', 'balanceSheet', 'trends']);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { sections: ['charts'] } })), /page.sections/);
  const { columns, buckets, ...sheetPf } = sheet.page.portfolio;
  assert.deepEqual(sheetPf, { summary: false, flags: false, tags: false, combinedList: false, label: "VJ's Dashboard", nameColumn: 'Company' }, 'Financial KPIs: no portfolio tiles, Combine companies, flag chips or pills, company tags or combined list; list headed by the client name');
  assert.deepEqual(columns.map((c) => c.key), ['netCollections', 'totalExpenses', 'managementFees', 'officeEbitda', 'withdrawals', 'operatingCashFlow'], 'the six columns VJ typed on the 2026-10-27 call');
  assert.deepEqual(columns.map((c) => c.label), ['Collections', 'Total expenses', 'Management fees', 'EBITDA', 'Withdrawals & profits', 'Cash flow'], 'labels as VJ shortened them on the 2026-10-28 call');
  assert.deepEqual(buckets.list.map((b) => b.key), ['sabuska', 'dental', 'dentalRe', 'nonDentalRe', 'other', 'nonOperational'], 'the groups of the client org-structure sheet (2026-10-28), Sabuska first');
  assert.equal(buckets.rest, 'other');
  assert.equal(buckets.list.find((b) => b.key === 'sabuska').show, true, 'the holding company is listed first (2026-10-28 evening: VJ wants its lines back)');
  assert.equal(buckets.list.find((b) => b.key === 'dental').show, true, 'show defaults to true');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { portfolio: { buckets: { list: [{ key: 'a', label: 'A', show: 'no' }], rest: 'a' } } } })), /buckets\.list\[0\]\.show/);
  assert.equal(buckets.list.find((b) => b.key === 'other').companies.includes('9130351692019756'), true, 'VJ 2026-10-28: Sage Consulting Group sits under Construction, development & equipment, not Dental');
  assert.equal(sheet.autoPair.otherCompanies, 'offices', 'every connected company is listed, not only the dental group');
  assert.equal(sheet.naming.pattern, '{company}');
  assert.deepEqual(cfg.page.portfolio, { summary: true, flags: true, tags: true, combinedList: true, label: 'Offices', nameColumn: 'Offices', columns: null, buckets: null });
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { portfolio: { columns: [{ key: 'nope' }] } } })), /columns\[0\]\.key "nope"/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { portfolio: { buckets: { list: [{ key: 'a', label: 'A' }], rest: 'b' } } } })), /buckets.rest/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, autoPair: { otherCompanies: 'all' } })), /autoPair.otherCompanies/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { portfolio: { flags: 'no' } } })), /page.portfolio.flags/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { portfolio: { label: '' } } })), /page.portfolio.label/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, statement: { rollUpSubAccounts: 'deep' } })), /rollUpSubAccounts/);
  const k = (grp, account, fullName) => classifyLine(L('D', '2026-01', grp, account, 1, null, fullName), sheet);
  assert.deepEqual(k('Income', '402.1 Cash/Patient Checks', '402 Income:402.1 Cash/Patient Checks'), { kind: 'row', key: 'netCollections' });
  assert.deepEqual(k('Income', '401 Refunds', '402 Income:401 Refunds'), { kind: 'row', key: 'netCollections' });
  assert.deepEqual(k('Income', '405 Uncategorized Income'), { kind: 'memo', key: 'unassignedIncome' }, 'income the sheet does not assign is not collections');
  assert.deepEqual(k('Expenses', 'Dentist', '503 Contract Labor:503.1 Dental Contract Labor:Dentist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', 'Staff', '503 Contract Labor:503.1 Dental Contract Labor:Staff'), { kind: 'row', key: 'providerComp' }, 'sheet: all of 503.1');
  assert.deepEqual(k('Expenses', '504 Hygienist', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', '576 Payroll Tax Expense', '5000.1 Total Payroll Expenses:550.1 Payroll Taxes & Fees:576 Payroll Tax Expense'), { kind: 'tax', key: 'payrollTaxes' }, 'sheet: 576 under both payroll rows -> split');
  assert.deepEqual(k('Expenses', '506.3 Bonus', '506 Employee Benefits Expense:506.3 Bonus'), { kind: 'tax', key: 'payrollTaxes' });
  assert.deepEqual(k('Expenses', '506.1 Health Insurance', '506 Employee Benefits Expense:506.1 Health Insurance'), { kind: 'tax', key: 'payrollTaxes' }, 'sheet: Benefits 506 whole');
  assert.deepEqual(k('Expenses', "500 Doctor's payroll", "5000.1 Total Payroll Expenses:5000.2 Payroll Expense:500 Doctor's payroll"), { kind: 'row', key: 'providerComp' }, 'sheet: 500');
  assert.deepEqual(k('Expenses', '501 Associate Dentist', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:501 Associate Dentist'), { kind: 'row', key: 'providerComp' }, 'sheet: 501');
  assert.deepEqual(k('Expenses', '5000.2 Payroll Expense', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense'), { kind: 'memo', key: 'unassigned' }, '5000 is not 500');
  assert.deepEqual(k('Expenses', '530.1 Dental Related Insurance', '530 Insurance:530.1 Dental Related Insurance'), { kind: 'row', key: 'otherExpenses' }, 'sheet: insurance 530 is Other');
  assert.deepEqual(k('Expenses', '554.1 Office Expense', '554 Office Expense & Postage & Donations:554.1 Office Expense'), { kind: 'row', key: 'otherExpenses' });
  assert.deepEqual(k('Expenses', '554.3 Postage', '554 Office Expense & Postage & Donations:554.3 Postage'), { kind: 'row', key: 'otherExpenses' }, 'sheet: Office Exp 554 (whole)');
  assert.deepEqual(k('Expenses', '542 Legal & Professional Fees'), { kind: 'row', key: 'legalProfessional' }, 'sheet: own row');
  assert.deepEqual(k('Expenses', '524 Dues & Subscriptions'), { kind: 'row', key: 'otherExpenses' });
  assert.deepEqual(k('Expenses', '546 Medical Waste'), { kind: 'row', key: 'otherExpenses' });
  assert.equal(sheet.page.memo, false);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { memo: 'no' } })), /page.memo/);
  assert.deepEqual(k('Expenses', '503 Staff Payroll', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:503 Staff Payroll'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '503.3 Temp Agency', '503 Contract Labor:503.3 Temp Agency'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '502 Dental Assistant', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:502 Dental Assistant'), { kind: 'row', key: 'staffPayroll' }, 'sheet: 502');
  assert.deepEqual(k('Expenses', '517.2 Staff Training', '517 Continuing Ed & Training Courses:517.2 Staff Training'), { kind: 'row', key: 'trainingHiring' });
  assert.deepEqual(k('Expenses', '560.1 Dental', '560 Repairs & Maintenance:560.1 Dental'), { kind: 'row', key: 'otherExpenses' }, 'sheet: Repairs 560 are Other Expenses, not rent');
  assert.deepEqual(k('Expenses', '560.2 Non Dental', '560 Repairs & Maintenance:560.2 Non Dental'), { kind: 'row', key: 'otherExpenses' });
  assert.deepEqual(k('Expenses', '586.1 Electric', '586 Electric, Gas, Water & Trash:586.1 Electric'), { kind: 'row', key: 'otherExpenses' }, 'sheet: Utilities 586 are Other Expenses');
  assert.deepEqual(k('Expenses', '559.2 Common Area Maintenance', '559 Rent & NNN:559.2 Common Area Maintenance'), { kind: 'row', key: 'occupancy' });
  assert.deepEqual(k('Expenses', '540.1 Small Dental Equipment', '540 Equipment Lease Expense:540.1 Small Dental Equipment'), { kind: 'memo', key: 'unassigned' }, 'Small Equipment Lease struck out of the sheet');
  assert.deepEqual(k('Expenses', '540.2 Non-Dental', '540 Equipment Lease Expense:540.2 Non-Dental'), { kind: 'memo', key: 'unassigned' });
  assert.deepEqual(k('Expenses', '650.1 Corporation Overhead Charges', '650 Management Fee:650.1 Corporation Overhead Charges'), { kind: 'row', key: 'managementFees' });
  assert.deepEqual(k('Expenses', '520 Depreciation Expense'), { kind: 'memo', key: 'notOperating' }, 'inherited');
  assert.deepEqual(k('OtherExpenses', '802.1 Management Profit', '802 Profits:802.1 Management Profit'), { kind: 'row', key: 'partnerWithdrawal' }, 'sheet: 802.1 / 802.2 is the Partner withdrawal row, before the inherited profit-transfer rule');
  assert.deepEqual(k('OtherExpenses', '802.3 Other', '802 Profits:802.3 Other'), { kind: 'memo', key: 'profitTransfers' }, 'inherited');
  assert.deepEqual(k('OtherIncome', '801 Non Operation Income'), { kind: 'row', key: 'nonOperatingIncome' }, 'before the other-income memo and the internal-income rule');
  assert.deepEqual(k('OtherExpenses', '701.1 Interest Expense', '701 Non Operational Expenses:701.1 Interest Expense'), { kind: 'row', key: 'nonOperatingExpenses' }, 'before the notOperating rule');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, rows: { list: [...base.rows.list, { key: 'x', label: 'X', role: 'item' }] } })), /accounts is required for role item/);
  // The accounts behind a row are shown at the level the rule matched.
  const st = buildStatement([
    L('S', '2026-05', 'Expenses', '504 Hygienist', 100, null, '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist'),
    L('S', '2026-05', 'Expenses', 'Dentist', 50, null, '503 Contract Labor:503.1 Dental Contract Labor:Dentist'),
    L('S', '2026-05', 'Expenses', 'Staff', 25, null, '503 Contract Labor:503.1 Dental Contract Labor:Staff'),
    L('S', '2026-05', 'Expenses', '503.3 Temp Agency', 10, null, '503 Contract Labor:503.3 Temp Agency'),
    L('D', '2026-05', 'Income', '402.1 Cash', 1000, null, '402 Income:402.1 Cash'),
  ], office, sheet, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] });
  const children = (key) => st.rows.find((r) => r.key === key).children.map((c) => [c.account, c.fullName, c.period]);
  assert.deepEqual(children('providerComp'), [['503.1 Dental Contract Labor', '503 Contract Labor:503.1 Dental Contract Labor', 75], ['504 Hygienist', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist', 100]], 'Dentist and Staff roll up into 503.1; account-number order');
  assert.deepEqual(children('staffPayroll'), [['503 Contract Labor', '503 Contract Labor', 10]], 'rule 503 matches the top level, so 503.3 rolls up into it');
  assert.deepEqual(children('netCollections'), [['402 Income', '402 Income', 1000]]);
  // statement.sortAccounts = number: the accounts behind a row in account-number order, whatever their amounts.
  assert.equal(sheet.statement.sortAccounts, 'number');
  assert.equal(cfg.statement.sortAccounts, 'amount', 'Offices tab: largest first');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, statement: { sortAccounts: 'name' } })), /sortAccounts/);
  const sorted = buildStatement([
    L('S', '2026-05', 'Expenses', '586.1 Electric', 900, null, '586 Electric, Gas, Water & Trash:586.1 Electric'),
    L('S', '2026-05', 'Expenses', '554.1 Office Expense', 500, null, '554 Office Expense & Postage & Donations:554.1 Office Expense'),
    L('S', '2026-05', 'Expenses', '512 Bank Fees', 10),
    L('S', '2026-05', 'Expenses', '530.1 Dental Related Insurance', 700, null, '530 Insurance:530.1 Dental Related Insurance'),
    L('S', '2026-05', 'Expenses', '504 Hygienist', 100, null, '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist'),
    L('S', '2026-05', 'Expenses', "500 Doctor's payroll", 5, null, "5000.1 Total Payroll Expenses:5000.2 Payroll Expense:500 Doctor's payroll"),
    L('S', '2026-05', 'Expenses', '576 Payroll Tax Expense', 50),
  ], office, sheet, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] });
  assert.deepEqual(sorted.rows.find((r) => r.key === 'otherExpenses').children.map((c) => c.account), ['512 Bank Fees', '530 Insurance', '554 Office Expense & Postage & Donations', '586 Electric, Gas, Water & Trash'], '512 first although it is the smallest');
  assert.deepEqual(sorted.rows.find((r) => r.key === 'providerComp').children.map((c) => c.account), ["500 Doctor's payroll", '504 Hygienist', 'Payroll taxes (allocated)'], 'allocated line last');
  assert.deepEqual(buildStatement([
    L('S', '2026-05', 'Expenses', '512 Bank Fees', 10),
    L('S', '2026-05', 'Expenses', '586.1 Electric', 900, null, '586 Electric, Gas, Water & Trash:586.1 Electric'),
  ], office, { ...sheet, statement: { ...sheet.statement, sortAccounts: 'amount' } }, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] }).rows.find((r) => r.key === 'otherExpenses').children.map((c) => c.account), ['586 Electric, Gas, Water & Trash', '512 Bank Fees'], 'amount: largest first');
  // Item rows (partner withdrawal, non-operating): shown as booked, outside EBITDA and never an internal charge.
  const it = buildStatement([
    L('D', '2026-05', 'Income', '402.1 Cash', 1000, null, '402 Income:402.1 Cash'),
    L('S', '2026-05', 'Expenses', '521 Dental Supplies', 100),
    L('S', '2026-05', 'OtherExpenses', '802.1 Management Profit', 300, 'Luxia Dental LLC', '802 Profits:802.1 Management Profit'),
    L('D', '2026-05', 'OtherIncome', '801 Non Operation Income', 300, 'zz subDSO IndianaPolis'),
    L('S', '2026-05', 'OtherExpenses', '701 Non Operational Expenses', 40),
  ], office, sheet, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] });
  const ir = (key) => it.rows.find((r) => r.key === key);
  assert.equal(ir('partnerWithdrawal').months['2026-05'], 300, 'as booked, even though the payee is the other company');
  assert.equal(ir('nonOperatingIncome').months['2026-05'], 300);
  assert.equal(ir('nonOperatingExpenses').months['2026-05'], 40);
  assert.equal(ir('officeEbitda').months['2026-05'], 900, 'item rows are in no subtotal');
  assert.deepEqual(it.internalPeriod, { expense: 0, income: 0, matched: 0 }, 'item lines are not internal-charge candidates');
  assert.equal(it.memo.length, 0);
  // One spelling per account across the companies of an office; children merge by name however the companies spell or nest it.
  const books = {
    A: { 1: { id: '1', name: '650 Management Fees', fullName: '650 Management Fees', type: 'Expense' }, 2: { id: '2', name: '503 Staff Payroll', fullName: '5000 Total Payroll Expenses:5000.1 Payroll Expense:503 Staff Payroll', type: 'Expense' } },
    B: { 1: { id: '1', name: '650 Management fee', fullName: '650 Management fee', type: 'Expense' }, 2: { id: '2', name: '503 Staff payroll', fullName: '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:503 Staff payroll', type: 'Expense' } },
    C: { 1: { id: '1', name: '650 Management Fee', fullName: '650 Management Fee', type: 'Expense' } },
  };
  books.A[3] = { id: '3', name: '503 Contract Labor', fullName: '503 Contract Labor', type: 'Expense' };
  books.A[4] = { id: '4', name: '560 Repairs & Maintenance', fullName: '560 Repairs & Maintenance', type: 'Expense' };
  books.B[4] = { id: '4', name: '560 Repairs and Maintenance', fullName: '560 Repairs and Maintenance', type: 'Expense' };
  books.C[4] = { id: '4', name: '560 Repair & Maintenance', fullName: '560 Repair & Maintenance', type: 'Expense' };
  books.B[5] = { id: '5', name: '539 Uniforms & Laundry', fullName: '539 Uniforms & Laundry', type: 'Expense' };
  books.A[5] = { id: '5', name: '539 Laundry & Uniform', fullName: '539 Laundry & Uniform', type: 'Expense' };
  const cb = canonicalBook((id) => books[id], ['A', 'B', 'C']);
  assert.equal(cb('B')[1].name, '650 Management Fee', 'three spellings, one each: capitalised / shorter wins the tie');
  assert.equal(cb('A')[1].fullName, '650 Management Fee');
  assert.equal(cb('B')[2].name, '503 Staff Payroll', 'two 503 accounts in company A, so 503 merges by name only');
  assert.equal(cb('A')[3].name, '503 Contract Labor');
  assert.equal(cb('B')[4].name, '560 Repair & Maintenance', 'same number 560, unique in every company: one account whatever the wording');
  assert.equal(cb('C')[4].name, '560 Repair & Maintenance');
  assert.equal(cb('B')[5].name, '539 Laundry & Uniform', 'word order and plural ignored');
  const merged = buildStatement([
    L('A', '2026-05', 'Expenses', '503 Staff Payroll', 100, null, '5000 Total Payroll Expenses:5000.1 Payroll Expense:503 Staff Payroll'),
    L('B', '2026-05', 'Expenses', '503 Staff payroll', 50, null, '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:503 Staff payroll'),
    L('A', '2026-05', 'Expenses', '650 Management Fees', 10, null, '650 Management Fees'),
    L('C', '2026-05', 'Expenses', '650 Management Fee', 5, null, '650 Management Fee'),
  ], { ...office, companies: [{ realmId: 'A', name: 'A' }, { realmId: 'B', name: 'B' }, { realmId: 'C', name: 'C' }] }, sheet, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] });
  assert.deepEqual(merged.rows.find((r) => r.key === 'staffPayroll').children.map((c) => [c.account, c.period, c.companies]), [['503 Staff Payroll', 150, 2]], 'one line although the parents differ (5000 vs 5000.1)');
  assert.deepEqual(merged.rows.find((r) => r.key === 'managementFees').children.map((c) => [c.account, c.period, c.companies]), [['650 Management Fees', 15, 2]], 'plural / case differences merge; spelling of the larger line is shown');
  // extends guards
  assert.throws(() => loadOfficesConfig(tmp({ extends: 'config/offices-sheet.json' })), /does not itself extend/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, cashFlow: { includeLoanPayments: 'yes' } })), /cashFlow.includeLoanPayments/);
});

test('combined profit and loss: accounts merged by path across the two companies, by month and by company', () => {
  const books = {
    D: { 1: { id: '1', name: '402 Income', fullName: '402 Income', type: 'Income', classification: 'Revenue', active: true }, 2: { id: '2', name: '402.1 Cash', fullName: '402 Income:402.1 Cash', type: 'Income', classification: 'Revenue', active: true }, 3: { id: '3', name: '521 Dental Supplies', fullName: '521 Dental Supplies', type: 'Expense', classification: 'Expense', active: true }, 9: { id: '9', name: 'Checking', fullName: 'Checking', type: 'Bank', classification: 'Asset', active: true } },
    S: { 7: { id: '7', name: '521 Dental Supplies', fullName: '521 Dental Supplies', type: 'Expense', classification: 'Expense', active: true }, 8: { id: '8', name: '801 Other Income', fullName: '801 Other Income', type: 'Other Income', classification: 'Revenue', active: true }, 6: { id: '6', name: '600 COGS', fullName: '600 COGS', type: 'Cost of Goods Sold', classification: null, active: true } },
  };
  const book = (id) => books[id];
  const companies = [{ realmId: 'D', name: 'Dental' }, { realmId: 'S', name: 'Sub-DSO' }];
  const lines = [
    { realmId: 'D', month: '2026-01', grp: 'Income', accountId: '2', account: '402.1 Cash', amount: 1000 },
    { realmId: 'D', month: '2026-02', grp: 'Income', accountId: '2', account: '402.1 Cash', amount: 2000 },
    { realmId: 'D', month: '2026-01', grp: 'Expenses', accountId: '3', account: '521 Dental Supplies', amount: 100 },
    { realmId: 'S', month: '2026-01', grp: 'Expenses', accountId: '7', account: '521 Dental Supplies', amount: 50 },
    { realmId: 'S', month: '2026-02', grp: 'COGS', accountId: '6', account: '600 COGS', amount: 300 },
    { realmId: 'S', month: '2026-02', grp: 'OtherIncome', accountId: '8', account: '801 Other Income', amount: 10 },
    { realmId: 'S', month: '2026-03', grp: 'Expenses', accountId: '7', account: '521 Dental Supplies', amount: 999 }, // outside the months
  ];
  const pl = officePl({ companies, book, lines, months: ['2026-01', '2026-02'] });
  const m = pl.months;
  assert.deepEqual(m.buckets.map((b) => b.key), ['2026-01', '2026-02']);
  const income = m.types.find((t) => t.accountType === 'Income');
  assert.equal(income.total, 3000);
  assert.equal(income.nodes.length, 1, '402 Income with 402.1 Cash under it');
  assert.equal(income.nodes[0].children[0].name, '402.1 Cash');
  const exp = m.types.find((t) => t.accountType === 'Expense');
  assert.deepEqual(exp.nodes.map((n) => [n.name, n.total, n.companies]), [['521 Dental Supplies', 150, 2]], 'same account path in both companies merged');
  assert.equal(m.types.find((t) => t.accountType === 'Cost of Goods Sold').total, 300, 'classification missing in QuickBooks: derived from the type');
  assert.deepEqual(m.subtotals.grossProfit, { periods: { '2026-01': 1000, '2026-02': 1700 }, total: 2700 });
  assert.deepEqual(m.subtotals.netOperatingIncome.total, 2550);
  assert.deepEqual(m.subtotals.netOtherIncome.total, 10);
  assert.deepEqual(m.subtotals.netIncome, { periods: { '2026-01': 850, '2026-02': 1710 }, total: 2560 });
  const c = pl.companies;
  assert.deepEqual(c.buckets, [{ key: 'D', label: 'Dental' }, { key: 'S', label: 'Sub-DSO' }]);
  assert.deepEqual(c.subtotals.netIncome.periods, { D: 2900, S: -340 });
  assert.equal(c.subtotals.netIncome.total, 2560);
  assert.deepEqual(monthlyPl(lines, ['2026-01', '2026-02']), { '2026-01': { revenue: 1000, netIncome: 850 }, '2026-02': { revenue: 2000, netIncome: 1710 } });
  // Compare view: one column per office (here each company is its own office); total = both together.
  const cmp = comparePl({ offices: [{ key: 'a', name: 'Office A', companies: [companies[0]] }, { key: 'b', name: 'Office B', companies: [companies[1]] }], book, lines, months: ['2026-01', '2026-02'] });
  assert.deepEqual(cmp.buckets, [{ key: 'a', label: 'Office A' }, { key: 'b', label: 'Office B' }]);
  assert.deepEqual(cmp.subtotals.netIncome, { periods: { a: 2900, b: -340 }, total: 2560 });
  assert.deepEqual(cmp.types.find((t) => t.accountType === 'Expense').nodes.map((n) => [n.name, n.periods, n.total]), [['521 Dental Supplies', { a: 100, b: 50 }, 150]], 'same account merged across offices');
});

const cfg = loadOfficesConfig();
const tmp = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'offices-')), 'offices.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
};
const base = JSON.parse(fs.readFileSync(new URL('../config/offices.json', import.meta.url), 'utf8'));

test('offices config loads; bad edits fail naming the key', () => {
  assert.equal(cfg.rows.length, 13);
  assert.equal(cfg.rows.find((r) => r.role === 'collections').key, 'netCollections');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, rows: { list: base.rows.list.filter((r) => r.role !== 'ebitda') } })), /exactly one row with role ebitda/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, payrollTaxes: { accounts: 'tax', allocateTo: ['nope'] } })), /allocateTo "nope"/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, offices: { list: [{ companies: ['1'] }, { companies: ['1'] }] } })), /more than one office/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, periods: { default: 'week' } })), /periods.default/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, periods: { asOf: 'yesterday' } })), /periods.asOf/);
  assert.equal(cfg.periods.asOf, 'lastFullMonth');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, internal: { expense: { accounts: '(' } } })), /internal.expense.accounts/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, internal: { income: { accounts: 'x', unmatched: 'drop' } } })), /internal.income.unmatched must be memo \| rows/);
  assert.equal(cfg.internal.income.unmatched, 'memo');
  assert.equal(cfg.internal.expense.unmatched, 'rows');
});

const companies = [
  { realmId: '1', officeName: 'Admire Dental Springfield', city: 'Springfield', state: 'MA' },
  { realmId: '2', officeName: 'Admire Dental Branford', city: 'Branford', state: 'CT' },
  { realmId: '3', officeName: 'zz subDSO Branford', city: 'Branford', state: 'CT' },
  { realmId: '4', officeName: 'Head Office Dental', city: 'Southington', state: 'CT' },
  { realmId: '5', officeName: 'zz subDSO Elsewhere', city: 'Elsewhere', state: 'CA' },
  { realmId: '6', officeName: 'zz SubDSO Pueblo', city: 'Pueblo', state: 'CO' },
  { realmId: '7', officeName: 'Y Pueblo Properties', city: 'Pueblo', state: 'CO' },
];
const testCfg = { ...cfg, offices: [{ companies: ['4', '5'], city: 'Elsewhere', state: 'CA', aliases: [] }], autoPair: { ...cfg.autoPair, dimension: 'group', categories: ['Dental Companies'] } };
const categoryOf = (id) => (['1', '2', '4'].includes(id) ? 'Dental Companies' : 'Other');

test('offices: explicit pairs, pairing by city, standalone sub-DSO, scope', () => {
  const offices = resolveOffices(companies, testCfg, categoryOf);
  const byName = Object.fromEntries(offices.map((o) => [o.name, o]));
  assert.deepEqual(Object.keys(byName).sort(), ['Dental Office - Branford', 'Dental Office - Elsewhere', 'Dental Office - Pueblo', 'Dental Office - Springfield']);
  assert.deepEqual(byName['Dental Office - Branford'].companies.map((c) => c.realmId), ['2', '3'], 'sub-DSO joins the dental company at the same city');
  assert.deepEqual(byName['Dental Office - Elsewhere'].companies.map((c) => c.realmId), ['4', '5'], 'explicit pair overrides the head-office address');
  assert.equal(byName['Dental Office - Elsewhere'].explicit, true);
  assert.deepEqual(byName['Dental Office - Pueblo'].companies.map((c) => c.realmId), ['6'], 'a sub-DSO without a dental company is its own office; real estate is not');
  // Only companies the user may see.
  const scoped = resolveOffices(companies.filter((c) => c.realmId === '3'), testCfg, categoryOf);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].companies.length, 1);
  assert.equal(resolveOffices(companies, { ...testCfg, autoPair: { ...testCfg.autoPair, enabled: false } }, categoryOf).length, 1);
  const dup = resolveOffices([...companies, { realmId: '8', officeName: 'Second Springfield Dental', city: 'Springfield', state: 'MA' }], testCfg, (id) => (id === '8' ? 'Dental Companies' : categoryOf(id)));
  assert.deepEqual(dup.map((o) => o.name).filter((n) => n.includes('Springfield')), ['Dental Office - Springfield (Admire Dental Springfield)', 'Dental Office - Springfield (Second Springfield Dental)'], 'same-city offices are told apart');
});

test('offices: autoPair.otherCompanies = offices lists every company; buckets by company or category', () => {
  const all = resolveOffices(companies, { ...testCfg, naming: { pattern: '{company}', fallback: '{company}' }, autoPair: { ...testCfg.autoPair, otherCompanies: 'offices' } }, categoryOf);
  const byName = Object.fromEntries(all.map((o) => [o.name, o]));
  assert.deepEqual(Object.keys(byName).sort(), ['Admire Dental Branford', 'Admire Dental Springfield', 'Head Office Dental', 'Y Pueblo Properties', 'zz SubDSO Pueblo'], 'every company is listed, named after its first company');
  assert.deepEqual(byName['zz SubDSO Pueblo'].companies.map((c) => c.realmId), ['6'], 'the sub-DSO still does not pair with the real-estate company at the same city');
  assert.deepEqual(byName['Y Pueblo Properties'].companies.map((c) => c.realmId), ['7'], 'the real-estate company is its own office');
  assert.deepEqual(byName['Admire Dental Branford'].companies.map((c) => c.realmId), ['2', '3']);
  const buckets = { list: [{ key: 'hq', label: 'HQ', companies: ['6'], categories: [] }, { key: 'dental', label: 'Dental', companies: [], categories: ['Dental Companies'] }, { key: 'other', label: 'Other', companies: [], categories: [] }], rest: 'other' };
  assert.equal(bucketOf(byName['zz SubDSO Pueblo'], buckets, categoryOf), 'hq', 'a listed company wins');
  assert.equal(bucketOf(byName['Admire Dental Branford'], buckets, categoryOf), 'dental', 'else the category of the first company');
  assert.equal(bucketOf(byName['Y Pueblo Properties'], buckets, categoryOf), 'other', 'else rest');
  assert.equal(bucketOf(byName['Y Pueblo Properties'], null, categoryOf), null);
});

test('period windows: month, last full quarter, YTD, TTM and the prior year', () => {
  assert.deepEqual(periodWindow('2026-10', 'month'), { key: 'month', label: 'Last month', from: '2026-10', to: '2026-10', priorFrom: '2025-10', priorTo: '2025-10' });
  assert.deepEqual(periodWindow('2026-10', 'quarter'), { key: 'quarter', label: 'Q3 2026', from: '2026-07', to: '2026-09', priorFrom: '2025-07', priorTo: '2025-09' });
  assert.equal(periodWindow('2026-09', 'quarter').to, '2026-09');
  assert.deepEqual(periodWindow('2026-10', 'ytd', 1).from, '2026-01');
  assert.deepEqual(periodWindow('2026-03', 'ytd', 7).from, '2025-07');
  assert.deepEqual(periodWindow('2026-10', 'ttm').from, '2025-11');
  // 2026-10-28 (VJ): Last year = the last full fiscal year ending at or before asOf; Custom = the header From up to asOf.
  assert.deepEqual(periodWindow('2026-09', 'lastYear'), { key: 'lastYear', label: 'Year 2025', from: '2025-01', to: '2025-12', priorFrom: '2024-01', priorTo: '2024-12' });
  assert.equal(periodWindow('2025-12', 'lastYear').to, '2025-12', 'a December as-of counts that year as full');
  assert.deepEqual(periodWindow('2026-03', 'lastYear', 7), { key: 'lastYear', label: 'Year to 2025-06', from: '2024-07', to: '2025-06', priorFrom: '2023-07', priorTo: '2024-06' });
  assert.deepEqual(periodWindow('2026-09', 'custom', 1, '2026-03'), { key: 'custom', label: 'Custom', from: '2026-03', to: '2026-09', priorFrom: '2025-03', priorTo: '2025-09' });
  assert.equal(periodWindow('2026-09', 'custom', 1, '2026-11').from, '2026-09', 'a From after asOf falls back to the as-of month');
});

test('display names: naming.companies by the first company, pairNote for two-company offices; picker groups by company', () => {
  const naming = { pattern: '{company}', fallback: '{company}', pairNote: 'dental + sub-DSO', companies: { 2: { name: 'Admire Dental Branford', short: 'Branford', note: null }, 6: { name: 'Admire Dental Pueblo', short: 'Pueblo', note: 'sub-DSO only' } } };
  const all = resolveOffices(companies, { ...testCfg, naming, autoPair: { ...testCfg.autoPair, otherCompanies: 'offices' } }, categoryOf);
  const byId = Object.fromEntries(all.map((o) => [o.companies[0].realmId, o]));
  assert.deepEqual([byId[2].name, byId[2].short, byId[2].note], ['Admire Dental Branford', 'Branford', 'dental + sub-DSO'], 'the pair takes the DBA name and the pair note');
  assert.deepEqual([byId[6].name, byId[6].short, byId[6].note], ['Admire Dental Pueblo', 'Pueblo', 'sub-DSO only'], 'a lone sub-DSO is named after the practice it manages, with its note');
  assert.deepEqual([byId[7].name, byId[7].short, byId[7].note], ['Y Pueblo Properties', null, null], 'companies not listed keep their QuickBooks names');
  assert.equal(byId[2].key, 'admire-dental-branford-2', 'the key follows the display name');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, naming: { companies: { 1: { name: 'Admire Dental Bristol', short: 'Branford' } } } })), /naming.companies\["1"\].short/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, naming: { companies: { 1: { short: 'x' } } } })), /naming.companies\["1"\].name/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, picker: { groups: [{ key: 'a', label: 'A' }], rest: 'zz' } })), /picker.rest/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, periods: { options: ['month', 'week'] } })), /periods.options/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, periods: { default: 'ttm', options: ['month'] } })), /periods.default/);
  assert.equal(cfg.picker, null);
  assert.deepEqual(cfg.periods.options, ['month', 'quarter', 'ytd', 'lastYear', 'ttm', 'custom'], 'default: every period');
  const sheet = loadOfficesConfig(path.resolve('config/offices-sheet.json'));
  assert.deepEqual(sheet.periods.options, ['month', 'quarter', 'ytd', 'custom'], 'VJ 2026-10-29: Last month, Last quarter, YTD, Custom (the calendar-year buttons were dropped again)');
  assert.equal(sheet.periods.yearButtons, 3);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, periods: { yearButtons: 0 } })), /periods\.yearButtons/);
  assert.deepEqual(periodWindow('2026-09', 'year:2025'), { key: 'year:2025', label: '2025', from: '2025-01', to: '2025-12', priorFrom: '2024-01', priorTo: '2024-12' });
  assert.deepEqual(periodWindow('2026-09', 'year:2026'), { key: 'year:2026', label: '2026', from: '2026-01', to: '2026-09', priorFrom: '2025-01', priorTo: '2025-09' }, 'the running year ends at asOf');
  assert.equal(sheet.page.titles.statement, 'Synopsis P&L');
  assert.equal(sheet.page.titles.pl, 'Detailed P&L');
  assert.equal(sheet.page.titles.sideBySide, 'Synopsis comparison');
  assert.equal(cfg.page.titles.sideBySide, 'Synopsis comparison', 'default');
  assert.deepEqual(sheet.page.titles.combined, { statement: 'Combined Synopsis', pl: 'Combined Details' }, 'VJ 2026-10-29: a combined view has its own two titles');
  assert.deepEqual(cfg.page.titles.combined, { statement: 'Combined statement', pl: 'Combined profit and loss' }, 'defaults');
  assert.deepEqual(sheet.page.split, [5, 7], 'VJ 2026-10-29 call: about 40 / 60 so the statement stays readable on a laptop');
  assert.deepEqual(cfg.page.split, [6, 6]);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { split: [4, 9] } })), /page\.split/);
  assert.equal(sheet.page.portfolio.nameColumn, 'Company');
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { titles: { pl: '' } } })), /page\.titles\.pl/);
  assert.throws(() => loadOfficesConfig(tmp({ ...base, page: { titles: { combined: { statement: '' } } } })), /page\.titles\.combined\.statement/);
  // Group header columns: only the dental practices say Collections, every other group Revenue (VJ 2026-10-29).
  assert.deepEqual(sheet.page.portfolio.buckets.list.map((b) => [b.key, b.columns.netCollections || null]), [['sabuska', 'Revenue'], ['dental', null], ['dentalRe', 'Revenue'], ['nonDentalRe', 'Revenue'], ['other', 'Revenue'], ['nonOperational', 'Revenue']]);
  const sheetRaw = JSON.parse(fs.readFileSync(path.resolve('config/offices-sheet.json'), 'utf8'));
  const withCols = (columns) => tmp({ ...sheetRaw, page: { ...sheetRaw.page, portfolio: { ...sheetRaw.page.portfolio, buckets: { ...sheetRaw.page.portfolio.buckets, list: sheetRaw.page.portfolio.buckets.list.map((b, i) => (i ? b : { ...b, columns })) } } } });
  assert.throws(() => loadOfficesConfig(withCols({ nope: 'Revenue' })), /buckets\.list\[0\]\.columns\.nope/);
  assert.throws(() => loadOfficesConfig(withCols({ netCollections: '' })), /buckets\.list\[0\]\.columns\.netCollections/);
  assert.deepEqual(['month', 'quarter', 'ytd', 'lastYear', 'custom'], ['month', 'quarter', 'ytd', 'lastYear', 'custom'], 'VJ 2026-10-28: Month, Last quarter, YTD, Last year, Custom');
  assert.deepEqual(sheet.picker.list.map((g) => g.key), ['sabuska', 'dental', 'management', 'dentalRe', 'nonDentalRe', 'other', 'nonOperational'], 'picker: practices and management companies under separate headings');
  assert.equal(Object.keys(sheet.naming.companies).length >= 12, true, 'DBA names from the org-structure sheet');
  // picker groups go by company, so a sub-DSO lands in the management group even though it pairs with a practice in the list.
  const picker = { list: [{ key: 'dental', label: 'Dental companies', companies: [], categories: ['Dental Companies'] }, { key: 'mgmt', label: 'Dental Management', companies: [], categories: ['Dental Management (z & zz)'] }, { key: 'other', label: 'Other', companies: [], categories: [] }], rest: 'other' };
  assert.deepEqual(companies.map((c) => bucketOf({ companies: [c] }, picker, categoryOf)), companies.map((c) => ({ 'Dental Companies': 'dental', 'Dental Management (z & zz)': 'mgmt' })[categoryOf(c.realmId)] || 'other'));
});

const office = { key: 'o', name: 'Dental Office - Test', companies: [{ realmId: 'D', name: 'IN Luxia Dental LLC' }, { realmId: 'S', name: 'zz subDSO IndianaPolis' }], aliases: ['CT Luxia'] };
const L = (realmId, month, grp, account, amount, entity = null, fullName = null) => ({ realmId, month, grp, accountId: account, account, fullName: fullName || account, entity, amount });

test('partner names are matched loosely, plus aliases', () => {
  assert.equal(isPartnerName('z SubDSO Indianapolis', office, 'D'), true);
  assert.equal(isPartnerName('Luxia Dental LLC', office, 'S'), true);
  assert.equal(isPartnerName('Luxia Dental LLC', office, 'D'), false, 'a company is not its own partner');
  assert.equal(isPartnerName('CT Luxia', office, 'S'), true);
  assert.equal(isPartnerName('Sabuska 9045', office, 'D'), false);
  assert.equal(isPartnerName('', office, 'D'), false);
});

test('internal charges: only the matched part is removed, by payee name or by account', () => {
  const lines = [
    L('D', '2026-05', 'Expenses', '901 Uncategorized Expense', 30000, 'z SubDSO Indianapolis'),
    L('D', '2026-05', 'Expenses', '901 Uncategorized Expense', 500, 'Eversource'), // outside vendor: not a candidate
    L('S', '2026-05', 'Income', '402.2 Management Income', 35000, 'Luxia Dental LLC'),
    L('D', '2026-06', 'Expenses', 'Management Expenses:Rent', 4000, null, 'Management Expenses:Rent'), // by account, no payee
    L('S', '2026-06', 'Income', '405 Uncategorized Income', 3000),
    L('S', '2026-06', 'Expenses', '650 Management Fee:650.3 Others', 2000, 'Sabuska'), // DSO fee: not internal
  ];
  const ic = eliminateInternal(lines, office, cfg);
  assert.deepEqual(ic['2026-05'], { expense: 30000, income: 35000, matched: 30000 });
  assert.equal(lines[0].internal, 30000);
  assert.equal(lines[1].internal, 0);
  assert.ok(Math.abs(lines[2].internal - 30000) < 0.01, 'income side loses the same amount');
  assert.deepEqual(ic['2026-06'], { expense: 4000, income: 3000, matched: 3000 });
  assert.equal(lines[5].internal, 0);
  assert.deepEqual(eliminateInternal(lines, { ...office, companies: [office.companies[0]] }, cfg), {}, 'one company: nothing to eliminate');
});

test('classification: rows, payroll taxes, memo lines', () => {
  const k = (grp, account, fullName) => classifyLine(L('D', '2026-01', grp, account, 1, null, fullName), cfg);
  assert.deepEqual(k('Income', '402.3 Medicaid'), { kind: 'row', key: 'netCollections' });
  assert.deepEqual(k('OtherIncome', '801.3 Non Operation Income'), { kind: 'memo', key: 'otherIncome' });
  assert.deepEqual(k('Expenses', '501 Associate Dentist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', 'Dentist', '503 Contract Labor:503.1 Dental Contract Labor:Dentist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', '502 Dental Assistant'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '576 Payroll Tax Expense'), { kind: 'tax', key: 'payrollTaxes' });
  assert.deepEqual(k('Expenses', '505 HR Recruiting & Training Expense'), { kind: 'row', key: 'trainingHiring' });
  assert.deepEqual(k('Expenses', '517.2 Staff Training', '517 Continuing Ed & Training Courses:517.2 Staff Training'), { kind: 'row', key: 'trainingHiring' }, 'staff training is training, not payroll');
  assert.deepEqual(k('Expenses', '517.3 Dental Drs & Staff License', '517 Continuing Ed & Training Courses:517.3 Dental Drs & Staff License'), { kind: 'row', key: 'trainingHiring' });
  assert.deepEqual(k('Expenses', 'Staff', '503 Contract Labor:503.1 Dental Contract Labor:Staff'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '536.4 Implant Lab', '536 Dental Labs:536.4 Implant Lab'), { kind: 'row', key: 'laboratory' }, 'implant lab is a lab fee');
  assert.deepEqual(k('Expenses', '521.1 Implants', '521 Dental Supplies:521.1 Implants'), { kind: 'row', key: 'dentalSupplies' });
  assert.deepEqual(k('Expenses', 'Supplies & Labs', 'Management Expenses:Supplies & Labs'), { kind: 'row', key: 'dentalSupplies' });
  assert.deepEqual(k('Expenses', '521.2 Other Dental Supplies'), { kind: 'row', key: 'dentalSupplies' });
  assert.deepEqual(k('Expenses', '536.1 Fixed Labs'), { kind: 'row', key: 'laboratory' });
  assert.deepEqual(k('Expenses', '559.1 Rent & Fees'), { kind: 'row', key: 'occupancy' });
  assert.deepEqual(k('Expenses', '586.1 Electric'), { kind: 'row', key: 'occupancy' });
  assert.deepEqual(k('Expenses', '507.1 Digital Advertising'), { kind: 'row', key: 'marketing' });
  assert.deepEqual(k('Expenses', '540.1 Small Dental Equipment', '540 Equipment Lease Expense:540.1 Small Dental Equipment'), { kind: 'row', key: 'otherExpenses' }, 'small equipment lease is not its own row');
  assert.deepEqual(k('Expenses', '506.3 Bonus', '506 Employee Benefits Expense:506.3 Bonus'), { kind: 'tax', key: 'payrollTaxes' }, 'benefits and bonuses are split like payroll taxes');
  assert.deepEqual(k('Expenses', '560.1 Dental', '560 Repairs & Maintenance:560.1 Dental'), { kind: 'row', key: 'dentalSupplies' }, 'dental equipment maintenance counts as supplies');
  assert.deepEqual(k('Expenses', '560.2 Non Dental', '560 Repairs & Maintenance:560.2 Non Dental'), { kind: 'row', key: 'occupancy' });
  assert.deepEqual(k('Expenses', '650.1 Corporation Overhead Charges', '650 Management Fee:650.1 Corporation Overhead Charges'), { kind: 'row', key: 'managementFees' });
  assert.deepEqual(k('OtherExpenses', '802.1 Management Profit', '802 Profits:802.1 Management Profit'), { kind: 'memo', key: 'profitTransfers' });
  assert.deepEqual(k('Expenses', '520 Depreciation Expense'), { kind: 'memo', key: 'notOperating' });
  assert.deepEqual(k('Expenses', '542 Legal & Professional Fees'), { kind: 'row', key: 'otherExpenses' });
});

test('statement: rows by month, tax allocation, subtotals, memo lines, period and prior year', () => {
  const lines = [
    L('D', '2026-05', 'Income', '402.3 Medicaid', 100000),
    L('D', '2026-05', 'Income', '401 Refunds', -1000),
    L('S', '2026-05', 'Expenses', '501 Associate Dentist', 30000),
    L('S', '2026-05', 'Expenses', '502 Dental Assistant', 10000),
    L('S', '2026-05', 'Expenses', '576 Payroll Tax Expense', 4000),
    L('S', '2026-05', 'Expenses', '521.2 Other Dental Supplies', 6000),
    L('S', '2026-05', 'Expenses', '542 Legal & Professional Fees', 1500),
    L('S', '2026-05', 'Expenses', '650.3 Others', 5000, 'Sabuska', '650 Management Fee:650.3 Others'),
    L('S', '2026-05', 'Expenses', '520 Depreciation Expense', 9000),
    L('S', '2026-05', 'OtherExpenses', '802.1 Management Profit', 20000, 'Sabuska', '802 Profits:802.1 Management Profit'),
    L('D', '2026-05', 'Expenses', '901 Uncategorized Expense', 30000, 'z SubDSO Indianapolis'),
    L('S', '2026-05', 'Income', '402.2 Management Income', 35000, 'Luxia Dental LLC'),
    L('D', '2025-05', 'Income', '402.3 Medicaid', 80000),
  ];
  const window = periodWindow('2026-05', 'month');
  const st = buildStatement(lines, office, cfg, { window, months: ['2026-04', '2026-05'], cashFlow: { '2026-05': 12345 } });
  const row = (k) => st.rows.find((r) => r.key === k);
  assert.equal(row('netCollections').months['2026-05'], 99000, 'collections net of refunds; the unmatched 5,000 of internal income is not patient collections');
  assert.equal(row('netCollections').prior, 80000);
  assert.equal(row('providerComp').months['2026-05'], 33000, '30,000 + 3/4 of payroll taxes');
  assert.equal(row('staffPayroll').months['2026-05'], 11000, '10,000 + 1/4 of payroll taxes');
  assert.ok(row('providerComp').children.some((c) => c.allocated && c.months['2026-05'] === 3000));
  assert.equal(row('dentalSupplies').months['2026-05'], 6000);
  assert.equal(row('otherExpenses').months['2026-05'], 1500, 'uncategorized expense to the sub-DSO was eliminated in full');
  assert.equal(row('ebitdaBeforeFees').months['2026-05'], 99000 - 33000 - 11000 - 6000 - 1500);
  assert.equal(row('managementFees').months['2026-05'], 5000);
  assert.equal(row('officeEbitda').months['2026-05'], 99000 - 33000 - 11000 - 6000 - 1500 - 5000);
  assert.equal(row('operatingCashFlow').months['2026-05'], 12345);
  assert.equal(row('operatingCashFlow').months['2026-04'], 0);
  const memo = Object.fromEntries(st.memo.map((m) => [m.key, m]));
  assert.equal(memo.notOperating.months['2026-05'], 9000);
  assert.equal(memo.profitTransfers.months['2026-05'], 20000);
  assert.equal(memo.internalIncome.months['2026-05'], 5000, 'the unmatched internal income is a memo line with its account');
  assert.ok(memo.internalIncome.children.some((c) => c.fullName === '402 Management Income' && Math.abs(c.months['2026-05'] - 5000) < 0.01), 'sub-account rolled up into its main account');
  assert.equal(memo.internalUnmatched, undefined, 'expense side: unmatched stays in the rows (internal.expense.unmatched = rows)');
  assert.deepEqual(st.internalPeriod, { expense: 30000, income: 35000, matched: 30000 });
  // internal.expense.unmatched = memo: the unmatched part of an internal charge leaves the cost rows too.
  const memoBoth = buildStatement([
    L('D', '2026-05', 'Income', '402.3 Medicaid', 100000),
    L('D', '2026-05', 'Expenses', '901 Uncategorized Expense', 30000, 'z SubDSO Indianapolis'),
    L('S', '2026-05', 'Income', '402.2 Management Income', 10000, 'Luxia Dental LLC'),
  ], office, { ...cfg, internal: { ...cfg.internal, expense: { ...cfg.internal.expense, unmatched: 'memo' } } }, { window, months: ['2026-05'] });
  assert.equal(memoBoth.rows.find((r) => r.key === 'otherExpenses').months['2026-05'], 0);
  assert.equal(memoBoth.memo.find((m) => m.key === 'internalUnmatched').months['2026-05'], 20000);
  assert.equal(memoBoth.rows.find((r) => r.key === 'netCollections').months['2026-05'], 100000);
  assert.equal(st.uncategorizedPeriod, 0, 'the eliminated part does not count as uncategorized');
  assert.ok(row('netCollections').children.every((c) => typeof c.period === 'number'));
  const sub = buildStatement([
    L('D', '2026-05', 'Income', '402.1 Cash/Patient Checks', 100, null, '402 Income:402.1 Cash/Patient Checks'),
    L('D', '2026-05', 'Income', '402.2a Insurance Checks', 50, null, '402 Income:402.2 Insurance Checks & EFT`s:402.2a Insurance Checks'),
    L('S', '2026-05', 'Expenses', '5000.1 Total Payroll Expenses', 10, null, '5000.1 Total Payroll Expenses'),
  ], office, cfg, { window, months: ['2026-05'] });
  assert.deepEqual(sub.rows.find((r) => r.key === 'netCollections').children.map((c) => [c.account, c.period]), [['402 Income', 150]], 'sub-accounts roll up into the main account');
  assert.deepEqual(sub.rows.find((r) => r.key === 'staffPayroll').children.map((c) => c.account), ['5000 Total Payroll Expenses']);
  const noRoll = buildStatement([L('D', '2026-05', 'Income', '402.1 Cash/Patient Checks', 100, null, '402 Income:402.1 Cash/Patient Checks')], office, { ...cfg, statement: { rollUpSubAccounts: false } }, { window, months: ['2026-05'] });
  assert.equal(noRoll.rows.find((r) => r.key === 'netCollections').children[0].account, '402.1 Cash/Patient Checks');
});

test('flags', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const keys = (s) => flagsFor({ collections: 100000, prior: 100000, ebitda: 1000, cash: 100000, ar: 50000, monthlyCosts: 90000, monthlyCollections: 100000, uncategorized: 0, internalUnmatched: 0, lastChange: '2026-10-19T08:00:00Z', lastActivity: '2026-10', pullErrors: false, ...s }, cfg, { asOf: '2026-10', now }).map((f) => f.key);
  assert.deepEqual(keys({}), []);
  assert.deepEqual(keys({ ebitda: -1 }), ['netLoss']);
  assert.deepEqual(keys({ collections: 85000 }), ['collectionsDown']);
  assert.deepEqual(keys({ uncategorized: 5000 }), ['uncategorized']);
  assert.deepEqual(keys({ cash: 10000 }), ['lowCash']);
  assert.deepEqual(keys({ ar: 250000 }), ['arHigh']);
  assert.deepEqual(keys({ lastActivity: '2026-08' }), ['booksBehind']);
  assert.deepEqual(keys({ lastChange: '2026-10-01T08:00:00Z' }), ['stale']);
  assert.deepEqual(keys({ internalUnmatched: 9000 }), ['internalUnmatched']);
  assert.deepEqual(keys({ pullErrors: true }), ['pullFailed']);
});

test('balance sheet tree merges the two companies by account path and derives retained earnings', () => {
  const acc = {
    D: { b1: { name: 'Checking', fullName: 'Checking', type: 'Bank' }, ar: { name: 'Accounts Receivable', fullName: 'Accounts Receivable', type: 'Accounts Receivable' }, i1: { name: 'Income', fullName: 'Income', type: 'Income' }, eq: { name: 'Owner equity', fullName: 'Owner equity', type: 'Equity' } },
    S: { b2: { name: 'Checking', fullName: 'Checking', type: 'Bank' }, ap: { name: 'Accounts Payable', fullName: 'Accounts Payable', type: 'Accounts Payable' }, ln: { name: 'SBA', fullName: 'Loans:SBA', type: 'Long Term Liability' }, lp: { name: 'Loans', fullName: 'Loans', type: 'Long Term Liability' }, e1: { name: 'Rent', fullName: 'Rent', type: 'Expense' } },
  };
  const sections = balanceTree([
    { realmId: 'D', accountId: 'b1', now: 1000, prior: 800 }, { realmId: 'S', accountId: 'b2', now: 500, prior: 0 },
    { realmId: 'D', accountId: 'ar', now: 300, prior: 300 }, { realmId: 'S', accountId: 'ap', now: -200, prior: -100 },
    { realmId: 'S', accountId: 'ln', now: -700, prior: -900 }, { realmId: 'D', accountId: 'eq', now: -100, prior: -100 },
    { realmId: 'D', accountId: 'i1', now: -2000, prior: -1000 }, { realmId: 'S', accountId: 'e1', now: 1200, prior: 1000 },
  ], (id) => acc[id]);
  const [assets, liabilities, equity] = sections;
  assert.equal(assets.now, 1800);
  const bank = assets.groups.find((g) => g.label === 'Bank Accounts');
  assert.equal(bank.nodes.length, 1, 'same-named checking accounts merge');
  assert.equal(bank.nodes[0].companies, 2);
  assert.equal(bank.nodes[0].now, 1500);
  assert.equal(liabilities.now, 900);
  const lt = liabilities.groups.find((g) => g.label === 'Long-Term Liabilities');
  assert.equal(lt.nodes[0].name, 'Loans');
  assert.equal(lt.nodes[0].children[0].name, 'SBA');
  assert.equal(lt.nodes[0].now, 700);
  assert.equal(equity.now, 100 + (2000 - 1200), 'equity + cumulative net income');
  assert.equal(equity.groups.find((g) => g.label === 'Net income (cumulative)').prior, 0);
  assert.equal(assets.now, liabilities.now + equity.now, 'balances');
});

test('saved combinations: create, edit, delete; a company may be in several; offices are not replaced', async () => {
  const { openDb } = await import('../server/db.js');
  const { initOfficesSchema, listSavedOffices, saveOffice, deleteOffice } = await import('../server/offices/store.js');
  const db = openDb(':memory:');
  initOfficesSchema(db);
  const a = saveOffice(db, { name: 'Combined: Bakersfield, Branford', companies: ['1', '2'], aliases: ['CA Bakersfield', ''] });
  assert.deepEqual(a.companies, ['1', '2']);
  assert.deepEqual(a.aliases, ['CA Bakersfield']);
  const b = saveOffice(db, { name: 'Other', companies: ['2', '3'] });
  assert.deepEqual(listSavedOffices(db).map((s) => s.companies), [['1', '2'], ['2', '3']], 'company 2 stays in both combinations');
  saveOffice(db, { id: b.id, name: 'Other renamed', companies: ['3'] });
  assert.equal(listSavedOffices(db).find((s) => s.id === b.id).name, 'Other renamed');
  assert.throws(() => saveOffice(db, { companies: [] }), /at least one company/);
  assert.throws(() => saveOffice(db, { id: 999, companies: ['1'] }), /not found/);
  const cos = [{ realmId: '1', officeName: 'A Dental', city: 'Q', state: 'Z' }, { realmId: '2', officeName: 'B subDSO', city: 'Q', state: 'Z' }, { realmId: '3', officeName: 'C Dental', city: 'R', state: 'Z' }];
  const combos = combinedOffices(listSavedOffices(db), cos);
  assert.deepEqual(combos.map((o) => [o.key, o.name, o.companies.map((c) => c.realmId), o.combined]), [[`combined-${a.id}`, 'Combined: Bakersfield, Branford', ['1', '2'], true], [`combined-${b.id}`, 'Other renamed', ['3'], true]]);
  assert.equal(combinedOffices(listSavedOffices(db), cos.slice(0, 1)).length, 1, 'only companies the user may see; a combination with none is dropped');
  const offices = resolveOffices(cos, testCfg, () => 'Dental Companies');
  assert.equal(offices.length, 2, 'the offices themselves are unaffected by combinations');
  deleteOffice(db, listSavedOffices(db)[0].id);
  assert.equal(listSavedOffices(db).length, 1, 'removing one combination leaves the other');
  deleteOffice(db, listSavedOffices(db)[0].id);
  assert.equal(listSavedOffices(db).length, 0);
  assert.throws(() => deleteOffice(db, 123), /not found/);
  db.close();
});
