import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, Bar, Line, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { fmtCompact, fmtMoney, metric as metricOf, officeColor, groupColor, groupLabel } from '../format.js';

const axisTick = { fill: 'var(--muted)', fontSize: 12 };
const barCursor = { fill: 'var(--ring)' };
const lineCursor = { stroke: 'var(--axis)' };
const BAR = { maxBarSize: 24, isAnimationActive: false };
const ROUND_TOP = [4, 4, 0, 0];
const lineDot = (color) => ({ r: 4, fill: color, stroke: 'var(--surface)', strokeWidth: 2 });
const activeDot = (color) => ({ r: 5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 });
const lineProps = (color) => ({
  type: 'monotone', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  dot: lineDot(color), activeDot: activeDot(color), isAnimationActive: false,
});

export const CHART_TYPE_LABELS = {
  combo: 'Bars + line',
  lines: 'Lines',
  bars: 'Grouped bars',
  stacked: 'Stacked',
  small: 'Small multiples',
  ranked: 'Ranked totals',
};

function TooltipBox({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      <div className="mb-1 text-ink2">{label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </span>
            <span className="tabular">{fmtMoney(p.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ items }) {
  if (items.length < 2) return null; // a single series is named by the title
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            className={it.kind === 'line' ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'}
            style={{ background: it.color }}
            aria-hidden="true"
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Segmented control for the chart form. Hidden when only one option is configured. */
export function ChartTypePicker({ options, value, onChange, label }) {
  if (!options || options.length < 2) return null;
  return (
    <div className="seg seg-sm" role="group" aria-label={label}>
      {options.map((t) => (
        <button key={t} type="button" aria-pressed={value === t} onClick={() => onChange(t)}>
          {CHART_TYPE_LABELS[t] || t}
        </button>
      ))}
    </div>
  );
}

function Frame({ title, legend, picker, children, note }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {legend}
          {picker}
        </div>
      </div>
      {note && <p className="mb-2 text-xs text-muted">{note}</p>}
      {children}
    </section>
  );
}

const Axes = ({ yWidth = 64 }) => (
  <>
    <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={24} />
    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={yWidth} />
    <ReferenceLine y={0} stroke="var(--axis)" />
  </>
);

/**
 * Income / expenses / net income over time. Forms:
 *   combo   bars for income and expenses, line for net income (default)
 *   lines   three lines
 *   bars    three grouped bars
 *   stacked expense groups stacked (composition of spend), income and net income as lines
 * Everything is money, so a single y-axis.
 */
export function MainChart({ periods, height = 320, type = 'combo', options, onTypeChange, expenseGroups = [] }) {
  const income = metricOf('income');
  const expenses = metricOf('expenses');
  const net = metricOf('netIncome');
  const groupSeries = expenseGroups.map((g) => ({ key: g, label: groupLabel(g), color: groupColor(g) }));

  const data = periods.map((p) => ({
    label: p.label, income: p.income, expenses: p.expenses, netIncome: p.netIncome,
    ...Object.fromEntries(expenseGroups.map((g) => [g, p.groups?.[g] ?? 0])),
  }));

  const series = type === 'stacked' ? [...groupSeries, income, net] : [income, expenses, net];
  const legendItems =
    type === 'stacked'
      ? [...groupSeries.map((s) => ({ ...s, kind: 'bar' })), { ...income, kind: 'line' }, { ...net, kind: 'line' }]
      : [income, expenses, net].map((m) => ({ ...m, kind: type === 'lines' || (type === 'combo' && m.key === 'netIncome') ? 'line' : 'bar' }));

  const title =
    type === 'stacked'
      ? `Expense composition vs ${income.label.toLowerCase()} and ${net.label.toLowerCase()}`
      : `${income.label} vs ${expenses.label.toLowerCase()} vs ${net.label.toLowerCase()}`;

  const picker = <ChartTypePicker options={options} value={type} onChange={onTypeChange} label="Chart type" />;
  const margin = { top: 8, right: 12, bottom: 0, left: 4 };

  let chart;
  if (type === 'lines') {
    chart = (
      <LineChart data={data} margin={margin}>
        <Axes />
        <Tooltip cursor={lineCursor} content={<TooltipBox series={series} />} />
        {series.map((s) => <Line key={s.key} dataKey={s.key} {...lineProps(s.color)} />)}
      </LineChart>
    );
  } else if (type === 'bars') {
    chart = (
      <BarChart data={data} margin={margin} barGap={2} barCategoryGap="25%">
        <Axes />
        <Tooltip cursor={barCursor} content={<TooltipBox series={series} />} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.color} radius={ROUND_TOP} {...BAR} />)}
      </BarChart>
    );
  } else if (type === 'stacked') {
    chart = (
      <ComposedChart data={data} margin={margin} barCategoryGap="30%">
        <Axes />
        <Tooltip cursor={barCursor} content={<TooltipBox series={series} />} />
        {groupSeries.map((s, i) => (
          // 2px surface-colored stroke = the gap between stacked segments
          <Bar key={s.key} dataKey={s.key} stackId="exp" fill={s.color} stroke="var(--surface)" strokeWidth={2}
               radius={i === groupSeries.length - 1 ? ROUND_TOP : 0} {...BAR} />
        ))}
        <Line dataKey="income" {...lineProps(income.color)} />
        <Line dataKey="netIncome" {...lineProps(net.color)} />
      </ComposedChart>
    );
  } else {
    chart = (
      <ComposedChart data={data} margin={margin} barGap={2} barCategoryGap="30%">
        <Axes />
        <Tooltip cursor={barCursor} content={<TooltipBox series={series} />} />
        <Bar dataKey="income" fill={income.color} radius={ROUND_TOP} {...BAR} />
        <Bar dataKey="expenses" fill={expenses.color} radius={ROUND_TOP} {...BAR} />
        <Line dataKey="netIncome" {...lineProps(net.color)} />
      </ComposedChart>
    );
  }

  return (
    <Frame title={title} legend={<Legend items={legendItems} />} picker={picker}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </Frame>
  );
}

/**
 * One metric per office. Forms:
 *   lines   one line per office (default)
 *   bars    grouped bars per period
 *   stacked offices stacked per period (part-to-whole of the combined figure)
 *   small   one small panel per office on a shared y-scale
 *   ranked  horizontal bars of the office totals over the range, largest first
 * Colors follow the office's stable palette slot (colorIndexOf), never its position in the selection.
 */
export function OfficeChart({
  periods, offices, metricKey = 'netIncome', colorIndexOf, maxOffices = 8, height = 280, title,
  type = 'lines', options, onTypeChange,
}) {
  const m = metricOf(metricKey);
  const shown = offices.slice(0, maxOffices);
  const series = shown.map((o) => ({ key: o.realmId, label: o.officeName, color: officeColor(colorIndexOf(o.realmId)) }));
  const data = useMemo(
    () => periods.map((p) => {
      const row = { label: p.label };
      for (const o of shown) row[o.realmId] = o.periods[p.key]?.[metricKey] ?? 0;
      return row;
    }),
    [periods, shown, metricKey]
  );

  const heading = title || `${m.label} by office`;
  const note = offices.length > maxOffices ? `Showing the first ${maxOffices} offices by name.` : null;
  const picker = <ChartTypePicker options={options} value={type} onChange={onTypeChange} label="Chart type" />;
  const margin = { top: 8, right: 12, bottom: 0, left: 4 };

  if (type === 'small') {
    // Shared y-domain so panels are comparable at a glance.
    let lo = 0;
    let hi = 0;
    for (const row of data) for (const s of series) { lo = Math.min(lo, row[s.key]); hi = Math.max(hi, row[s.key]); }
    const domain = [lo, hi === lo ? lo + 1 : hi];
    const cols = series.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4';
    return (
      <Frame title={`${heading}, one panel per office`} picker={picker} note={note}>
        <div className={`grid grid-cols-1 gap-3 ${cols}`}>
          {series.map((s) => (
            <div key={s.key} className="rounded-lg border border-[var(--ring)] p-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </div>
              <div style={{ height: Math.max(140, height / 2) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                    <XAxis dataKey="label" tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={32} />
                    <YAxis domain={domain} tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={52} />
                    <ReferenceLine y={0} stroke="var(--axis)" />
                    <Tooltip cursor={lineCursor} content={<TooltipBox series={[s]} />} />
                    <Line dataKey={s.key} {...lineProps(s.color)} dot={false} activeDot={activeDot(s.color)} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </Frame>
    );
  }

  if (type === 'ranked') {
    const ranked = [...shown]
      .map((o) => ({ label: o.officeName, key: o.realmId, value: o.totals?.[metricKey] ?? 0, color: officeColor(colorIndexOf(o.realmId)) }))
      .sort((a, b) => b.value - a.value);
    const first = periods[0]?.label;
    const last = periods[periods.length - 1]?.label;
    const rowH = 36;
    return (
      <Frame title={`${m.label} per office, ${first} to ${last}`} picker={picker} note={note}>
        <div style={{ height: ranked.length * rowH + 24 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ranked} layout="vertical" margin={{ top: 4, right: 72, bottom: 0, left: 4 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke="var(--line)" strokeWidth={1} />
              <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
              <YAxis type="category" dataKey="label" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={150} />
              <ReferenceLine x={0} stroke="var(--axis)" />
              <Tooltip cursor={barCursor} content={<TooltipBox series={[{ key: 'value', label: m.label, color: 'var(--ink-2)' }]} />} />
              <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {ranked.map((r) => <Cell key={r.key} fill={r.color} />)}
                <LabelList dataKey="value" position="right" formatter={fmtMoney} style={{ fill: 'var(--ink-2)', fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Frame>
    );
  }

  let chart;
  if (type === 'bars') {
    chart = (
      <BarChart data={data} margin={margin} barGap={2} barCategoryGap="25%">
        <Axes />
        <Tooltip cursor={barCursor} content={<TooltipBox series={series} />} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.color} radius={ROUND_TOP} {...BAR} />)}
      </BarChart>
    );
  } else if (type === 'stacked') {
    chart = (
      <BarChart data={data} margin={margin} barCategoryGap="30%">
        <Axes />
        <Tooltip cursor={barCursor} content={<TooltipBox series={series} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="o" fill={s.color} stroke="var(--surface)" strokeWidth={2}
               radius={i === series.length - 1 ? ROUND_TOP : 0} {...BAR} />
        ))}
      </BarChart>
    );
  } else {
    chart = (
      <LineChart data={data} margin={margin}>
        <Axes />
        <Tooltip cursor={lineCursor} content={<TooltipBox series={series} />} />
        {series.map((s) => <Line key={s.key} dataKey={s.key} {...lineProps(s.color)} />)}
      </LineChart>
    );
  }

  const legendItems = series.map((s) => ({ ...s, kind: type === 'lines' ? 'line' : 'bar' }));
  return (
    <Frame title={type === 'stacked' ? `${heading}, stacked to the combined total` : heading} legend={<Legend items={legendItems} />} picker={picker} note={note}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </Frame>
  );
}
