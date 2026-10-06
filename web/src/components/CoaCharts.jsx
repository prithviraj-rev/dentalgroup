import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { fmtMoney, fmtCompact, fmtPct, metric as metricOf } from '../format.js';
import { ChartTypePicker, Legend } from './charts.jsx';

const axisTick = { fill: 'var(--muted)', fontSize: 12 };
const SLOT = (i) => `var(--series-${i + 1})`;
const OTHER_COLOR = 'var(--axis)';
const SIDES = [{ id: 'Revenue', label: 'Revenue' }, { id: 'Expense', label: 'Expenses' }];
const ROUND_TOP = [4, 4, 0, 0];
const lineProps = (color) => ({
  type: 'monotone', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  dot: { r: 4, fill: color, stroke: 'var(--surface)', strokeWidth: 2 },
  activeDot: { r: 5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 },
  isAnimationActive: false,
});

// ---------- data shaping from the /api/coa tree ----------

/** Top-level accounts of one classification (across all its account types), as flat series. */
function topLevelAccounts(data, classification) {
  const section = data.sections.find((s) => s.classification === classification);
  if (!section) return [];
  return section.types.flatMap((t) => t.nodes.map((n) => ({ key: n.key, name: n.name, type: t.accountType, periods: n.periods, total: n.total })));
}

/** Sum of each leaf's own postings by account sub-type. */
function bySubType(data, classification) {
  const section = data.sections.find((s) => s.classification === classification);
  const acc = new Map();
  const walk = (n) => {
    const k = n.accountSubType || (n.unmapped ? 'Not in chart' : 'No sub-type');
    acc.set(k, (acc.get(k) || 0) + n.ownTotal);
    n.children.forEach(walk);
  };
  for (const t of section?.types || []) t.nodes.forEach(walk);
  return [...acc.entries()].map(([name, value]) => ({ name, value })).filter((x) => x.value !== 0).sort((a, b) => b.value - a.value);
}

/** Largest-first slices capped at maxSlices, rest folded into Other. Negative totals are left out of the mix. */
function slices(accounts, maxSlices) {
  const positive = accounts.filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
  const skipped = accounts.length - positive.length;
  const head = positive.slice(0, maxSlices);
  const tail = positive.slice(maxSlices);
  const out = head.map((a, i) => ({ name: a.name, value: a.total, color: SLOT(i) }));
  if (tail.length) out.push({ name: `Other (${tail.length})`, value: tail.reduce((s, a) => s + a.total, 0), color: OTHER_COLOR, other: true });
  const sum = out.reduce((s, x) => s + x.value, 0);
  return { items: out.map((x) => ({ ...x, share: sum ? x.value / sum : 0 })), sum, skipped };
}

// ---------- pieces ----------

function SideToggle({ value, onChange }) {
  return (
    <div className="seg seg-sm" role="group" aria-label="Side">
      {SIDES.map((s) => <button key={s.id} type="button" aria-pressed={value === s.id} onClick={() => onChange(s.id)}>{s.label}</button>)}
    </div>
  );
}

function Frame({ title, right, children, note }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{right}</div>
      </div>
      {note && <p className="mb-2 text-xs text-muted">{note}</p>}
      {children}
    </section>
  );
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />{p.name}</div>
      <div className="tabular text-ink2">{fmtMoney(p.value)} · {fmtPct(p.share).replace('+', '')}</div>
    </div>
  );
}

