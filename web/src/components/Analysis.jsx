import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { api } from '../api.js';
import { fmtMoney, fmtCompact } from '../format.js';
import { Axes, ChartTypePicker, Legend, TooltipBox } from './charts.jsx';
import { Seg, SourceLine } from './ui.jsx';

// Analysis: one office-statement metric (Net collections, Provider compensation, ..., Office EBITDA, or a row as
// % of net collections) by office, office category, statement row or QuickBooks account over time. Data from
// /api/analysis, computed exactly like the Offices tab: raw QuickBooks records, dental practice + sub-DSO as one
// office, internal charges removed, payroll taxes split (config/offices.json; options in app.config.json analysis.*).

const SLOT = (i) => `var(--series-${i + 1})`;
const OTHER_COLOR = 'var(--axis)';
const axisTick = { fill: 'var(--muted)', fontSize: 12 };
const ROUND_TOP = [4, 4, 0, 0];
const lineProps = (color) => ({
  type: 'monotone', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  dot: { r: 4, fill: color, stroke: 'var(--surface)', strokeWidth: 2 },
  activeDot: { r: 5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }, isAnimationActive: false, connectNulls: true,
});
const isPct = (metric) => String(metric).startsWith('pct:');
const fmtPercent = (v) => `${(v * 100).toFixed(1)}%`;

/** Metric and group-by options: from the API once loaded, else the keys from app.config.json. */
function optionsFrom(data, config, categories) {
  const a = config.analysis;
  const metrics = data?.config?.metrics || a.metrics.map((k) => ({ key: k, label: k, format: isPct(k) ? 'percent' : 'money', account: true }));
  const labels = a.dimensionLabels || {};
  const dimensions = data?.config?.dimensions || a.dimensions.map((d) => {
    if (d.startsWith('category:')) { const dim = categories.find((c) => c.id === d.slice(9)); return dim ? { id: d, label: `${dim.label} (office category)` } : null; }
    return { id: d, label: labels[d] || d };
  }).filter(Boolean);
  return { metrics, dimensions };
}

