import React from 'react';
import { metric as metricOf, officeColor } from '../format.js';

const GRANULARITY_LABELS = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };

export const COMPARE = 'compare';

/**
 * Header filters. Office picker: All offices, any office category (combined), each office, or Compare.
 * compare.maxOffices null means no limit on how many offices can be compared.
 */
export default function Controls({ config, offices, filters, onChange, yoy, onYoy, onSync, syncing, compact = false, categories = [], canSync = true }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const { maxOffices, minOffices, metrics } = config.compare;
  const limited = maxOffices != null;
  const isCompare = filters.office === COMPARE;
  const selected = filters.compare;
  const usefulDims = categories.filter((d) => d.categories.length > 0);

  const setSelection = (ids) => set({ compare: limited ? ids.slice(0, maxOffices) : ids });
  const toggleOffice = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (limited && next.length > maxOffices) return;
    setSelection(next);
  };
  const addCategory = (value) => {
    if (!value) return;
    const [dimId, ...rest] = value.split(':');
    const cat = categories.find((d) => d.id === dimId)?.categories.find((c) => c.label === rest.join(':'));
    if (cat) setSelection([...new Set([...selected, ...cat.realmIds.filter((id) => offices.some((o) => o.realmId === id))])]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <label className="col-span-2 flex flex-col gap-1 text-xs text-ink2 sm:col-span-1">
          Office
          <select className="control w-full sm:w-auto sm:min-w-[200px]" value={filters.office} onChange={(e) => set({ office: e.target.value })}>
            <option value="all">All offices</option>
            {usefulDims.map((d) => (
              <optgroup key={d.id} label={`By ${d.label.toLowerCase()}`}>
                {d.categories.map((c) => (
                  <option key={c.label} value={`cat:${d.id}:${c.label}`}>{c.label} ({c.realmIds.length})</option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Offices">
              {offices.map((o) => <option key={o.realmId} value={o.realmId}>{o.officeName}</option>)}
            </optgroup>
            {offices.length >= minOffices && <option value={COMPARE}>Compare offices…</option>}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink2">
          From
          <input className="control w-full min-w-0" type="month" value={filters.from} max={filters.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink2">
          To
          <input className="control w-full min-w-0" type="month" value={filters.to} min={filters.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>

        <div className="col-span-2 flex flex-col gap-1 text-xs text-ink2 sm:col-span-1">
          Granularity
          <div className="seg seg-fill" role="group" aria-label="Granularity">
            {config.dashboard.granularities.map((g) => (
              <button key={g} type="button" aria-pressed={filters.granularity === g} onClick={() => set({ granularity: g })}>
                {GRANULARITY_LABELS[g] || g}
              </button>
            ))}
          </div>
        </div>

        {isCompare && !compact && (
          <label className="col-span-2 flex flex-col gap-1 text-xs text-ink2 sm:col-span-1">
            Metric
            <select className="control w-full sm:w-auto sm:min-w-[200px]" value={filters.metric} onChange={(e) => set({ metric: e.target.value })}>
              {metrics.map((m) => <option key={m} value={m}>{metricOf(m).label}</option>)}
            </select>
          </label>
        )}

        {!compact && (
          <label className="flex h-9 items-center gap-2 text-sm text-ink2 select-none">
            <input type="checkbox" className="h-4 w-4 accent-[var(--series-1)]" checked={yoy} onChange={(e) => onYoy(e.target.checked)} />
            YoY
          </label>
        )}

        <div className="hidden flex-1 sm:block" />

        {canSync && (
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="col-span-2 h-9 w-full rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60 sm:col-span-1 sm:w-auto"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {isCompare && (
        <div className="card flex flex-col gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
            <span>
              Comparing {selected.length}{limited ? `/${maxOffices}` : ''} {selected.length === 1 ? 'office' : 'offices'}
              {selected.length < minOffices && <span className="text-muted"> · pick at least {minOffices}</span>}
            </span>
            <span className="flex-1" />
            {usefulDims.length > 0 && (
              <select className="control h-8 w-auto py-0 text-xs" value="" onChange={(e) => addCategory(e.target.value)} aria-label="Add a category">
                <option value="">Add a category…</option>
                {usefulDims.map((d) => (
                  <optgroup key={d.id} label={d.label}>
                    {d.categories.map((c) => <option key={c.label} value={`${d.id}:${c.label}`}>{c.label} ({c.realmIds.length})</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            {(!limited || offices.length <= maxOffices) && (
              <button type="button" className="text-accent hover:underline" onClick={() => setSelection(offices.map((o) => o.realmId))}>Select all</button>
            )}
            {selected.length > 0 && <button type="button" className="text-accent hover:underline" onClick={() => setSelection([])}>Clear</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {offices.map((o) => {
              const on = selected.includes(o.realmId);
              const full = limited && !on && selected.length >= maxOffices;
              return (
                <button
                  key={o.realmId}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleOffice(o.realmId)}
                  title={full ? `Deselect an office first (max ${maxOffices})` : ''}
                  className={`flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors ${
                    on ? 'border-transparent bg-page text-ink' : 'border-[var(--ring)] text-ink2 hover:bg-page'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  style={on ? { boxShadow: `inset 0 0 0 2px ${officeColor(o.colorIndex)}` } : undefined}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: officeColor(o.colorIndex), opacity: on ? 1 : 0.5 }} aria-hidden="true" />
                  {o.officeName}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
