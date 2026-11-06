import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import {
  Section, ErrorBox, Loading, Empty, SourceLine, Sparkline, ChartTip, sortTh, sorter, downloadCsv, useApi,
  tint, POS, NEG, axisTick, pct1, signedPct, money, compact, monthLabel,
} from './ui.jsx';

// KPI dashboard: an Executive-style visual summary (tiles, trends, office leaderboard, heatmap, profit bridge,
// movers, cost structure) built from the office statements of the Financial KPIs sheet (or the Offices tab,
// app.config.json kpiDashboard.source). Data from /api/<kpiDashboard.apiPath>; sections in config/kpi-dashboard.json.

const shortMonth = (m) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)); return d.toLocaleString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', " '"); };
const fmt = (def, v) => (def.format === 'percent' ? pct1(v) : money(v));
const PCT = { format: 'percent' };
/** Change vs the prior period: money -> % change; percent -> percentage points. */
const changeOf = (def, cur, prev) => (cur == null || prev == null ? null : def.format === 'percent' ? cur - prev : prev ? (cur - prev) / Math.abs(prev) : null);
const fmtChange = (def, d) => (d == null || !Number.isFinite(d) ? '–' : def.format === 'percent' ? `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)} pts` : signedPct(d));
const toneOf = (def, d) => (d == null || d === 0 || def.upIsGood == null ? null : (d > 0) === def.upIsGood ? 'good' : 'bad');
const toneCls = (tone) => (tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-muted');
const signedCompact = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${compact(v)}`);

export default function KpiDashboard({ config, filters, officeParam, reloadKey, onOpenOffice }) {
  const path = config.kpiDashboard?.apiPath || 'kpi-dashboard';
  const { data, loading, error } = useApi(() => api.kpiDashboard({ from: filters.from, to: filters.to, office: officeParam, ...(filters.basis ? { basis: filters.basis } : {}) }, path), [filters.from, filters.to, officeParam, filters.basis, reloadKey, path]);
  if (error) return <ErrorBox title="Could not load the KPI dashboard" error={error} />;
  if (!data) return <Loading />;
  if (!data.hasData) return <Empty title="No data for this selection">Pick another date range or office, or run a sync.</Empty>;
  const x = data.config;
  const sheet = x.base !== 'office-view';
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <SourceLine source={data.source} extra={<>Rows and account numbers from {sheet ? 'the Financial KPIs sheet (config/offices-sheet.json)' : 'the Offices tab (config/offices.json)'} · {data.offices.length} {data.offices.length === 1 ? 'office' : 'offices'} · {monthLabel(data.from)} to {monthLabel(data.to)}, compared with {monthLabel(data.prior.from)} to {monthLabel(data.prior.to)}.</>} />
      <KpiTiles data={data} x={x} />
      <Trend data={data} x={x} />
      <Leaderboard data={data} x={x} onOpenOffice={onOpenOffice} sheet={sheet} />
      <Heatmap data={data} x={x} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {x.bridge.enabled && <Bridge data={data} x={x} />}
        <Movers data={data} x={x} />
      </div>
      <CostStructure data={data} x={x} />
    </div>
  );
}

function KpiTiles({ data, x }) {
  const months = data.months;
  const collKey = data.rows.find((r) => r.role === 'collections').key;
  const hasPrior = data.totals[collKey].prior > 0;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {x.tiles.map((def) => {
          const t = data.totals[def.key];
          const d = hasPrior ? changeOf(def, t.period, t.prior) : null;
          return (
            <div key={def.key} className="card flex min-w-0 flex-col gap-1 p-3 sm:p-4">
              <div className="truncate text-xs text-ink2 sm:text-sm" title={def.label}>{def.label}</div>
              <div className="flex items-end justify-between gap-3">
                <div className={`truncate text-lg font-semibold tabular sm:text-2xl ${t.period < 0 ? 'text-bad' : ''}`}>{fmt(def, t.period)}</div>
                <Sparkline values={months.map((m) => t.monthly[m])} color={def.upIsGood === false ? NEG : POS} />
              </div>
              <div className={`text-[11px] sm:text-xs ${toneCls(toneOf(def, d))}`}>{d != null ? `${fmtChange(def, d)} vs ${fmt(def, t.prior)} last year` : 'No data for last year'}</div>
            </div>
          );
        })}
      </div>
      {x.shares.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {x.shares.map((def) => {
            const t = data.totals[`pct:${def.row}`];
            const d = hasPrior ? changeOf(PCT, t.period, t.prior) : null;
            return (
              <div key={def.key} className="card flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink2">{def.label} % of collections</div>
                  {d != null && <div className={`text-[11px] ${d > 0 ? 'text-bad' : d < 0 ? 'text-good' : 'text-muted'}`}>{fmtChange(PCT, d)} vs last year</div>}
                </div>
                <div className="text-lg font-semibold tabular">{pct1(t.period)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Trend({ data, x }) {
  const b = data.totals[x.trend.bars.key];
  const l = data.totals[x.trend.line.key];
  const lp = data.totals[`pct:${x.trend.line.row}`] || null;
  const rows = data.months.map((m) => ({ m, label: shortMonth(m), bars: b.monthly[m], prior: b.priorMonthly?.[m] ?? null, line: l.monthly[m], pct: lp ? lp.monthly[m] : null }));
  const hasPrior = rows.some((r) => r.prior);
  const pctTick = (v) => `${Math.round(v * 100)}%`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section title={`${x.trend.bars.label} by month`} subtitle={hasPrior ? 'Bars: this period. Dashed line: the same month last year.' : 'By month, as booked for the offices selected.'}>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={60} />
              <Tooltip cursor={{ fill: 'var(--line)', opacity: 0.4 }} content={<ChartTip rows={(p) => [[x.trend.bars.label, money(p.bars), POS], hasPrior && ['Same month last year', money(p.prior), 'var(--muted)', true]]} />} />
              <Bar dataKey="bars" fill={POS} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              {hasPrior && <Line type="monotone" dataKey="prior" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title={`${x.trend.line.label} by month`} subtitle={lp ? 'Bars: the amount. Line: as % of net collections (right axis).' : 'By month.'}>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis yAxisId="amt" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} width={60} />
              {lp && <YAxis yAxisId="pct" orientation="right" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={pctTick} width={44} />}
              <Tooltip cursor={{ fill: 'var(--line)', opacity: 0.4 }} content={<ChartTip rows={(p) => [[x.trend.line.label, money(p.line), p.line < 0 ? NEG : POS], lp && ['% of collections', pct1(p.pct), 'var(--series-3)']]} />} />
              <ReferenceLine yAxisId="amt" y={0} stroke="var(--axis)" />
              <Bar yAxisId="amt" dataKey="line" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.m} fill={r.line < 0 ? NEG : POS} />)}
              </Bar>
              {lp && <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="var(--series-3)" strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}

function Leaderboard({ data, x, onOpenOffice, sheet }) {
  const cols = x.leaderboard.columns;
  const spark = x.leaderboard.spark;
  const [sort, setSort] = useState({ col: x.leaderboard.defaultSort, dir: -1 });
  const get = (o, col) => (col === 'name' ? o.name : o.values[col]?.period);
  const rows = useMemo(() => [...data.offices].sort(sorter(sort, get)), [data, sort]);
  const maxOf = Object.fromEntries(cols.map((c) => [c.key, Math.max(1e-9, ...data.offices.map((o) => Math.abs(o.values[c.key]?.period || 0)))]));
  const csv = () => downloadCsv(`kpi-dashboard-${data.from}-${data.to}.csv`, [
    ['Office', 'City', 'State', ...cols.map((c) => c.label), ...cols.map((c) => `${c.label} prior year`), 'Flags'],
    ...rows.map((o) => [o.name, o.city, o.state, ...cols.map((c) => o.values[c.key]?.period), ...cols.map((c) => o.values[c.key]?.prior), o.flags]),
    ['All offices', '', '', ...cols.map((c) => data.totals[c.key]?.period), ...cols.map((c) => data.totals[c.key]?.prior), ''],
  ]);
  const cellBg = (c, v) => {
    if (c.format !== 'percent' || v == null) return undefined;
    if (c.upIsGood === false) return tint(NEG, Math.abs(v) / maxOf[c.key]);
    if (c.upIsGood) return tint(v >= 0 ? POS : NEG, Math.abs(v) / maxOf[c.key]);
    return undefined;
  };
  return (
    <Section title="Office leaderboard" subtitle={`${rows.length} offices · click a column to sort, an office to open it on the ${sheet ? 'Financial KPIs' : 'Offices'} tab · small figures: change vs the same months last year`}
      right={<button type="button" className="control text-sm" onClick={csv}>Export CSV</button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="text-xs text-theadInk">
            <tr className="border-b border-[var(--line)]">
              {sortTh(sort, setSort, 'name', 'Office', 'text-left')}
              {cols.map((c) => sortTh(sort, setSort, c.key, c.label, 'text-right'))}
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">{spark.label} by month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.key} className="border-b border-[var(--line)] hover:bg-page">
                <td className="whitespace-nowrap px-2 py-1.5">
                  {onOpenOffice ? <button type="button" className="text-left hover:underline" onClick={() => onOpenOffice(o.companies[0])}>{o.name}</button> : o.name}
                  {o.flags > 0 && <span className="ml-2 text-[10px] text-bad" title="Needs-attention flags on the office page">{o.flags} {o.flags === 1 ? 'flag' : 'flags'}</span>}
                </td>
                {cols.map((c) => {
                  const v = o.values[c.key] || {};
                  const d = changeOf(c, v.period, v.prior);
                  return (
                    <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-right tabular" style={{ background: cellBg(c, v.period) }}>
                      <div className={v.period < 0 ? 'text-bad' : ''}>{fmt(c, v.period)}</div>
                      <div className={`text-[10px] ${toneCls(toneOf(c, d))}`}>{d != null ? fmtChange(c, d) : '–'}</div>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right"><Sparkline values={data.months.map((m) => o.values[spark.key]?.monthly[m] ?? null)} color={spark.upIsGood === false ? NEG : POS} /></td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-2 py-1.5">All offices</td>
              {cols.map((c) => <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 text-right tabular ${data.totals[c.key]?.period < 0 ? 'text-bad' : ''}`}>{fmt(c, data.totals[c.key]?.period)}</td>)}
              <td className="px-2 py-1.5 text-right"><Sparkline values={data.months.map((m) => data.totals[spark.key]?.monthly[m] ?? null)} color={spark.upIsGood === false ? NEG : POS} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Heatmap({ data, x }) {
  const def = x.heatmap.metric;
  const isP = def.format === 'percent';
  const months = data.months;
  const clamp = isP ? x.heatmap.clampPercent / 100 : Math.max(1, ...data.offices.flatMap((o) => months.map((m) => Math.abs(o.values[def.key].monthly[m] || 0))));
  const good = def.upIsGood !== false;
  const color = (v) => { if (v == null) return 'var(--surface)'; const favorable = good ? v >= 0 : v <= 0; return tint(favorable ? POS : NEG, Math.min(1, Math.abs(v) / clamp)); };
  const rows = [...data.offices].sort((a, b) => (b.values[def.key].period ?? -Infinity) - (a.values[def.key].period ?? -Infinity));
  return (
    <Section title={`${def.label} by office and month`} subtitle={`Blue = ${good ? 'positive' : 'low'}, red = ${good ? 'negative' : 'high'}, deeper = further from zero (full color at ±${isP ? `${x.heatmap.clampPercent}%` : compact(clamp)}). Hover a cell for the value.`}>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] bg-surface px-2 py-1 text-left font-medium">Office</th>
              {months.map((m) => <th key={m} scope="col" className="whitespace-nowrap px-1 py-1 text-right font-medium text-muted">{shortMonth(m)}</th>)}
              <th scope="col" className="px-2 py-1 text-right font-medium">Period</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.key}>
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-surface px-2 py-0.5 text-left font-normal">{o.name}</th>
                {months.map((m) => {
                  const v = o.values[def.key].monthly[m];
                  return <td key={m} title={`${o.name} · ${monthLabel(m)}: ${fmt(def, v)}`} className="px-1 py-0.5 text-right tabular" style={{ background: color(v), minWidth: 44 }}>{v == null ? '–' : isP ? `${Math.round(v * 100)}%` : compact(v)}</td>;
                })}
                <td className={`px-2 py-0.5 text-right tabular font-medium ${o.values[def.key].period < 0 ? 'text-bad' : ''}`}>{fmt(def, o.values[def.key].period)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Bridge({ data, x }) {
  const collKey = data.rows.find((r) => r.role === 'collections').key;
  const ebitdaKey = data.rows.find((r) => r.role === 'ebitda').key;
  const steps = [];
  let running = data.totals[collKey].period;
  steps.push({ label: data.rows.find((r) => r.key === collKey).label, amount: running, kind: 'start' });
  for (const c of x.costStructure.rows) {
    const v = data.totals[c.key].period;
    if (!v) continue;
    const after = running - v;
    steps.push({ label: c.label, amount: -v, kind: 'cost', base: Math.min(running, after), size: Math.abs(v) });
    running = after;
  }
  const ebitda = data.totals[ebitdaKey].period;
  steps.push({ label: data.rows.find((r) => r.key === ebitdaKey).label, amount: ebitda, kind: 'end' });
  const rows = steps.map((s) => (s.kind === 'cost' ? s : { ...s, base: Math.min(0, s.amount), size: Math.abs(s.amount) }));
  const colorOf = (s) => (s.kind === 'cost' ? NEG : s.amount < 0 ? NEG : POS);
  return (
    <Section title="Profit bridge" subtitle={`From net collections to office EBITDA, ${monthLabel(data.from)} to ${monthLabel(data.to)}: what each statement row takes away.`}>
      <div style={{ height: 36 + rows.length * 30 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid horizontal={false} stroke="var(--line)" />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={compact} />
            <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={190} interval={0} />
            <Tooltip cursor={{ fill: 'var(--line)', opacity: 0.4 }} content={<ChartTip rows={(p) => [[p.label, money(p.amount), colorOf(p)]]} />} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="size" stackId="w" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {rows.map((s) => <Cell key={s.label} fill={colorOf(s)} fillOpacity={s.kind === 'cost' ? 0.75 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Movers({ data, x }) {
  const up = data.movers.filter((m) => m.impact > 0).slice(0, x.movers.count);
  const down = data.movers.filter((m) => m.impact < 0).slice(0, x.movers.count);
  const title = 'What changed vs last year';
  if (!up.length && !down.length) return <Section title={title}><p className="text-xs text-muted">No data for the same months last year, or nothing moved.</p></Section>;
  const max = Math.max(1, ...[...up, ...down].map((m) => Math.abs(m.impact)));
  const List = ({ items, heading, color }) => (
    <div>
      <h3 className="mb-1.5 text-xs font-medium text-ink2">{heading}</h3>
      {items.length === 0 ? <p className="text-xs text-muted">None</p> : (
        <ul className="grid gap-1.5">
          {items.map((m) => (
            <li key={`${m.row}|${m.account}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs">
              <div className="min-w-0">
                <div className="truncate" title={`${m.account} · ${m.rowLabel} · ${m.offices} ${m.offices === 1 ? 'office' : 'offices'}`}>{m.account} <span className="text-muted">· {m.rowLabel}</span></div>
                <div className="mt-0.5 h-1.5 rounded bg-page"><div className="h-1.5 rounded" style={{ width: `${Math.max(2, Math.round((Math.abs(m.impact) / max) * 100))}%`, background: color }} /></div>
              </div>
              <div className="text-right tabular">
                <div className={m.impact > 0 ? 'text-good' : 'text-bad'}>{signedCompact(m.impact)}</div>
                <div className="text-[10px] text-muted">{compact(m.prior)} → {compact(m.period)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Section title={title} subtitle={`Accounts that moved office EBITDA the most, ${monthLabel(data.from)} to ${monthLabel(data.to)} vs ${monthLabel(data.prior.from)} to ${monthLabel(data.prior.to)}. Collections up and costs down help; the reverse hurts.`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <List items={up} heading="Helped EBITDA" color={POS} />
        <List items={down} heading="Hurt EBITDA" color={NEG} />
      </div>
    </Section>
  );
}

function CostStructure({ data, x }) {
  const cols = x.costStructure.rows;
  const collKey = data.rows.find((r) => r.role === 'collections').key;
  const ebitdaKey = data.rows.find((r) => r.role === 'ebitda').key;
  const pk = (c) => `pct:${c.row}`;
  const rows = [...data.offices].sort((a, b) => (b.values[collKey].period || 0) - (a.values[collKey].period || 0));
  const maxOf = Object.fromEntries(cols.map((c) => [c.key, Math.max(1e-9, ...rows.map((o) => o.values[pk(c)]?.period || 0))]));
  const cell = (c, v) => <td key={c.key} className="whitespace-nowrap px-2 py-1 text-right tabular" style={{ background: v != null && v > 0 ? tint(NEG, v / maxOf[c.key]) : undefined }}>{pct1(v)}</td>;
  const ebitdaCell = (v) => <td className={`whitespace-nowrap px-2 py-1 text-right tabular font-medium ${v < 0 ? 'text-bad' : ''}`}>{pct1(v)}</td>;
  return (
    <Section title="Cost structure" subtitle="Each statement row as a share of net collections. Darker = higher than other offices for that row. First line: all offices together.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-xs">
          <thead className="text-theadInk">
            <tr className="border-b border-[var(--line)]">
              <th scope="col" className="sticky left-0 z-[1] bg-surface px-2 py-2 text-left font-medium">Office</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">Net collections</th>
              {cols.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium" title={c.label}>{c.label}</th>)}
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">EBITDA margin</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--line)] font-semibold">
              <th scope="row" className="sticky left-0 z-[1] bg-surface px-2 py-1 text-left">All offices</th>
              <td className="whitespace-nowrap px-2 py-1 text-right tabular">{money(data.totals[collKey].period)}</td>
              {cols.map((c) => cell(c, data.totals[pk(c)]?.period))}
              {ebitdaCell(data.totals[`pct:${ebitdaKey}`]?.period)}
            </tr>
            {rows.map((o) => (
              <tr key={o.key} className="border-b border-[var(--line)]">
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-surface px-2 py-1 text-left font-normal">{o.name}</th>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular">{money(o.values[collKey].period)}</td>
                {cols.map((c) => cell(c, o.values[pk(c)]?.period))}
                {ebitdaCell(o.values[`pct:${ebitdaKey}`]?.period)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
