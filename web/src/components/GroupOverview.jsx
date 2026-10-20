import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import {
  Section, Tiles, Seg, Swatches, ErrorBox, Loading, Empty, Status, SourceLine, Sparkline, ChartTip, sortTh, sorter, downloadCsv, useApi, useNarrow,
  POS, NEG, axisTick, pct1, signedPct, money, compact, monthLabel,
} from './ui.jsx';

// Group overview: segment P&Ls with intercompany eliminations, EBITDA, trailing twelve months, full-year
// outlook, office scorecard and alerts. Data from /api/group-overview (config/group-overview.json).

const SC_LABELS = { revenue: 'Revenue', revenueGrowth: 'Revenue YoY', netMargin: 'Net margin', ebitda: 'EBITDA', ebitdaMargin: 'EBITDA margin', targetsMet: 'Cost targets met' };

export default function GroupOverview({ filters, officeParam, reloadKey, onOpenOffice }) {
  const { data, loading, error } = useApi(() => api.groupOverview({ from: filters.from, to: filters.to, office: officeParam }), [filters.from, filters.to, officeParam, reloadKey]);
  const [basis, setBasis] = useState('consolidated');
  if (error) return <ErrorBox title="Could not load the group overview" error={error} />;
  if (!data) return <Loading />;
  if (!data.hasData) return <Empty title="No data for this selection">Pick another date range or office, or run a sync.</Empty>;
  const t = data.totals[basis];
  const prior = data.totals.prior;
  const comparable = data.totals.comparable;
  const sameMonths = data.totals.overlapMonths < data.totals.months ? `same ${data.totals.overlapMonths} months last year` : 'last year';
  const icTotal = data.eliminations.reduce((s, e) => s + e.eliminated, 0);
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <SourceLine source={data.source} />
      <div className="card flex flex-wrap items-end justify-between gap-3 p-3 sm:p-4">
        <Seg label="Figures" value={basis} onChange={setBasis} options={[['consolidated', 'Consolidated'], ['reported', 'As reported']]} />
        <p className="max-w-2xl text-xs text-muted">
          Consolidated removes what companies in the group charge each other ({compact(icTotal)} matched in this range), so revenue and costs are not counted twice.
          EBITDA adds back depreciation, amortization, interest and taxes. Rules: config/group-overview.json.
        </p>
      </div>
      <Tiles cols={5} items={[
        { label: 'Revenue', value: money(t.revenue), sub: prior && comparable ? `${signedPct(prior.revenue ? (comparable.revenue - prior.revenue) / Math.abs(prior.revenue) : null)} vs ${sameMonths} (consolidated)` : 'No data for last year yet' },
        { label: 'EBITDA', value: money(t.ebitda), bad: t.ebitda < 0, sub: `Margin ${pct1(t.ebitdaMargin)}` },
        { label: 'Net income', value: money(t.netIncome), bad: t.netIncome < 0, sub: `Net margin ${pct1(t.netMargin)}` },
        { label: `Trailing 12 months${data.ttm.months < 12 ? ` (${data.ttm.months} mo)` : ''}`, value: compact(data.ttm.revenue), sub: `EBITDA ${compact(data.ttm.ebitda)} · ${pct1(data.ttm.ebitdaMargin)}` },
        data.forecast.method && { label: `Full-year outlook`, value: compact(data.forecast.fullYear.revenue), sub: data.forecast.lastYear ? `${signedPct((data.forecast.fullYear.revenue - data.forecast.lastYear.revenue) / Math.abs(data.forecast.lastYear.revenue || 1))} vs last year` : `${data.forecast.actualMonths} months actual` },
      ]} />
      <Segments data={data} basis={basis} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RevenueTrend data={data} basis={basis} />
        <EbitdaTrend data={data} basis={basis} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Forecast data={data} />
        <Alerts data={data} onOpenOffice={onOpenOffice} />
      </div>
      <Scorecard data={data} onOpenOffice={onOpenOffice} />
      <Eliminations data={data} />
    </div>
  );
}

