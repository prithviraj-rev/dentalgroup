import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfitAndLoss } from '../server/pnlParser.js';

const money = (title, start) => ({
  ColTitle: title,
  ColType: 'Money',
  MetaData: start ? [{ Name: 'StartDate', Value: start }, { Name: 'ColKey', Value: title }] : [{ Name: 'ColKey', Value: 'total' }],
});
const data = (name, ...vals) => ({ type: 'Data', ColData: [{ value: name, id: '1' }, ...vals.map((value) => ({ value }))] });
const summary = (name, ...vals) => ({ ColData: [{ value: name }, ...vals.map((value) => ({ value }))] });

// Abridged shape of a real sandbox ProfitAndLoss response with summarize_column_by=Month.
const report = {
  Header: { ReportName: 'ProfitAndLoss', Currency: 'USD' },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      money('Aug 2026', '2026-08-01'),
      money('Sep 2026', '2026-09-01'),
      money('Total'),
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section', group: 'Income',
        Header: { ColData: [{ value: 'Income' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: {
          Row: [
            data('Design income', '100.00', '', '100.00'),
            {
              type: 'Section',
              Header: { ColData: [{ value: 'Landscaping Services', id: '45' }, { value: '' }, { value: '' }, { value: '' }] },
              Rows: {
                Row: [
                  data('Landscaping Services', '10.00', '5.00', '15.00'),
                  {
                    type: 'Section',
                    Header: { ColData: [{ value: 'Job Materials', id: '46' }, { value: '' }, { value: '' }, { value: '' }] },
                    Rows: { Row: [data('Fountains and Garden Lighting', '200.50', '300.25', '500.75')] },
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
        Header: { ColData: [{ value: 'Cost of Goods Sold' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: { Row: [data('Cost of Goods Sold', '50.00', '0.00', '50.00')] },
        Summary: summary('Total Cost of Goods Sold', '50.00', '0.00', '50.00'),
      },
      { type: 'Section', group: 'GrossProfit', Summary: summary('Gross Profit', '260.50', '305.25', '565.75') },
      {
        type: 'Section', group: 'Expenses',
        Header: { ColData: [{ value: 'Expenses' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: { Row: [data('Advertising', '75.00', '-5.00', '70.00')] },
        Summary: summary('Total Expenses', '75.00', '-5.00', '70.00'),
      },
      { type: 'Section', group: 'NetOperatingIncome', Summary: summary('Net Operating Income', '185.50', '310.25', '495.75') },
      {
        type: 'Section', group: 'OtherExpenses',
        Header: { ColData: [{ value: 'Other Expenses' }, { value: '' }, { value: '' }, { value: '' }] },
        Rows: { Row: [data('Miscellaneous', '', '12.00', '12.00')] },
        Summary: summary('Total Other Expenses', '', '12.00', '12.00'),
      },
      { type: 'Section', group: 'NetIncome', Summary: summary('Net Income', '185.50', '298.25', '483.75') },
    ],
  },
};

test('flattens leaf accounts, skips totals/summaries, keeps sub-account paths', () => {
  const rows = parseProfitAndLoss(report);
  assert.deepEqual(rows, [
    { account_name: 'Design income', account_type: 'Income', period: '2026-08', amount: 100 },
    { account_name: 'Landscaping Services', account_type: 'Income', period: '2026-08', amount: 10 },
    { account_name: 'Landscaping Services', account_type: 'Income', period: '2026-09', amount: 5 },
    { account_name: 'Landscaping Services:Job Materials:Fountains and Garden Lighting', account_type: 'Income', period: '2026-08', amount: 200.5 },
    { account_name: 'Landscaping Services:Job Materials:Fountains and Garden Lighting', account_type: 'Income', period: '2026-09', amount: 300.25 },
    { account_name: 'Cost of Goods Sold', account_type: 'Cost of Goods Sold', period: '2026-08', amount: 50 },
    { account_name: 'Advertising', account_type: 'Expense', period: '2026-08', amount: 75 },
    { account_name: 'Advertising', account_type: 'Expense', period: '2026-09', amount: -5 },
    { account_name: 'Miscellaneous', account_type: 'Other Expense', period: '2026-09', amount: 12 },
  ]);
});

test('leaf rows reconcile to the report Net Income per month', () => {
  const rows = parseProfitAndLoss(report);
  const sign = { Income: 1, 'Other Income': 1, 'Cost of Goods Sold': -1, Expense: -1, 'Other Expense': -1 };
  const net = (p) => rows.filter((r) => r.period === p).reduce((s, r) => s + sign[r.account_type] * r.amount, 0);
  assert.equal(net('2026-08'), 185.5);
  assert.equal(net('2026-09'), 298.25);
});

test('falls back to column titles when StartDate metadata is missing', () => {
  const r = structuredClone(report);
  r.Columns.Column[1].MetaData = [];
  assert.equal(parseProfitAndLoss(r)[0].period, '2026-08');
});

test('empty report yields no rows', () => {
  assert.deepEqual(parseProfitAndLoss({ Header: {}, Columns: { Column: [] }, Rows: {} }), []);
});
