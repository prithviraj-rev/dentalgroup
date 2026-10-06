import React, { useMemo, useState } from 'react';
import { fmtMoney, groupLabel } from '../format.js';

function Amount({ value, strong }) {
  const neg = value < 0;
  return (
    <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right ${strong ? 'font-medium' : ''} ${neg ? 'text-bad' : ''} ${value === 0 ? 'text-muted' : ''}`}>
      {value === 0 ? '–' : fmtMoney(value)}
    </td>
  );
}

/**
 * Accounts grouped by grp with one column per `data.periods` entry (periods, or offices when the
 * API was called with by=office) plus a total. Group sign (+ income, − expense) comes from config.
 */
export default function BreakdownTable({ data, config, title = 'Account breakdown', firstColumn = 'Account' }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (g) => setCollapsed((c) => ({ ...c, [g]: !c[g] }));

  const { periods, groups, accounts } = data;
  const sign = (g) => (config.groups.expenseGroups.includes(g) ? -1 : config.groups.incomeGroups.includes(g) ? 1 : 0);

  const byGroup = useMemo(() => {
    const m = Object.fromEntries(groups.map((g) => [g, []]));
    for (const a of accounts) (m[a.grp] ||= []).push(a);
    return m;
  }, [groups, accounts]);

  const subtotal = (rows) => {
    const t = Object.fromEntries(periods.map((p) => [p.key, 0]));
    let total = 0;
    for (const a of rows) {
      for (const p of periods) t[p.key] += a.periods[p.key] || 0;
      total += a.total;
    }
    return { periods: t, total };
  };

  const net = useMemo(() => {
    const t = Object.fromEntries(periods.map((p) => [p.key, 0]));
    let total = 0;
    for (const g of groups) {
      const s = subtotal(byGroup[g] || []);
      for (const p of periods) t[p.key] += sign(g) * s.periods[p.key];
      total += sign(g) * s.total;
    }
    return { periods: t, total };
  }, [periods, groups, byGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-muted">Click a group to collapse it</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-xs text-ink2">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">{firstColumn}</th>
              {periods.map((p) => (
                <th key={p.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p.label}</th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const rows = byGroup[g] || [];
              if (rows.length === 0) return null;
              const s = subtotal(rows);
              const isCollapsed = Boolean(collapsed[g]);
              return (
                <React.Fragment key={g}>
                  <tr className="cursor-pointer border-t border-[var(--line)] bg-page hover:bg-surface" onClick={() => toggle(g)}>
                    <td className="sticky left-0 z-10 bg-page px-4 py-2 font-medium">
                      <button type="button" className="flex items-center gap-2" aria-expanded={!isCollapsed}>
                        <span className="inline-block w-3 text-muted" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                        {groupLabel(g)}
                        <span className="text-xs font-normal text-muted">{rows.length}</span>
                      </button>
                    </td>
                    {periods.map((p) => <Amount key={p.key} value={s.periods[p.key]} strong />)}
                    <Amount value={s.total} strong />
                  </tr>
                  {!isCollapsed &&
                    rows.map((a) => (
                      <tr key={a.accountName} className="border-t border-[var(--line)] hover:bg-page">
                        <td className="sticky left-0 z-10 bg-surface px-4 py-1.5 pl-9 text-ink2">{a.accountName}</td>
                        {periods.map((p) => <Amount key={p.key} value={a.periods[p.key] || 0} />)}
                        <Amount value={a.total} />
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
            <tr className="border-t-2 border-[var(--axis)]">
              <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-semibold">Net income</td>
              {periods.map((p) => <Amount key={p.key} value={net.periods[p.key]} strong />)}
              <Amount value={net.total} strong />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
