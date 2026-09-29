// Flattens a QBO ProfitAndLoss report (summarize_column_by=Month) into
// { account_name, account_type, period: 'YYYY-MM', amount } rows.
//
// Report shape (abridged):
//   Columns.Column: [{ColType:'Account'}, {ColType:'Money', MetaData:[{Name:'StartDate',Value:'2024-10-01'},...]}, ..., {ColTitle:'Total'}]
//   Rows.Row: top-level Sections with group Income | COGS | GrossProfit | Expenses | NetOperatingIncome |
//             OtherIncome | OtherExpenses | NetOtherIncome | NetIncome.
//   Parent accounts are nested Sections (Header = parent name, Summary = "Total <parent>").
//
// Only leaf Data rows are kept - Summary/total rows are skipped so SUM() in SQL never double counts.
// Amounts are stored as reported: expenses are positive numbers under an expense account_type.

export const ACCOUNT_TYPES = {
  Income: 'Income',
  COGS: 'Cost of Goods Sold',
  Expenses: 'Expense',
  OtherIncome: 'Other Income',
  OtherExpenses: 'Other Expense',
};

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function columnPeriod(col) {
  if (col.ColType !== 'Money') return null;
  const meta = Object.fromEntries((col.MetaData || []).map((m) => [m.Name, m.Value]));
  if (meta.StartDate) return meta.StartDate.slice(0, 7);
  // Fallback for titles like "Jan 2025" or "Jan 1-15, 2025"
  const m = /^([A-Z][a-z]{2})\b.*?(\d{4})$/.exec(col.ColTitle || '');
  return m && MONTHS[m[1]] ? `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}` : null;
}

export function parseProfitAndLoss(report) {
  const periods = (report?.Columns?.Column || []).map(columnPeriod);
  const out = [];

  const walk = (rows, accountType, parents) => {
    for (const row of rows?.Row || []) {
      if (row.Rows || row.type === 'Section') {
        const header = row.Header?.ColData?.[0]?.value;
        if (accountType) {
          // Nested section = parent account with sub-accounts.
          walk(row.Rows, accountType, header ? [...parents, header] : parents);
        } else {
          // Top-level section: GrossProfit / NetIncome etc. have no Rows, so they fall through harmlessly.
          const type = ACCOUNT_TYPES[row.group] || header;
          if (type) walk(row.Rows, type, []);
        }
        continue;
      }

      const cells = row.ColData;
      if (!cells || !accountType) continue;
      const name = cells[0]?.value?.trim();
      if (!name) continue;
      // A parent's own postings appear as a Data row named after the parent.
      const pathParts = parents.at(-1) === name ? parents : [...parents, name];
      const accountName = pathParts.join(':');

      cells.forEach((cell, i) => {
        const period = periods[i];
        if (!period || cell.value === '' || cell.value == null) return;
        const amount = Number(cell.value);
        if (!Number.isFinite(amount) || amount === 0) return;
        out.push({ account_name: accountName, account_type: accountType, period, amount });
      });
    }
  };

  walk(report?.Rows, null, []);
  return out;
}