/** Composition of one side by top-level account: donut (default), pie, or ranked bars. */
export function MixChart({ data, classification, cfg, type, onTypeChange, height = 260 }) {
  const accounts = useMemo(() => topLevelAccounts(data, classification), [data, classification]);
  const { items, sum, skipped } = useMemo(() => slices(accounts, cfg.maxSlices), [accounts, cfg.maxSlices]);
  const label = SIDES.find((s) => s.id === classification)?.label || classification;
  const picker = <ChartTypePicker options={cfg.options} value={type} onChange={onTypeChange} label="Chart type" />;
  const note = [
    items.length > 1 && items.at(-1).other ? `Top ${cfg.maxSlices} accounts shown, the rest folded into Other.` : null,
    skipped ? `${skipped} account${skipped === 1 ? '' : 's'} with a negative total left out of the mix.` : null,
  ].filter(Boolean).join(' ');

  if (items.length === 0) {
    return <Frame title={`${label} mix`} right={picker}><div className="flex h-40 items-center justify-center text-sm text-muted">No {label.toLowerCase()} in this range.</div></Frame>;
  }

  if (type === 'bars') {
    return (
      <Frame title={`${label} by account`} right={picker} note={note}>
        <div style={{ height: items.length * 32 + 24 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} layout="vertical" margin={{ top: 4, right: 84, bottom: 0, left: 4 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke="var(--line)" strokeWidth={1} />
              <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
              <YAxis type="category" dataKey="name" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={150} />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={<PieTip />} />
              <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {items.map((s) => <Cell key={s.name} fill={s.color} />)}
                <LabelList dataKey="share" position="right" formatter={(v) => fmtPct(v).replace('+', '')} style={{ fill: 'var(--ink-2)', fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Frame>
    );
  }

  const donut = type === 'donut';
  return (
    <Frame title={`${label} mix`} right={picker} note={note}>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative shrink-0" style={{ width: height, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={items} dataKey="value" nameKey="name" innerRadius={donut ? '62%' : 0} outerRadius="96%"
                stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} startAngle={90} endAngle={-270}
              >
                {items.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
              <Tooltip content={<PieTip />} />
            </PieChart>
          </ResponsiveContainer>
          {donut && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-xs text-ink2">{label}</div>
              <div className="text-lg font-semibold">{fmtCompact(sum)}</div>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {items.map((s) => (
              <tr key={s.name} className="border-t border-[var(--line)] first:border-t-0">
                <td className="py-1 pr-2">
                  <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.name}</span>
                </td>
                <td className="tabular whitespace-nowrap py-1 text-right text-ink2">{fmtMoney(s.value)}</td>
                <td className="tabular whitespace-nowrap py-1 pl-3 text-right text-ink2">{fmtPct(s.share).replace('+', '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

/** Top N accounts of one side over time: lines, stacked bars, or small multiples. */
export function TrendChart({ data, classification, cfg, type, onTypeChange, height = 280 }) {
  const periods = data.periods;
  const series = useMemo(
    () => topLevelAccounts(data, classification).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, cfg.topAccounts)
      .map((a, i) => ({ key: a.key, label: a.name, color: SLOT(i), periods: a.periods })),
    [data, classification, cfg.topAccounts]
  );
  const rows = useMemo(() => periods.map((p) => ({ label: p.label, ...Object.fromEntries(series.map((s) => [s.key, s.periods[p.key] || 0])) })), [periods, series]);
  const label = SIDES.find((s) => s.id === classification)?.label || classification;
  const picker = <ChartTypePicker options={cfg.options} value={type} onChange={onTypeChange} label="Chart type" />;
  const title = `Top ${series.length} ${label.toLowerCase()} accounts over time`;

  if (series.length === 0) return null;

  const tip = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="card px-3 py-2 text-sm shadow-sm">
        <div className="mb-1 text-ink2">{l}</div>
        {series.map((s) => {
          const p = payload.find((x) => x.dataKey === s.key);
          return p ? (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />{s.label}</span>
              <span className="tabular">{fmtMoney(p.value)}</span>
            </div>
          ) : null;
        })}
      </div>
    );
  };

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={24} />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={64} />
      <ReferenceLine y={0} stroke="var(--axis)" />
    </>
  );

  if (type === 'small') {
    let lo = 0; let hi = 0;
    for (const r of rows) for (const s of series) { lo = Math.min(lo, r[s.key]); hi = Math.max(hi, r[s.key]); }
    const domain = [lo, hi === lo ? lo + 1 : hi];
    return (
      <Frame title={title} right={picker}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <div key={s.key} className="rounded-lg border border-[var(--ring)] p-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />{s.label}</div>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                    <XAxis dataKey="label" tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={32} />
                    <YAxis domain={domain} tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={52} />
                    <ReferenceLine y={0} stroke="var(--axis)" />
                    <Tooltip cursor={{ stroke: 'var(--axis)' }} content={tip} />
                    <Line dataKey={s.key} {...lineProps(s.color)} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </Frame>
    );
  }

  return (
    <Frame title={title} right={<><Legend items={series.map((s) => ({ ...s, kind: type === 'lines' ? 'line' : 'bar' }))} />{picker}</>}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'stacked' ? (
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap="30%">
              {axes}
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={tip} />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={24}
                     radius={i === series.length - 1 ? ROUND_TOP : 0} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              {axes}
              <Tooltip cursor={{ stroke: 'var(--axis)' }} content={tip} />
              {series.map((s) => <Line key={s.key} dataKey={s.key} {...lineProps(s.color)} />)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}

/** Ranked bars of one side by QuickBooks account sub-type: a view only the chart of accounts makes possible. */
export function SubTypeChart({ data, classification, cfg }) {
  const items = useMemo(() => bySubType(data, classification).slice(0, cfg.maxRows), [data, classification, cfg.maxRows]);
  const label = SIDES.find((s) => s.id === classification)?.label || classification;
  if (items.length === 0) return null;
  const total = items.reduce((s, x) => s + Math.max(0, x.value), 0);
  const rows = items.map((x) => ({ ...x, share: total ? x.value / total : 0 }));
  return (
    <Frame title={`${label} by account sub-type`} note={`Sub-types are set per account in QuickBooks (Account → Detail type). Top ${cfg.maxRows}.`}>
      <div style={{ height: rows.length * 32 + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 84, bottom: 0, left: 4 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke="var(--line)" strokeWidth={1} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
            <YAxis type="category" dataKey="name" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={190} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--ring)' }} content={({ active, payload }) => active && payload?.length ? (
              <div className="card px-3 py-2 text-sm shadow-sm"><div>{payload[0].payload.name}</div><div className="tabular text-ink2">{fmtMoney(payload[0].value)}</div></div>
            ) : null} />
            <Bar dataKey="value" fill={classification === 'Revenue' ? metricOf('income').color : metricOf('expenses').color} maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="value" position="right" formatter={fmtMoney} style={{ fill: 'var(--ink-2)', fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}

/** KPI tiles + the chart grid for the chart of accounts tab. */
export default function CoaDashboard({ data, cfg }) {
  const [mixType, setMixType] = useState(cfg.mix.default);
  const [trendType, setTrendType] = useState(cfg.trend.default);
  const [side, setSide] = useState('Expense');

  const revenue = data.sections.find((s) => s.classification === 'Revenue');
  const expense = data.sections.find((s) => s.classification === 'Expense');
  const counts = useMemo(() => {
    let total = 0; let active = 0;
    const walk = (n) => { if (!n.unmapped) { total++; if (n.hasActivity) active++; } n.children.forEach(walk); };
    for (const s of data.sections) for (const t of s.types) t.nodes.forEach(walk);
    return { total, active };
  }, [data]);
  const income = metricOf('income');
  const expenses = metricOf('expenses');
  const net = metricOf('netIncome');
  const tiles = [
    { label: 'Revenue', value: revenue?.total || 0, color: income.color },
    { label: 'Expenses', value: expense?.total || 0, color: expenses.color },
    { label: net.label, value: data.netIncome.total, color: net.color },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card flex flex-col gap-1 p-4">
            <div className="flex items-center gap-2 text-sm text-ink2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} aria-hidden="true" />{t.label}</div>
            <div className={`text-2xl font-semibold ${t.value < 0 ? 'text-bad' : ''}`}>{fmtMoney(t.value)}</div>
          </div>
        ))}
        <div className="card flex flex-col gap-1 p-4">
          <div className="text-sm text-ink2">P&amp;L accounts with activity</div>
          <div className="text-2xl font-semibold">{counts.active} <span className="text-base font-normal text-muted">of {counts.total}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MixChart data={data} classification="Revenue" cfg={cfg.mix} type={mixType} onTypeChange={setMixType} />
        <MixChart data={data} classification="Expense" cfg={cfg.mix} type={mixType} onTypeChange={setMixType} />
      </div>

      <div className="flex items-center gap-3 text-sm text-ink2">
        Show for <SideToggle value={side} onChange={setSide} />
      </div>
      <TrendChart data={data} classification={side} cfg={cfg.trend} type={trendType} onTypeChange={setTrendType} />
      {cfg.subType.enabled && <SubTypeChart data={data} classification={side} cfg={cfg.subType} />}
    </>
  );
}
