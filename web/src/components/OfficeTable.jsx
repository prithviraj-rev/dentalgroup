import React from 'react';
import { fmtMetric, fmtChange, metric as metricOf, officeColor } from '../format.js';

const cell = (v, strong) =>
  `tabular whitespace-nowrap px-3 py-1.5 text-right ${strong ? 'font-medium' : ''} ${v < 0 ? 'text-bad' : ''} ${!v ? 'text-muted' : ''}`;

/**
 * Compare view: offices as rows, periods as columns, for one metric. The combined row comes from the
 * server's totals for the whole selection, so ratio metrics (margins) are computed correctly.
 */
export default function OfficeTable({ periods, offices, metricKey, colorIndexOf, yoy, priorOffices, combined }) {
  const m = metricOf(metricKey);
  const prior = Object.fromEntries((priorOffices || []).map((o) => [o.realmId, o.totals]));
  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className="text-sm font-medium">{m.label} per office per period</h2>
        <span className="text-xs text-muted">{offices.length} offices</span>
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
              const cur = o.totals[metricKey];
              const prev = prior[o.realmId]?.[metricKey];
              const good = prev == null || cur === prev ? null : (cur > prev) === m.upIsGood;
              return (
                <tr key={o.realmId} className="border-t border-[var(--line)] hover:bg-page">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: officeColor(colorIndexOf(o.realmId)) }} aria-hidden="true" />
                      {o.officeName}
                    </span>
                  </td>
                  {periods.map((per) => {
                    const v = o.periods[per.key]?.[metricKey];
                    return <td key={per.key} className={cell(v)}>{fmtMetric(metricKey, v)}</td>;
                  })}
                  <td className={cell(cur, true)}>{fmtMetric(metricKey, cur)}</td>
                  {yoy && (
                    <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right text-xs ${good == null ? 'text-muted' : good ? 'text-good' : 'text-bad'}`}>
                      {prev == null ? 'n/a' : fmtChange(metricKey, cur, prev)}
                    </td>
                  )}
                </tr>
              );
            })}
            {combined && (
              <tr className="border-t-2 border-[var(--axis)]">
                <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-semibold">Combined</td>
                {periods.map((p) => <td key={p.key} className={cell(combined.periods[p.key], true)}>{fmtMetric(metricKey, combined.periods[p.key])}</td>)}
                <td className={cell(combined.total, true)}>{fmtMetric(metricKey, combined.total)}</td>
                {yoy && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
