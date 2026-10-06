// Flattens a QBO ProfitAndLoss report (summarize_column_by=Month) into rows:
//   { account_name, account_id, grp, period_start, period_end, amount }
//
// Report shape:
//   Columns.Column[0]        account-name column
//   Columns.Column[1..n-1]   one per month; true dates in MetaData StartDate / EndDate
//   Columns.Column[n]        "Total" (ignored)
//   Rows.Row[]               recursive. type "Section" = { Header?, Rows?.Row[], Summary? }
//                            type "Data"    = leaf account line, ColData[0] = { value: name, id: account id }
//   Top-level sections carry `group`: Income | COGS | GrossProfit | Expenses | NetOperatingIncome |
//   OtherIncome | OtherExpenses | NetOtherIncome | NetIncome.
//
// Rules:
//   - emit one row per non-empty month cell of every Data row
//   - a Section whose Header has an account id AND amounts (a parent account with its own postings)
//     also emits rows for its header amounts
//   - Summary rows are never stored; computed groups (GrossProfit, NetOperatingIncome, NetOtherIncome,
//     NetIncome) are skipped entirely
//   - the nearest top-level group is propagated down as `grp`

export const GROUPS = ['Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses'];

const COMPUTED_GROUPS = new Set(['GrossProfit', 'NetOperatingIncome', 'NetOtherIncome', 'NetIncome']);

// Fallback when a top-level section has no `group` field: map its header title.
const HEADER_TO_GROUP = {
  income: 'Income',
  'cost of goods sold': 'COGS',
  expenses: 'Expenses',
  'other income': 'OtherIncome',
  'other expenses': 'OtherExpenses',
};

function monthColumns(columns) {
  const last = columns.length - 1;
  return columns.map((col, i) => {
    if (i === 0 || i === last) return null; // account column / Total column
    const meta = Object.fromEntries((col.MetaData || []).map((m) => [m.Name, m.Value]));
    if (!meta.StartDate || !meta.EndDate) return null;
    return { start: meta.StartDate, end: meta.EndDate };
  });
}

export function parseProfitAndLoss(report) {
  const columns = report?.Columns?.Column || [];
  const periods = monthColumns(columns);
  const out = [];

  const emit = (colData, grp) => {
    const first = colData?.[0];
    const name = first?.value?.trim();
    if (!name) return;
    const id = first.id != null && String(first.id) !== '' ? String(first.id) : null;
    colData.forEach((cell, i) => {
      const p = periods[i];
      if (!p) return;
      const raw = cell?.value;
      if (raw == null || String(raw).trim() === '') return; // empty string = no value
      const amount = parseFloat(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(amount)) return;
      out.push({ account_name: name, account_id: id, grp, period_start: p.start, period_end: p.end, amount });
    });
  };

  const walk = (rows, grp, depth) => {
    for (const row of rows?.Row || []) {
      const isSection = row.type === 'Section' || row.Rows != null;
      if (isSection) {
        let g = grp;
        if (depth === 0) {
          const header = row.Header?.ColData?.[0]?.value?.trim().toLowerCase();
          g = row.group || HEADER_TO_GROUP[header] || null;
          if (!g || COMPUTED_GROUPS.has(g)) continue;
        }
        if (!g) continue;
        const h = row.Header?.ColData;
        if (h?.[0]?.id != null && String(h[0].id) !== '') emit(h, g); // parent account with own amounts
        walk(row.Rows, g, depth + 1);
        continue; // Summary rows are intentionally ignored
      }
      if (row.type === 'Data' && row.ColData && grp) emit(row.ColData, grp);
    }
  };

  walk(report?.Rows, null, 0);
  return out;
}

/**
 * Collapse rows onto the storage key (account_id, period_start). Rows without an account id
 * get a stable synthetic id derived from the name so the unique index still applies.
 */
export function dedupeForStorage(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const account_id = r.account_id ?? `name:${r.account_name}`;
    const key = `${account_id}|${r.period_start}`;
    const prev = byKey.get(key);
    if (prev) prev.amount = Math.round((prev.amount + r.amount) * 100) / 100;
    else byKey.set(key, { ...r, account_id });
  }
  return [...byKey.values()];
}
