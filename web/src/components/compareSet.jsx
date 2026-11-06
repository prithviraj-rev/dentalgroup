import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { monthLabel } from './ui.jsx';

/**
 * The companies x periods comparison shared by the Side by side card (Financial KPIs > Compare) and the Compare charts tab.
 * A "set" = one chip in the COMPANIES row: one company, or a group of companies read as ONE column. A "period" = one chip in the
 * PERIODS row: a year, a month or custom dates. Every set over every period is one column, fetched as GET /api/<base>/set
 * (the statement rows consolidated over the set's companies, with the accounts behind each row and the monthly totals).
 */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mm = (n) => String(n).padStart(2, '0');
export const monthOf = (d) => (d || '').slice(0, 7);
export const firstDay = (m) => (m ? `${m}-01` : '');
export const lastDay = (m) => (m ? new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10) : '');
export const minM = (a, b) => (a < b ? a : b);
export const addMonths = (m, n) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return `${d.getUTCFullYear()}-${mm(d.getUTCMonth() + 1)}`; };
export const monthsBetween = (from, to) => { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; };
let seq = 0;
export const nid = () => `k${++seq}`;

/** The months a period covers; never past the last full month, so a running year ends where the data does. */
export function windowOf(p, lastFull) {
  if (p.mode === 'year') return { from: minM(`${p.year}-01`, lastFull), to: minM(`${p.year}-12`, lastFull) };
  if (p.mode === 'month') { const m = minM(p.month, lastFull); return { from: m, to: m }; }
  const to = minM(p.to || lastFull, lastFull);
  return { from: minM(p.from || to, to), to };
}
export const periodLabel = (p, lastFull) => {
  if (p.mode === 'year') return p.year === Number(lastFull.slice(0, 4)) && lastFull.slice(5, 7) !== '12' ? `${p.year} (to ${MONTHS[Number(lastFull.slice(5, 7)) - 1]})` : String(p.year);
  const w = windowOf(p, lastFull);
  return w.from === w.to ? monthLabel(w.from) : `${monthLabel(w.from)} to ${monthLabel(w.to)}`;
};
export const samePeriod = (a, b) => a.mode === b.mode && a.year === b.year && a.month === b.month && a.from === b.from && a.to === b.to;
export const signed = (d) => (d == null ? '–' : `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`);
export const delta = (v, b) => (v == null || b == null || !b ? null : (v - b) / Math.abs(b));
export const prevPeriod = (p, lastFull) => (p.mode === 'year' ? { mode: 'year', year: p.year - 1 } : p.mode === 'month' ? { mode: 'month', month: addMonths(p.month, -12) } : { mode: 'custom', from: addMonths(windowOf(p, lastFull).from, -12), to: addMonths(windowOf(p, lastFull).to, -12) });

/** A panel fixed under its button, drawn on the body so no table or card clips it; closes on Escape, scroll or a click outside. */
export function Dropdown({ anchor, onClose, width = 360, children }) {
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const place = () => { const r = anchor.current?.getBoundingClientRect(); if (r) setRect({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4 }); };
    place();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    window.addEventListener('resize', place); document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown); document.addEventListener('scroll', onClose, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', onClose, true); };
  }, [anchor, onClose, width]);
  if (!rect) return null;
  return createPortal(<div ref={ref} className="card fixed z-50 shadow-xl" style={{ left: rect.left, top: rect.top, width }}>{children}</div>, document.body);
}

/** A "+ Add …" button that opens a dropdown. */
export function AddButton({ label, width, disabled = false, title, children }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const close = () => setOpen(false);
  return (
    <>
      <button ref={btn} type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--axis)] px-2.5 text-xs font-medium text-accent hover:bg-page disabled:cursor-not-allowed disabled:opacity-50" aria-expanded={open} disabled={disabled} title={title} onClick={() => setOpen(!open)}>+ {label}</button>
      {open && <Dropdown anchor={btn} onClose={close} width={width}>{children(close)}</Dropdown>}
    </>
  );
}

