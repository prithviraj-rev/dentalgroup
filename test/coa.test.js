import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoaTree } from '../server/coa.js';

const buckets = [{ key: '2026-01', label: 'Jan 2026' }, { key: '2026-02', label: 'Feb 2026' }];
const acct = (realm, id, name, fqn, type, classification, extra = {}) => ({
  office_realm_id: realm, office_name: `Office ${realm}`, account_id: id, name, fully_qualified_name: fqn,
  account_type: type, account_sub_type: null, classification, parent_id: null, sub_account: 0, active: 1, current_balance: 0, ...extra,
});

const accountsA = [
  acct('A', '1', 'Services', 'Services', 'Income', 'Revenue'),
  acct('A', '2', 'Cleanings', 'Services:Cleanings', 'Income', 'Revenue', { parent_id: '1', sub_account: 1 }),
  acct('A', '3', 'Rent', 'Rent', 'Expense', 'Expense'),
  acct('A', '4', 'Old account', 'Old account', 'Expense', 'Expense', { active: 0 }),
  acct('A', '9', 'Checking', 'Checking', 'Bank', 'Asset', { current_balance: 500 }),
];
const linesA = [
  { realmId: 'A', accountId: '1', accountName: 'Services', grp: 'Income', period: '2026-01', amount: 100 },
  { realmId: 'A', accountId: '2', accountName: 'Cleanings', grp: 'Income', period: '2026-01', amount: 50 },
  { realmId: 'A', accountId: '2', accountName: 'Cleanings', grp: 'Income', period: '2026-02', amount: 25 },
  { realmId: 'A', accountId: '3', accountName: 'Rent', grp: 'Expenses', period: '2026-01', amount: 40 },
  { realmId: 'A', accountId: 'name:Misc', accountName: 'Misc', grp: 'Expenses', period: '2026-02', amount: 5 },
];

test('single office: parent rolls up its own amounts plus sub-accounts; net income = revenue - expense', () => {
  const t = buildCoaTree({ accounts: accountsA, lines: linesA, buckets, merge: false });
  const revenue = t.sections.find((s) => s.classification === 'Revenue');
  const services = revenue.types[0].nodes.find((n) => n.name === 'Services');
  assert.equal(services.own['2026-01'], 100);
  assert.equal(services.periods['2026-01'], 150);
  assert.equal(services.total, 175);
  assert.equal(services.children[0].name, 'Cleanings');
  assert.equal(services.children[0].depth, 1);
  assert.deepEqual(revenue.periods, { '2026-01': 150, '2026-02': 25 });
  assert.deepEqual(t.netIncome, { periods: { '2026-01': 110, '2026-02': 20 }, total: 130 });
  // balance sheet accounts are excluded unless asked for
  assert.equal(t.sections.some((s) => s.classification === 'Asset'), false);
});

test('inactive accounts are kept with a flag; lines without a matching account become unmapped leaves', () => {
  const t = buildCoaTree({ accounts: accountsA, lines: linesA, buckets, merge: false });
  const expense = t.sections.find((s) => s.classification === 'Expense').types.find((x) => x.accountType === 'Expense');
  const old = expense.nodes.find((n) => n.name === 'Old account');
  assert.equal(old.active, false);
  assert.equal(old.hasActivity, false);
  const misc = expense.nodes.find((n) => n.name === 'Misc');
  assert.equal(misc.unmapped, true);
  assert.equal(misc.total, 5);
  assert.equal(t.unmappedCount, 1);
  assert.equal(t.accountCount, 4);
});

test('balance sheet accounts appear with their current balance when requested', () => {
  const t = buildCoaTree({ accounts: accountsA, lines: linesA, buckets, merge: false, includeBalanceSheet: true });
  const asset = t.sections.find((s) => s.classification === 'Asset');
  assert.equal(asset.types[0].accountType, 'Bank');
  assert.equal(asset.balance, 500);
});

test('several offices merge by type + fully qualified name and sum amounts', () => {
  const accountsB = [
    acct('B', '7', 'Services', 'Services', 'Income', 'Revenue'),
    acct('B', '8', 'Whitening', 'Services:Whitening', 'Income', 'Revenue', { parent_id: '7', sub_account: 1 }),
  ];
  const linesB = [
    { realmId: 'B', accountId: '7', accountName: 'Services', grp: 'Income', period: '2026-01', amount: 10 },
    { realmId: 'B', accountId: '8', accountName: 'Whitening', grp: 'Income', period: '2026-02', amount: 30 },
  ];
  const t = buildCoaTree({ accounts: [...accountsA, ...accountsB], lines: [...linesA, ...linesB], buckets, merge: true });
  const income = t.sections.find((s) => s.classification === 'Revenue').types[0];
  assert.equal(income.nodes.length, 1);
  const services = income.nodes[0];
  assert.deepEqual(services.offices.sort(), ['A', 'B']);
  assert.equal(services.own['2026-01'], 110);
  assert.deepEqual(services.children.map((c) => c.name), ['Cleanings', 'Whitening']);
  assert.equal(services.total, 215); // A: 100 + 50 + 25, B: 10 + 30
});
