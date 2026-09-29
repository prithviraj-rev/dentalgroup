import React, { useMemo, useState } from 'react';
import { accountMatrix, fmtMoney } from './pnl.js';

const SECTIONS = [
  { type: 'Income', total: 'Total Income', metric: 'revenue' },
  { type: 'Cost of Goods Sold', total: 'Total Cost of Goods Sold', metric: 'cogs' },
  { key: 'Gross Profit', metric: 'grossProfit' },
  { type: 'Expense', total: 'Total Expenses', metric: 'opex' },
  { key: 'Net Operating Income', metric: 'netOperating' },
  { type: 'Other Income', total: 'Total Other Income', metric: 'otherIncome', optional: true },
  { type: 'Other Expense', total: 'Total Other Expenses', metric: 'otherExpense', optional: true },
  { key: 'Net Income', metric: 'netIncome' },
];

const Cell = ({ v }) => <td className={v < 0 ? 'neg' : undefined}>{v ? fmtMoney(v) : '–'}</td>;

/** P&L statement: accounts grouped by type with QBO-style subtotals; one column per bucket plus a range total. */
export default function PnlTable({ rows, months, granularity, buckets, total }) {
  const [collapsed, setCollapsed] = useState({});
  const [showAccounts, setShowAccounts] = useState(true);
  const matrix = useMemo(() => accountMatrix(rows, months, granularity), [rows, months, granularity]);
  const toggle = (t) => setCollapsed((c) => ({ ...c, [t]: !c[t] }));

  const body = [];
  for (const s of SECTIONS) {
    if (s.key) {
      body.push(
        <tr className="key-total" key={s.key}>
          <td>{s.key}</td>
          {buckets.map((b) => <Cell key={b.key} v={b[s.metric]} />)}
          <Cell v={total[s.metric]} />
        </tr>
      );
      continue;
    }
    const accounts = matrix[s.type];
    if (s.optional && accounts.length === 0) continue;
    const open = showAccounts && !collapsed[s.type];
    body.push(
      <tr className="type" key={s.type} onClick={() => toggle(s.type)} title="Click to expand/collapse">
        <td>{open ? '▾' : '▸'} {s.type}</td>
        <td colSpan={buckets.length + 1} />
      </tr>
    );
    if (open) {
      for (const a of accounts) {
        body.push(
          <tr className="acct" key={`${s.type}/${a.name}`}>
            <td title={a.name}>{a.name}</td>
            {buckets.map((b) => <Cell key={b.key} v={a.cells[b.key]} />)}
            <Cell v={a.cells.total} />
          </tr>
        );
      }
    }
    body.push(
      <tr className="subtotal" key={s.total}>
        <td>{s.total}</td>
        {buckets.map((b) => <Cell key={b.key} v={b[s.metric]} />)}
        <Cell v={total[s.metric]} />
      </tr>
    );
  }

  return (
    <>
      <div className="card-head">
        <h2>Profit &amp; loss statement</h2>
        <label className="check">
          <input type="checkbox" checked={showAccounts} onChange={(e) => setShowAccounts(e.target.checked)} /> Show accounts
        </label>
      </div>
      <div className="table-wrap">
        <table className="pnl">
          <thead>
            <tr>
              <th>Account</th>
              {buckets.map((b) => (
                <th key={b.key}>
                  {b.label}
                  {b.partial && <span className="partial" title={`${b.months} month(s) in range`}>*</span>}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {buckets.some((b) => b.partial) && <p className="note">* Partial period: not all months fall inside the selected range.</p>}
    </>
  );
}
