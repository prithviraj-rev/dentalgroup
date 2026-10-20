import React from 'react';
import { fmtMetric, fmtChange, metric as metricOf, officeColor } from '../format.js';

/** YoY change: % change for money metrics, percentage points for ratios. */
export function Delta({ cur, prev, upIsGood, compact, metricKey = 'netIncome' }) {
  if (prev == null) return <span className="text-xs text-muted">No prior-year data</span>;
  if (cur == null) return <span className="text-xs text-muted">n/a</span>;
  const up = cur - prev > 0;
  const flat = cur === prev;
  const good = flat ? null : up === upIsGood;
  const cls = good == null ? 'text-ink2' : good ? 'text-good' : 'text-bad';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return (
    <span className={`text-xs ${cls}`}>
      <span aria-hidden="true">{arrow} </span>
      {fmtChange(metricKey, cur, prev)}{compact ? ' YoY' : <> vs {fmtMetric(metricKey, prev)} last year</>}
    </span>
  );
}

const KPI_KEYS = ['income', 'expenses', 'netIncome'];

function Tile({ m, totals, prior, yoy, small }) {
  const v = totals?.[m.key];
  return (
    <div className={`card flex flex-col gap-1 ${small ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2 text-sm text-ink2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
        {small ? m.label : `Total ${m.label.toLowerCase()}`}
      </div>
      <div className={`${small ? 'text-xl' : 'text-3xl'} font-semibold ${v < 0 ? 'text-bad' : ''}`}>{fmtMetric(m.key, m.format === 'percent' ? v : v ?? 0)}</div>
      {yoy && (m.format === 'percent' && v == null ? <span className="text-xs text-muted">No revenue in this period</span> : <Delta metricKey={m.key} cur={v ?? 0} prev={prior ? prior[m.key] ?? null : null} upIsGood={m.upIsGood} />)}
    </div>
  );
}

/** Single-office / all-offices view: headline tiles plus a configurable secondary row. */
export default function KpiCards({ totals, prior, yoy, secondary = [] }) {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {KPI_KEYS.map(metricOf).map((m) => <Tile key={m.key} m={m} totals={totals} prior={prior} yoy={yoy} />)}
      </div>
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {secondary.map(metricOf).map((m) => <Tile key={m.key} m={m} totals={totals} prior={prior} yoy={yoy} small />)}
        </div>
      )}
    </div>
  );
}

const DETAIL_KEYS = ['revenue', 'grossProfit', 'operatingExpenses', 'netIncome', 'netMargin'];

/** Compare view: one tile per office, with the chosen metric as the hero figure and the others beneath. */
export function CompareKpis({ offices, priorOffices, yoy, metricKey, colorIndexOf }) {
  const hero = metricOf(metricKey);
  const others = DETAIL_KEYS.filter((k) => k !== metricKey).slice(0, 4).map(metricOf);
  const prior = Object.fromEntries((priorOffices || []).map((o) => [o.realmId, o.totals]));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {offices.map((o) => (
        <div key={o.realmId} className="card flex flex-col gap-1 p-4" style={{ borderTop: `3px solid ${officeColor(colorIndexOf(o.realmId))}` }}>
          <div className="truncate text-sm font-medium" title={o.officeName}>{o.officeName}</div>
          <div className="text-xs text-ink2">{hero.label}</div>
          <div className={`text-2xl font-semibold ${o.totals[metricKey] < 0 ? 'text-bad' : ''}`}>{fmtMetric(metricKey, o.totals[metricKey])}</div>
          {yoy && <Delta metricKey={metricKey} cur={o.totals[metricKey]} prev={prior[o.realmId]?.[metricKey] ?? null} upIsGood={hero.upIsGood} compact />}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
            {others.map((m) => (
              <React.Fragment key={m.key}>
                <dt className="text-ink2">{m.label}</dt>
                <dd className="tabular text-right">{fmtMetric(m.key, o.totals[m.key])}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
