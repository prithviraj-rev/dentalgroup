import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { api } from '../api.js';
import { useNarrow } from './ui.jsx';
import { fmtMoney, fmtCompact, officeColor } from '../format.js';
import {
  buildEntities, combine, columnsFor, amountOf, measureValue, median, shadeAgainst, headline, toCsv,
} from '../categoryMath.js';

// Category compare tab: offices (or office categories) side by side on account categories, with
// targets and peer medians. Self-contained: its own endpoint (/api/category-view) and config file.

const POS = 'var(--series-1)';
const NEG = 'var(--series-8)';
const OTHER = 'var(--axis)';
const axisTick = { fill: 'var(--muted)', fontSize: 12 };
const slotColor = (slot) => (slot == null ? OTHER : `var(--series-${slot})`);
const tint = (color, s) => `color-mix(in oklab, ${color} ${Math.round(8 + Math.min(1, Math.max(0, s)) * 62)}%, var(--surface))`;
const pct1 = (v) => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
const MEASURES = [['pctRevenue', '% of revenue'], ['amount', 'Amount'], ['monthlyAvg', 'Monthly avg']];
const STORE = 'categoryCompare.ui';
const MAX_SERIES = 8;

const readStore = () => { try { return JSON.parse(window.localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
const writeStore = (v) => { try { window.localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage blocked */ } };

function fmtValue(measure, v, compact = false) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (measure === 'pctRevenue') return pct1(v);
  return compact ? fmtCompact(v) : fmtMoney(v);
}

function Section({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
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

function Seg({ label, options, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink2">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </label>
  );
}

function Select({ label, value, onChange, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink2">{label}</span>
      <select className="control" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

function Swatches({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className={it.kind === 'line' ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'}
            style={{ background: it.color, ...(it.dashed ? { background: 'none', borderTop: `2px dashed ${it.color}`, height: 0 } : {}) }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Y-axis office name on one line, truncated to fit (Recharts would otherwise wrap it). */
function NameTick({ x, y, payload, max = 26 }) {
  const s = String(payload?.value ?? '');
  const short = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--ink-2)">
      <title>{s}</title>{short}
    </text>
  );
}

function relTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- main ----------

export default function CategoryCompare({ config, filters, officeParam, reloadKey, offices, categories }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ui, setUi] = useState(null); // filled from config defaults + saved choices once data arrives
  const [sort, setSort] = useState({ col: '__revenue', dir: -1 });
  const [picked, setPicked] = useState(null); // entity keys shown in the trend chart
  const [focus, setFocus] = useState(null); // column label for the benchmark + trend charts
  const [drill, setDrill] = useState(null); // { key, col }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.categoryView({ granularity: filters.granularity, from: filters.from, to: filters.to, office: officeParam })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.granularity, filters.from, filters.to, officeParam, reloadKey]);

  // UI state: config defaults, overridden by this viewer's last choices (kept only if still valid).
  useEffect(() => {
    if (!data || ui) return;
    const d = data.config.defaults;
    const saved = readStore();
    const dimIds = data.dimensions.map((x) => x.id);
    const pick = (k, ok) => (ok(saved[k]) ? saved[k] : ok(d[k]) ? d[k] : undefined);
    setUi({
      view: pick('view', (v) => ['expense', 'revenue'].includes(v)) || 'expense',
      level: pick('level', (v) => ['category', 'group'].includes(v)) || 'category',
      measure: pick('measure', (v) => MEASURES.some(([m]) => m === v)) || 'pctRevenue',
      compareBy: pick('compareBy', (v) => v === 'office' || dimIds.includes(v)) || 'office',
      groupRowsBy: pick('groupRowsBy', (v) => v === 'none' || dimIds.includes(v)) || 'none',
      shade: pick('shade', (v) => ['median', 'target'].includes(v)) || 'median',
    });
  }, [data, ui]);

  const setOpt = (k) => (v) => setUi((u) => { const next = { ...u, [k]: v }; writeStore(next); return next; });

  const colorIndexOf = useMemo(() => {
    const m = Object.fromEntries((offices || []).map((o) => [o.realmId, o.colorIndex]));
    return (id) => m[id] ?? 0;
  }, [offices]);
  const dimOrder = useMemo(() => Object.fromEntries((categories || []).map((d) => [d.id, d.categories.map((c) => c.label)])), [categories]);

  const model = useMemo(() => {
    if (!data || !ui) return null;
    const cfg = data.config;
    const denomKey = cfg.denominator;
    const entities = buildEntities(data, ui.compareBy, { officeColor: colorIndexOf, dimOrder });
    const cols = columnsFor(cfg, ui.view, ui.level, data.offices);
    const portfolio = combine(entities, '__all', ui.compareBy === 'office' ? 'All selected offices' : 'All selected', 'portfolio');
    const hl = (e) => headline(config, e.groups, denomKey);
    const measured = (e) => {
      const h = hl(e);
      // A category an office does not book at all (amount 0) shows as blank and stays out of the median,
      // so e.g. a property company without payroll does not look "best in class" on payroll.
      const values = Object.fromEntries(cols.map((c) => {
        const amt = amountOf(e.cats, c);
        return [c.label, Math.abs(amt) < 0.5 ? null : measureValue(ui.measure, amt, h.revenue, e.months)];
      }));
      const totalAmt = cols.reduce((s, c) => s + amountOf(e.cats, c), 0);
      return { ...e, h, values, total: ui.view === 'expense' ? measureValue(ui.measure, totalAmt, h.revenue, e.months) : null };
    };
    const rows = entities.map(measured).filter((e) => Object.keys(e.groups).length);
    const medians = Object.fromEntries(cols.map((c) => [c.label, median(rows.map((r) => r.values[c.label]))]));
    medians.__total = median(rows.map((r) => r.total));
    medians.__margin = median(rows.map((r) => r.h.netMargin));
    medians.__revenue = median(rows.map((r) => r.h.revenue));
    return { cfg, appConfig: config, cols, rows, portfolio: measured(portfolio), medians, measured };
  }, [data, ui, config, colorIndexOf, dimOrder]);

  // Default trend selection: largest rows by revenue. Reset when the compared set changes.
  const rowKeys = model ? model.rows.map((r) => r.key).join('|') : '';
  useEffect(() => {
    if (!model) return;
    const n = data.config.defaults.trendSeries;
    setPicked((p) => {
      const still = (p || []).filter((k) => model.rows.some((r) => r.key === k));
      if (still.length) return still;
      return [...model.rows].sort((a, b) => b.h.revenue - a.h.revenue).slice(0, n).map((r) => r.key);
    });
  }, [rowKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus column: keep when still present, else the largest column.
  const colKeys = model ? model.cols.map((c) => c.label).join('|') : '';
  useEffect(() => {
    if (!model) return;
    setFocus((f) => (model.cols.some((c) => c.label === f) ? f
      : [...model.cols].sort((a, b) => Math.abs(amountOf(model.portfolio.cats, b)) - Math.abs(amountOf(model.portfolio.cats, a)))[0]?.label || null));
    setDrill(null);
  }, [colKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="card border-l-4 border-l-bad p-4 text-sm"><div className="font-medium">Could not load the category view</div><div className="text-ink2">{error}</div></div>;
  if (!data || !ui || !model) return <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>;

  const dimLabel = (id) => data.dimensions.find((d) => d.id === id)?.label || id;
  const focusCol = model.cols.find((c) => c.label === focus) || null;

  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <Toolbar data={data} ui={ui} setOpt={setOpt} model={model} />
      {!data.hasData ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">No data for this selection and date range.</div>
      ) : (
        <>
          <Kpis model={model} ui={ui} />
          <Matrix
            model={model} ui={ui} sort={sort} onSort={setSort} picked={picked || []} onPick={setPicked}
            focus={focus} onFocus={setFocus} drill={drill} onDrill={setDrill} dimLabel={dimLabel} data={data}
          />
          {drill && <Drill key={`${drill.key}|${drill.col}`} data={data} model={model} ui={ui} drill={drill} onClose={() => setDrill(null)} />}
          {focusCol && model.rows.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Benchmark model={model} ui={ui} col={focusCol} cols={model.cols} onFocus={setFocus} />
              <Trend data={data} model={model} ui={ui} col={focusCol} picked={picked || []} />
            </div>
          )}
          <Mix model={model} ui={ui} />
        </>
      )}
    </div>
  );
}

// ---------- toolbar ----------

function Toolbar({ data, ui, setOpt, model }) {
  const s = data.sync;
  const sched = s.schedule;
  const exportCsv = () => {
    const head = ['Name', 'Revenue', ...model.cols.map((c) => c.label), ...(ui.view === 'expense' ? ['Total'] : []), 'Net income', 'Net margin'];
    const line = (r) => [r.label, r.h.revenue, ...model.cols.map((c) => r.values[c.label]), ...(ui.view === 'expense' ? [r.total] : []), r.h.netIncome, r.h.netMargin];
    const csv = toCsv([
      [`Category compare, ${data.from} to ${data.to}, values: ${MEASURES.find(([m]) => m === ui.measure)[1]}`],
      head, ...model.rows.map(line), line(model.portfolio),
      ['Median', model.medians.__revenue, ...model.cols.map((c) => model.medians[c.label]), ...(ui.view === 'expense' ? [model.medians.__total] : []), null, model.medians.__margin],
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `category-compare-${data.from}-${data.to}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Seg label="View" value={ui.view} onChange={setOpt('view')} options={[['expense', 'Expenses'], ['revenue', 'Revenue']]} />
        {ui.view === 'expense' && <Seg label="Club by" value={ui.level} onChange={setOpt('level')} options={[['category', 'Categories'], ['group', 'Category groups']]} />}
        <Seg label="Show" value={ui.measure} onChange={setOpt('measure')} options={MEASURES} />
        <Select label="Compare" value={ui.compareBy} onChange={setOpt('compareBy')}>
          <option value="office">Offices</option>
          {data.dimensions.map((d) => <option key={d.id} value={d.id}>{d.label} (combined)</option>)}
        </Select>
        {ui.compareBy === 'office' && data.dimensions.length > 0 && (
          <Select label="Group rows by" value={ui.groupRowsBy} onChange={setOpt('groupRowsBy')}>
            <option value="none">No grouping</option>
            {data.dimensions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        )}
        {ui.measure === 'pctRevenue' && ui.view === 'expense' && (
          <Seg label="Shade cells vs" value={ui.shade} onChange={setOpt('shade')} options={[['median', 'Peer median'], ['target', 'Target']]} />
        )}
        <button type="button" onClick={exportCsv} className="control w-full self-end text-sm hover:border-accent sm:ml-auto sm:w-auto">Export CSV</button>
      </div>
      <p className="text-xs text-muted">
        {sched?.enabled
          ? <>Pulled from QuickBooks daily at {sched.time} ({sched.timezone}). Last sync {relTime(s.lastSync)}{sched.nextRun ? `, next ${relTime(sched.nextRun)}` : ''}.</>
          : <>Last sync {relTime(s.lastSync)}. Daily QuickBooks pull is off on this server.</>}
        {' '}Figures are built from the raw QuickBooks records (invoices, bills, payments, journal entries). Categories and targets come from config/category-view.json.
      </p>
    </div>
  );
}

// ---------- KPIs ----------

function Kpis({ model, ui }) {
  const p = model.portfolio;
  const largest = [...model.cols].sort((a, b) => amountOf(p.cats, b) - amountOf(p.cats, a))[0];
  const overTarget = ui.view === 'expense'
    ? model.rows.filter((r) => model.cols.some((c) => {
      const v = r.h.revenue > 0 ? amountOf(r.cats, c) / r.h.revenue : null;
      return v != null && c.target && ((c.target.max != null && v > c.target.max) || (c.target.min != null && v < c.target.min));
    })).length
    : null;
  const tiles = [
    { label: 'Revenue', value: fmtMoney(p.h.revenue) },
    { label: 'Total expenses', value: fmtMoney(p.h.expenses), sub: p.h.revenue > 0 ? `${pct1(p.h.expenses / p.h.revenue)} of revenue` : null },
    { label: 'Net income', value: fmtMoney(p.h.netIncome), bad: p.h.netIncome < 0, sub: `Net margin ${pct1(p.h.netMargin)}` },
    largest && {
      label: ui.view === 'expense' ? 'Largest cost category' : 'Largest revenue source', value: largest.label, small: true,
      sub: `${fmtMoney(amountOf(p.cats, largest))}${p.h.revenue > 0 ? ` · ${pct1(amountOf(p.cats, largest) / p.h.revenue)} of revenue` : ''}`,
    },
    overTarget != null && {
      label: 'Over a target', value: `${overTarget} of ${model.rows.length}`, sub: `${ui.compareBy === 'office' ? 'offices' : 'groups'} above at least one cost target`,
    },
  ].filter(Boolean);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="card flex flex-col gap-1 p-4">
          <div className="text-sm text-ink2">{t.label}</div>
          <div className={`${t.small ? 'truncate text-base' : 'text-2xl'} font-semibold tabular ${t.bad ? 'text-bad' : ''}`} title={t.small ? t.value : undefined}>{t.value}</div>
          {t.sub && <div className="text-xs text-muted">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- matrix ----------

function Matrix({ model, ui, sort, onSort, picked, onPick, focus, onFocus, drill, onDrill, dimLabel, data }) {
  const { cols, rows, medians, cfg } = model;
  const pct = ui.measure === 'pctRevenue';
  const showTotal = ui.view === 'expense';

  const sortVal = (r) => (sort.col === '__revenue' ? r.h.revenue : sort.col === '__margin' ? r.h.netMargin : sort.col === '__total' ? r.total : sort.col === '__name' ? r.label : r.values[sort.col]);
  const cmp = (a, b) => {
    const x = sortVal(a); const y = sortVal(b);
    if (typeof x === 'string') return sort.dir * x.localeCompare(y);
    return sort.dir * ((x ?? -Infinity) - (y ?? -Infinity));
  };

  // Offices grouped by an office category dimension get a subtotal row per group.
  let body;
  if (ui.compareBy === 'office' && ui.groupRowsBy !== 'none') {
    const groups = new Map();
    for (const r of rows) {
      const g = r.dims?.[ui.groupRowsBy] ?? 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    body = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([g, rs]) => [
      ...[...rs].sort(cmp),
      model.measured(combine(rs, `sub:${g}`, `${g} (${rs.length})`, 'subtotal')),
    ]);
  } else {
    body = [...rows].sort(cmp);
  }

  const cellStyle = (col, v) => {
    if (v == null) return undefined;
    if (pct && ui.view === 'expense') {
      const s = ui.shade === 'target'
        ? (col.target ? shadeAgainst(v, null, { target: col.target, clamp: cfg.clampRelative }) : { tone: null })
        : shadeAgainst(v, medians[col.label], { upIsGood: col.upIsGood, clamp: cfg.clampRelative });
      if (!s.tone) return undefined;
      return { background: tint(s.tone === 'good' ? POS : NEG, s.strength) };
    }
    const max = Math.max(...rows.map((r) => Math.abs(r.values[col.label] ?? 0)));
    return max ? { background: tint(POS, Math.abs(v) / max * 0.8) } : undefined;
  };
  const marginStyle = (v) => {
    if (v == null) return undefined;
    const s = shadeAgainst(v, medians.__margin, { upIsGood: true, clamp: 1 });
    return s.tone ? { background: tint(s.tone === 'good' ? POS : NEG, s.strength * 0.8) } : undefined;
  };

  // Sortable header cell (a plain function, not a component, so headers are not remounted on every render).
  // Clicking a category column also charts it below.
  const th = (id, children, className = '', title, isCategory = false) => (
    <th key={id} scope="col" className={`whitespace-nowrap px-2 py-2 font-medium ${className}`} aria-sort={sort.col === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} title={title}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink"
        onClick={() => { onSort((s) => ({ col: id, dir: s.col === id ? -s.dir : id === '__name' ? 1 : -1 })); if (isCategory) onFocus(id); }}>
        {children}<span className="text-[10px]" aria-hidden="true">{sort.col === id ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );

  const togglePick = (key) => onPick((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= MAX_SERIES ? p : [...p, key]));
  const subtitle = pct
    ? (ui.view === 'expense'
      ? (ui.shade === 'target' ? 'Each category as % of revenue. Blue = within target, red = over target (deeper = further). Categories without a target are not shaded.' : `Each category as % of revenue. Blue = below the peer median, red = above it (full color at ${Math.round(cfg.clampRelative * 100)}% off the median).`)
      : 'Each revenue source as % of revenue; deeper blue = larger share.')
    : `${ui.measure === 'monthlyAvg' ? 'Monthly average' : 'Total'} over ${data.from} to ${data.to}; deeper blue = larger.`;

  return (
    <Section
      title={`${ui.view === 'expense' ? (ui.level === 'group' ? 'Category groups' : 'Cost categories') : 'Revenue sources'} by ${ui.compareBy === 'office' ? 'office' : dimLabel(ui.compareBy).toLowerCase()}`}
      subtitle={`${subtitle} Click a column to sort and chart it, a cell for its accounts, a checkbox to add a row to the trend.`}
    >
      <div className="max-h-[640px] overflow-auto rounded-lg border border-[var(--line)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="sticky left-0 z-30 w-8 bg-surface px-2"><span className="sr-only">Show in trend</span></th>
              {th('__name', ui.compareBy === 'office' ? 'Office' : dimLabel(ui.compareBy), 'sticky left-8 z-30 bg-surface text-left')}
              {th('__revenue', 'Revenue', 'text-right')}
              {cols.map((c) => th(c.label, (
                <span className="inline-flex items-center gap-1">
                  {c.color != null && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: slotColor(c.color) }} aria-hidden="true" />}
                  <span className={focus === c.label ? 'text-accent underline underline-offset-4' : ''}>{c.label}</span>
                </span>
              ), 'text-right',
              `${c.label}${c.target ? ` · target ${c.target.max != null ? `≤ ${pct1(c.target.max)}` : `≥ ${pct1(c.target.min)}`}` : ''}${c.names.length > 1 ? `\nIncludes: ${c.names.join(', ')}` : ''}\nClick to sort and chart`, true))}
              {showTotal && th('__total', 'Total', 'text-right')}
              {th('__margin', 'Net margin', 'text-right')}
            </tr>
          </thead>
          <tbody>
            {body.map((r) => {
              const sub = r.kind === 'subtotal';
              const color = officeColor(r.colorSlot ?? 0);
              return (
                <tr key={r.key} className={`border-t border-[var(--line)] ${sub ? 'bg-[var(--page)] font-medium' : ''}`}>
                  <td className="sticky left-0 z-10 bg-inherit px-2" style={{ background: 'var(--surface)' }}>
                    {!sub && (
                      <input type="checkbox" aria-label={`Show ${r.label} in trend`} checked={picked.includes(r.key)} onChange={() => togglePick(r.key)}
                        disabled={!picked.includes(r.key) && picked.length >= MAX_SERIES} style={{ accentColor: color }} />
                    )}
                  </td>
                  <th scope="row" className={`sticky left-8 z-10 max-w-[240px] truncate px-2 py-1.5 text-left font-normal ${sub ? 'font-medium' : ''}`} style={{ background: sub ? 'var(--page)' : 'var(--surface)' }} title={r.label}>
                    <span className="inline-flex items-center gap-2">
                      {!sub && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
                      {r.label}
                      {ui.compareBy !== 'office' && <span className="text-xs text-muted">{r.realmIds.length}</span>}
                    </span>
                  </th>
                  <td className="tabular whitespace-nowrap px-2 text-right">{fmtCompact(r.h.revenue)}</td>
                  {cols.map((c) => {
                    const v = r.values[c.label];
                    const active = drill && drill.key === r.key && drill.col === c.label;
                    return (
                      <td key={c.label} className="p-0.5">
                        <button type="button" onClick={() => onDrill(active ? null : { key: r.key, col: c.label, entity: r })}
                          className={`tabular block w-full whitespace-nowrap rounded px-1.5 py-1 text-right ${active ? 'ring-2 ring-[var(--series-1)]' : 'hover:ring-1 hover:ring-[var(--axis)]'}`}
                          style={cellStyle(c, v)} title={`${r.label} · ${c.label}: ${fmtMoney(amountOf(r.cats, c))}${r.h.revenue > 0 ? ` (${pct1(amountOf(r.cats, c) / r.h.revenue)} of revenue)` : ''}`}>
                          {v == null ? <span className="text-muted">–</span> : fmtValue(ui.measure, v, true)}
                        </button>
                      </td>
                    );
                  })}
                  {showTotal && <td className="tabular whitespace-nowrap px-2 text-right">{fmtValue(ui.measure, r.total, true)}</td>}
                  <td className="p-0.5"><div className={`tabular whitespace-nowrap rounded px-1.5 py-1 text-right ${r.h.netMargin < 0 ? 'text-bad' : ''}`} style={marginStyle(r.h.netMargin)}>{pct1(r.h.netMargin)}</div></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 bg-surface text-xs shadow-[0_-1px_0_var(--line)]">
            <FootRow label={model.portfolio.label} strong revenue={fmtCompact(model.portfolio.h.revenue)} cols={cols} get={(c) => fmtValue(ui.measure, model.portfolio.values[c.label], true)}
              total={showTotal ? fmtValue(ui.measure, model.portfolio.total, true) : null} margin={pct1(model.portfolio.h.netMargin)} />
            {rows.length > 1 && (
              <FootRow label="Median" revenue={fmtCompact(medians.__revenue)} cols={cols} get={(c) => fmtValue(ui.measure, medians[c.label], true)}
                total={showTotal ? fmtValue(ui.measure, medians.__total, true) : null} margin={pct1(medians.__margin)} />
            )}
            {pct && ui.view === 'expense' && cols.some((c) => c.target) && (
              <FootRow label="Target" revenue="" cols={cols} get={(c) => (c.target ? (c.target.max != null ? `≤ ${pct1(c.target.max)}` : `≥ ${pct1(c.target.min)}`) : '')} total={showTotal ? '' : null} margin="" />
            )}
          </tfoot>
        </table>
      </div>
      {pct && ui.view === 'expense' && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted" aria-hidden="true">
          <span>{ui.shade === 'target' ? 'Within target' : 'Below median'}</span>
          {[1, 0.6, 0.25].map((s) => <span key={`g${s}`} className="inline-block h-3 w-4 rounded-sm" style={{ background: tint(POS, s) }} />)}
          <span className="inline-block h-3 w-4 rounded-sm" style={{ background: 'var(--line)' }} />
          {[0.25, 0.6, 1].map((s) => <span key={`b${s}`} className="inline-block h-3 w-4 rounded-sm" style={{ background: tint(NEG, s) }} />)}
          <span>{ui.shade === 'target' ? 'Over target' : 'Above median'}</span>
        </div>
      )}
    </Section>
  );
}

function FootRow({ label, strong, revenue, cols, get, total, margin }) {
  return (
    <tr className="border-t border-[var(--line)]">
      <td className="sticky left-0 bg-surface" />
      <th scope="row" className={`sticky left-8 bg-surface px-2 py-1.5 text-left ${strong ? 'font-medium text-ink' : 'font-normal text-ink2'}`}>{label}</th>
      <td className="tabular whitespace-nowrap px-2 text-right">{revenue}</td>
      {cols.map((c) => <td key={c.label} className={`tabular whitespace-nowrap px-2 text-right ${strong ? 'font-medium' : 'text-ink2'}`}>{get(c)}</td>)}
      {total != null && <td className="tabular whitespace-nowrap px-2 text-right">{total}</td>}
      <td className="tabular whitespace-nowrap px-2 text-right">{margin}</td>
    </tr>
  );
}

// ---------- drill-down ----------

function Drill({ data, model, ui, drill, onClose }) {
  const col = model.cols.find((c) => c.label === drill.col);
  const entity = drill.entity;
  const [open, setOpen] = useState(null); // index of the line showing transactions (before any early return)
  if (!col || !entity) return null;
  const members = new Set(col.names);
  const realms = new Set(entity.realmIds);
  const names = Object.fromEntries(data.offices.map((o) => [o.realmId, o.officeName]));
  const lines = data.accounts.filter((a) => a.kind === ui.view && members.has(a.category) && realms.has(a.realmId)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = lines.reduce((s, a) => s + a.amount, 0);
  const multi = realms.size > 1;
  const shown = lines.slice(0, 60);
  return (
    <Section title={`${col.label} · ${entity.label}`} subtitle={`${lines.length} account ${lines.length === 1 ? 'line' : 'lines'}, ${fmtMoney(total)}${entity.h.revenue > 0 ? `, ${pct1(total / entity.h.revenue)} of revenue` : ''}. Matching rules live in config/category-view.json.`}
      right={<button type="button" className="text-sm text-accent hover:underline" onClick={onClose}>Close</button>}>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-ink2">
            <tr>
              <th className="py-1 text-left font-medium">Account</th>
              {col.members.length > 1 && <th className="py-1 text-left font-medium">Category</th>}
              {multi && <th className="py-1 text-left font-medium">Office</th>}
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Share</th>
              <th className="py-1 pl-2 text-right font-medium"><span className="sr-only">Transactions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <React.Fragment key={i}>
              <tr className="border-t border-[var(--line)]">
                <td className="max-w-[320px] truncate py-1" title={a.account}>{a.account}</td>
                {col.members.length > 1 && <td className="py-1 text-ink2">{a.category}</td>}
                {multi && <td className="max-w-[220px] truncate py-1 text-ink2" title={names[a.realmId]}>{names[a.realmId]}</td>}
                <td className={`tabular py-1 text-right ${a.amount < 0 ? 'text-bad' : ''}`}>{fmtMoney(a.amount)}</td>
                <td className="tabular py-1 text-right text-ink2">{total ? pct1(a.amount / total) : '–'}</td>
                <td className="py-1 pl-2 text-right">
                  {a.accountIds?.length > 0 && (
                    <button type="button" className="whitespace-nowrap text-xs text-accent hover:underline" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                      {open === i ? 'Hide' : 'Transactions'}
                    </button>
                  )}
                </td>
              </tr>
              {open === i && (
                <tr><td colSpan={6} className="bg-[var(--page)] p-2"><Transactions realmId={a.realmId} accountIds={a.accountIds} from={data.from} to={data.to} /></td></tr>
              )}
              </React.Fragment>
            ))}
            {lines.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-ink2">No account lines in this category.</td></tr>}
          </tbody>
        </table>
        {lines.length > shown.length && <p className="mt-2 text-xs text-muted">Showing the {shown.length} largest of {lines.length}.</p>}
      </div>
    </Section>
  );
}

/** Live General Ledger lines for one account from QuickBooks (fetched on demand, cached 5 minutes on the server). */
function Transactions({ realmId, accountIds, from, to }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    api.transactions({ realmId, accountIds: accountIds.join(','), from, to })
      .then((d) => { if (!cancelled) setState({ data: d }); })
      .catch((e) => { if (!cancelled) setState({ error: e.message }); });
    return () => { cancelled = true; };
  }, [realmId, accountIds, from, to]);
  if (state.loading) return <div className="py-2 text-xs text-ink2">Loading transactions…</div>;
  if (state.error) return <div className="py-2 text-xs text-bad">{state.error}</div>;
  const { transactions, count, total } = state.data;
  if (!transactions.length) return <div className="py-2 text-xs text-ink2">No transactions in this range.</div>;
  return (
    <div className="max-h-[280px] overflow-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="sticky top-0 bg-[var(--page)] text-ink2">
          <tr><th className="py-1 text-left font-medium">Date</th><th className="text-left font-medium">Type</th><th className="text-left font-medium">No.</th><th className="text-left font-medium">Name</th><th className="text-left font-medium">Memo</th><th className="text-right font-medium">Amount</th></tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => (
            <tr key={i} className="border-t border-[var(--line)]">
              <td className="whitespace-nowrap py-1 pr-2 tabular">{t.date}</td>
              <td className="whitespace-nowrap pr-2">{t.type}</td>
              <td className="whitespace-nowrap pr-2 text-ink2">{t.num}</td>
              <td className="max-w-[180px] truncate pr-2" title={t.name}>{t.name}</td>
              <td className="max-w-[220px] truncate pr-2 text-ink2" title={t.memo}>{t.memo}</td>
              <td className={`tabular whitespace-nowrap text-right ${t.amount < 0 ? 'text-bad' : ''}`}>{fmtMoney(t.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">{count > transactions.length ? `Showing ${transactions.length} of ${count}. ` : ''}Total {fmtMoney(total)} · from the raw QuickBooks records.</p>
    </div>
  );
}

// ---------- benchmark (ranked bars with median + target) ----------

function Benchmark({ model, ui, col, cols, onFocus }) {
  const narrow = useNarrow();
  const rows = model.rows.map((r) => ({ key: r.key, label: r.label, value: r.values[col.label] })).filter((r) => r.value != null).sort((a, b) => b.value - a.value);
  const med = model.medians[col.label];
  const target = ui.measure === 'pctRevenue' && col.target ? (col.target.max ?? col.target.min) : null;
  const height = Math.max(160, rows.length * 24 + 40);
  const fmt = (v) => fmtValue(ui.measure, v, true);
  return (
    <Section title={`${col.label}: ${ui.measure === 'pctRevenue' ? '% of revenue' : ui.measure === 'monthlyAvg' ? 'monthly average' : 'total'}, ranked`}
      subtitle="Each bar is one row of the table; lines mark the peer median and the target."
      right={
        <select className="control h-8 text-xs" value={col.label} onChange={(e) => onFocus(e.target.value)} aria-label="Category to chart">
          {cols.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
      }>
      <Swatches items={[{ label: 'Median', color: 'var(--ink-2)', kind: 'line', dashed: true }, ...(target != null ? [{ label: 'Target', color: NEG, kind: 'line' }] : [])]} />
      <div className="mt-2 max-h-[520px] overflow-y-auto">
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 48, bottom: 0, left: 0 }} barCategoryGap={4}>
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis type="number" tick={axisTick} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={narrow ? 110 : 180} tick={<NameTick max={narrow ? 15 : 26} />} axisLine={false} tickLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="card px-3 py-2 text-sm shadow-sm">
                    <div className="mb-1 text-ink2">{p.label}</div>
                    <div className="tabular font-medium">{fmtValue(ui.measure, p.value)}</div>
                    {med != null && <div className="text-xs text-muted">Median {fmtValue(ui.measure, med)}</div>}
                    {target != null && <div className="text-xs text-muted">Target {col.target.max != null ? '≤' : '≥'} {pct1(target)}{(col.target.max != null ? p.value > target : p.value < target) ? ' · outside target' : ''}</div>}
                  </div>
                );
              }} />
              <Bar dataKey="value" fill={POS} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
              {med != null && <ReferenceLine x={med} stroke="var(--ink-2)" strokeDasharray="4 3" strokeWidth={1.5} />}
              {target != null && <ReferenceLine x={target} stroke={NEG} strokeWidth={2} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Section>
  );
}

// ---------- trend (selected rows over time) ----------

function Trend({ data, model, ui, col, picked }) {
  const series = model.rows.filter((r) => picked.includes(r.key));
  const all = model.portfolio;
  const valueAt = (e, p) => {
    const g = e.periods[p.key];
    if (!g || !Object.keys(g.groups).length) return null;
    const h = headline(model.appConfig, g.groups, model.cfg.denominator);
    return measureValue(ui.measure, amountOf(g.cats, col), h.revenue, p.months);
  };
  const rows = data.periods.map((p) => ({
    label: p.label,
    __all: valueAt(all, p),
    ...Object.fromEntries(series.map((s) => [s.key, valueAt(s, p)])),
  }));
  const fmt = (v) => fmtValue(ui.measure, v, true);
  const items = [
    ...series.map((s) => ({ key: s.key, label: s.label, color: officeColor(s.colorSlot ?? 0), kind: 'line' })),
    { key: '__all', label: all.label, color: 'var(--ink-2)', kind: 'line', dashed: true },
  ];
  return (
    <Section title={`${col.label} over time`} subtitle={series.length ? `Tick rows in the table to change the lines (up to ${MAX_SERIES}).` : 'Tick rows in the table to add lines.'}>
      <Swatches items={items} />
      <div className="mt-2 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={12} />
            <YAxis tick={axisTick} tickFormatter={fmt} axisLine={false} tickLine={false} width={64} />
            <Tooltip cursor={{ stroke: 'var(--axis)' }} content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="card px-3 py-2 text-sm shadow-sm">
                  <div className="mb-1 text-ink2">{label}</div>
                  {items.map((it) => {
                    const p = payload.find((x) => x.dataKey === it.key);
                    if (!p) return null;
                    return (
                      <div key={it.key} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} aria-hidden="true" />{it.label}</span>
                        <span className="tabular">{fmtValue(ui.measure, p.value)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            }} />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={officeColor(s.colorSlot ?? 0)} strokeWidth={2} connectNulls={false}
                dot={{ r: 3, fill: officeColor(s.colorSlot ?? 0), stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            ))}
            <Line dataKey="__all" type="monotone" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

// ---------- mix (100% stacked bars) ----------

function Mix({ model, ui }) {
  const narrow = useNarrow();
  const { cols, rows } = model;
  // Colored segments: columns with a palette slot; everything else folds into "All other".
  const colored = cols.filter((c) => c.color != null).slice(0, 7);
  const coloredSet = new Set(colored.map((c) => c.label));
  const hasOther = cols.some((c) => !coloredSet.has(c.label));
  const segs = [...colored.map((c) => ({ key: c.label, label: c.label, color: slotColor(c.color) })), ...(hasOther ? [{ key: '__other', label: 'All other', color: OTHER }] : [])];
  const data = [...rows].sort((a, b) => b.h.revenue - a.h.revenue).map((r) => {
    const o = { label: r.label, __sum: 0 };
    for (const c of cols) {
      const v = Math.max(0, amountOf(r.cats, c)); // refunds and credits can be negative; they are left out of the mix
      const k = coloredSet.has(c.label) ? c.label : '__other';
      o[k] = (o[k] || 0) + v;
      o.__sum += v;
    }
    return o;
  }).filter((o) => o.__sum > 0);
  if (data.length === 0 || segs.length < 2) return null;
  const height = Math.max(160, data.length * 26 + 40);
  return (
    <Section title={ui.view === 'expense' ? 'Where the money goes: expense mix' : 'Revenue mix'}
      subtitle={`Share of each row's ${ui.view === 'expense' ? 'expenses' : 'revenue'} by ${ui.level === 'group' && ui.view === 'expense' ? 'category group' : 'category'}. Colors stay with the category.`}>
      <Swatches items={segs} />
      <div className="mt-2 max-h-[560px] overflow-y-auto">
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
              <XAxis type="number" tick={axisTick} tickFormatter={(v) => `${Math.round(v * 100)}%`} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={narrow ? 110 : 180} tick={<NameTick max={narrow ? 15 : 26} />} axisLine={false} tickLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="card px-3 py-2 text-sm shadow-sm">
                    <div className="mb-1 text-ink2">{label}</div>
                    {segs.filter((s) => p[s.key]).map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.label}</span>
                        <span className="tabular">{pct1(p[s.key] / p.__sum)} · {fmtCompact(p[s.key])}</span>
                      </div>
                    ))}
                  </div>
                );
              }} />
              {segs.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="mix" fill={s.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={18} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Section>
  );
}
