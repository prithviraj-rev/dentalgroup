import React, { useEffect, useState } from 'react';
import { fmtMoney, fmtCompact } from '../format.js';

// Shared building blocks for the newer tabs (Category compare, Group overview, Cash, Budget, Practice KPIs).

export const POS = 'var(--series-1)';
export const NEG = 'var(--series-8)';
export const OTHER = 'var(--axis)';
export const axisTick = { fill: 'var(--muted)', fontSize: 12 };
export const slotColor = (slot) => (slot == null ? OTHER : `var(--series-${slot})`);
export const tint = (color, s) => `color-mix(in oklab, ${color} ${Math.round(8 + Math.min(1, Math.max(0, s)) * 62)}%, var(--surface))`;
export const pct1 = (v) => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
export const signedPct = (v) => (v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
export const money = (v) => (v == null || !Number.isFinite(v) ? '–' : fmtMoney(v));
export const compact = (v) => (v == null || !Number.isFinite(v) ? '–' : fmtCompact(v));
export const monthLabel = (m) => {
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
  return d.toLocaleString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** True on phone-width screens; charts use it to shorten axis labels. */
export function useNarrow(px = 640) {
  const q = `(max-width: ${px}px)`;
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [q]);
  return narrow;
}

export function Section({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`card min-w-0 p-3 sm:p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Tiles({ items, cols = 4 }) {
  const lg = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols] || 'lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 gap-2 sm:gap-3 ${lg}`}>
      {items.filter(Boolean).map((t) => (
        <div key={t.label} className="card flex min-w-0 flex-col gap-1 p-3 sm:p-4">
          <div className="truncate text-xs text-ink2 sm:text-sm" title={t.label}>{t.label}</div>
          <div className={`truncate font-semibold tabular ${t.small ? 'text-sm sm:text-base' : 'text-lg sm:text-2xl'} ${t.bad ? 'text-bad' : ''}`} title={typeof t.value === 'string' ? t.value : undefined}>{t.value}</div>
          {t.sub && <div className={`text-[11px] sm:text-xs ${t.subTone === 'good' ? 'text-good' : t.subTone === 'bad' ? 'text-bad' : 'text-muted'}`}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Seg({ label, options, value, onChange, small = false }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && <span className="text-xs text-ink2">{label}</span>}
      <div className={`seg ${small ? 'seg-sm' : ''}`} role="group" aria-label={label}>
        {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </div>
  );
}

export function Swatches({ items }) {
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

export function ErrorBox({ title, error }) {
  return <div className="card border-l-4 border-l-bad p-4 text-sm"><div className="font-medium">{title}</div><div className="text-ink2">{error}</div></div>;
}
export const Loading = () => <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>;
export function Empty({ title, children }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-base font-medium">{title}</div>
      <div className="max-w-xl text-sm text-ink2">{children}</div>
    </div>
  );
}

/** Data source line for the tabs built on raw QuickBooks records. */
export function SourceLine({ source, extra }) {
  if (!source) return null;
  const when = source.lastChange ? new Date(source.lastChange).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <p className="text-xs text-muted">
      {source.pulled === 0 ? (
        <>No raw QuickBooks data pulled yet for these companies. It arrives with the next sync (daily, or <b>Sync now</b>).</>
      ) : (
        <>
          Built from {source.records.toLocaleString()} raw QuickBooks records ({source.pulled} of {source.companies} companies){when ? `, last pulled ${when}` : ''}.
          {' '}{source.balancesMatch + source.balancesDiffer > 0 && (source.balancesDiffer === 0
            ? <Status tone="good">All {source.balancesMatch} account balances match QuickBooks</Status>
            : <Status tone="warn">{source.balancesMatch} of {source.balancesMatch + source.balancesDiffer} account balances match QuickBooks</Status>)}
          {source.errors.length > 0 && <> <Status tone="bad">Pull failed for {source.errors.length} {source.errors.length === 1 ? 'company' : 'companies'}</Status></>}
        </>
      )}
      {extra ? <> {extra}</> : null}
    </p>
  );
}

/** Status pill: icon + label, never color alone. */
export function Status({ tone, children }) {
  const map = { good: ['✓', 'text-good'], bad: ['!', 'text-bad'], warn: ['▲', 'text-[var(--series-4)]'], info: ['i', 'text-ink2'] };
  const [icon, cls] = map[tone] || map.info;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${cls}`}>
      <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] leading-none">{icon}</span>
      {children}
    </span>
  );
}

/** Y-axis category label on one line, truncated (Recharts would otherwise wrap it). */
export function NameTick({ x, y, payload, max = 26 }) {
  const s = String(payload?.value ?? '');
  const short = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--ink-2)">
      <title>{s}</title>{short}
    </text>
  );
}

export function Sparkline({ values, width = 96, height = 24, color = POS }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <span className="text-xs text-muted">–</span>;
  const vs = pts.map(([, v]) => v);
  const min = Math.min(0, ...vs); const max = Math.max(0, ...vs);
  const span = max - min || 1;
  const x = (i) => (i / Math.max(1, values.length - 1)) * (width - 4) + 2;
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      <polyline fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" points={pts.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />
      <circle cx={x(pts.at(-1)[0])} cy={y(pts.at(-1)[1])} r={2.5} fill={color} />
    </svg>
  );
}

export function ChartTip({ active, payload, label, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      {label != null && <div className="mb-1 text-ink2">{label}</div>}
      {rows(p, payload).filter(Boolean).map(([k, v, color, dashed]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            {color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={dashed ? { border: `2px dashed ${color}` } : { background: color }} aria-hidden="true" />}
            {k}
          </span>
          <span className="tabular">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Sortable table header cell, as a plain function (not a component) so headers are not remounted. */
export function sortTh(sort, setSort, id, label, className = '', title) {
  return (
    <th key={id} scope="col" className={`whitespace-nowrap px-2 py-2 font-medium ${className}`} aria-sort={sort.col === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} title={title}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ col: id, dir: s.col === id ? -s.dir : -1 }))}>
        {label}<span className="text-[10px]" aria-hidden="true">{sort.col === id ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}
export const sorter = (sort, get) => (a, b) => {
  const x = get(a, sort.col); const y = get(b, sort.col);
  if (typeof x === 'string' || typeof y === 'string') return sort.dir * String(x ?? '').localeCompare(String(y ?? ''));
  return sort.dir * ((x ?? -Infinity) - (y ?? -Infinity));
};

/** Download rows as CSV. */
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch helper with loading/error state that re-runs when deps change. */
export function useApi(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message })); });
    return () => { cancelled = true; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
