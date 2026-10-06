import React from 'react';
import { fmtMoney, fmtPct, pctChange, metric as metricOf, officeColor } from '../format.js';

export function Delta({ cur, prev, upIsGood, compact }) {
  if (prev == null) return <span className="text-xs text-muted">No prior-year data</span>;
  const p = pctChange(cur, prev);
  const up = cur - prev > 0;
  const flat = cur === prev;
  const good = flat ? null : up === upIsGood;
  const cls = good == null ? 'text-ink2' : good ? 'text-good' : 'text-bad';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return (
    <span className={`text-xs ${cls}`}>
      <span aria-hidden="true">{arrow} </span>
      {fmtPct(p)}{compact ? ' YoY' : <> vs {fmtMoney(prev)} last year</>}
    </span>
  );
}

const KPI_KEYS = ['income', 'expenses', 'netIncome'];

/** Single-office / all-offices view: one tile per metric. */
export default function KpiCards({ totals, prior, yoy }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {KPI_KEYS.map(metricOf).map((m) => (
        <div key={m.key} className="card flex flex-col gap-1 p-4">
          <div className="flex items-center gap-2 text-sm text-ink2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
            Total {m.label.toLowerCase()}
          </div>
          <div className="text-3xl font-semibold">{fmtMoney(totals?.[m.key] ?? 0)}</div>
          {yoy && <Delta cur={totals?.[m.key] ?? 0} prev={prior ? prior[m.key] : null} upIsGood={m.upIsGood} />}
        </div>
      ))}
    </div>
  );
}

/** Compare view: one tile per office, with the chosen metric as the hero figure and the others beneath. */
export function CompareKpis({ offices, priorOffices, yoy, metricKey, colorIndexOf }) {
  const hero = metricOf(metricKey);
  const others = KPI_KEYS.filter((k) => k !== metricKey).map(metricOf);
  const prior = Object.fromEntries((priorOffices || []).map((o) => [o.realmId, o.totals]));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {offices.map((o) => (
        <div key={o.realmId} className="card flex flex-col gap-1 p-4" style={{ borderTop: `3px solid ${officeColor(colorIndexOf(o.realmId))}` }}>
          <div className="truncate text-sm font-medium" title={o.officeName}>{o.officeName}</div>
          <div className="text-xs text-ink2">{hero.label}</div>
          <div className="text-2xl font-semibold">{fmtMoney(o.totals[metricKey])}</div>
          {yoy && <Delta cur={o.totals[metricKey]} prev={prior[o.realmId]?.[metricKey] ?? null} upIsGood={hero.upIsGood} compact />}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
            {others.map((m) => (
              <React.Fragment key={m.key}>
                <dt className="text-ink2">{m.label}</dt>
                <dd className="tabular text-right">{fmtMoney(o.totals[m.key])}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
