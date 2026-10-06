import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfitAndLoss, dedupeForStorage } from '../server/pnlParser.js';
import { openDb, upsertPlLines } from '../server/db.js';
import { derive } from '../server/api.js';

const month = (title, start, end) => ({
  ColTitle: title,
  ColType: 'Money',
  MetaData: [{ Name: 'StartDate', Value: start }, { Name: 'EndDate', Value: end }, { Name: 'ColKey', Value: title }],
});
const data = (name, id, ...vals) => ({ type: 'Data', ColData: [{ value: name, id }, ...vals.map((value) => ({ value }))] });
const summary = (name, ...vals) => ({ ColData: [{ value: name }, ...vals.map((value) => ({ value }))] });
const header = (name, id, ...vals) => ({ ColData: [id ? { value: name, id } : { value: name }, ...vals.map((value) => ({ value }))] });

// Abridged shape of a real sandbox ProfitAndLoss response with summarize_column_by=Month.
const report = {
  Header: { ReportName: 'ProfitAndLoss', Currency: 'USD' },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      month('Aug 2026', '2026-08-01', '2026-08-31'),
      month('Sep 2026', '2026-09-01', '2026-09-30'),
      { ColTitle: 'Total', ColType: 'Money', MetaData: [{ Name: 'ColKey', Value: 'total' }] },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section', group: 'Income',
        Header: header('Income', null, '', '', ''),
        Rows: {
          Row: [
            data('Design income', '82', '100.00', '', '100.00'),
            {
              type: 'Section',
              // Parent account with its own postings: amounts live in the Header ColData.
              Header: header('Landscaping Services', '45', '10.00', '5.00', '15.00'),
              Rows: {
                Row: [
                  {
                    type: 'Section',
                    Header: header('Job Materials', '46', '', '', ''),
                    Rows: { Row: [data('Fountains and Garden Lighting', '48', '200.50', '300.25', '500.75')] },
                    Summary: summary('Total Job Materials', '200.50', '300.25', '500.75'),
                  },
                ],
              },
              Summary: summary('Total Landscaping Services', '210.50', '305.25', '515.75'),
            },
          ],
        },
        Summary: summary('Total Income', '310.50', '305.25', '615.75'),
      },
      {
        type: 'Section', group: 'COGS',
        Header: header('Cost of Goods Sold', null, '', '', ''),
        Rows: { Row: [data('Cost of Goods Sold', '80', '50.00', '0.00', '50.00')] },
        Summary: summary('Total Cost of Goods Sold', '50.00', '0.00', '50.00'),
      },
      { type: 'Section', group: 'GrossProfit', Summary: summary('Gross Profit', '260.50', '305.25', '565.75') },
      {
        type: 'Section', group: 'Expenses',
        Header: header('Expenses', null, '', '', ''),
        Rows: { Row: [data('Advertising', '7', '75.00', '-5.00', '70.00')] },
        Summary: summary('Total Expenses', '75.00', '-5.00', '70.00'),
      },
      { type: 'Section', group: 'NetOperatingIncome', Summary: summary('Net Operating Income', '185.50', '310.25', '495.75') },
      {
        type: 'Section', group: 'OtherExpenses',
        Header: header('Other Expenses', null, '', '', ''),
        Rows: { Row: [data('Miscellaneous', '31', '', '12.00', '12.00')] },
        Summary: summary('Total Other Expenses', '', '12.00', '12.00'),
      },
      { type: 'Section', group: 'NetOtherIncome', Summary: summary('Net Other Income', '', '-12.00', '-12.00') },
      { type: 'Section', group: 'NetIncome', Summary: summary('Net Income', '185.50', '298.25', '483.75') },
    ],
  },
};

test('flattens Data rows and parent-header amounts; skips summaries, totals and computed groups', () => {
  const rows = parseProfitAndLoss(report);
  assert.deepEqual(rows, [
    { account_name: 'Design income', account_id: '82', grp: 'Income', period_start: '2026-08-01', period_end: '2026-08-31', amount: 100 },
    { account_name: 'Landscaping Services', account_id: '45', grp: 'Income', period_start: '2026-08-01', period_end: '2026-08-31', amount: 10 },
    { account_name: 'Landscaping Services', account_id: '45', grp: 'Income', period_start: '2026-09-01', period_end: '2026-09-30', amount: 5 },
    { account_name: 'Fountains and Garden Lighting', account_id: '48', grp: 'Income', period_start: '2026-08-01', period_end: '2026-08-31', amount: 200.5 },
    { account_name: 'Fountains and Garden Lighting', account_id: '48', grp: 'Income', period_start: '2026-09-01', period_end: '2026-09-30', amount: 300.25 },
    { account_name: 'Cost of Goods Sold', account_id: '80', grp: 'COGS', period_start: '2026-08-01', period_end: '2026-08-31', amount: 50 },
    { account_name: 'Cost of Goods Sold', account_id: '80', grp: 'COGS', period_start: '2026-09-01', period_end: '2026-09-30', amount: 0 },
    { account_name: 'Advertising', account_id: '7', grp: 'Expenses', period_start: '2026-08-01', period_end: '2026-08-31', amount: 75 },
    { account_name: 'Advertising', account_id: '7', grp: 'Expenses', period_start: '2026-09-01', period_end: '2026-09-30', amount: -5 },
    { account_name: 'Miscellaneous', account_id: '31', grp: 'OtherExpenses', period_start: '2026-09-01', period_end: '2026-09-30', amount: 12 },
  ]);
});

test('emitted rows reconcile to the report Net Income per month', () => {
  const rows = parseProfitAndLoss(report);
  const net = (start) => {
    const groups = {};
    for (const r of rows) if (r.period_start === start) groups[r.grp] = (groups[r.grp] || 0) + r.amount;
    return derive(groups).netIncome;
  };
  assert.equal(net('2026-08-01'), 185.5);
  assert.equal(net('2026-09-01'), 298.25);
});

test('top-level sections without a group fall back to the header title', () => {
  const r = structuredClone(report);
  delete r.Rows.Row[0].group;
  assert.equal(parseProfitAndLoss(r)[0].grp, 'Income');
});

test('rows without an account id get a synthetic id and duplicates are summed', () => {
  const rows = dedupeForStorage([
    { account_name: 'Misc', account_id: null, grp: 'Expenses', period_start: '2026-01-01', period_end: '2026-01-31', amount: 1.1 },
    { account_name: 'Misc', account_id: null, grp: 'Expenses', period_start: '2026-01-01', period_end: '2026-01-31', amount: 2.2 },
  ]);
  assert.deepEqual(rows.map((r) => [r.account_id, r.amount]), [['name:Misc', 3.3]]);
});

test('empty report yields no rows', () => {
  assert.deepEqual(parseProfitAndLoss({ Header: {}, Columns: { Column: [] }, Rows: {} }), []);
});

test('upsert is idempotent and drops stale rows inside the synced window', () => {
  const db = openDb(':memory:');
  const range = { startDate: '2026-08-01', endDate: '2026-09-30' };
  const rows = dedupeForStorage(parseProfitAndLoss(report));
  upsertPlLines(db, '1', 'Office A', rows, range);
  upsertPlLines(db, '1', 'Office A', rows, range);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pl_lines').get().n, rows.length);

  upsertPlLines(db, '1', 'Office A', rows.slice(0, 3), range);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pl_lines').get().n, 3);
  db.close();
});
