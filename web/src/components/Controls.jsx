import React from 'react';
import { metric as metricOf, officeColor } from '../format.js';

const GRANULARITY_LABELS = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };

export const COMPARE = 'compare';

export default function Controls({ config, offices, filters, onChange, yoy, onYoy, onSync, syncing, compact = false }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const { maxOffices, minOffices, metrics } = config.compare;
  const isCompare = filters.office === COMPARE;
  const selected = filters.compare;

  const toggleOffice = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (next.length > maxOffices) return;
    set({ compare: next });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink2">
          Office
          <select className="control min-w-[180px]" value={filters.office} onChange={(e) => set({ office: e.target.value })}>
            <option value="all">All offices</option>
            {offices.map((o) => (
              <option key={o.realmId} value={o.realmId}>{o.officeName}</option>
            ))}
            {offices.length >= minOffices && <option value={COMPARE}>Compare offices…</option>}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink2">
          From
          <input className="control" type="month" value={filters.from} max={filters.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink2">
          To
          <input className="control" type="month" value={filters.to} min={filters.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>

        <div className="flex flex-col gap-1 text-xs text-ink2">
          Granularity
          <div className="seg" role="group" aria-label="Granularity">
            {config.dashboard.granularities.map((g) => (
              <button key={g} type="button" aria-pressed={filters.granularity === g} onClick={() => set({ granularity: g })}>
                {GRANULARITY_LABELS[g] || g}
              </button>
            ))}
          </div>
        </div>

        {isCompare && !compact && (
          <div className="flex flex-col gap-1 text-xs text-ink2">
            Metric
            <div className="seg" role="group" aria-label="Metric">
              {metrics.map((m) => (
                <button key={m} type="button" aria-pressed={filters.metric === m} onClick={() => set({ metric: m })}>
                  {metricOf(m).label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!compact && (
        <label className="flex h-9 items-center gap-2 text-sm text-ink2 select-none">
          <input type="checkbox" className="h-4 w-4 accent-[var(--series-1)]" checked={yoy} onChange={(e) => onYoy(e.target.checked)} />
          YoY
        </label>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {isCompare && (
        <div className="card flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="mr-1 text-xs text-ink2">
            Compare {selected.length}/{maxOffices}
            {selected.length < minOffices && <span className="text-muted"> · pick at least {minOffices}</span>}
          </span>
          {offices.map((o) => {
            const on = selected.includes(o.realmId);
            const full = !on && selected.length >= maxOffices;
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
      )}
    </div>
  );
}
