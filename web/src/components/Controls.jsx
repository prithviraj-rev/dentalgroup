import React, { useEffect, useState } from 'react';
import { metric as metricOf, officeColor } from '../format.js';

const GRANULARITY_LABELS = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
export const PERIOD_LABELS = { month: 'Last month', quarter: 'Last quarter', ytd: 'YTD', lastYear: 'Last year', ttm: 'TTM', custom: 'Custom' };
const Chevron = ({ open }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="shrink-0 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
// Custom From / To: full-date pickers (VJ 2026-10-29, the month picker's design was disliked); the dashboard is monthly, so
// From uses the month of the picked day and To the month of its day (shown as the 1st and the last day of those months).
const firstDay = (m) => `${m}-01`;
const lastDay = (m) => `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
const monthOf = (d) => d.slice(0, 7);
const ago = (iso) => { if (!iso) return 'never'; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? 'just now' : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };

export const COMPARE = 'compare';
const BASIS_LABELS = { accrual: 'Accrual', cash: 'Cash' };

/**
 * Header filters.
 * dashboard.periodPicker = range: From / To / Granularity. = buttons: the period buttons (dashboard.periods), Custom shows From / To.
 * dashboard.officePicker = select: an Office picker (All offices, any office category, each office, or Compare).
 * = companies: one small "Select companies" button opening the companies in their groups (/api/<base>/groups: the
 * picker groups of the Financial KPIs config, one color per group); the picked ones are the filter, none = every company.
 * dashboard.syncButton: always | stale (only when the last sync is older than syncStaleHours) | never.
 * compare.maxOffices null means no limit on how many offices can be compared.
 */
export default function Controls({ config, offices, filters, onChange, yoy, onYoy, onSync, syncing, compact = false, categories = [], groups = null, names = {}, canSync = true, lastSync = null, inline = false, parts = {}, periods = null }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const periodList = periods || config.dashboard.periods; // App.jsx expands "years" into year:<YYYY> buttons
  const periodLabel = (p) => PERIOD_LABELS[p] || (String(p).startsWith('year:') ? p.slice(5) : p);
  // parts.view = { ids, onApply } (a Compare or combined view, VJ 2026-10-29): the popup opens with the companies of that view
  // ticked and highlighted; Done with a changed set hands the new set to onApply (which opens the matching view) instead of filtering the list.
  const view = inline && parts.view ? parts.view : null;
  const [viewSel, setViewSel] = useState([]);
  const { maxOffices, minOffices, metrics } = config.compare;
  const d = config.dashboard;
  const chips = d.officePicker === 'companies';
  const buttons = d.periodPicker === 'buttons';
  const [open, setOpen] = useState(false); // the company picker popup
  const [search, setSearch] = useState('');
  const openPopup = () => { if (view) setViewSel(view.ids); setSearch(''); setOpen(!open); };
  const viewChanged = () => Boolean(view) && (viewSel.length !== view.ids.length || viewSel.some((id) => !view.ids.includes(id)));
  const done = () => { setOpen(false); if (view && viewSel.length > 0 && viewChanged()) view.onApply(viewSel); };
  // Popup: Escape closes it, the page behind does not scroll.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);
  const limited = !view && maxOffices != null;
  const isCompare = filters.office === COMPARE;
  const selected = view ? viewSel : filters.compare;
  const usefulDims = categories.filter((x) => x.categories.length > 0);
  const stale = !lastSync || Date.now() - new Date(lastSync).getTime() > d.syncStaleHours * 36e5;
  const showSync = canSync && (d.syncButton === 'always' || (d.syncButton === 'stale' && stale));

  const setSelection = (ids) => (view ? setViewSel(ids) : set({ office: COMPARE, compare: limited ? ids.slice(0, maxOffices) : ids }));
  const toggleOffice = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (limited && next.length > maxOffices) return;
    setSelection(next);
  };
  const addCategory = (value) => {
    if (!value) return;
    const [dimId, ...rest] = value.split(':');
    const cat = categories.find((x) => x.id === dimId)?.categories.find((c) => c.label === rest.join(':'));
    if (cat) setSelection([...new Set([...selected, ...cat.realmIds.filter((id) => offices.some((o) => o.realmId === id))])]);
  };

  // Chips in rows, one per group (companies in no group fall into a last row); colors per group; display names from the groups API.
  const nameOf = (o) => names[o.realmId] || o.officeName;
  const byId = Object.fromEntries(offices.map((o) => [o.realmId, o]));
  const columns = groups
    ? [...groups.map((g) => ({ ...g, companies: g.realmIds.map((id) => byId[id]).filter(Boolean).sort((a, b) => nameOf(a).localeCompare(nameOf(b))) })),
      ...(() => { const placed = new Set(groups.flatMap((g) => g.realmIds)); const rest = offices.filter((o) => !placed.has(o.realmId)); return rest.length ? [{ key: '__rest', label: 'Other companies', color: 8, companies: rest }] : []; })()]
    : [{ key: '__all', label: null, color: null, companies: offices }];
  const colorOf = (col, o) => (col.color ? `var(--series-${col.color})` : officeColor(o.colorIndex));

  const chip = (o, col) => {
    const on = selected.includes(o.realmId);
    const full = limited && !on && selected.length >= maxOffices;
    const color = colorOf(col, o);
    return (
      <button
        key={o.realmId}
        type="button"
        aria-pressed={on}
        disabled={full}
        onClick={() => toggleOffice(o.realmId)}
        title={full ? `Deselect an office first (max ${maxOffices})` : on && view ? `${o.officeName} is in this view` : o.officeName}
        className={`flex min-w-0 items-center gap-1.5 rounded-full border transition-colors ${col.label ? 'h-7 max-w-[220px] px-2.5 text-xs' : 'h-8 px-3 text-sm'} ${
          on ? 'border-transparent bg-page font-medium text-ink' : 'border-[var(--ring)] text-ink2 hover:bg-page'
        } disabled:cursor-not-allowed disabled:opacity-40`}
        style={on ? { boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color, opacity: on ? 1 : 0.5 }} aria-hidden="true" />
        <span className="truncate">{nameOf(o)}</span>
      </button>
    );
  };

  // Popup body: one block per group (heading with all / none, then the chips), filtered by the search box.
  const q = search.trim().toLowerCase();
  const matches = (o) => !q || nameOf(o).toLowerCase().includes(q) || o.officeName.toLowerCase().includes(q);
  const groupBlocks = (
    <div className="flex flex-col gap-3">
      {columns.map((col) => {
        const shown = col.companies.filter(matches);
        if (q && !shown.length) return null;
        const ids = col.companies.map((o) => o.realmId);
        const on = ids.filter((id) => selected.includes(id)).length;
        const allOn = ids.length > 0 && on === ids.length;
        return (
          <div key={col.key}>
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.color ? `var(--series-${col.color})` : 'var(--ink-2)' }} aria-hidden="true" />
              <span className="font-semibold text-ink">{col.label || 'Companies'}</span>
              <span className="text-muted">{on ? `${on} of ${ids.length}` : ids.length}</span>
              {ids.length > 0 && (!limited || ids.length <= maxOffices) && (
                <button type="button" className="text-accent hover:underline" onClick={() => setSelection(allOn ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])}>{allOn ? 'none' : 'all'}</button>
              )}
            </div>
            {ids.length === 0 ? <span className="text-xs text-muted">No companies yet.</span> : <div className="flex flex-wrap gap-1.5">{shown.map((o) => chip(o, col))}</div>}
          </div>
        );
      })}
    </div>
  );
  const popup = open && (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Select companies" className="card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden p-0 shadow-xl">
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-base font-semibold">Select companies</h2>
          <span className="text-xs text-ink2">{view ? `${selected.length} in this view` : selected.length === 0 ? `all ${offices.length} shown` : `${selected.length} selected`}</span>
          <span className="flex-1" />
          <input className="control h-8 w-44 text-sm" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search companies" autoFocus />
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink2 hover:bg-page">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groupBlocks}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-2.5">
          <span className="text-xs text-muted">{view ? (view.hint || 'Done opens the ticked companies as a view.') : 'Nothing ticked = every company.'}</span>
          <span className="flex-1" />
          {selected.length > 0 && <button type="button" className="control h-8 text-sm" onClick={() => setSelection([])}>Unselect all</button>}
          <button type="button" className="h-8 rounded-lg bg-accent px-4 text-sm font-medium text-white" onClick={done}>{view && viewChanged() ? 'Open' : 'Done'}</button>
        </div>
      </div>
    </div>
  );

  // Accrual | Cash as in QuickBooks (dashboard.basis); a basis the data does not support is greyed out.
  const basisSeg = d.basis?.show && (
    <div className={`seg ${inline ? 'seg-sm' : ''}`} role="group" aria-label="Accounting basis">
      {d.basis.options.map((b) => {
        const ok = d.basis.available.includes(b);
        return <button key={b} type="button" aria-pressed={filters.basis === b} disabled={!ok} title={ok ? undefined : `${BASIS_LABELS[b]} basis is not synced yet (every figure is accrual)`} onClick={() => ok && set({ basis: b })}>{BASIS_LABELS[b] || b}</button>;
      })}
    </div>
  );
  const syncButton = showSync && (
    <button type="button" onClick={onSync} disabled={syncing} title={`Last sync ${ago(lastSync)}`}
      className={`h-8 rounded-lg px-3 text-sm font-medium disabled:opacity-60 ${stale ? 'bg-accent text-white' : 'control'}`}>
      {syncing ? 'Syncing…' : 'Sync now'}
    </button>
  );

  // inline: the same controls without captions, for a page's own button bar (officesSheet.controls = inline).
  if (inline) {
    const show = (k) => parts[k] !== false;
    const own = parts.periodValue !== undefined; // a table's own period instead of the page's
    const periodValue = own ? parts.periodValue : filters.period;
    const setPeriod = (p) => (own ? parts.onPeriod(p) : set({ period: p }));
    return (
      <>
        {show('period') && buttons && (
          <div className="seg seg-sm" role="group" aria-label="Period">
            {periodList.map((p) => <button key={p} type="button" aria-pressed={periodValue === p} onClick={() => setPeriod(p)}>{periodLabel(p)}</button>)}
          </div>
        )}
        {show('period') && (!buttons || periodValue === 'custom') && <>
          <input className="control h-8 w-auto text-xs" type="date" aria-label="From" value={firstDay(filters.from)} max={lastDay(filters.to)} onChange={(e) => e.target.value && set({ from: monthOf(e.target.value) })} />
          <span className="text-xs text-muted">to</span>
          <input className="control h-8 w-auto text-xs" type="date" aria-label="To" value={lastDay(filters.to)} min={firstDay(filters.from)} onChange={(e) => e.target.value && set({ to: monthOf(e.target.value) })} />
        </>}
        {show('companies') && chips && (
          <button type="button" aria-expanded={open} onClick={openPopup} className={`control inline-flex h-8 items-center gap-1.5 text-xs ${!view && selected.length ? 'font-medium text-ink' : ''}`}>
            <Chevron open={open} />{view || selected.length === 0 ? 'Select companies' : `${selected.length} ${selected.length === 1 ? 'company' : 'companies'} selected`}
          </button>
        )}
        {show('companies') && chips && !view && selected.length > 0 && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelection([])}>Unselect all</button>}
        {show('basis') && basisSeg}
        {show('sync') && showSync && <button type="button" onClick={onSync} disabled={syncing} title={`Last sync ${ago(lastSync)}`} className={`h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-60 ${stale ? 'bg-accent text-white' : 'control'}`}>{syncing ? 'Syncing…' : 'Sync now'}</button>}
        {chips && popup}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-end gap-3">
        {!chips && (
          <label className="flex flex-col gap-1 text-xs text-ink2">
            Office
            <select className="control w-full sm:w-auto sm:min-w-[200px]" value={filters.office} onChange={(e) => set({ office: e.target.value })}>
              <option value="all">All offices</option>
              {usefulDims.map((x) => (
                <optgroup key={x.id} label={`By ${x.label.toLowerCase()}`}>
                  {x.categories.map((c) => (
                    <option key={c.label} value={`cat:${x.id}:${c.label}`}>{c.label} ({c.realmIds.length})</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Offices">
                {offices.map((o) => <option key={o.realmId} value={o.realmId}>{o.officeName}</option>)}
              </optgroup>
              {offices.length >= minOffices && <option value={COMPARE}>Compare offices…</option>}
            </select>
          </label>
        )}

        {buttons ? (
          <div className="flex flex-col gap-1 text-xs text-ink2">
            Period
            <div className="seg" role="group" aria-label="Period">
              {periodList.map((p) => (
                <button key={p} type="button" aria-pressed={filters.period === p} onClick={() => set({ period: p })}>{periodLabel(p)}</button>
              ))}
            </div>
          </div>
        ) : null}

        {(!buttons || filters.period === 'custom') && <>
          <label className="flex flex-col gap-1 text-xs text-ink2">
            From
            <input className="control w-full min-w-0" type="date" value={firstDay(filters.from)} max={lastDay(filters.to)} onChange={(e) => e.target.value && set({ from: monthOf(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink2">
            To
            <input className="control w-full min-w-0" type="date" value={lastDay(filters.to)} min={firstDay(filters.from)} onChange={(e) => e.target.value && set({ to: monthOf(e.target.value) })} />
          </label>
        </>}

        {basisSeg && (
          <div className="flex flex-col gap-1 text-xs text-ink2">
            Basis
            {basisSeg}
          </div>
        )}

        {!buttons && (
          <div className="flex flex-col gap-1 text-xs text-ink2">
            Granularity
            <div className="seg seg-fill" role="group" aria-label="Granularity">
              {d.granularities.map((g) => (
                <button key={g} type="button" aria-pressed={filters.granularity === g} onClick={() => set({ granularity: g })}>
                  {GRANULARITY_LABELS[g] || g}
                </button>
              ))}
            </div>
          </div>
        )}

        {chips && (
          <div className="flex flex-col gap-1 text-xs text-ink2">
            Companies
            <div className="flex items-center gap-2">
              <button type="button" aria-expanded={open} onClick={openPopup} className={`control inline-flex h-8 items-center gap-1.5 text-sm ${selected.length ? 'font-medium text-ink' : ''}`}>
                <Chevron open={open} />{selected.length === 0 ? 'Select companies' : `${selected.length} ${selected.length === 1 ? 'company' : 'companies'} selected`}
              </button>
              {selected.length > 0 && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setSelection([])}>Unselect all</button>}
            </div>
          </div>
        )}

        {isCompare && !compact && (
          <label className="flex flex-col gap-1 text-xs text-ink2">
            Metric
            <select className="control w-full sm:w-auto sm:min-w-[200px]" value={filters.metric} onChange={(e) => set({ metric: e.target.value })}>
              {metrics.map((m) => <option key={m} value={m}>{metricOf(m).label}</option>)}
            </select>
          </label>
        )}

        {!compact && (
          <label className="flex h-8 items-center gap-2 text-sm text-ink2 select-none">
            <input type="checkbox" className="h-4 w-4 accent-[var(--series-1)]" checked={yoy} onChange={(e) => onYoy(e.target.checked)} />
            YoY
          </label>
        )}

        <div className="flex-1" />
        {syncButton}
      </div>

      {chips && popup}

      {!chips && isCompare && (
        <div className="card flex flex-col gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
            <span className="text-sm font-medium text-ink">Compare</span>
            <span>Comparing {selected.length}{limited ? `/${maxOffices}` : ''} {selected.length === 1 ? 'office' : 'offices'}{selected.length < minOffices && <span className="text-muted"> · pick at least {minOffices}</span>}</span>
            <span className="flex-1" />
            {usefulDims.length > 0 && (
              <select className="control h-8 w-auto py-0 text-xs" value="" onChange={(e) => addCategory(e.target.value)} aria-label="Add a category">
                <option value="">Add a category…</option>
                {usefulDims.map((x) => (
                  <optgroup key={x.id} label={x.label}>
                    {x.categories.map((c) => <option key={c.label} value={`${x.id}:${c.label}`}>{c.label} ({c.realmIds.length})</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            {(!limited || offices.length <= maxOffices) && <button type="button" className="text-accent hover:underline" onClick={() => setSelection(offices.map((o) => o.realmId))}>Select all</button>}
            {selected.length > 0 && <button type="button" className="text-accent hover:underline" onClick={() => setSelection([])}>Clear</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">{columns[0].companies.map((o) => chip(o, columns[0]))}</div>
        </div>
      )}
    </div>
  );
}
