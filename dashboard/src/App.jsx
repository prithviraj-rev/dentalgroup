import React, { useEffect, useMemo, useState } from 'react';
import {
  METRICS, addMonths, monthsBetween, monthLabel, bucketize, totalsFor,
  yoySeries, topAccounts, officeTotals, fmtCompact, fmtMoney, fmtPct, pctChange,
} from './pnl.js';
import { TrendChart, YoyChart, RankedBars } from './charts.jsx';
import PnlTable from './PnlTable.jsx';

const VIEWS = [
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'yoy', label: 'YOY' },
];
const PRESETS = [
  { id: 'all', label: 'All synced months' },
  { id: '24', label: 'Last 24 months' },
  { id: '12', label: 'Last 12 months' },
  { id: '6', label: 'Last 6 months' },
  { id: '3', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom range' },
];
const COST_TYPES = ['Cost of Goods Sold', 'Expense', 'Other Expense'];
// Optional initial state from the URL, e.g. ?office=all&view=yoy&timeline=12&metric=netIncome
const initial = new URLSearchParams(window.location.search);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function Tile({ label, value, prev, downIsGood, extra, priorLabel }) {
  const change = prev == null ? null : pctChange(value, prev);
  let delta = <span>No prior-period data</span>;
  if (change != null) {
    const up = change >= 0;
    const cls = `${up ? 'up' : 'down'}-${up !== !!downIsGood ? 'good' : 'bad'}`;
    delta = (
      <>
        <span className={cls}>{up ? '▲' : '▼'} {fmtPct(change).replace('+', '')}</span> vs {priorLabel}
      </>
    );
  }
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value" title={fmtMoney(value)}>{fmtCompact(value)}</div>
      <div className="delta">{delta}{extra && <> · {extra}</>}</div>
    </div>
  );
}

function MetricSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Metric">
      {['revenue', 'grossProfit', 'costs', 'netIncome'].map((m) => <option key={m} value={m}>{METRICS[m].short || METRICS[m].label}</option>)}
    </select>
  );
}

