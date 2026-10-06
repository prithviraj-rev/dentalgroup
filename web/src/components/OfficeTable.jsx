import React from 'react';
import { fmtMoney, fmtPct, pctChange, metric as metricOf, officeColor } from '../format.js';

const cell = (v, strong) =>
  `tabular whitespace-nowrap px-3 py-1.5 text-right ${strong ? 'font-medium' : ''} ${v < 0 ? 'text-bad' : ''} ${v === 0 ? 'text-muted' : ''}`;

/** Compare view: offices as rows, periods as columns, for one metric. */
export default function OfficeTable({ periods, offices, metricKey, colorIndexOf, yoy, priorOffices }) {
  const m = metricOf(metricKey);
  const prior = Object.fromEntries((priorOffices || []).map((o) => [o.realmId, o.totals]));
  const combined = Object.fromEntries(periods.map((p) => [p.key, 0]));
  let combinedTotal = 0;
  for (const o of offices) {
    for (const p of periods) combined[p.key] += o.periods[p.key]?.[metricKey] ?? 0;
    combinedTotal += o.totals[metricKey];
  }
  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-sm font-medium">{m.label} per office per period</h2>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-xs text-ink2">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">Office</th>
              {periods.map((p) => <th key={p.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p.label}</th>)}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total</th>
              {yoy && <th className="whitespace-nowrap px-3 py-2 text-right font-medium">YoY</th>}
            </tr>
          </thead>
          <tbody>
            {offices.map((o) => {
              const prev = prior[o.realmId]?.[metricKey];
              const p = prev != null ? pctChange(o.totals[metricKey], prev) : null;
              const good = p == null || p === 0 ? null : (p > 0) === m.upIsGood;
              return (
                <tr key={o.realmId} className="border-t border-[var(--line)] hover:bg-page">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: officeColor(colorIndexOf(o.realmId)) }} aria-hidden="true" />
                      {o.officeName}
                    </span>
                  </td>
                  {periods.map((per) => {
                    const v = o.periods[per.key]?.[metricKey] ?? 0;
                    return <td key={per.key} className={cell(v)}>{v === 0 ? '–' : fmtMoney(v)}</td>;
                  })}
                  <td className={cell(o.totals[metricKey], true)}>{fmtMoney(o.totals[metricKey])}</td>
                  {yoy && (
                    <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right text-xs ${good == null ? 'text-muted' : good ? 'text-good' : 'text-bad'}`}>
                      {prev == null ? 'n/a' : fmtPct(p)}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t-2 border-[var(--axis)]">
              <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-semibold">Combined</td>
              {periods.map((p) => <td key={p.key} className={cell(combined[p.key], true)}>{fmtMoney(combined[p.key])}</td>)}
              <td className={cell(combinedTotal, true)}>{fmtMoney(combinedTotal)}</td>
              {yoy && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
