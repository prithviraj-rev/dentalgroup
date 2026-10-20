import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, ScatterChart, PieChart, Pie, Bar, Line, Scatter, Cell, LabelList,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { api } from '../api.js';
import { fmtMetric, fmtCompact, fmtMoney, fmtChange, metric as metricOf } from '../format.js';
import { Delta } from './KpiCards.jsx';

// ---------- helpers ----------

const SLOT = (i) => `var(--series-${i + 1})`;
const OTHER = 'var(--axis)';
const POS = 'var(--series-1)';
const NEG = 'var(--series-8)';
const axisTick = { fill: 'var(--muted)', fontSize: 12 };
const pct1 = (v) => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
/** Tint of a color toward the surface: share 0..1 -> 6%..90% of the color. */
const tint = (color, share) => `color-mix(in oklab, ${color} ${Math.round(6 + Math.min(1, Math.max(0, share)) * 84)}%, var(--surface))`;
const inkOn = (share) => (share > 0.55 ? '#fff' : 'var(--ink)');

function Section({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function LegendRow({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className={it.kind === 'line' ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'} style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function Tip({ active, payload, label, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      {label != null && <div className="mb-1 text-ink2">{label}</div>}
      {rows(p).map(([k, v, color]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            {color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />}
            {k}
          </span>
          <span className="tabular">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Tiny inline SVG sparkline. Values may include null (no data that month). */
export function Sparkline({ values, width = 120, height = 32, color = POS }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
  if (pts.length < 2) return <span className="text-xs text-muted">–</span>;
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(0, ...vs);
  const x = (i) => 2 + (i / Math.max(1, values.length - 1)) * (width - 4);
  const y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="block">
      {lo < 0 && hi > 0 && <line x1="2" x2={width - 2} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="2.5" fill={lv < 0 ? NEG : color} />
    </svg>
  );
}

// ---------- sections ----------

function Kpis({ data, x }) {
  const tiles = x.kpis.metrics.map((k) => {
    const m = metricOf(k);
    return { key: k, label: m.label, value: data.totals[k], comparable: data.comparableTotals?.[k], prior: data.priorTotals?.[k], upIsGood: m.upIsGood, spark: data.series.map((s) => (s.hasData ? s[k] : null)), metricKey: k };
  });
  const revenue = data.totals.revenue || 0;
  const shares = x.kpis.bucketShares.map((b) => ({ key: b, label: `${b} % of revenue`, value: revenue ? (data.cost.portfolio[b] || 0) / revenue : null }));
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key} className="card flex flex-col gap-1 p-4">
            <div className="text-sm text-ink2">{t.label}</div>
            <div className="flex items-end justify-between gap-3">
              <div className={`text-2xl font-semibold ${t.value < 0 ? 'text-bad' : ''}`}>{fmtMetric(t.metricKey, t.value)}</div>
              <Sparkline values={t.spark} color={metricOf(t.key).color} />
            </div>
            {data.priorTotals ? (
              <>
                <Delta metricKey={t.metricKey} cur={t.comparable ?? t.value} prev={t.prior ?? null} upIsGood={t.upIsGood} />
                {data.prior.overlapMonths < data.series.length && <span className="text-[11px] text-muted">Same {data.prior.overlapMonths} months both years</span>}
              </>
            ) : <span className="text-xs text-muted">No data for last year yet</span>}
          </div>
        ))}
      </div>
      {shares.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shares.map((s) => (
            <div key={s.key} className="card flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-xs text-ink2">{s.label}</div>
              <div className="text-lg font-semibold tabular">{pct1(s.value)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Trend({ data, x }) {
  const n = x.trend.rollingMonths;
  const rows = data.series.map((s, i) => {
    const win = data.series.slice(Math.max(0, i - n + 1), i + 1).filter((w) => w.hasData);
    return {
      label: s.label,
      revenue: s.hasData ? s.revenue : null,
      priorRevenue: s.prior?.revenue ?? null,
      netIncome: s.hasData ? s.netIncome : null,
      rolling: win.length === Math.min(n, i + 1) && win.length ? win.reduce((a, w) => a + w.netIncome, 0) / win.length : null,
    };
  });
  const hasPrior = rows.some((r) => r.priorRevenue != null);
  const tick = (v) => fmtCompact(v);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Revenue by month" subtitle={hasPrior ? 'Compared with the same month last year' : undefined}
        right={<LegendRow items={[{ label: 'This period', color: POS }, ...(hasPrior ? [{ label: 'Last year', color: 'var(--muted)', kind: 'line' }] : [])]} />}>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={tick} width={60} />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={<Tip rows={(p) => [['Revenue', fmtMoney(p.revenue), POS], ...(p.priorRevenue != null ? [['Last year', fmtMoney(p.priorRevenue), 'var(--muted)'], ['Change', fmtChange('revenue', p.revenue, p.priorRevenue)]] : [])]} />} />
              <Bar dataKey="revenue" fill={POS} maxBarSize={22} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              {hasPrior && <Line dataKey="priorRevenue" stroke="var(--muted)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Net income by month" subtitle={`Bars: monthly result. Line: ${n}-month average.`}
        right={<LegendRow items={[{ label: 'Profit', color: POS }, { label: 'Loss', color: NEG }, { label: `${n}-month average`, color: 'var(--series-3)', kind: 'line' }]} />}>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={tick} width={60} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={<Tip rows={(p) => [['Net income', fmtMoney(p.netIncome), p.netIncome < 0 ? NEG : POS], ...(p.rolling != null ? [[`${n}-month average`, fmtMoney(p.rolling), 'var(--series-3)']] : [])]} />} />
              <Bar dataKey="netIncome" maxBarSize={22} isAnimationActive={false}>
                {rows.map((r, i) => <Cell key={i} fill={r.netIncome < 0 ? NEG : POS} />)}
              </Bar>
              <Line dataKey="rolling" stroke="var(--series-3)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}

const SORTS = {
  revenue: { label: 'Revenue', get: (o) => o.totals.revenue },
  netIncome: { label: 'Net income', get: (o) => o.totals.netIncome },
  netMargin: { label: 'Net margin', get: (o) => o.totals.netMargin ?? -Infinity },
  yoy: { label: 'Revenue YoY', get: (o) => (o.prior?.revenue ? ((o.comparable ?? o.totals).revenue - o.prior.revenue) / Math.abs(o.prior.revenue) : -Infinity) },
};

function Leaderboard({ data, x, onOpenOffice }) {
  const [sort, setSort] = useState(SORTS[x.leaderboard.defaultSort] ? x.leaderboard.defaultSort : 'revenue');
  const rows = [...data.offices].sort((a, b) => SORTS[sort].get(b) - SORTS[sort].get(a));
  const maxRev = Math.max(1, ...data.offices.map((o) => o.totals.revenue));
  const clamp = x.heatmap.clampPercent / 100;
  const spark = x.leaderboard.sparkMetric;
  const hasPrior = data.offices.some((o) => o.prior);
  const Th = ({ id, children, className = '' }) => (
    <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}>
      {id ? <button type="button" onClick={() => setSort(id)} className={`hover:text-ink ${sort === id ? 'text-ink' : ''}`}>{children}{sort === id ? ' ▾' : ''}</button> : children}
    </th>
  );
  return (
    <Section title="Office leaderboard" subtitle={`${rows.length} offices · click a column to sort, click an office to open it`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs text-ink2">
              <Th className="w-8 text-right">#</Th>
              <Th>Office</Th>
              <Th id="revenue">Revenue</Th>
              {hasPrior && <Th id="yoy" className="text-right">YoY</Th>}
              <Th id="netIncome" className="text-right">Net income</Th>
              <Th id="netMargin">Net margin</Th>
              <Th>{metricOf(spark).label}, by month</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => {
              const m = o.totals.netMargin;
              const share = m == null ? 0 : Math.min(1, Math.abs(m) / clamp);
              const yoy = o.prior?.revenue ? ((o.comparable ?? o.totals).revenue - o.prior.revenue) / Math.abs(o.prior.revenue) : null;
              return (
                <tr key={o.realmId} className="border-t border-[var(--line)] hover:bg-page">
                  <td className="tabular px-3 py-2 text-right text-muted">{i + 1}</td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpenOffice?.(o.realmId)}>{o.officeName}</button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-28 shrink-0 rounded-full bg-[var(--line)]">
                        <div className="h-2.5 rounded-full" style={{ width: `${Math.max(0, (o.totals.revenue / maxRev) * 100)}%`, background: POS }} />
                      </div>
                      <span className="tabular whitespace-nowrap">{fmtMoney(o.totals.revenue)}</span>
                    </div>
                  </td>
                  {hasPrior && (
                    <td className={`tabular whitespace-nowrap px-3 py-2 text-right text-xs ${yoy == null ? 'text-muted' : yoy >= 0 ? 'text-good' : 'text-bad'}`}>
                      {yoy == null ? 'n/a' : `${yoy >= 0 ? '▲' : '▼'} ${Math.abs(yoy * 100).toFixed(1)}%`}
                    </td>
                  )}
                  <td className={`tabular whitespace-nowrap px-3 py-2 text-right ${o.totals.netIncome < 0 ? 'text-bad' : ''}`}>{fmtMoney(o.totals.netIncome)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {/* Diverging bar around a center line: blue right for profit, red left for loss. */}
                      <div className="relative h-2.5 w-24 shrink-0 rounded-full bg-[var(--line)]">
                        <div className="absolute top-[-2px] h-[14px] w-px bg-[var(--axis)]" style={{ left: '50%' }} />
                        {m != null && (
                          <div className="absolute h-2.5 rounded-full" style={m >= 0 ? { left: '50%', width: `${share * 50}%`, background: POS } : { right: '50%', width: `${share * 50}%`, background: NEG }} />
                        )}
                      </div>
                      <span className={`tabular whitespace-nowrap text-xs ${m < 0 ? 'text-bad' : 'text-ink2'}`}>{pct1(m)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1"><Sparkline values={o.monthly.map((mm) => (mm.empty ? null : mm[spark]))} width={110} height={26} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function RevenueVsMargin({ data, x }) {
  const pts = data.offices.filter((o) => o.totals.revenue > 0 && o.totals.netMargin != null);
  const PIN = 1; // pin margins beyond ±100% to the edge so one tiny entity can't flatten the chart
  const top = new Set([...pts].sort((a, b) => b.totals.revenue - a.totals.revenue).slice(0, x.scatter.labelTop).map((o) => o.realmId));
  const rows = pts.map((o) => ({
    name: o.officeName, x: o.totals.revenue, y: Math.max(-PIN, Math.min(PIN, o.totals.netMargin)), margin: o.totals.netMargin,
    netIncome: o.totals.netIncome, label: top.has(o.realmId) ? o.officeName : '', pinned: Math.abs(o.totals.netMargin) > PIN,
  }));
  const group = data.totals.netMargin;
  return (
    <Section title="Revenue vs net margin" subtitle="Each dot is an office. Right = bigger, up = more profitable. Largest offices are labelled."
      right={<LegendRow items={[{ label: 'Profitable', color: POS }, { label: 'Loss-making', color: NEG }, { label: 'Group margin', color: 'var(--muted)', kind: 'line' }]} />}>
      <div style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--line)" />
            <XAxis type="number" dataKey="x" name="Revenue" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={fmtCompact} />
            <YAxis type="number" dataKey="y" name="Net margin" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={52} />
            <ZAxis range={[90, 90]} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            {group != null && <ReferenceLine y={Math.max(-PIN, Math.min(PIN, group))} stroke="var(--muted)" strokeWidth={1.5} />}
            <Tooltip cursor={false} content={<Tip rows={(p) => [[p.name, ''], ['Revenue', fmtMoney(p.x)], ['Net income', fmtMoney(p.netIncome)], ['Net margin', `${pct1(p.margin)}${p.pinned ? ' (off the chart)' : ''}`]]} />} />
            <Scatter data={rows} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={r.margin < 0 ? NEG : POS} stroke="var(--surface)" strokeWidth={2} />)}
              <LabelList dataKey="label" position="top" style={{ fill: 'var(--ink-2)', fontSize: 11 }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {rows.some((r) => r.pinned) && <p className="mt-1 text-xs text-muted">Margins beyond ±100% are pinned to the chart edge; hover for the real value.</p>}
    </Section>
  );
}

function Heatmap({ data, x }) {
  const key = x.heatmap.metric;
  const m = metricOf(key);
  const isPct = m.format === 'percent';
  const clamp = isPct ? x.heatmap.clampPercent / 100 : Math.max(1, ...data.offices.flatMap((o) => o.monthly.map((c) => Math.abs(c[key] || 0))));
  const cellColor = (v) => {
    if (v == null) return { background: 'transparent' };
    const share = Math.min(1, Math.abs(v) / clamp);
    return { background: tint(v >= 0 ? POS : NEG, share), color: inkOn(share) };
  };
  const months = data.series;
  return (
    <Section title={`${m.label} by office and month`} subtitle={`Blue = profit, red = loss, deeper = further from zero (full color at ±${isPct ? `${x.heatmap.clampPercent}%` : fmtCompact(clamp)}). Hover a cell for the value.`}
      right={
        <div className="flex items-center gap-1 text-[11px] text-muted" aria-hidden="true">
          <span>Loss</span>
          {[1, 0.6, 0.25, 0, 0.25, 0.6, 1].map((s, i) => <span key={i} className="inline-block h-3 w-4 rounded-sm" style={{ background: s === 0 ? 'var(--line)' : tint(i < 3 ? NEG : POS, s) }} />)}
          <span>Profit</span>
        </div>
      }>
      <div className="overflow-x-auto">
        <table className="border-separate text-xs" style={{ borderSpacing: 2 }}>
          <thead>
            <tr className="text-muted">
              <th className="sticky left-0 z-10 bg-surface pr-2 text-left font-medium">Office</th>
              {months.map((c) => <th key={c.key} className="px-0.5 font-normal" title={c.label}>{c.label.slice(0, 3)}<br />{c.key.slice(2, 4)}</th>)}
              <th className="pl-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.offices.map((o) => (
              <tr key={o.realmId}>
                <td className="sticky left-0 z-10 max-w-[220px] truncate bg-surface pr-2 text-ink2" title={o.officeName}>{o.officeName}</td>
                {o.monthly.map((c) => {
                  // Ratio undefined because revenue was 0: show a loss month as full red instead of "no data".
                  const v = c.empty ? null : c[key] ?? (isPct && c.netIncome < 0 ? -clamp : isPct && c.netIncome > 0 ? clamp : null);
                  return (
                    <td key={c.key} title={`${o.officeName} · ${c.key}: ${c.empty ? 'no data' : c[key] == null && isPct ? `no revenue, net income ${fmtMoney(c.netIncome)}` : fmtMetric(key, v)}`}
                      className="h-6 min-w-[30px] rounded-sm text-center tabular" style={cellColor(v)}>
                      {v == null ? <span className="text-muted">·</span> : ''}
                    </td>
                  );
                })}
                <td className={`tabular whitespace-nowrap pl-2 text-right ${o.totals[key] < 0 ? 'text-bad' : ''}`}>{fmtMetric(key, o.totals[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Stacked 100% bar of a { bucket: amount } map over an ordered bucket list (top 7 + Other). */
function shareSegments(map, order, maxSlots = 7) {
  const entries = order.map((b) => [b, map[b] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const head = entries.slice(0, maxSlots);
  const tail = entries.slice(maxSlots).reduce((s, [, v]) => s + v, 0);
  const segs = head.map(([b, v]) => ({ label: b, value: v }));
  if (tail > 0) segs.push({ label: 'Other', value: tail });
  const total = segs.reduce((s, x) => s + x.value, 0);
  return { segs: segs.map((s) => ({ ...s, share: total ? s.value / total : 0 })), total };
}

function RevenueMix({ data }) {
  // Fixed colors per payer bucket in config order, so a payer keeps its color in every row.
  const order = data.mix.order;
  const colorOf = (b) => (b === 'Other' ? OTHER : order.indexOf(b) < 8 ? SLOT(order.indexOf(b)) : OTHER);
  const port = shareSegments(data.mix.portfolio, order);
  const refunds = Object.entries(data.mix.portfolio).filter(([, v]) => v < 0);
  return (
    <Section title="Payer mix" subtitle="Where revenue comes from: group total and by office">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col items-center gap-3">
          <div className="relative" style={{ width: 220, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={port.segs} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
                  {port.segs.map((s) => <Cell key={s.label} fill={colorOf(s.label)} />)}
                </Pie>
                <Tooltip content={<Tip rows={(p) => [[p.label, `${fmtMoney(p.value)} · ${pct1(p.share)}`, colorOf(p.label)]]} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-xs text-ink2">Revenue</div>
              <div className="text-lg font-semibold">{fmtCompact(port.total)}</div>
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {port.segs.map((s) => (
                <tr key={s.label} className="border-t border-[var(--line)] first:border-t-0">
                  <td className="py-1"><span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(s.label) }} aria-hidden="true" />{s.label}</span></td>
                  <td className="tabular py-1 text-right text-ink2">{fmtMoney(s.value)}</td>
                  <td className="tabular py-1 pl-3 text-right font-medium">{pct1(s.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {refunds.length > 0 && <p className="text-xs text-muted">Refunds of {fmtMoney(-refunds.reduce((s, [, v]) => s + v, 0))} are netted out of the shares.</p>}
        </div>
        <div className="lg:col-span-2">
          <div className="flex flex-col gap-1.5">
            {data.offices.filter((o) => o.totals.revenue > 0).map((o) => {
              const { segs } = shareSegments(o.mix, order);
              return (
                <div key={o.realmId} className="grid grid-cols-[minmax(0,170px)_1fr] items-center gap-3 text-xs">
                  <span className="truncate text-ink2" title={o.officeName}>{o.officeName}</span>
                  <div className="flex h-4 overflow-hidden rounded" role="img" aria-label={`${o.officeName}: ${segs.map((s) => `${s.label} ${pct1(s.share)}`).join(', ')}`}>
                    {segs.map((s) => (
                      <div key={s.label} title={`${o.officeName} · ${s.label}: ${pct1(s.share)} (${fmtMoney(s.value)})`}
                        style={{ width: `${s.share * 100}%`, background: colorOf(s.label), borderRight: '2px solid var(--surface)' }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}

function CostStructure({ data }) {
  const revenue = data.totals.revenue || 0;
  const order = data.cost.order;
  // Columns: the biggest cost categories for the group.
  const cols = order.filter((b) => (data.cost.portfolio[b] || 0) > 0).sort((a, b) => (data.cost.portfolio[b] || 0) - (data.cost.portfolio[a] || 0)).slice(0, 9);
  const shareOf = (o, b) => (o.totals.revenue > 0 ? (o.cost[b] || 0) / o.totals.revenue : null);
  const colMax = Object.fromEntries(cols.map((b) => [b, Math.max(0.0001, ...data.offices.map((o) => shareOf(o, b) ?? 0).filter((v) => v < 2))]));
  // Revenue dollar bar: each cost category as cents of a revenue dollar, plus what is left.
  const { segs } = shareSegments(data.cost.portfolio, order, 7);
  const expenses = segs.reduce((s, x) => s + x.value, 0);
  const left = revenue - expenses;
  const base = Math.max(revenue, expenses) || 1;
  const segColor = (i, label) => (label === 'Other' ? OTHER : SLOT(i));
  return (
    <Section title="Cost structure" subtitle="Each cost category as a share of revenue. Darker = higher than other offices for that category.">
      <div className="mb-5">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink2">
          <span className="font-medium text-ink">Where each revenue dollar goes (group)</span>
          <span>{left >= 0 ? `${pct1(left / (revenue || 1))} left as profit before other income` : `Costs exceed revenue by ${fmtMoney(-left)}`}</span>
        </div>
        <div className="flex h-7 overflow-hidden rounded">
          {segs.map((s, i) => (
            <div key={s.label} title={`${s.label}: ${fmtMoney(s.value)} = ${pct1(revenue ? s.value / revenue : null)} of revenue`}
              className="flex items-center justify-center overflow-hidden text-[11px] font-medium text-white"
              style={{ width: `${(s.value / base) * 100}%`, background: segColor(i, s.label), borderRight: '2px solid var(--surface)' }}>
              {s.value / base > 0.07 ? `${Math.round((s.value / (revenue || 1)) * 100)}¢` : ''}
            </div>
          ))}
          {left > 0 && <div className="flex items-center justify-center text-[11px] font-medium" style={{ width: `${(left / base) * 100}%`, background: 'var(--line)' }} title={`Left: ${fmtMoney(left)}`}>{left / base > 0.07 ? `${Math.round((left / revenue) * 100)}¢ left` : ''}</div>}
        </div>
        <div className="mt-2"><LegendRow items={segs.map((s, i) => ({ label: s.label, color: segColor(i, s.label) }))} /></div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate text-xs" style={{ borderSpacing: 2 }}>
          <thead>
            <tr className="text-ink2">
              <th className="sticky left-0 z-10 bg-surface pr-2 text-left font-medium">Office</th>
              <th className="px-2 text-right font-medium">Revenue</th>
              {cols.map((b) => <th key={b} className="max-w-[90px] px-1 text-right font-medium leading-tight">{b}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="font-medium">
              <td className="sticky left-0 z-10 bg-surface pr-2">Group</td>
              <td className="tabular px-2 text-right">{fmtCompact(revenue)}</td>
              {cols.map((b) => <td key={b} className="tabular rounded-sm px-2 py-1 text-right" style={{ background: 'var(--line)' }}>{pct1(revenue ? (data.cost.portfolio[b] || 0) / revenue : null)}</td>)}
            </tr>
            {data.offices.filter((o) => o.totals.revenue > 0).map((o) => (
              <tr key={o.realmId}>
                <td className="sticky left-0 z-10 max-w-[200px] truncate bg-surface pr-2 text-ink2" title={o.officeName}>{o.officeName}</td>
                <td className="tabular px-2 text-right text-ink2">{fmtCompact(o.totals.revenue)}</td>
                {cols.map((b) => {
                  const v = shareOf(o, b);
                  const s = v == null || !(o.cost[b] > 0) ? 0 : Math.min(1, v / colMax[b]);
                  return (
                    <td key={b} className="tabular rounded-sm px-2 py-1 text-right" title={`${o.officeName} · ${b}: ${fmtMoney(o.cost[b] || 0)}`}
                      style={{ background: s ? tint(POS, s * 0.85) : 'transparent', color: s ? inkOn(s * 0.85) : 'var(--muted)' }}>
                      {o.cost[b] > 0 ? pct1(v) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Bridge({ data }) {
  const order = data.cost.order;
  const { segs } = shareSegments(data.cost.portfolio, order, 8);
  // Each step is a range bar [from, to] on one money axis.
  const revenue = data.totals.revenue || 0;
  const rows = [];
  const range = (a, b) => [Math.min(a, b), Math.max(a, b)];
  let run = revenue;
  rows.push({ label: 'Revenue', kind: 'total', signed: revenue, a: range(0, revenue) });
  if (data.otherIncome) {
    rows.push({ label: 'Other income', kind: data.otherIncome >= 0 ? 'up' : 'down', signed: data.otherIncome, a: range(run, run + data.otherIncome) });
    run += data.otherIncome;
  }
  for (const seg of segs) {
    rows.push({ label: seg.label, kind: 'down', signed: -seg.value, a: range(run, run - seg.value) });
    run -= seg.value;
  }
  const credits = Object.values(data.cost.portfolio).filter((v) => v < 0).reduce((s, v) => s + v, 0);
  if (credits) {
    rows.push({ label: 'Cost credits & reversals', kind: 'up', signed: -credits, a: range(run, run - credits) });
    run -= credits;
  }
  rows.push({ label: 'Net income', kind: run >= 0 ? 'total' : 'loss', signed: run, a: range(0, run) });
  const color = (k) => (k === 'down' || k === 'loss' ? NEG : k === 'up' ? 'var(--series-3)' : POS);
  return (
    <Section title="Profit bridge" subtitle="From revenue to net income for the selected period: what each cost category takes away">
      <div style={{ height: Math.max(280, rows.length * 34 + 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 90, bottom: 0, left: 4 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="var(--line)" />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
            <YAxis type="category" dataKey="label" tick={{ ...axisTick, fill: 'var(--ink-2)' }} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={200} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--ring)' }} content={<Tip rows={(p) => [[p.label, fmtMoney(p.signed), color(p.kind)], ...(revenue && p.label !== 'Revenue' ? [['% of revenue', pct1(Math.abs(p.signed) / revenue)]] : [])]} />} />
            <Bar dataKey="a" maxBarSize={22} radius={3} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={i} fill={color(r.kind)} />)}
              <LabelList dataKey="signed" position="right" formatter={(v) => fmtCompact(v)} style={{ fill: 'var(--ink-2)', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Movers({ data, x }) {
  if (!data.prior.hasData) {
    return (
      <Section title="What changed vs last year">
        <p className="text-sm text-ink2">This needs data for the same months last year ({data.prior.from} to {data.prior.to}). Sync history does not reach back that far yet.</p>
      </Section>
    );
  }
  const up = data.movers.filter((m) => m.impact > 0).slice(0, x.movers.count);
  const down = data.movers.filter((m) => m.impact < 0).slice(0, x.movers.count);
  const max = Math.max(1, ...data.movers.map((m) => Math.abs(m.impact)));
  const partial = data.prior.overlapMonths < data.series.length;
  const List = ({ title, items, color }) => (
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink2">{title}</h3>
      {items.length === 0 ? <p className="text-xs text-muted">None.</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li key={`${m.grp}|${m.account}`} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate" title={m.account}>{m.account}</span>
                <span className={`tabular shrink-0 font-medium ${m.impact > 0 ? 'text-good' : 'text-bad'}`}>{m.impact > 0 ? '+' : '−'}{fmtMoney(Math.abs(m.impact))}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-[var(--line)]"><div className="h-1.5 rounded-full" style={{ width: `${(Math.abs(m.impact) / max) * 100}%`, background: color }} /></div>
                <span className="tabular shrink-0 text-muted">{fmtCompact(m.prior)} → {fmtCompact(m.current)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Section title="What changed vs last year" subtitle={`Accounts that moved net income the most, ${data.from} to ${data.to} vs ${data.prior.from} to ${data.prior.to}${partial ? ` (compared over the ${data.prior.overlapMonths} months with data in both years)` : ''}`}>
      <div className="grid gap-6 md:grid-cols-2">
        <List title="Helped net income" items={up} color={POS} />
        <List title="Hurt net income" items={down} color={NEG} />
      </div>
    </Section>
  );
}

// ---------- page ----------

export default function Executive({ config, filters, officeParam, reloadKey, onOpenOffice }) {
  const x = config.executiveView;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.executive({ from: filters.from, to: filters.to, office: officeParam })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.from, filters.to, officeParam, reloadKey]);

  const on = useMemo(() => new Set(x.sections), [x.sections]);

  if (error) return <div className="card border-l-4 border-l-bad p-4 text-sm"><div className="font-medium">Could not load the executive view</div><div className="text-ink2">{error}</div></div>;
  if (!data) return <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>;
  if (!data.hasData) return <div className="card px-6 py-12 text-center text-sm text-ink2">No data for this selection and date range.</div>;

  return (
    <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      {on.has('kpis') && <Kpis data={data} x={x} />}
      {on.has('trend') && <Trend data={data} x={x} />}
      {on.has('leaderboard') && data.offices.length > 1 && <Leaderboard data={data} x={x} onOpenOffice={onOpenOffice} />}
      {on.has('scatter') && data.offices.length > 2 && <RevenueVsMargin data={data} x={x} />}
      {on.has('heatmap') && <Heatmap data={data} x={x} />}
      {on.has('revenueMix') && <RevenueMix data={data} />}
      {on.has('costStructure') && <CostStructure data={data} />}
      {(on.has('bridge') || on.has('movers')) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {on.has('bridge') && <Bridge data={data} />}
          {on.has('movers') && <Movers data={data} x={x} />}
        </div>
      )}
    </div>
  );
}