function Segments({ data, basis }) {
  const rows = data.segments;
  const cons = basis === 'consolidated';
  const elim = {
    revenue: data.totals.consolidated.revenue - data.totals.reported.revenue,
    expenses: data.totals.consolidated.expenses - data.totals.reported.expenses,
    ebitda: data.totals.consolidated.ebitda - data.totals.reported.ebitda,
    netIncome: data.totals.consolidated.netIncome - data.totals.reported.netIncome,
  };
  const total = data.totals[basis];
  const cell = 'tabular whitespace-nowrap px-2 py-1.5 text-right';
  // Like-for-like: only months with data in both years.
  const yoy = (s) => (s.prior?.revenue && s.comparable ? (s.comparable.revenue - s.prior.revenue) / Math.abs(s.prior.revenue) : null);
  return (
    <Section title={`P&L by ${data.segmentLabel ? data.segmentLabel.toLowerCase() : 'segment'}`}
      subtitle={`${cons ? 'Each segment as booked; the eliminations row removes intercompany charges to reach the consolidated group.' : 'Each segment exactly as booked in QuickBooks.'}${data.totals.overlapMonths && data.totals.overlapMonths < data.totals.months ? ` YoY uses the ${data.totals.overlapMonths} months that have data in both years.` : ''}`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-ink2">
            <tr className="border-b border-[var(--line)]">
              <th className="px-2 py-2 text-left font-medium">Segment</th>
              <th className="px-2 text-right font-medium">Companies</th>
              <th className="px-2 text-right font-medium">Revenue</th>
              <th className="px-2 text-right font-medium">YoY</th>
              <th className="px-2 text-right font-medium">Expenses</th>
              <th className="px-2 text-right font-medium">EBITDA</th>
              <th className="px-2 text-right font-medium">EBITDA margin</th>
              <th className="px-2 text-right font-medium">Net income</th>
              <th className="px-2 text-right font-medium">Intercompany in / out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.label} className="border-b border-[var(--line)]">
                <th scope="row" className="px-2 py-1.5 text-left font-normal">{s.label}</th>
                <td className={cell}>{s.offices}</td>
                <td className={cell}>{money(s.reported.revenue)}</td>
                <td className={`${cell} ${yoy(s) < 0 ? 'text-bad' : ''}`}>{signedPct(yoy(s))}</td>
                <td className={cell}>{money(s.reported.expenses)}</td>
                <td className={`${cell} ${s.reported.ebitda < 0 ? 'text-bad' : ''}`}>{money(s.reported.ebitda)}</td>
                <td className={cell}>{pct1(s.reported.ebitdaMargin)}</td>
                <td className={`${cell} ${s.reported.netIncome < 0 ? 'text-bad' : ''}`}>{money(s.reported.netIncome)}</td>
                <td className={`${cell} text-ink2`}>{compact(s.intercompany.income)} / {compact(s.intercompany.expense)}</td>
              </tr>
            ))}
            {cons && (
              <tr className="border-b border-[var(--line)] text-ink2">
                <th scope="row" className="px-2 py-1.5 text-left font-normal italic">Intercompany eliminations</th>
                <td className={cell} />
                <td className={cell}>{money(elim.revenue)}</td>
                <td className={cell} />
                <td className={cell}>{money(elim.expenses)}</td>
                <td className={cell}>{money(elim.ebitda)}</td>
                <td className={cell} />
                <td className={cell}>{money(elim.netIncome)}</td>
                <td className={cell} />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <th scope="row" className="px-2 py-2 text-left">{cons ? 'Consolidated group' : 'Total as reported'}</th>
              <td className={cell}>{rows.reduce((t, s) => t + s.offices, 0)}</td>
              <td className={cell}>{money(total.revenue)}</td>
              <td className={cell}>{data.totals.prior && data.totals.comparable && cons ? signedPct((data.totals.comparable.revenue - data.totals.prior.revenue) / Math.abs(data.totals.prior.revenue || 1)) : ''}</td>
              <td className={cell}>{money(total.expenses)}</td>
              <td className={`${cell} ${total.ebitda < 0 ? 'text-bad' : ''}`}>{money(total.ebitda)}</td>
              <td className={cell}>{pct1(total.ebitdaMargin)}</td>
              <td className={`${cell} ${total.netIncome < 0 ? 'text-bad' : ''}`}>{money(total.netIncome)}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

function RevenueTrend({ data, basis }) {
  const rows = data.monthly.map((m) => ({ label: monthLabel(m.month), now: m[basis]?.revenue ?? null, ly: m.lastYear?.revenue ?? null }));
  return (
    <Section title="Revenue by month" subtitle={`${basis === 'consolidated' ? 'Consolidated' : 'As reported'}, against the same month last year (consolidated).`}>
      <Swatches items={[{ label: 'This year', color: POS, kind: 'line' }, { label: 'Last year', color: 'var(--ink-2)', kind: 'line', dashed: true }]} />
      <div className="mt-2 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={56} />
            <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<ChartTip rows={(p) => [['This year', money(p.now), POS], ['Last year', money(p.ly), 'var(--ink-2)', true]]} />} />
            <Line dataKey="now" stroke={POS} strokeWidth={2} dot={{ r: 3, fill: POS, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="ly" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function EbitdaTrend({ data, basis }) {
  const rows = data.monthly.map((m) => ({ label: monthLabel(m.month), v: m[basis]?.ebitda ?? null, margin: m[basis]?.ebitdaMargin ?? null }));
  return (
    <Section title="EBITDA by month" subtitle="Blue = positive, red = negative.">
      <div className="mt-2 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [['EBITDA', money(p.v)], ['Margin', pct1(p.margin)]]} />} />
            <Bar dataKey="v" maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={r.v < 0 ? NEG : POS} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Forecast({ data }) {
  const f = data.forecast;
  const [k, setK] = useState('revenue');
  if (!f.method) return <Section title="Full-year outlook"><p className="text-sm text-ink2">No months of the current fiscal year in the data yet.</p></Section>;
  const rows = f.monthly.map((m) => ({ label: monthLabel(m.month), v: m[k], kind: m.kind }));
  return (
    <Section title={`Full-year outlook, ${f.fiscalYear}`}
      subtitle={`${f.actualMonths} months actual + ${f.remainingMonths} forecast (${f.method === 'seasonal' ? "last year's monthly pattern, scaled by this year's trend" : 'average of recent months'}). Consolidated.`}
      right={<Seg small value={k} onChange={setK} options={[['revenue', 'Revenue'], ['ebitda', 'EBITDA'], ['netIncome', 'Net income']]} />}>
      <div className="mb-2 grid grid-cols-3 gap-2 text-sm">
        <div><div className="text-xs text-ink2">Year to date</div><div className="font-semibold tabular">{compact(f.ytd[k])}</div></div>
        <div><div className="text-xs text-ink2">Full-year outlook</div><div className="font-semibold tabular">{compact(f.fullYear[k])}</div></div>
        <div><div className="text-xs text-ink2">Last year</div><div className="font-semibold tabular">{f.lastYear ? compact(f.lastYear[k]) : '–'}</div></div>
      </div>
      <Swatches items={[{ label: 'Actual', color: POS }, { label: 'Forecast', color: 'color-mix(in oklab, var(--series-1) 35%, var(--surface))' }]} />
      <div className="mt-2 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={8} />
            <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [[p.kind === 'actual' ? 'Actual' : 'Forecast', money(p.v)]]} />} />
            <Bar dataKey="v" maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={r.kind === 'actual' ? (r.v < 0 ? NEG : POS) : 'color-mix(in oklab, var(--series-1) 35%, var(--surface))'} stroke={r.kind === 'actual' ? undefined : POS} strokeDasharray="3 2" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Alerts({ data, onOpenOffice }) {
  const [all, setAll] = useState(false);
  const list = all ? data.alerts : data.alerts.slice(0, 8);
  const tone = { high: 'bad', medium: 'warn', low: 'info' };
  const label = { high: 'High', medium: 'Watch', low: 'Note' };
  return (
    <Section title="Alerts" subtitle="Cost spikes against each office's own recent months, revenue drops vs last year, loss streaks and costs over target.">
      {data.alerts.length === 0 ? <p className="py-6 text-center text-sm text-ink2"><Status tone="good">Nothing flagged for this range</Status></p> : (
        <ul className="divide-y divide-[var(--line)]">
          {list.map((a, i) => (
            <li key={i} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="w-16 shrink-0"><Status tone={tone[a.severity]}>{label[a.severity]}</Status></div>
              <div className="min-w-0 flex-1 text-sm">
                <button type="button" className="font-medium hover:underline" onClick={() => onOpenOffice?.(a.realmId)}>{a.officeName}</button>
                <span className="text-ink2"> · {a.message}</span>
              </div>
              <div className={`shrink-0 text-xs tabular ${a.impact < 0 ? 'text-bad' : 'text-ink2'}`} title="Estimated effect on profit">{a.impact ? compact(a.impact) : ''}</div>
            </li>
          ))}
        </ul>
      )}
      {data.alerts.length > 8 && <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${data.alerts.length}`}</button>}
    </Section>
  );
}

function Scorecard({ data, onOpenOffice }) {
  const cfg = data.scorecardConfig;
  const [sort, setSort] = useState({ col: cfg.defaultSort, dir: -1 });
  const get = (r, c) => (c === 'name' ? r.officeName : c === 'segment' ? r.segment : c === 'targetsMet' ? (r.targetsTotal ? r.targetsMet / r.targetsTotal : null) : r[c]);
  const rows = useMemo(() => [...data.scorecard].sort(sorter(sort, get)), [data.scorecard, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (c, r) => {
    if (c === 'revenue' || c === 'ebitda') return <span className={r[c] < 0 ? 'text-bad' : ''}>{compact(r[c])}</span>;
    if (c === 'revenueGrowth') return <span className={r[c] < 0 ? 'text-bad' : ''}>{signedPct(r[c])}</span>;
    if (c === 'netMargin' || c === 'ebitdaMargin') return <span className={r[c] < 0 ? 'text-bad' : ''}>{pct1(r[c])}</span>;
    if (c === 'targetsMet') return r.targetsTotal ? <Status tone={r.targetsMet === r.targetsTotal ? 'good' : r.targetsMet / r.targetsTotal >= 0.5 ? 'warn' : 'bad'}>{r.targetsMet}/{r.targetsTotal}</Status> : '–';
    return r[c];
  };
  const exportCsv = () => downloadCsv(`office-scorecard-${data.from}-${data.to}.csv`, [
    ['Office', 'Segment', ...cfg.columns.map((c) => SC_LABELS[c]), 'Net income'],
    ...rows.map((r) => [r.officeName, r.segment, ...cfg.columns.map((c) => (c === 'targetsMet' ? (r.targetsTotal ? `${r.targetsMet}/${r.targetsTotal}` : '') : r[c])), r.netIncome]),
  ]);
  return (
    <Section title="Office scorecard" subtitle="Each company as booked (before eliminations). Revenue YoY compares the same months in both years. Cost targets come from the Category compare config."
      right={<button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button>}>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
            <tr>
              {sortTh(sort, setSort, 'name', 'Office', 'text-left')}
              {sortTh(sort, setSort, 'segment', data.segmentLabel || 'Segment', 'text-left')}
              {cfg.columns.map((c) => sortTh(sort, setSort, c, SC_LABELS[c], 'text-right'))}
              <th className="px-2 text-right font-medium">Net income trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.realmId} className="border-t border-[var(--line)]">
                <th scope="row" className="max-w-[240px] truncate px-2 py-1.5 text-left font-normal">
                  <button type="button" className="hover:underline" title={`Open ${r.officeName} on the Dashboard`} onClick={() => onOpenOffice?.(r.realmId)}>{r.officeName}</button>
                </th>
                <td className="max-w-[160px] truncate px-2 text-ink2">{r.segment}</td>
                {cfg.columns.map((c) => <td key={c} className="tabular whitespace-nowrap px-2 text-right">{fmt(c, r)}</td>)}
                <td className="px-2 text-right"><Sparkline values={r.spark} color={r.netIncome < 0 ? NEG : POS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Eliminations({ data }) {
  const [open, setOpen] = useState(null);
  if (!data.eliminations.length) return null;
  return (
    <Section title="Intercompany reconciliation" subtitle="Only the amount found on both sides is eliminated (month by month), so consolidated net income is unchanged. Unmatched means one side is larger: a charge booked on one side only, payments to outside parties caught by the rule (e.g. rent to outside landlords), or a rule in config/group-overview.json that needs narrowing.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-xs text-ink2">
            <tr className="border-b border-[var(--line)]">
              <th className="px-2 py-2 text-left font-medium">Rule</th>
              <th className="px-2 text-right font-medium">Income side</th>
              <th className="px-2 text-right font-medium">Expense side</th>
              <th className="px-2 text-right font-medium">Eliminated</th>
              <th className="px-2 text-right font-medium">Unmatched</th>
              <th className="px-2 text-right font-medium">Status</th>
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {data.eliminations.map((e) => {
              const base = Math.max(Math.abs(e.income.total), Math.abs(e.expense.total));
              const ok = base === 0 || Math.abs(e.difference) / base < 0.01;
              const isOpen = open === e.label;
              return (
                <React.Fragment key={e.label}>
                  <tr className="border-b border-[var(--line)]">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">{e.label}</th>
                    <td className="tabular px-2 text-right">{money(e.income.total)}</td>
                    <td className="tabular px-2 text-right">{money(e.expense.total)}</td>
                    <td className="tabular px-2 text-right">{money(e.eliminated)}</td>
                    <td className={`tabular px-2 text-right ${ok ? '' : 'text-bad'}`}>{money(e.difference)}</td>
                    <td className="px-2 text-right">{base === 0 ? <Status tone="info">No matches</Status> : ok ? <Status tone="good">Matched</Status> : <Status tone="warn">Check</Status>}</td>
                    <td className="px-2 text-right"><button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen(isOpen ? null : e.label)}>{isOpen ? 'Hide accounts' : 'Accounts'}</button></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={7} className="bg-[var(--page)] p-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        {[['Income side', e.income.accounts], ['Expense side', e.expense.accounts]].map(([t, list]) => (
                          <div key={t}>
                            <div className="mb-1 text-xs font-medium text-ink2">{t} ({list.length})</div>
                            <ul className="max-h-56 overflow-auto text-xs">
                              {list.map((a, i) => <li key={i} className="flex justify-between gap-2 border-t border-[var(--line)] py-1"><span className="truncate" title={`${a.officeName} · ${a.account}`}>{a.officeName} · <span className="text-ink2">{a.account}</span></span><span className="tabular">{money(a.amount)}</span></li>)}
                              {!list.length && <li className="text-muted">No accounts matched.</li>}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
