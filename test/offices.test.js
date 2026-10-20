import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOfficesConfig } from '../server/offices/config.js';
import { resolveOffices, periodWindow, isPartnerName, eliminateInternal, classifyLine, buildStatement, flagsFor, balanceTree } from '../server/offices/offices.js';
import { officePl, monthlyPl } from '../server/offices/pl.js';

test('client-sheet offices config: extends offices.json, rows hold exactly the account numbers of the sheet', () => {
  const sheet = loadOfficesConfig(path.resolve('config/offices-sheet.json'));
  assert.equal(sheet.rows.length, 14, 'the sheet has 14 rows incl. Small Equipment Lease');
  assert.deepEqual(sheet.rows.map((r) => r.key), ['netCollections', 'providerComp', 'staffPayroll', 'trainingHiring', 'dentalSupplies', 'laboratory', 'occupancy', 'marketing', 'smallEquipmentLease', 'otherExpenses', 'ebitdaBeforeFees', 'managementFees', 'officeEbitda', 'operatingCashFlow']);
  assert.equal(sheet.naming.pattern, cfg.naming.pattern, 'inherited');
  assert.equal(sheet.internal.income.unmatched, cfg.internal.income.unmatched, 'inherited');
  assert.equal(sheet.payrollTaxes.re, null, 'no proportional split: 576 / 506.2 / 506.3 are whole rows of Provider Compensation');
  assert.equal(sheet.cashFlow.includeLoanPayments, true);
  assert.equal(cfg.cashFlow.includeLoanPayments, false);
  const k = (grp, account, fullName) => classifyLine(L('D', '2026-01', grp, account, 1, null, fullName), sheet);
  assert.deepEqual(k('Income', '402.1 Cash/Patient Checks', '402 Income:402.1 Cash/Patient Checks'), { kind: 'row', key: 'netCollections' });
  assert.deepEqual(k('Income', '401 Refunds', '402 Income:401 Refunds'), { kind: 'row', key: 'netCollections' });
  assert.deepEqual(k('Income', '405 Uncategorized Income'), { kind: 'memo', key: 'unassignedIncome' }, 'income the sheet does not assign is not collections');
  assert.deepEqual(k('Expenses', 'Dentist', '503 Contract Labor:503.1 Dental Contract Labor:Dentist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', 'Staff', '503 Contract Labor:503.1 Dental Contract Labor:Staff'), { kind: 'row', key: 'providerComp' }, 'sheet: all of 503.1');
  assert.deepEqual(k('Expenses', '504 Hygienist', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', '576 Payroll Tax Expense', '5000.1 Total Payroll Expenses:550.1 Payroll Taxes & Fees:576 Payroll Tax Expense'), { kind: 'row', key: 'providerComp' }, 'whole, not split');
  assert.deepEqual(k('Expenses', '506.3 Bonus', '506 Employee Benefits Expense:506.3 Bonus'), { kind: 'row', key: 'providerComp' });
  assert.deepEqual(k('Expenses', '506.1 Health Insurance', '506 Employee Benefits Expense:506.1 Health Insurance'), { kind: 'row', key: 'otherExpenses' }, 'not in the sheet');
  assert.deepEqual(k('Expenses', "500 Doctor's payroll", "5000.1 Total Payroll Expenses:5000.2 Payroll Expense:500 Doctor's payroll"), { kind: 'row', key: 'otherExpenses' }, 'sheet column E does not list 500');
  assert.deepEqual(k('Expenses', '503 Staff Payroll', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:503 Staff Payroll'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '503.3 Temp Agency', '503 Contract Labor:503.3 Temp Agency'), { kind: 'row', key: 'staffPayroll' });
  assert.deepEqual(k('Expenses', '502 Dental Assistant', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:502 Dental Assistant'), { kind: 'row', key: 'otherExpenses' }, 'not in the sheet');
  assert.deepEqual(k('Expenses', '517.2 Staff Training', '517 Continuing Ed & Training Courses:517.2 Staff Training'), { kind: 'row', key: 'trainingHiring' });
  assert.deepEqual(k('Expenses', '560.1 Dental', '560 Repairs & Maintenance:560.1 Dental'), { kind: 'row', key: 'otherExpenses' }, 'sheet: repairs 560 are Other');
  assert.deepEqual(k('Expenses', '586.1 Electric', '586 Electric, Gas, Water & Trash:586.1 Electric'), { kind: 'row', key: 'otherExpenses' }, 'sheet: rent is 559 only');
  assert.deepEqual(k('Expenses', '559.2 Common Area Maintenance', '559 Rent & NNN:559.2 Common Area Maintenance'), { kind: 'row', key: 'occupancy' });
  assert.deepEqual(k('Expenses', '540.1 Small Dental Equipment', '540 Equipment Lease Expense:540.1 Small Dental Equipment'), { kind: 'row', key: 'smallEquipmentLease' });
  assert.deepEqual(k('Expenses', '540.2 Non-Dental', '540 Equipment Lease Expense:540.2 Non-Dental'), { kind: 'row', key: 'otherExpenses' });
  assert.deepEqual(k('Expenses', '650.1 Corporation Overhead Charges', '650 Management Fee:650.1 Corporation Overhead Charges'), { kind: 'row', key: 'managementFees' });
  assert.deepEqual(k('Expenses', '520 Depreciation Expense'), { kind: 'memo', key: 'notOperating' }, 'inherited');
  assert.deepEqual(k('OtherExpenses', '802.1 Management Profit', '802 Profits:802.1 Management Profit'), { kind: 'memo', key: 'profitTransfers' }, 'inherited');
  // The accounts behind a row are shown at the level the rule matched.
  const st = buildStatement([
    L('S', '2026-05', 'Expenses', '504 Hygienist', 100, null, '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist'),
    L('S', '2026-05', 'Expenses', 'Dentist', 50, null, '503 Contract Labor:503.1 Dental Contract Labor:Dentist'),
    L('S', '2026-05', 'Expenses', 'Staff', 25, null, '503 Contract Labor:503.1 Dental Contract Labor:Staff'),
    L('S', '2026-05', 'Expenses', '503.3 Temp Agency', 10, null, '503 Contract Labor:503.3 Temp Agency'),
    L('D', '2026-05', 'Income', '402.1 Cash', 1000, null, '402 Income:402.1 Cash'),
  ], office, sheet, { window: periodWindow('2026-05', 'month'), months: ['2026-05'] });
  const children = (key) => st.rows.find((r) => r.key === key).children.map((c) => [c.account, c.fullName, c.period]);
  assert.deepEqual(children('providerComp'), [['504 Hygienist', '5000.1 Total Payroll Expenses:5000.2 Payroll Expense:504 Hygienist', 100], ['503.1 Dental Contract Labor', '503 Contract Labor:503.1 Dental Contract Labor', 75]], 'Dentist and Staff roll up into 503.1');
  assert.deepEqual(children('staffPayroll'), [['503 Contract Labor', '503 Contract Labor', 10]], 'rule 503 matches the top level, so 503.3 rolls up into it');
  assert.deepEqual(children('netCollections'), [['402 Income', '402 Income', 1000]]);
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

test('period windows: month, last full quarter, YTD, TTM and the prior year', () => {
  assert.deepEqual(periodWindow('2026-10', 'month'), { key: 'month', label: 'Month', from: '2026-10', to: '2026-10', priorFrom: '2025-10', priorTo: '2025-10' });
  assert.deepEqual(periodWindow('2026-10', 'quarter'), { key: 'quarter', label: 'Q3 2026', from: '2026-07', to: '2026-09', priorFrom: '2025-07', priorTo: '2025-09' });
  assert.equal(periodWindow('2026-09', 'quarter').to, '2026-09');
  assert.deepEqual(periodWindow('2026-10', 'ytd', 1).from, '2026-01');
  assert.deepEqual(periodWindow('2026-03', 'ytd', 7).from, '2025-07');
  assert.deepEqual(periodWindow('2026-10', 'ttm').from, '2025-11');
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

test('saved offices: create, move a company between offices, delete, merge with config pairs', async () => {
  const { openDb } = await import('../server/db.js');
  const { initOfficesSchema, listSavedOffices, saveOffice, deleteOffice, mergeExplicit } = await import('../server/offices/store.js');
  const db = openDb(':memory:');
  initOfficesSchema(db);
  const a = saveOffice(db, { name: 'Dental Office - Bakersfield', city: 'Bakersfield', state: 'CA', companies: ['1', '2'], aliases: ['CA Bakersfield', ''] });
  assert.deepEqual(a.companies, ['1', '2']);
  assert.deepEqual(a.aliases, ['CA Bakersfield']);
  const b = saveOffice(db, { name: 'Other', companies: ['2', '3'] });
  assert.deepEqual(listSavedOffices(db).map((s) => s.companies), [['1'], ['2', '3']], 'company 2 moved to the new office');
  saveOffice(db, { id: b.id, name: 'Other renamed', companies: ['3'] });
  assert.equal(listSavedOffices(db).find((s) => s.id === b.id).name, 'Other renamed');
  saveOffice(db, { companies: ['1', '3'] });
  assert.deepEqual(listSavedOffices(db).map((s) => s.companies), [['1', '3']], 'emptied offices are removed');
  assert.throws(() => saveOffice(db, { companies: [] }), /at least one company/);
  assert.throws(() => saveOffice(db, { id: 999, companies: ['1'] }), /not found/);
  const explicit = mergeExplicit(listSavedOffices(db), [{ companies: ['1', '9'], city: 'X', state: 'Y', aliases: [] }, { companies: ['7'], aliases: [] }]);
  assert.deepEqual(explicit.map((o) => o.companies), [['1', '3'], ['9'], ['7']], 'saved offices win; config pair keeps its other company');
  assert.equal(explicit[0].saved, true);
  const offices = resolveOffices([{ realmId: '1', officeName: 'A Dental', city: 'Q', state: 'Z' }, { realmId: '3', officeName: 'B subDSO', city: 'Q', state: 'Z' }], { ...testCfg, offices: explicit }, () => 'Dental Companies');
  assert.equal(offices.length, 1);
  assert.equal(offices[0].saved, true);
  deleteOffice(db, listSavedOffices(db)[0].id);
  assert.equal(listSavedOffices(db).length, 0);
  assert.throws(() => deleteOffice(db, 123), /not found/);
  db.close();
});
