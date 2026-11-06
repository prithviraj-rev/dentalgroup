import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Section, Toolbar, Money, compact, pct1, downloadCsv, monthLabel, axisTick } from './ui.jsx';
import { useComparison, SetPicker, nid, windowOf, periodLabel, monthsBetween, MONTHS, delta, signed } from './compareSet.jsx';

/**
 * Compare charts tab (VJ 2026-10-30: "these tables are very difficult for comparison, can we do charts or graphs"): the same
 * COMPANIES x PERIODS picks as the Side by side card (compareSet.jsx), drawn instead of tabled.
 *   - Trend: one statement row month by month, one line per company and period. Years / quarters / custom windows line up
 *     by month position (Jan..Dec), so A's 2026 runs over A's 2025; when every period is a single month, the months are the
 *     x axis and each company is one line (A month-wise).
 *   - Panels: one small bar chart per statement row, one bar per column; click a panel to put that row in the trend.
 * Colour follows the company (one hue per chip, in the order added); later periods are lighter tints and dashed lines.
 * app.config.json compareCharts: label, source (rows + /set endpoint), defaultMetric, panels, maxSets, periodYears, periodMonths, rememberPicks.
 */
const TINT = [100, 58, 38, 24];
const DASH = [undefined, '6 3', '2 3', '8 3 2 3'];
const hueOf = (i) => `var(--series-${(i % 8) + 1})`;
const colorOf = (i, j) => (j === 0 ? hueOf(i) : `color-mix(in oklab, ${hueOf(i)} ${TINT[Math.min(j, 3)]}%, var(--surface))`);
const dashOf = (j) => DASH[Math.min(j, 3)];
const VALUE_OPTIONS = [['amount', 'Amounts'], ['pct', '% of collections']];
const storeKey = (base) => `pnl.compareCharts.${base}`;
const readStore = (base) => { try { const v = JSON.parse(localStorage.getItem(storeKey(base)) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const writeStore = (base, v) => { try { localStorage.setItem(storeKey(base), JSON.stringify(v)); } catch { /* private mode */ } };
const validPeriod = (p) => p && ((p.mode === 'year' && Number.isInteger(p.year)) || (p.mode === 'month' && /^\d{4}-\d{2}$/.test(p.month)) || (p.mode === 'custom' && /^\d{4}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}$/.test(p.to)));

/** A short line or bar key in the series colour (never coloured text). */
const Key = ({ color, dash, kind }) => (kind === 'line'
  ? <svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash} /></svg>
  : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />);

export default function CompareCharts({ config, filters, officeParam, lastFull, reloadKey = 0, base, controls = null }) {
  const cc = config.compareCharts || {};
  const y = Number(lastFull.slice(0, 4));
  const stored = cc.rememberPicks !== false ? readStore(base) : null;
  const fromHeader = officeParam && !['all', '__none__'].includes(officeParam) ? officeParam.split(',').filter(Boolean) : [];
  const cmp = useComparison({
    // The header's picks (?office=a,b) win; else the browser's last picks; else nothing yet. Periods: this year and last year.
    initialSets: fromHeader.length ? fromHeader.map((id) => ({ id: nid(), ids: [id] })) : (stored?.sets || []).filter((s) => Array.isArray(s.ids) && s.ids.length).slice(0, cc.maxSets || 8).map((s) => ({ id: nid(), ids: s.ids.map(String) })),
    initialPeriods: (stored?.periods || []).filter(validPeriod).length ? stored.periods.filter(validPeriod).map((p) => ({ id: nid(), ...p })) : [{ id: nid(), mode: 'year', year: y }, { id: nid(), mode: 'year', year: y - 1 }],
    lastFull, basis: filters.basis, base, reloadKey, maxSets: cc.maxSets || 8,
    onChange: cc.rememberPicks !== false ? (sets, periods) => writeStore(base, { sets: sets.map((s) => ({ ids: s.ids })), periods: periods.map(({ id: _id, ...p }) => p), metric: stored?.metric }) : null,
  });
  const { sets, periods, cols, rows, collectionsKey: ck, nameOf, overTime, baseOf, vsLabel } = cmp;
  const [metric, setMetric] = useState(stored?.metric || cc.defaultMetric || null);
  const [values, setValues] = useState('amount'); // amount | pct (% of collections)
  const [table, setTable] = useState(false);
  useEffect(() => { if (cc.rememberPicks !== false && metric) { const v = readStore(base) || {}; writeStore(base, { ...v, metric }); } }, [metric, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = rows.find((r) => r.key === metric) || rows.find((r) => r.key === ck) || rows[0] || null;
  const panelRows = cc.panels ? rows.filter((r) => cc.panels.includes(r.key)) : rows;
  const setIndex = (s) => sets.indexOf(s);
  const periodIndex = (p) => periods.indexOf(p);
  const colColor = (c) => colorOf(setIndex(c.s), periodIndex(c.p));
  const colDash = (c) => dashOf(periodIndex(c.p));
  const colLabel = (c) => (sets.length === 1 ? periodLabel(c.p, lastFull) : periods.length === 1 ? nameOf(c.s) : `${nameOf(c.s)} · ${periodLabel(c.p, lastFull)}`);
  const isPct = values === 'pct';
  const fmt = (v) => (v == null ? '–' : isPct ? pct1(v) : compact(v));
  const fmtFull = (v) => (v == null ? '–' : isPct ? pct1(v) : <Money v={v} />);
  const total = (c, rk) => { const d = c.r.data; if (!d) return null; const v = d.values?.[rk]; if (!isPct) return v ?? null; const b = ck ? d.values?.[ck] : 0; return b > 0 && v != null ? v / b : null; };
  const atMonth = (c, rk, m) => { const d = c.r.data; if (!d) return null; const v = d.monthly?.[rk]?.[m]; if (v == null) return null; if (!isPct) return v; const b = ck ? d.monthly?.[ck]?.[m] : 0; return b > 0 ? v / b : null; };
  const loading = cols.some((c) => c.r.loading);
  const errors = cols.filter((c) => c.r.error);

  // ---------- Trend: the chosen row month by month ----------
  const monthsMode = periods.length > 1 && periods.every((p) => { const w = windowOf(p, lastFull); return w.from === w.to; }); // every period is one month: months on the x axis, one line per company
  const trend = useMemo(() => {
    if (!row) return { series: [], data: [] };
    if (monthsMode) {
      const ordered = [...periods].sort((a, b) => (windowOf(a, lastFull).from < windowOf(b, lastFull).from ? -1 : 1));
      const series = sets.map((s, i) => ({ key: s.id, label: nameOf(s), color: colorOf(i, 0), dash: undefined }));
      const data = ordered.map((p) => { const m = windowOf(p, lastFull).from; const pt = { x: monthLabel(m), m }; for (const s of sets) { const c = cols.find((x) => x.s === s && x.p === p); pt[s.id] = atMonth(c, row.key, m); pt[`${s.id}__m`] = m; } return pt; });
      return { series, data };
    }
    const series = cols.map((c) => ({ key: c.key, label: colLabel(c), color: colColor(c), dash: colDash(c), months: monthsBetween(c.w.from, c.w.to) }));
    const n = Math.max(0, ...series.map((s) => s.months.length));
    const starts = new Set(series.map((s) => s.months[0]?.slice(5, 7)));
    const start = starts.size === 1 ? Number([...starts][0]) - 1 : null; // every window starts in the same month of the year: label by month name
    const data = Array.from({ length: n }, (_, i) => {
      const pt = { x: start == null ? `Month ${i + 1}` : MONTHS[(start + i) % 12] };
      for (const c of cols) { const s = series.find((x) => x.key === c.key); const m = s.months[i]; pt[c.key] = m ? atMonth(c, row.key, m) : null; pt[`${c.key}__m`] = m || null; }
      return pt;
    });
    return { series, data };
  }, [cols, periods, sets, row, monthsMode, isPct, lastFull]); // eslint-disable-line react-hooks/exhaustive-deps
  const TrendTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const pt = payload[0].payload;
    return (
      <div className="card px-3 py-2 text-sm shadow-sm">
        <div className="mb-1 text-ink2">{label}</div>
        {trend.series.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><Key color={s.color} dash={s.dash} kind="line" />{s.label}{pt[`${s.key}__m`] && pt[`${s.key}__m`] !== label && <span className="text-xs text-muted">{monthLabel(pt[`${s.key}__m`])}</span>}</span>
            <span className="tabular font-medium">{fmt(pt[s.key])}</span>
          </div>
        ))}
      </div>
    );
  };
  const legend = (series, kind) => (series.length > 1 ? (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
      {series.map((s) => <li key={s.key} className="flex items-center gap-1.5"><Key color={s.color} dash={s.dash} kind={kind} />{s.label}</li>)}
    </ul>
  ) : null);

  // ---------- Panels: every row, one bar per column ----------
  const PanelTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return <div className="card px-3 py-2 text-sm shadow-sm"><div className="flex items-center gap-2"><Key color={p.color} kind="bar" /><span className="text-ink2">{p.name}</span><span className="tabular font-medium">{fmtFull(p.v)}</span></div></div>;
  };
  const panel = (r) => {
    const data = cols.map((c) => ({ k: c.key, name: colLabel(c), v: total(c, r.key), color: colColor(c) }));
    const two = cols.length === 2 && baseOf(cols[1]) ? delta(data[1].v, data[0].v) : null; // exactly two columns: the change in the title
    const on = row?.key === r.key;
    const bold = ['collections', 'feesSubtotal', 'ebitda', 'cashFlow'].includes(r.role);
    return (
      <div key={r.key} role="button" tabIndex={0} aria-pressed={on} onClick={() => setMetric(r.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMetric(r.key); } }}
        className={`cursor-pointer rounded-lg border p-2 transition-colors hover:bg-page ${on ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))]' : 'border-[var(--line)]'}`} title="Show this row in the trend chart">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className={`min-w-0 truncate ${bold ? 'font-semibold' : ''}`}>{r.label}</span>
          {two != null && <span className="tabular shrink-0 text-[11px] text-ink2" title={vsLabel}>{signed(two)}</span>}
        </div>
        <div style={{ height: 112 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: 4 }} barCategoryGap="25%">
              <XAxis dataKey="name" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip content={<PanelTip />} cursor={{ fill: 'var(--ring)' }} />
              <Bar dataKey="v" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => <Cell key={d.k} fill={d.color} />)}
                {cols.length <= 4 && <LabelList dataKey="v" position="top" formatter={fmt} style={{ fill: 'var(--ink-2)', fontSize: 10 }} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };
  const barSeries = cols.map((c) => ({ key: c.key, label: colLabel(c), color: colColor(c) }));
  const exportCsv = () => downloadCsv(`compare-charts-${lastFull}.csv`, [['Row', ...cols.map(colLabel)], ...rows.map((r) => [r.label, ...cols.map((c) => total(c, r.key) ?? '')])]);
  const seg = (
    <div className="seg seg-sm" role="group" aria-label="Values">{VALUE_OPTIONS.map(([v, l]) => <button key={v} type="button" aria-pressed={values === v} onClick={() => setValues(v)}>{l}</button>)}</div>
  );
  const empty = !sets.length;
  const chartHeight = config.dashboard?.chartHeights?.main || 320;
  return (
    <div className="grid gap-2">
      <Section left={(
        <Toolbar sticky
          head={<><span className="toolbar-title">{cc.label || 'Compare charts'}</span><span className="toolbar-note">one colour per company; later periods lighter and dashed</span></>}
          left={seg}
          center={controls ? controls({ period: false, companies: false }) : null}
          end={<>
            <button type="button" className="control h-8 text-xs" aria-pressed={table} onClick={() => setTable(!table)} style={table ? { background: 'var(--accent)', color: '#fff', borderColor: 'transparent' } : undefined}>Table</button>
            <button type="button" className="control h-8 text-sm" onClick={exportCsv} disabled={empty}>Export CSV</button>
          </>} />
      )}>
        <SetPicker cmp={cmp} minSets={0} years={cc.periodYears} months={cc.periodMonths} colorOf={(i) => hueOf(i)}
          note={overTime || sets.length > 1 ? <span className="text-[11px] text-muted">change {vsLabel}</span> : null} />
        {empty && <p className="px-1 pb-1 text-sm text-ink2">Add a company, or a group of companies read as one, to start. Every chart then compares the picked companies over the picked periods: A against A over the years, A against B, or A's month against ABC's month.</p>}
        {errors.length > 0 && <p className="px-1 pb-1 text-xs text-bad">Could not load {errors.map(colLabel).join(', ')}: {errors[0].r.error}</p>}
      </Section>

      {!empty && (
        <Section
          left={(
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-medium">Trend</h2>
              <select className="control h-8 text-xs" value={row?.key || ''} onChange={(e) => setMetric(e.target.value)} aria-label="Statement row">
                {rows.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <span className="text-xs text-muted">{monthsMode ? 'month by month, one line per company' : 'month by month within each period'}</span>
            </div>
          )}
          right={legend(trend.series, 'line')}
        >
          <div style={{ height: chartHeight }} className={loading ? 'opacity-60' : ''}>
            {rows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="x" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} tickFormatter={fmt} />
                  <ReferenceLine y={0} stroke="var(--axis)" />
                  <Tooltip content={<TrendTip />} cursor={{ stroke: 'var(--axis)' }} />
                  {trend.series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinecap="round" strokeLinejoin="round" connectNulls={false}
                      dot={{ r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 5, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-sm text-ink2">{errors.length && errors.length === cols.length ? 'Could not load these columns.' : 'Loading…'}</div>}
          </div>
        </Section>
      )}

      {!empty && rows.length > 0 && (
        <Section title="Every row side by side" subtitle="one bar per company and period; click a row to see its trend" right={legend(barSeries, 'bar')}>
          <div className={`grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 ${loading ? 'opacity-60' : ''}`}>{panelRows.map(panel)}</div>
          {table && (
            <div className="mt-2 overflow-auto">
              <table className="cols-lined min-w-full text-xs">
                <thead className="bg-thead text-theadInk"><tr><th scope="col" className="px-2 py-1 text-left font-medium">Row</th>{cols.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-1 text-right font-medium">{colLabel(c)}</th>)}</tr></thead>
                <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-[var(--line)]"><th scope="row" className="px-2 py-0.5 text-left font-normal">{r.label}</th>{cols.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-0.5 text-right">{fmtFull(total(c, r.key))}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