/** One small line chart per row (every office / category / account), all on the same y-scale. */
function SmallMultiples({ data, fmtV, fmtTick }) {
  let lo = 0;
  let hi = 0;
  for (const r of data.rows) for (const p of data.periods) { const v = r.periods[p.key]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const domain = [lo, hi === lo ? lo + 1 : hi];
  const color = 'var(--series-1)';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {data.rows.map((r) => {
        const rows = data.periods.map((p) => ({ label: p.label, v: r.periods[p.key] }));
        return (
          <div key={r.key} className="rounded-lg border border-[var(--ring)] p-2">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-ink2" title={r.label}>{r.label}</span>
              <span className={`tabular shrink-0 font-medium ${r.total < 0 ? 'text-bad' : ''}`}>{fmtV(r.total)}</span>
            </div>
            <div style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                  <XAxis dataKey="label" tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis domain={domain} tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtTick} width={48} />
                  <ReferenceLine y={0} stroke="var(--axis)" />
                  <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<TooltipBox series={[{ key: 'v', label: r.label, color }]} fmt={fmtV} />} />
                  <Line dataKey="v" {...lineProps(color)} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Analysis({ config, filters, officeParam, reloadKey, categories, state, onState }) {
  const a = config.analysis;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isRatio = isPct(state.metric);
  const { metrics, dimensions } = optionsFrom(data, config, categories);
  const def = metrics.find((m) => m.key === state.metric) || metrics[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.analysis({ granularity: filters.granularity, from: filters.from, to: filters.to, office: officeParam, by: state.by, metric: state.metric })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.granularity, filters.from, filters.to, officeParam, state.by, state.metric, reloadKey]);

  const chartOptions = a.chart.options.filter((t) => !(isRatio && t === 'stacked'));
  const chartType = chartOptions.includes(state.chart) ? state.chart : chartOptions[0];

  // Top N rows get palette slots; the rest fold into "Other" (sums only; a folded ratio would be meaningless).
  const { series, folded } = useMemo(() => {
    if (!data) return { series: [], folded: 0 };
    const head = data.rows.slice(0, a.topN).map((r, i) => ({ ...r, color: SLOT(i) }));
    const tail = data.rows.slice(a.topN);
    if (tail.length && !isRatio) {
      const periods = Object.fromEntries(data.periods.map((p) => [p.key, tail.reduce((s, r) => s + (r.periods[p.key] || 0), 0)]));
      head.push({ key: '__other', label: `Other (${tail.length})`, periods, total: tail.reduce((s, r) => s + (r.total || 0), 0), color: OTHER_COLOR });
    }
    return { series: head, folded: tail.length };
  }, [data, a.topN, isRatio]);

  const rows = useMemo(() => (data ? data.periods.map((p) => ({ label: p.label, ...Object.fromEntries(series.map((s) => [s.key, s.periods[p.key]])) })) : []), [data, series]);
  // Format with the metric the loaded data belongs to (state.metric may already point at the next one).
  const shownPct = data ? data.metricDef.format === 'percent' : isRatio;
  const fmtV = (v) => (v == null || !Number.isFinite(v) ? '–' : shownPct ? fmtPercent(v) : fmtMoney(v));
  const fmtTick = (v) => (v == null || !Number.isFinite(v) ? '–' : shownPct ? fmtPercent(v) : fmtCompact(v));
  const grand = data?.totals.total;
  const showShare = !shownPct && data && data.rows.every((r) => (r.total ?? 0) >= 0) && grand > 0;

  const amountMetrics = metrics.filter((m) => m.format !== 'percent');
  const pctMetrics = metrics.filter((m) => m.format === 'percent');
  const byRow = state.by === 'row';
  const accountOff = (m) => state.by === 'account' && m.account === false;
  const title = data ? (data.by === 'row' ? `${shownPct ? 'Costs as % of collections' : 'Costs'} by statement row` : `${data.metricDef.label} by ${data.byLabel.toLowerCase()}`) : '';

  return (
    <div className="grid gap-4">
      <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
        {byRow ? (
          <Seg label="Show" value={isRatio ? 'pct' : 'amount'} options={[['amount', 'Amounts'], ['pct', '% of collections']]}
            onChange={(v) => onState({ ...state, metric: (v === 'pct' ? pctMetrics[0] || amountMetrics[0] : amountMetrics[0]).key })} />
        ) : (
          <label className="flex flex-col gap-1 text-xs text-ink2">
            Metric
            <select className="control min-w-[240px]" value={state.metric} onChange={(e) => onState({ ...state, metric: e.target.value })}>
              <optgroup label="Amounts">{amountMetrics.map((m) => <option key={m.key} value={m.key} disabled={accountOff(m)}>{m.label}{accountOff(m) ? ' (no accounts)' : ''}</option>)}</optgroup>
              {pctMetrics.length > 0 && <optgroup label="% of net collections">{pctMetrics.map((m) => <option key={m.key} value={m.key} disabled={accountOff(m)}>{m.label}{accountOff(m) ? ' (no accounts)' : ''}</option>)}</optgroup>}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink2">
          Group by
          <select className="control min-w-[220px]" value={state.by} onChange={(e) => onState({ ...state, by: e.target.value })}>
            {dimensions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <span className="text-xs text-muted">Same figures as the Offices tab: dental practice + sub-DSO as one office, internal charges removed, payroll taxes split.</span>
      </div>

      {error && <div className="card border-l-4 border-l-bad p-4 text-sm"><div className="font-medium">Could not load the analysis</div><div className="text-ink2">{error}</div></div>}
      {loading && !data && <div className="card h-[380px] animate-pulse" />}
      {data && !data.hasData && (
        <div className="card px-6 py-12 text-center text-sm text-ink2">
          {data.offices === 0 ? 'No office in this selection. The Analysis tab works on the offices of the Offices tab (dental companies and their sub-DSOs).' : 'No data for this selection and date range.'}
          <div className="mt-2"><SourceLine source={data.source} /></div>
        </div>
      )}

      {data && data.hasData && (
        <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          {data.fallback && <p className="text-xs text-muted">{data.fallback}</p>}
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 className="text-sm font-medium">{title}</h2>
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-2">
                {!['ranked', 'small'].includes(chartType) && <Legend items={series.map((s) => ({ label: s.label, color: s.color, kind: chartType === 'lines' ? 'line' : 'bar' }))} />}
                <ChartTypePicker options={chartOptions} value={chartType} onChange={(t) => onState({ ...state, chart: t })} label="Chart type" />
              </div>
            </div>
            {folded > 0 && !['ranked', 'small'].includes(chartType) && (
              <p className="mb-2 text-xs text-muted">
                Top {a.topN} shown{shownPct ? '' : `, ${folded} more folded into Other`}. Every one of the {data.rows.length} is in{' '}
                {chartOptions.includes('small') && <><button type="button" className="text-accent hover:underline" onClick={() => onState({ ...state, chart: 'small' })}>small multiples</button>, </>}
                {chartOptions.includes('ranked') && <><button type="button" className="text-accent hover:underline" onClick={() => onState({ ...state, chart: 'ranked' })}>ranked totals</button> and </>}
                the table below.
              </p>
            )}

            {chartType === 'small' ? (
              <SmallMultiples data={data} fmtV={fmtV} fmtTick={fmtTick} />
            ) : chartType === 'ranked' ? (
              <div style={{ height: data.rows.length * 30 + 24 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.rows.map((r) => ({ label: r.label, value: r.total }))} layout="vertical" margin={{ top: 4, right: 96, bottom: 0, left: 4 }} barCategoryGap="30%">
                    <CartesianGrid horizontal={false} stroke="var(--line)" strokeWidth={1} />
                    <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtTick} />
                    <YAxis type="category" dataKey="label" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={190} />
                    <ReferenceLine x={0} stroke="var(--axis)" />
                    <Tooltip cursor={{ fill: 'var(--ring)' }} content={<TooltipBox series={[{ key: 'value', label: data.metricDef.label, color: 'var(--ink-2)' }]} fmt={fmtV} />} />
                    <Bar dataKey="value" fill="var(--series-1)" maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      <LabelList dataKey="value" position="right" formatter={fmtV} style={{ fill: 'var(--ink-2)', fontSize: 12 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: config.dashboard.chartHeights.main }}>
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'lines' ? (
                    <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                      <Axes fmt={fmtTick} />
                      <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<TooltipBox series={series} fmt={fmtV} />} />
                      {series.map((s) => <Line key={s.key} dataKey={s.key} {...lineProps(s.color)} />)}
                    </LineChart>
                  ) : (
                    <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barGap={2} barCategoryGap={chartType === 'stacked' ? '30%' : '20%'}>
                      <Axes fmt={fmtTick} />
                      <Tooltip cursor={{ fill: 'var(--ring)' }} content={<TooltipBox series={series} fmt={fmtV} />} />
                      {series.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} fill={s.color} maxBarSize={24} isAnimationActive={false}
                          {...(chartType === 'stacked'
                            ? { stackId: 'a', stroke: 'var(--surface)', strokeWidth: 2, radius: i === series.length - 1 ? ROUND_TOP : 0 }
                            : { radius: ROUND_TOP })} />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between px-4 pt-4">
              <h2 className="text-sm font-medium">{title} and period</h2>
              <span className="text-xs text-muted">{data.rows.length} rows · {data.offices} office{data.offices === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-ink2">
                    <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">{data.by === 'row' ? 'Statement row' : data.byLabel}</th>
                    {data.periods.map((p) => <th key={p.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p.label}</th>)}
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total</th>
                    {showShare && <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Share</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={r.key} className="border-t border-[var(--line)] hover:bg-page">
                      <td className="sticky left-0 z-10 bg-surface px-4 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i < a.topN ? SLOT(i) : OTHER_COLOR }} aria-hidden="true" />
                          <span title={r.key !== r.label ? r.key : undefined}>{r.label}</span>
                        </span>
                      </td>
                      {data.periods.map((p) => {
                        const v = r.periods[p.key];
                        return <td key={p.key} className={`tabular whitespace-nowrap px-3 py-1.5 text-right ${v < 0 ? 'text-bad' : ''} ${!v ? 'text-muted' : ''}`}>{fmtV(v)}</td>;
                      })}
                      <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right font-medium ${r.total < 0 ? 'text-bad' : ''}`}>{fmtV(r.total)}</td>
                      {showShare && <td className="tabular whitespace-nowrap px-3 py-1.5 text-right text-ink2">{((r.total / grand) * 100).toFixed(1)}%</td>}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--axis)]">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-semibold">{data.by === 'row' ? 'All costs' : 'Total'}</td>
                    {data.periods.map((p) => <td key={p.key} className="tabular whitespace-nowrap px-3 py-2 text-right font-medium">{fmtV(data.totals.periods[p.key])}</td>)}
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold">{fmtV(grand)}</td>
                    {showShare && <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink2">100%</td>}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4 pt-3"><SourceLine source={data.source} /></div>
          </section>
        </div>
      )}
    </div>
  );
}