export const Chip = ({ children, title, onRemove, first = false, color = null }) => (
  <span className={`inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 text-xs ${first ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,var(--surface))] font-semibold text-ink' : 'border-[var(--line)] bg-surface text-ink'}`} title={title}>
    {color && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />}
    <span className="truncate">{children}</span>
    {onRemove && <button type="button" className="text-muted hover:text-ink" aria-label={`Remove ${title || ''}`} onClick={onRemove}>×</button>}
  </span>
);

/** The list of companies with a search box: click = one company (or a tick box when picking a group). */
export function CompanyList({ companies, picked, onPick, ticks = false }) {
  const [text, setText] = useState('');
  const q = text.trim().toLowerCase();
  const shown = companies.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
  const groups = [...new Map(shown.map((c) => [c.group || 'Companies', c.color])).entries()];
  return (
    <>
      <div className="border-b border-[var(--line)] p-2">
        <input className="control h-8 w-full text-sm" type="search" placeholder="Search companies…" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Search companies"
          onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); onPick(shown[0].realmId); } }} />
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {shown.length === 0 && <div className="px-2 py-3 text-sm text-muted">No company matches.</div>}
        {groups.map(([g, color]) => (
          <div key={g} className="mb-1">
            <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: `var(--series-${color})` }} aria-hidden="true" />}{g}
            </div>
            {shown.filter((c) => (c.group || 'Companies') === g).map((c) => {
              const on = picked.includes(c.realmId);
              return ticks ? (
                <label key={c.realmId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-page">
                  <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => onPick(c.realmId)} /><span className="min-w-0 flex-1 truncate">{c.name}</span>
                </label>
              ) : (
                <button key={c.realmId} type="button" className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-page ${on ? 'text-muted' : ''}`} onClick={() => onPick(c.realmId)} aria-pressed={on}>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>{on && <span className="text-[11px]">added ✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** Pick a group of companies to read as ONE column (X + Y + Z). */
export function GroupPicker({ companies, onAdd, close }) {
  const [ids, setIds] = useState([]);
  return (
    <>
      <CompanyList companies={companies} picked={ids} ticks onPick={(id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])} />
      <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] p-2 text-xs">
        <span className="text-muted">{ids.length ? `${ids.length} ticked, read as one column` : 'Tick two or more companies'}</span>
        <button type="button" className="h-8 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50" disabled={ids.length < 1} onClick={() => { onAdd(ids); close(); }}>Add as one column</button>
      </div>
    </>
  );
}

/** Pick a period: a year, one of the last N months, or custom dates. */
export function PeriodPicker({ lastFull, onAdd, close, years: nYears = 6, months: nMonths = 24 }) {
  const y = Number(lastFull.slice(0, 4));
  const [from, setFrom] = useState(addMonths(lastFull, -2));
  const [to, setTo] = useState(lastFull);
  const years = Array.from({ length: nYears }, (_, i) => y - i);
  const months = Array.from({ length: nMonths }, (_, i) => addMonths(lastFull, -i));
  const b = 'rounded border border-[var(--line)] px-2 py-1 text-xs hover:bg-page';
  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted">Year</div><div className="flex flex-wrap gap-1">{years.map((yy) => <button key={yy} type="button" className={b} onClick={() => { onAdd({ mode: 'year', year: yy }); close(); }}>{yy}</button>)}</div></div>
      <div><div className="mb-1 font-semibold uppercase tracking-wide text-muted">Month</div><div className="grid grid-cols-4 gap-1">{months.map((m) => <button key={m} type="button" className={b} onClick={() => { onAdd({ mode: 'month', month: m }); close(); }}>{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}</button>)}</div></div>
      <div>
        <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Custom dates</div>
        <div className="flex flex-wrap items-center gap-1">
          <input className="control h-8 w-[132px] px-1.5 text-xs" type="date" aria-label="From" value={firstDay(from)} max={lastDay(to)} onChange={(e) => e.target.value && setFrom(monthOf(e.target.value))} />
          <span className="text-muted">to</span>
          <input className="control h-8 w-[132px] px-1.5 text-xs" type="date" aria-label="To" value={lastDay(to)} min={firstDay(from)} max={lastDay(lastFull)} onChange={(e) => e.target.value && setTo(monthOf(e.target.value))} />
          <button type="button" className="h-8 rounded-lg bg-accent px-3 text-xs font-medium text-white" onClick={() => { onAdd({ mode: 'custom', from, to: minM(to, lastFull) }); close(); }}>Add</button>
        </div>
      </div>
    </div>
  );
}

/** Every company the user may see, with its group and colour (for the pickers), in the groups' own order then by name. */
export function useCompanies(base) {
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.all([api.offices(), api.officeGroups(base).catch(() => ({ groups: null, names: {} }))]).then(([list, g]) => {
      if (!live) return;
      const groupOf = {}; const colorOf = {}; const orderOf = {};
      (g.groups || []).forEach((gr, i) => { for (const id of gr.realmIds) { groupOf[id] = gr.label; colorOf[id] = gr.color; orderOf[id] = i; } });
      setCompanies(list.map((o) => ({ realmId: o.realmId, name: g.names?.[o.realmId] || o.officeName, group: groupOf[o.realmId] || null, color: colorOf[o.realmId] || null, order: orderOf[o.realmId] ?? 99 })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
    }).catch(() => {});
    return () => { live = false; };
  }, [base]);
  return companies;
}

/**
 * The comparison state: sets (company chips), periods (period chips) and one fetched result per column, cached by the
 * column's content (companies + window + basis) so an edit refetches only what changed. onChange(sets, periods) fires on every edit.
 */
export function useComparison({ initialSets, initialPeriods, lastFull, basis, base, reloadKey = 0, maxSets = Infinity, onChange = null }) {
  const [sets, setSets] = useState(initialSets);
  const [periods, setPeriods] = useState(initialPeriods);
  const [results, setResults] = useState({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []); // set on every mount (StrictMode mounts twice in development)
  const companies = useCompanies(base);
  const cols = sets.flatMap((s) => periods.map((p) => ({ key: `${s.id}|${p.id}`, s, p, w: windowOf(p, lastFull) })));
  const keyOf = (c) => `${[...c.s.ids].sort().join(',')}|${c.w.from}|${c.w.to}|${basis || ''}|${reloadKey}`;
  const keys = cols.map(keyOf).join(';');
  useEffect(() => {
    for (const c of cols) {
      const k = keyOf(c);
      if (results[k] || !c.s.ids.length) continue;
      setResults((r) => ({ ...r, [k]: { loading: true } }));
      api.officeSet({ companies: c.s.ids.join(','), period: 'custom', from: c.w.from, to: c.w.to, ...(basis ? { basis } : {}) }, base)
        .then((data) => { if (mounted.current) setResults((r) => ({ ...r, [k]: { data } })); })
        .catch((e) => { if (mounted.current) setResults((r) => ({ ...r, [k]: { error: e.message } })); });
    }
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const colData = cols.map((c) => ({ ...c, r: results[keyOf(c)] || { loading: true } }));
  const first = colData.map((x) => x.r.data).find(Boolean);
  const byId = Object.fromEntries(companies.map((c) => [c.realmId, c]));
  const namesOf = (s) => s.ids.map((id) => byId[id]?.name).filter(Boolean);
  /** What a chip is called: the one name, "A + B", "Compared companies", or "N companies"; the office names once loaded. */
  const nameOf = (s) => {
    const d = colData.find((c) => c.s === s && c.r.data)?.r.data;
    if (d && d.offices.length === 1) return d.offices[0].name;
    const names = namesOf(s);
    if (s.ids.length <= 2 && names.length === s.ids.length) return names.join(' + ');
    return s.compared ? `Compared companies (${s.ids.length})` : `${s.ids.length} companies`;
  };
  const titleOf = (s) => namesOf(s).join(', ');
  // The base of the "change" figures: the first period of the same company, or, with one period, the first company.
  const overTime = periods.length > 1;
  const baseOf = (c) => (overTime ? (c.p === periods[0] ? null : colData.find((x) => x.s === c.s && x.p === periods[0])) : (c.s === sets[0] ? null : colData.find((x) => x.s === sets[0] && x.p === c.p)));
  const vsLabel = overTime ? `vs ${periodLabel(periods[0], lastFull)}` : sets[0] ? `vs ${nameOf(sets[0])}` : '';
  const edit = (nextSets, nextPeriods) => { if (onChange) onChange(nextSets, nextPeriods); };
  const updateSets = (fn) => setSets((ss) => { const n = fn(ss); edit(n, periods); return n; });
  const updatePeriods = (fn) => setPeriods((ps) => { const n = fn(ps); edit(sets, n); return n; });
  const addSet = (newIds) => { if (newIds.length) updateSets((ss) => (ss.length >= maxSets ? ss : [...ss, { id: nid(), ids: newIds }])); };
  const toggleCompany = (id) => updateSets((ss) => (ss.some((s) => s.ids.length === 1 && s.ids[0] === id) ? ss.filter((s) => !(s.ids.length === 1 && s.ids[0] === id)) : ss.length >= maxSets ? ss : [...ss, { id: nid(), ids: [id] }]));
  const singles = sets.filter((s) => s.ids.length === 1).map((s) => s.ids[0]);
  const addPeriod = (p) => updatePeriods((ps) => (ps.some((x) => samePeriod(x, p)) ? ps : [...ps, { id: nid(), ...p }]));
  const removeSet = (id) => updateSets((ss) => ss.filter((s) => s.id !== id));
  const removePeriod = (id) => updatePeriods((ps) => ps.filter((p) => p.id !== id));
  return { sets, periods, cols: colData, first, rows: first?.rows || [], collectionsKey: first?.collectionsKey || null, companies, byId, nameOf, titleOf, overTime, baseOf, vsLabel, addSet, toggleCompany, singles, addPeriod, removeSet, removePeriod, maxSets, lastFull };
}

/** The two chip rows: COMPANIES (each chip = one column group) and PERIODS (each chip = one column under every company). */
export function SetPicker({ cmp, note = null, colorOf = null, minSets = 1, minPeriods = 1, years, months }) {
  const { sets, periods, companies, nameOf, titleOf, overTime, addSet, toggleCompany, singles, addPeriod, removeSet, removePeriod, maxSets, lastFull } = cmp;
  const full = sets.length >= maxSets;
  const fullTitle = full ? `Up to ${maxSets} companies or groups at a time` : undefined;
  return (
    <div className="mb-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--line)] bg-page px-3 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-ink2">Companies</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {sets.map((s, i) => <Chip key={s.id} title={titleOf(s)} color={colorOf ? colorOf(i) : null} first={!overTime && i === 0 && sets.length > 1} onRemove={sets.length > minSets ? () => removeSet(s.id) : null}>{nameOf(s)}</Chip>)}
        <AddButton label="company" width={360} disabled={full} title={fullTitle}>{() => <CompanyList companies={companies} picked={singles} onPick={toggleCompany} />}</AddButton>
        <AddButton label="group of companies as one" width={360} disabled={full} title={fullTitle}>{(close) => <GroupPicker companies={companies} onAdd={addSet} close={close} />}</AddButton>
      </div>
      <span className="font-semibold uppercase tracking-wide text-ink2">Periods</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {periods.map((p, i) => <Chip key={p.id} title={periodLabel(p, lastFull)} first={overTime && i === 0} onRemove={periods.length > minPeriods ? () => removePeriod(p.id) : null}>{periodLabel(p, lastFull)}</Chip>)}
        <AddButton label="period" width={340}>{(close) => <PeriodPicker lastFull={lastFull} onAdd={addPeriod} close={close} years={years} months={months} />}</AddButton>
        {periods.length > 0 && <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => addPeriod(prevPeriod(periods[periods.length - 1], lastFull))}>a year earlier</button>}
        {note}
      </div>
    </div>
  );
}