export default function App() {
  const [offices, setOffices] = useState(null);
  const [realm, setRealm] = useState(initial.get('office') || 'all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(initial.get('view') || 'month');
  const [preset, setPreset] = useState(initial.get('timeline') || 'all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [metric, setMetric] = useState(initial.get('metric') || 'revenue');

  useEffect(() => {
    getJson('/api/offices').then(setOffices).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setData(null);
    getJson(`/api/pnl?realm=${encodeURIComponent(realm)}`).then(setData).catch((e) => setError(e.message));
  }, [realm]);

  // Continuous month axis over everything synced for the current selection.
  const allMonths = useMemo(() => {
    if (!data?.accounts.length) return [];
    const ps = data.accounts.map((r) => r.period).sort();
    return monthsBetween(ps[0], ps[ps.length - 1]);
  }, [data]);

  const months = useMemo(() => {
    if (!allMonths.length) return [];
    const first = allMonths[0];
    const last = allMonths[allMonths.length - 1];
    let from = first;
    let to = last;
    if (preset === 'ytd') from = `${last.slice(0, 4)}-01`;
    else if (preset === 'custom') {
      from = custom.from || first;
      to = custom.to || last;
      if (from > to) [from, to] = [to, from];
    } else if (preset !== 'all') from = addMonths(last, -(Number(preset) - 1));
    return monthsBetween(from < first ? first : from, to);
  }, [allMonths, preset, custom]);

  const rows = data?.accounts ?? [];
  const granularity = view === 'yoy' ? 'year' : view;
  const buckets = useMemo(() => bucketize(rows, months, granularity), [rows, months, granularity]);
  const total = useMemo(() => totalsFor(rows, months), [rows, months]);

  // Prior period of equal length, only when it is fully inside the synced data.
  const prior = useMemo(() => {
    if (!months.length) return null;
    const from = addMonths(months[0], -months.length);
    if (from < allMonths[0]) return null;
    return totalsFor(rows, monthsBetween(from, addMonths(months[0], -1)));
  }, [rows, months, allMonths]);
  const priorLabel = `prior ${months.length} mo`;

  const yoy = useMemo(() => yoySeries(rows, months, metric), [rows, months, metric]);
  const allYears = useMemo(() => [...new Set(allMonths.map((p) => p.slice(0, 4)))], [allMonths]);
  const costs = useMemo(() => topAccounts(rows, months, COST_TYPES, 10), [rows, months]);
  const officeRank = useMemo(
    () => officeTotals(data?.byOffice ?? [], months)
      .map((o) => ({ name: o.office, value: o[metric] }))
      .sort((a, b) => b.value - a.value),
    [data, months, metric]
  );

  const officeName = realm === 'all' ? 'All offices (consolidated)' : offices?.find((o) => o.realm_id === realm)?.office_name;
  const lastSync = offices?.map((o) => o.synced_at).filter(Boolean).sort().at(-1);

  if (error) return <div className="app"><div className="empty">Could not load data: {error}. Is the API server running on port 3000?</div></div>;
  if (offices && offices.length === 0) {
    return (
      <div className="app">
        <div className="empty">
          <p>No P&amp;L data yet.</p>
          <p>Run <code>npm run connect</code>, connect one or more QuickBooks companies at <a href="http://localhost:3000">localhost:3000</a>, then run <code>npm run sync</code> and reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <h1>P&amp;L dashboard</h1>
        <div className="sub">
          {offices ? `${offices.length} office${offices.length === 1 ? '' : 's'}` : 'Loading…'}
          {lastSync && ` · last sync ${lastSync.slice(0, 16).replace('T', ' ')} UTC`}
          {' · '}<a href="http://localhost:3000" target="_blank" rel="noreferrer">Manage connections</a>
        </div>
      </header>

      <div className="filters">
        <label className="field">
          <span>Office</span>
          <select value={realm} onChange={(e) => setRealm(e.target.value)}>
            <option value="all">All offices (consolidated)</option>
            {offices?.map((o) => <option key={o.realm_id} value={o.realm_id}>{o.office_name}</option>)}
          </select>
        </label>
        <div className="field">
          <span>View</span>
          <Segmented options={VIEWS} value={view} onChange={setView} label="View" />
        </div>
        <label className="field">
          <span>Timeline</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {preset === 'custom' && (
          <div className="field">
            <span>From – to</span>
            <div className="range">
              <select value={custom.from || allMonths[0] || ''} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From month">
                {allMonths.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
              </select>
              –
              <select value={custom.to || allMonths.at(-1) || ''} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To month">
                {allMonths.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {!data ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          <p className="sub">
            {officeName} · {months.length ? `${monthLabel(months[0])} – ${monthLabel(months.at(-1))} (${months.length} months)` : 'no months in range'}
          </p>
          <section className="tiles">
            <Tile label="Revenue" value={total.revenue} prev={prior?.revenue} priorLabel={priorLabel} />
            <Tile
              label="Gross profit" value={total.grossProfit} prev={prior?.grossProfit} priorLabel={priorLabel}
              extra={total.revenue ? `${((total.grossProfit / total.revenue) * 100).toFixed(1)}% margin` : null}
            />
            <Tile label="Operating expenses" value={total.opex} prev={prior?.opex} priorLabel={priorLabel} downIsGood />
            <Tile
              label="Net income" value={total.netIncome} prev={prior?.netIncome} priorLabel={priorLabel}
              extra={total.revenue ? `${((total.netIncome / total.revenue) * 100).toFixed(1)}% margin` : null}
            />
          </section>

          <section className="grid">
            {view === 'yoy' ? (
              <>
                <div className="card wide">
                  <div className="card-head">
                    <h2>{METRICS[metric].label} by month, year over year</h2>
                    <MetricSelect value={metric} onChange={setMetric} />
                  </div>
                  <YoyChart years={yoy.years} allYears={allYears} data={yoy.data} metric={metric} />
                </div>
                <div className="card wide">
                  <YoyTable yoy={yoy} metric={metric} />
                </div>
              </>
            ) : (
              <div className="card wide">
                <div className="card-head">
                  <h2>Revenue, costs and net income · {view === 'month' ? 'monthly' : 'quarterly'}</h2>
                  {buckets.some((b) => b.partial) && <span className="note">Partial quarters are marked in the tooltip and table</span>}
                </div>
                <TrendChart buckets={buckets} />
              </div>
            )}

            {realm === 'all' && officeRank.length > 1 && (
              <div className="card">
                <div className="card-head">
                  <h2>{METRICS[metric].short || METRICS[metric].label} by office</h2>
                  <MetricSelect value={metric} onChange={setMetric} />
                </div>
                <RankedBars items={officeRank} color={METRICS[metric].color} name={METRICS[metric].short || METRICS[metric].label} />
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <h2>Largest cost accounts</h2>
                <span className="note">COGS, expenses and other expenses in range</span>
              </div>
              <RankedBars items={costs} color={METRICS.costs.color} name="Amount" labelWidth={200} />
            </div>
          </section>

          <section className="card">
            <PnlTable rows={rows} months={months} granularity={granularity} buckets={buckets} total={total} />
          </section>
        </>
      )}
    </div>
  );
}

/** Table view of the YOY chart: months x years, plus the change of the latest year vs the one before. */
function YoyTable({ yoy, metric }) {
  const { years, data } = yoy;
  const [prev, cur] = years.slice(-2);
  const both = data.filter((d) => cur && prev && d[cur] != null && d[prev] != null);
  const sum = (y, list) => list.reduce((s, d) => s + (d[y] ?? 0), 0);
  return (
    <>
      <div className="card-head">
        <h2>{METRICS[metric].label} · year-over-year table</h2>
        {prev && <span className="note">Total change compares only months present in both {prev} and {cur}</span>}
      </div>
      <div className="table-wrap">
        <table className="pnl">
          <thead>
            <tr>
              <th>Month</th>
              {years.map((y) => <th key={y}>{y}</th>)}
              {prev && <th>{cur} vs {prev}</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td>{d.month}</td>
                {years.map((y) => <td key={y} className={d[y] < 0 ? 'neg' : undefined}>{d[y] == null ? '–' : fmtMoney(d[y])}</td>)}
                {prev && <td>{d[cur] != null && d[prev] != null ? fmtPct(pctChange(d[cur], d[prev])) : '–'}</td>}
              </tr>
            ))}
            <tr className="key-total">
              <td>Total</td>
              {years.map((y) => <td key={y}>{fmtMoney(sum(y, data))}</td>)}
              {prev && <td>{both.length ? fmtPct(pctChange(sum(cur, both), sum(prev, both))) : '–'}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

