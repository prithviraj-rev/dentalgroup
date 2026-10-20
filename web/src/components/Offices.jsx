import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, LineChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import {
  Section, Tiles, Seg, ErrorBox, Loading, Empty, Status, SourceLine, ChartTip, sortTh, sorter, downloadCsv, useApi, useNarrow,
  POS, NEG, axisTick, pct1, signedPct, money, compact, monthLabel,
} from './ui.jsx';

// Offices: each dental practice and its sub-DSO read as one office. Portfolio (all offices, flags) and one
// office (statement by month, balance sheet, trends). Data from /api/office-view (config/offices.json),
// computed from the raw QuickBooks records only.

const TONE = { bad: 'bg-[color-mix(in_oklab,var(--bad)_14%,var(--surface))] text-bad', warn: 'bg-[color-mix(in_oklab,var(--series-4)_22%,var(--surface))] text-[color-mix(in_oklab,var(--series-4)_70%,var(--ink))]', info: 'bg-[color-mix(in_oklab,var(--series-1)_14%,var(--surface))] text-[var(--series-1)]', good: 'bg-[color-mix(in_oklab,var(--good)_14%,var(--surface))] text-good' };
const Pill = ({ tone = 'info', children, title }) => <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone] || TONE.info}`}>{children}</span>;
const Tag = ({ children, title }) => <span title={title} className="inline-flex max-w-[220px] items-center truncate rounded bg-page px-1.5 py-0.5 text-[11px] text-ink2 ring-1 ring-[var(--line)]">{children}</span>;
const monthEndLabel = (m) => { if (!m) return ''; const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const ago = (iso) => { if (!iso) return 'never'; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? 'just now' : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
const shortMonth = (m) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)); return d.toLocaleString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', " '"); };
/** Expand / collapse chevron: one clean stroke icon, turned down when open (same look in every table of this tab). */
const Chevron = ({ open }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0 text-muted transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
/** Month columns grouped as monthly | quarterly | yearly: [{ key, label, months }]. No granularity -> no columns (the period total only). */
const bucketsOf = (months, gran) => {
  if (!gran) return [];
  const map = new Map();
  for (const m of months) {
    const q = `Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`;
    const key = gran === 'year' ? m.slice(0, 4) : gran === 'quarter' ? `${m.slice(0, 4)}-${q}` : m;
    const label = gran === 'year' ? key : gran === 'quarter' ? `${q} ${m.slice(0, 4)}` : monthLabel(m);
    if (!map.has(key)) map.set(key, { key, label, months: [] });
    map.get(key).months.push(m);
  }
  return [...map.values()];
};
const sumMonths = (map, b) => b.months.reduce((t, m) => t + (map?.[m] || 0), 0);
const COLUMN_OPTIONS = [['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']];
const Money = ({ v, bold }) => <span className={`tabular ${v < 0 ? 'text-bad' : ''} ${bold ? 'font-semibold' : ''}`}>{v == null ? '–' : money(v)}</span>;

export default function Offices({ filters, officeParam, singleOffice, reloadKey, base = 'office-view' }) {
  const [period, setPeriod] = useState(null);
  const [selected, setSelected] = useState(null);
  const [edits, setEdits] = useState(0); // bumps after an office is saved or removed
  const [combine, setCombine] = useState(null); // null | { office?: current office to edit }
  const q = { from: filters.from, to: filters.to, office: officeParam, ...(period ? { period } : {}) };
  const { data, loading, error } = useApi(() => api.officeView(q, base), [filters.from, filters.to, officeParam, period, reloadKey, edits, base]);
  const setup = useApi(() => api.officeSetup(base), [reloadKey, edits, base]);
  const canManage = setup.data?.canManage === true;
  // A single company picked in the header opens its office straight away.
  useEffect(() => { if (singleOffice && data?.offices?.length === 1) setSelected(data.offices[0].key); }, [singleOffice, data]);
  useEffect(() => { if (!singleOffice) setSelected(null); }, [officeParam, singleOffice]);
  if (error) return <ErrorBox title="Could not load the offices" error={error} />;
  if (!data) return <Loading />;
  const periodSeg = <Seg label="Period" small value={data.period.key} onChange={setPeriod} options={data.period.options} />;
  const panel = combine && setup.data && (
    <CombinePanel setup={setup.data} base={base} initial={combine.office || null} onClose={() => setCombine(null)}
      onSaved={(res) => { setCombine(null); setEdits((n) => n + 1); if (res?.key) setSelected(res.key); else if (!singleOffice) setSelected(null); }} />
  );
  if (selected) {
    return (
      <>
        {panel}
        <OfficeDetail officeKey={selected} q={q} base={base} reloadKey={reloadKey + edits} periodSeg={periodSeg} onBack={() => setSelected(null)} canBack={!singleOffice || data.offices.length !== 1}
          onCombine={canManage ? (office) => setCombine({ office }) : null} />
      </>
    );
  }
  const combineNow = async (offices) => {
    const places = offices.map((o) => o.city || o.name);
    const name = `Combined: ${places.slice(0, 3).join(', ')}${places.length > 3 ? ` +${places.length - 3}` : ''}`;
    const res = await api.officeSave({ id: null, name, city: null, state: null, companies: [...new Set(offices.flatMap((o) => o.companies.map((c) => c.realmId)))] }, base);
    setEdits((n) => n + 1);
    if (res?.key) setSelected(res.key); // open the combined office straight away
    return res;
  };
  const separateNow = async (id) => { await api.officeDelete(id, base); setEdits((n) => n + 1); };
  return <>{panel}<Portfolio data={data} loading={loading} periodSeg={periodSeg} onOpen={setSelected} onCombine={canManage ? (office) => setCombine({ office: office || null }) : null} onCombineNow={canManage ? combineNow : null} onSeparate={canManage ? separateNow : null} /></>;
}

// ---------- Combine companies ----------

function CombinePanel({ setup, initial, onClose, onSaved, base = 'office-view' }) {
  const fromOffice = (o) => {
    const saved = o && setup.saved.find((s) => s.id === o.id);
    return { id: saved?.id ?? null, name: saved?.name || o?.name || '', city: saved?.city || o?.city || '', state: saved?.state || o?.state || '', aliases: (saved?.aliases || []).join(', '), companies: new Set((o?.companies || []).map((c) => c.realmId)) };
  };
  const [form, setForm] = useState(() => fromOffice(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (id) => setForm((f) => { const c = new Set(f.companies); if (c.has(id)) c.delete(id); else c.add(id); return { ...f, companies: c }; });
  const picked = setup.companies.filter((c) => form.companies.has(c.realmId));
  const first = picked[0];
  const suggested = (form.city || first?.city) ? setup.namePattern.replace('{city}', form.city || first.city || '').replace('{state}', form.state || first?.state || '').replace('{company}', first?.name || '') : (first?.name || '');
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.officeSave({ id: form.id, name: form.name.trim() || suggested, city: form.city, state: form.state, companies: [...form.companies], aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean) }, base);
      onSaved(res);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true); setErr(null);
    try { await api.officeDelete(id, base); onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Section title={form.id ? 'Edit combined office' : 'Combine companies into one view'}
      subtitle="Tick the companies to read together. The combination is listed under Combined offices next to the offices, which stay as they are; a company can be in several combinations."
      right={<button type="button" className="control text-sm" onClick={onClose}>Close</button>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="max-h-[420px] overflow-auto rounded border border-[var(--line)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
              <tr><th scope="col" className="w-8 px-2 py-2" aria-label="Pick" /><th scope="col" className="px-2 py-2 text-left font-medium">Company</th><th scope="col" className="px-2 py-2 text-left font-medium">City</th><th scope="col" className="px-2 py-2 text-left font-medium">Type</th><th scope="col" className="px-2 py-2 text-left font-medium">Currently in</th></tr>
            </thead>
            <tbody>
              {setup.companies.map((c) => (
                <tr key={c.realmId} className={`cursor-pointer border-t border-[var(--line)] ${form.companies.has(c.realmId) ? 'bg-[color-mix(in_oklab,var(--series-1)_10%,var(--surface))]' : 'hover:bg-page'}`} onClick={() => toggle(c.realmId)}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={form.companies.has(c.realmId)} onChange={() => toggle(c.realmId)} onClick={(e) => e.stopPropagation()} aria-label={`Include ${c.name}`} /></td>
                  <td className="px-2 py-1.5 font-medium">{c.name}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink2">{[c.city, c.state].filter(Boolean).join(', ') || '–'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink2">{c.group || '–'}</td>
                  <td className="px-2 py-1.5 text-ink2">{c.office ? <>{c.office.name}{c.office.saved && <span className="ml-1 text-[10px] uppercase text-muted">saved</span>}</> : <span className="text-muted">not an office</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid content-start gap-3">
          <p className="text-sm">{picked.length ? <>{picked.length} selected: <b>{picked.map((c) => c.name).join(' + ')}</b></> : 'No companies selected yet.'}</p>
          <label className="grid gap-1 text-xs text-ink2">Office name<input className="control" value={form.name} placeholder={suggested || 'Dental Office - City'} onChange={(e) => set('name', e.target.value)} /></label>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
            <label className="grid gap-1 text-xs text-ink2">City<input className="control" value={form.city} placeholder={first?.city || ''} onChange={(e) => set('city', e.target.value)} /></label>
            <label className="grid gap-1 text-xs text-ink2">State<input className="control" value={form.state} placeholder={first?.state || ''} onChange={(e) => set('state', e.target.value)} /></label>
          </div>
          <label className="grid gap-1 text-xs text-ink2">Other spellings of these companies on payees / customers (comma separated)<input className="control" value={form.aliases} placeholder="e.g. CT Branford" onChange={(e) => set('aliases', e.target.value)} /></label>
          {err && <p className="text-sm text-bad">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !picked.length} onClick={save}>{form.id ? 'Save changes' : 'Save office'}</button>
            {form.id && <button type="button" className="control text-sm text-bad" disabled={busy} onClick={() => remove(form.id)}>Remove (back to automatic)</button>}
          </div>
          {setup.saved.length > 0 && (
            <div className="mt-2 border-t border-[var(--line)] pt-3">
              <div className="mb-1 text-xs font-medium text-ink2">Saved offices</div>
              <ul className="grid gap-1 text-sm">
                {setup.saved.map((sv) => (
                  <li key={sv.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><b>{sv.name || setup.namePattern.replace('{city}', sv.city || '')}</b> <span className="text-ink2">· {sv.companies.map((id) => setup.companies.find((c) => c.realmId === id)?.name || id).join(' + ')}</span></span>
                    <span className="flex gap-2"><button type="button" className="text-accent hover:underline" onClick={() => { setErr(null); setForm(fromOffice({ id: sv.id, companies: sv.companies.map((realmId) => ({ realmId })) })); }}>Edit</button><button type="button" className="text-bad hover:underline" disabled={busy} onClick={() => remove(sv.id)}>Remove</button></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted">Combinations are kept in the database and shown on both Offices tabs. The offices themselves come from config/offices.json and the automatic pairing by city and state.</p>
        </div>
      </div>
    </Section>
  );
}

// ---------- Portfolio ----------

function Portfolio({ data, loading, periodSeg, onOpen, onCombine, onCombineNow, onSeparate }) {
  const [flag, setFlag] = useState(null);
  const [sort, setSort] = useState({ col: 'netCollections', dir: -1 });
  const [picked, setPicked] = useState(() => new Set());
  const pick = (key) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const pickedOffices = data.offices.filter((o) => picked.has(o.key));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone, text } after a combine
  const combinePicked = async () => {
    if (pickedOffices.length < 2 || !onCombineNow) return;
    setBusy(true); setNote(null);
    try {
      const r = await onCombineNow(pickedOffices);
      setNote({ tone: 'good', text: `Combined ${pickedOffices.length} offices into "${r.name}".`, undoId: r.id });
      setPicked(new Set());
    } catch (e) { setNote({ tone: 'bad', text: e.message }); }
    setBusy(false);
  };
  const separate = async (id, label) => {
    setBusy(true); setNote(null);
    try { await onSeparate(id); setNote({ tone: 'good', text: label }); setPicked(new Set()); } catch (e) { setNote({ tone: 'bad', text: e.message }); }
    setBusy(false);
  };
  const combos = data.combined || [];
  const rows = useMemo(() => {
    const list = flag === 'all' ? data.offices.filter((o) => o.flags.length) : flag ? data.offices.filter((o) => o.flags.some((f) => f.key === flag)) : data.offices;
    return [...list].sort(sorter(sort, (r, c) => (c === 'name' ? r.name : r[c])));
  }, [data.offices, flag, sort]);
  const max = Math.max(1, ...data.offices.map((o) => Math.abs(o.netCollections)));
  const t = data.totals;
  const sortLabel = { name: 'office name', netCollections: 'net collections', ebitdaMargin: 'EBITDA margin', officeEbitda: 'office EBITDA', cash: 'cash', vsPrior: 'change vs prior year' }[sort.col];
  const exportCsv = () => downloadCsv(`offices-${data.asOf}.csv`, [['Office', 'City', 'State', 'Companies', 'Net collections', 'EBITDA before fees', 'DSO management fees', 'Office EBITDA', 'EBITDA margin', 'Operating cash flow', 'Cash', 'A/R', 'A/P', 'vs prior year', 'Flags'],
    ...rows.map((o) => [o.name, o.city, o.state, o.companies.map((c) => c.name).join(' + '), o.netCollections, o.ebitdaBeforeFees, o.managementFees, o.officeEbitda, o.ebitdaMargin, o.operatingCashFlow, o.cash, o.ar, o.ap, o.vsPrior, o.flags.map((f) => f.label).join('; ')])]);
  if (!data.hasData) return <Empty title="No office data for this selection">Offices are built from the raw QuickBooks records of each dental company and its sub-DSO (config/offices.json). They appear after the next sync.{onCombine && <div className="mt-3"><button type="button" className="control text-sm" onClick={() => onCombine(null)}>Combine companies</button></div>}</Empty>;
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Portfolio</h2>
          <p className="text-sm text-ink2">{data.period.label}{data.period.key !== 'month' ? ` (${monthLabel(data.period.from)} to ${monthLabel(data.period.to)})` : ` ${monthLabel(data.asOf)}`} · Balances as of {monthEndLabel(data.asOf)} · Accrual basis{data.to && data.to !== data.asOf ? ` · ${monthLabel(data.to)} is not finished, so figures are as of ${monthLabel(data.asOf)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">{onCombine && <button type="button" className="control text-sm" onClick={() => onCombine(null)}>Combine companies</button>}{periodSeg}</div>
      </div>
      <Tiles cols={4} items={[
        { label: 'Net collections', value: money(t.netCollections), sub: t.vsPrior == null ? 'No prior-year data' : `${signedPct(t.vsPrior)} vs prior year`, subTone: t.vsPrior == null ? null : t.vsPrior >= 0 ? 'good' : 'bad' },
        { label: 'Office EBITDA', value: money(t.officeEbitda), bad: t.officeEbitda < 0, sub: `EBITDA margin ${pct1(t.ebitdaMargin)}` },
        { label: 'Cash', value: money(t.cash), sub: `As of ${monthEndLabel(data.asOf)}` },
        { label: 'Receivables', value: money(t.ar), sub: `As of ${monthEndLabel(data.asOf)}` },
      ]} />
      <Section title={`Needs attention (${t.flagged} ${t.flagged === 1 ? 'office' : 'offices'})`}>
        {data.flags.length === 0 ? <p className="text-sm text-ink2">Nothing flagged for this period.</p> : (
          <div className="flex flex-wrap gap-2">
            <Chip active={flag === 'all'} onClick={() => setFlag(flag === 'all' ? null : 'all')} label="All flagged" count={t.flagged} />
            {data.flags.map((f) => <Chip key={f.key} active={flag === f.key} tone={f.tone} onClick={() => setFlag(flag === f.key ? null : f.key)} label={f.label} count={f.count} />)}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {onCombineNow && (
              <button type="button" disabled={busy || pickedOffices.length < 2} onClick={combinePicked}
                className={`h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-opacity ${pickedOffices.length >= 2 ? 'shadow-md ring-2 ring-[color-mix(in_oklab,var(--series-1)_40%,transparent)]' : 'opacity-40'}`}>
                {busy ? 'Combining…' : pickedOffices.length >= 2 ? `Combine ${pickedOffices.length} selected into one view` : 'Combine selected'}
              </button>
            )}
            {picked.size > 0 && <button type="button" className="control text-sm" onClick={() => { setPicked(new Set()); setNote(null); }}>Clear</button>}
            {note ? <span className={`text-sm ${note.tone === 'bad' ? 'text-bad' : 'text-good'}`}>{note.text}{note.undoId && onSeparate && <> <button type="button" className="ml-1 font-medium text-accent underline" disabled={busy} onClick={() => separate(note.undoId, 'Undone: the combination was removed; the offices were never changed.')}>Undo</button></>}</span>
              : picked.size > 0 ? <span className="text-sm text-ink2">{picked.size} selected{picked.size < 2 ? ' · tick one more to combine' : ''}</span>
              : <span className="text-xs text-muted">{onCombineNow ? 'Tick two or more offices and press Combine. ' : ''}Sorted by {sortLabel}, {sort.dir < 0 ? 'highest' : 'lowest'} first{flag ? ` · ${rows.length} of ${data.offices.length} offices` : ''}.</span>}
          </div>
          <button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-ink2">
              <tr className="border-b border-[var(--line)]">
                <th scope="col" className="w-8 px-2 py-2"><input type="checkbox" aria-label="Select all offices" checked={rows.length > 0 && rows.every((o) => picked.has(o.key))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((o) => o.key)) : new Set())} /></th>
                {sortTh(sort, setSort, 'name', 'Office', 'text-left')}
                {sortTh(sort, setSort, 'netCollections', 'Net collections', 'text-right')}
                {sortTh(sort, setSort, 'ebitdaMargin', 'EBITDA margin', 'text-right')}
                {sortTh(sort, setSort, 'officeEbitda', 'Office EBITDA', 'text-right')}
                {sortTh(sort, setSort, 'cash', 'Cash', 'text-right')}
                {sortTh(sort, setSort, 'vsPrior', 'vs prior year', 'text-right bg-page')}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.key} className={`cursor-pointer border-b border-[var(--line)] hover:bg-page ${picked.has(o.key) ? 'bg-[color-mix(in_oklab,var(--series-1)_8%,var(--surface))]' : ''}`} onClick={() => onOpen(o.key)}>
                  <td className="px-2 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="mt-1" aria-label={`Select ${o.name}`} checked={picked.has(o.key)} onChange={() => pick(o.key)} />
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(o.key); }}>{o.name}</button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {o.companies.length > 1 && <Tag title={o.companies.map((c) => c.name).join(' + ')}>{o.companies.length} companies</Tag>}
                      {o.companies.length === 1 && o.companies[0].name !== o.name && <Tag>{o.companies[0].name}</Tag>}
                      {o.flags.map((f) => <Pill key={f.key} tone={f.tone}>{f.label}</Pill>)}
                      {o.lastActivity && o.lastActivity < data.asOf && <span className="text-[10px] uppercase tracking-wide text-muted">Books to {shortMonth(o.lastActivity)}</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right align-top">
                    <Money v={o.netCollections} />
                    <div className="ml-auto mt-1 h-0.5 rounded bg-[var(--series-3)]" style={{ width: `${Math.round((Math.abs(o.netCollections) / max) * 100)}%`, maxWidth: 96 }} aria-hidden="true" />
                  </td>
                  <td className="tabular px-2 py-2 text-right align-top">{pct1(o.ebitdaMargin)}</td>
                  <td className="px-2 py-2 text-right align-top"><Money v={o.officeEbitda} /></td>
                  <td className="px-2 py-2 text-right align-top"><Money v={o.cash} /></td>
                  <td className={`tabular bg-page px-2 py-2 text-right align-top ${o.vsPrior != null && o.vsPrior < 0 ? 'text-bad' : ''}`}>{signedPct(o.vsPrior)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {(combos.length > 0 || onCombineNow) && (
        <Section title={`Combined offices (${combos.length})`} subtitle="Views made by combining offices. The offices above stay as they are and the totals above do not count these.">
          {combos.length === 0 ? <p className="text-sm text-ink2">None yet. Tick two or more offices above and press Combine.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs text-ink2"><tr className="border-b border-[var(--line)]"><th scope="col" className="px-2 py-2 text-left font-medium">Combined office</th><th scope="col" className="px-2 py-2 text-right font-medium">Net collections</th><th scope="col" className="px-2 py-2 text-right font-medium">EBITDA margin</th><th scope="col" className="px-2 py-2 text-right font-medium">Office EBITDA</th><th scope="col" className="px-2 py-2 text-right font-medium">Cash</th><th scope="col" className="px-2 py-2" /></tr></thead>
                <tbody>
                  {combos.map((o) => (
                    <tr key={o.key} className="cursor-pointer border-b border-[var(--line)] hover:bg-page" onClick={() => onOpen(o.key)}>
                      <td className="px-2 py-2">
                        <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(o.key); }}>{o.name}</button>
                        <div className="mt-1 flex flex-wrap gap-1"><Tag title={o.companies.map((c) => c.name).join(' + ')}>{o.companies.length} companies</Tag>{o.companies.slice(0, 6).map((c) => <Tag key={c.realmId}>{c.name}</Tag>)}{o.companies.length > 6 && <Tag>+{o.companies.length - 6} more</Tag>}</div>
                      </td>
                      <td className="px-2 py-2 text-right align-top"><Money v={o.netCollections} /></td>
                      <td className="tabular px-2 py-2 text-right align-top">{pct1(o.ebitdaMargin)}</td>
                      <td className="px-2 py-2 text-right align-top"><Money v={o.officeEbitda} /></td>
                      <td className="px-2 py-2 text-right align-top"><Money v={o.cash} /></td>
                      <td className="px-2 py-2 text-right align-top" onClick={(e) => e.stopPropagation()}>
                        <span className="flex justify-end gap-2">
                          {onCombine && <button type="button" className="control text-sm" onClick={() => onCombine({ id: o.id, name: o.name, city: o.city, state: o.state, companies: o.companies })}>Edit</button>}
                          {onSeparate && <button type="button" className="control text-sm text-bad" disabled={busy} onClick={() => separate(o.id, `"${o.name}" removed. The offices were never changed.`)}>Remove</button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      <SourceLine source={data.source} />
    </div>
  );
}

function Chip({ active, tone, label, count, onClick }) {
  const dot = { bad: 'var(--bad)', warn: 'var(--series-4)', info: 'var(--series-1)' }[tone] || 'var(--ink-2)';
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${active ? 'border-accent bg-[color-mix(in_oklab,var(--series-1)_12%,var(--surface))] font-medium' : 'border-[var(--line)] hover:bg-page'}`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden="true" />
      {label}
      <span className="rounded-full bg-page px-1.5 text-[10px] text-ink2">{count}</span>
    </button>
  );
}

// ---------- One office ----------

function OfficeDetail({ officeKey, q, reloadKey, periodSeg, onBack, canBack, onCombine, base = 'office-view' }) {
  const { data, loading, error } = useApi(() => api.officeDetail(officeKey, q, base), [officeKey, q.from, q.to, q.office, q.period, reloadKey, base]);
  const [cols, setCols] = useState(null); // null = the period total only; month | quarter | year adds those columns to both tables
  if (error) return <div className="grid gap-3">{canBack && <BackLink onBack={onBack} />}<ErrorBox title="Could not load this office" error={error} /></div>;
  if (!data) return <Loading />;
  const o = data.office;
  const b = data.badges;
  const show = (s) => !data.page || data.page.sections.includes(s); // config/offices*.json page.sections
  const columnsSeg = <Seg label="Columns" small value={cols || ''} options={COLUMN_OPTIONS} onChange={(v) => setCols(v === cols ? null : v)} />;
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      {canBack && <BackLink onBack={onBack} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{o.name}</h2>
            {o.combined && <Pill tone="info">Combined view</Pill>}
            {o.companies.map((c) => <Tag key={c.realmId} title={c.name}>{c.name}</Tag>)}
          </div>
          <p className="text-sm text-ink2">{data.period.label}{data.period.key !== 'month' ? ` (${monthLabel(data.period.from)} to ${monthLabel(data.period.to)})` : ` ${monthLabel(data.asOf)}`} · Balances as of {monthEndLabel(data.asOf)} · Accrual basis{o.companies.length > 1 ? ` · ${o.companies.length} companies read as one` : ''}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">{onCombine && <button type="button" className="control text-sm" onClick={() => onCombine({ id: o.id, name: o.name, city: o.city, state: o.state, companies: o.companies })}>{o.combined ? 'Edit combination' : 'Combine with…'}</button>}{columnsSeg}{periodSeg}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {b.balancesDiffer === 0 && b.balancesMatch > 0 ? <Pill tone="good">Totals tie ✓</Pill> : b.balancesMatch + b.balancesDiffer > 0 ? <Pill tone="warn" title="Ledger balances compared with the CurrentBalance QuickBooks returns on each account">{b.balancesDiffer} of {b.balancesMatch + b.balancesDiffer} balances differ</Pill> : null}
        <Tag>Last synced {ago(b.lastChange)}</Tag>
        <Tag>{b.errors ? `Pull failed for ${b.errors}` : b.pulled === o.companies.length ? 'Connected' : `${b.pulled} of ${o.companies.length} pulled`}</Tag>
        {o.lastActivity && <Tag>Books to {monthLabel(o.lastActivity)}</Tag>}
        {o.flags.map((f) => <Pill key={f.key} tone={f.tone}>{f.label}</Pill>)}
      </div>
      {!data.hasData ? <Empty title="No ledger data for this office in this range">Pick another date range, or run a sync.</Empty> : (
        <>
          {show('tiles') && <Tiles cols={6} items={[
            { label: 'Net collections', value: money(o.netCollections), sub: o.vsPrior == null ? 'No prior-year data' : `vs prior year ${signedPct(o.vsPrior)}`, subTone: o.vsPrior == null ? null : o.vsPrior >= 0 ? 'good' : 'bad' },
            { label: 'EBITDA before mgmt fees', value: money(o.ebitdaBeforeFees), bad: o.ebitdaBeforeFees < 0, sub: `Margin ${pct1(o.netCollections ? o.ebitdaBeforeFees / o.netCollections : null)}` },
            { label: 'Office EBITDA', value: money(o.officeEbitda), bad: o.officeEbitda < 0, sub: `Margin ${pct1(o.ebitdaMargin)}` },
            { label: 'Cash', value: money(o.cash), bad: o.cash < 0, sub: `As of ${monthLabel(data.asOf)} month-end` },
            { label: 'Accounts receivable', value: money(o.ar), sub: `As of ${monthLabel(data.asOf)} month-end` },
            { label: 'Accounts payable', value: money(o.ap), sub: `As of ${monthLabel(data.asOf)} month-end` },
          ]} />}
          {(show('statement') || (show('pl') && data.pl)) && (
            <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 ${!cols && show('statement') && show('pl') && data.pl ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
              {show('statement') && <Statement data={data} cols={cols} />}
              {show('pl') && data.pl && <CombinedPl data={data} cols={cols} />}
            </div>
          )}
          {(show('balanceSheet') || show('trends')) && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {show('balanceSheet') && <BalanceSheet data={data} />}
              {show('trends') && <Trends data={data} />}
            </div>
          )}
        </>
      )}
      <SourceLine source={data.source} />
    </div>
  );
}

const BackLink = ({ onBack }) => <button type="button" className="inline-flex w-fit items-center gap-1 text-sm text-accent hover:underline" onClick={onBack}>‹ Portfolio</button>;

const ROLE_STYLE = { feesSubtotal: 'subtotal', ebitda: 'subtotal', cashFlow: 'subtotal', collections: 'head', fees: 'plain' };

function Statement({ data, cols = null }) {
  const showMemo = data.page?.memo !== false; // config page.memo
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(false);
  const narrow = useNarrow();
  const buckets = narrow ? [] : bucketsOf(data.months, cols); // phones: the period column only
  const rows = data.statement.rows;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const isOpen = (k) => (all ? open[k] !== false : Boolean(open[k]));
  const priorLabel = data.period.key === 'month' ? monthLabel(data.period.priorTo) : `${monthLabel(data.period.priorFrom)} – ${monthLabel(data.period.priorTo)}`;
  const periodLabel = data.period.key === 'month' ? monthLabel(data.period.to) : data.period.label;
  const ip = data.statement.internalPeriod;
  const csvCols = bucketsOf(data.months, cols || 'month');
  const exportCsv = () => downloadCsv(`office-${data.office.key}-${data.asOf}.csv`, [
    ['Row', 'Account', ...csvCols.map((b) => b.label), `Period ${periodLabel}`, `Prior year ${priorLabel}`],
    ...rows.flatMap((r) => [[r.label, '', ...csvCols.map((b) => sumMonths(r.months, b)), r.period, r.prior], ...r.children.map((c) => ['', c.fullName, ...csvCols.map((b) => sumMonths(c.months, b)), c.period, c.prior])]),
    ...data.statement.memo.flatMap((r) => [[`Memo: ${r.label}`, '', ...csvCols.map((b) => sumMonths(r.months, b)), r.period, r.prior], ...r.children.map((c) => ['', c.fullName, ...csvCols.map((b) => sumMonths(c.months, b)), c.period, c.prior])]),
  ]);
  const cell = (v, bold) => <td className={`whitespace-nowrap px-2 py-1.5 text-right ${bold ? 'font-semibold' : ''}`}><Money v={v} bold={bold} /></td>;
  const line = (r, depth, key, expandable, sub, memoSign) => {
    const style = ROLE_STYLE[r.role] || (depth ? 'child' : 'plain');
    const bold = style === 'subtotal' || style === 'head';
    const cls = style === 'subtotal' ? 'bg-[color-mix(in_oklab,var(--series-3)_10%,var(--surface))] text-[color-mix(in_oklab,var(--series-3)_60%,var(--ink))]' : style === 'head' ? 'bg-page' : depth ? 'text-ink2' : '';
    return (
      <tr key={key} className={`border-t border-[var(--line)] ${cls}`}>
        <th scope="row" className={`sticky left-0 z-[1] whitespace-nowrap px-2 py-1.5 text-left font-normal ${style === 'subtotal' ? 'bg-[color-mix(in_oklab,var(--series-3)_10%,var(--surface))]' : style === 'head' ? 'bg-page' : 'bg-surface'}`} style={{ paddingLeft: 8 + depth * 18 }}>
          {expandable ? (
            <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen(key)} onClick={() => toggle(key)}>
              <Chevron open={isOpen(key)} /><span className={bold ? 'font-semibold' : ''}>{r.label}</span>
            </button>
          ) : <span className={`${bold ? 'font-semibold' : ''} ${depth ? 'text-xs' : ''}`} title={sub || undefined}>{r.label}{r.companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{r.companies}</span> : null}</span>}
          {memoSign != null && !depth && <span className="ml-2 text-[10px] text-muted">{memoSign > 0 ? 'income' : 'expense'}</span>}
        </th>
        {buckets.map((b) => <React.Fragment key={b.key}>{cell(sumMonths(r.months, b), bold)}</React.Fragment>)}
        <td className={`whitespace-nowrap bg-page px-2 py-1.5 text-right ${bold ? 'font-semibold' : ''}`}><Money v={r.period} bold={bold} /></td>
      </tr>
    );
  };
  const block = (r, prefix, memoSign) => {
    const expandable = r.children.length > 0;
    const out = [line(r, 0, `${prefix}${r.key}`, expandable, null, memoSign)];
    if (expandable && isOpen(`${prefix}${r.key}`)) for (const c of r.children) out.push(line({ label: c.account, months: c.months, period: c.period, prior: c.prior, role: 'child', companies: c.companies }, 1, `${prefix}${r.key}|${c.fullName}`, false, c.fullName));
    return out;
  };
  return (
    <Section title="Office statement" subtitle={`${monthLabel(data.months[0])} to ${monthLabel(data.months.at(-1))} · Accrual basis · Expand a row to see the QuickBooks accounts behind it${data.office.companies.length > 1 ? ', both companies merged by account' : ''}.`}
      right={<button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button>}>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full text-sm" style={{ minWidth: narrow ? 0 : 320 + buckets.length * 96 }}>
          <thead className="sticky top-0 z-[2] bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="sticky left-0 z-[3] bg-surface px-2 py-2 text-left font-medium">
                <span className="flex items-center gap-3">Account
                  <button type="button" className="rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={all} onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button>
                </span>
              </th>
              {buckets.map((b) => <th key={b.key} scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">{b.label}</th>)}
              <th scope="col" className="whitespace-nowrap bg-page px-2 py-2 text-right font-medium"><div>{data.period.key === 'month' ? 'Month' : data.period.label}</div><div className="font-normal text-muted">{periodLabel}</div></th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) => block(r, ''))}
            {showMemo && data.statement.memo.length > 0 && (
              <tr className="border-t border-[var(--line)]"><th scope="row" colSpan={buckets.length + 2} className="sticky left-0 bg-surface px-2 pb-1 pt-4 text-left text-[11px] font-medium uppercase tracking-wide text-muted">Not in the rows above</th></tr>
            )}
            {showMemo && data.statement.memo.flatMap((r) => block(r, 'memo:', r.sign))}
          </tbody>
        </table>
      </div>
      {!showMemo && data.statement.memo.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Not in the sheet, left out of this statement ({periodLabel}): {data.statement.memo.filter((m) => Math.abs(m.period) >= 0.5).map((m) => `${m.label.replace(/ \(.*\)$/, '')} ${money(m.period)}`).join(' · ')}.
        </p>
      )}
      {showMemo && (ip.expense > 0 || ip.income > 0) && (
        <p className="mt-3 text-xs text-muted">
          Internal charges between the companies of this office in the period: {money(ip.expense)} charged, {money(ip.income)} received, {money(ip.matched)} removed from both sides.
          {Math.abs(ip.expense - ip.income) > 0.5 && <> The difference stays in the figures and is listed under “Internal charges not matched”.</>} Rules: config/offices.json.
        </p>
      )}
    </Section>
  );
}

function BalanceSheet({ data }) {
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(false);
  const bs = data.balanceSheet;
  const isOpen = (k) => (all ? open[k] !== false : Boolean(open[k]));
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const exportCsv = () => {
    const out = [['Section', 'Account', `As of ${monthEndLabel(bs.asOf)}`, `As of ${monthEndLabel(bs.prior)}`]];
    const walk = (s, n, d) => { out.push([s, `${'  '.repeat(d)}${n.name}`, n.now, n.prior]); for (const c of n.children) walk(s, c, d + 1); };
    for (const s of bs.sections) { out.push([s.label, '', s.now, s.prior]); for (const g of s.groups) { out.push([s.label, g.label, g.now, g.prior]); for (const n of g.nodes) walk(s.label, n, 1); } }
    downloadCsv(`balance-sheet-${data.office.key}-${bs.asOf}.csv`, out);
  };
  const row = (key, label, now, prior, { depth = 0, bold = false, expandable = false, highlight = false, companies = 0 } = {}) => (
    <tr key={key} className={`border-t border-[var(--line)] ${highlight ? 'border-l-2 border-l-[var(--series-3)]' : ''} ${bold && depth === 0 ? 'bg-page' : ''}`}>
      <th scope="row" className={`px-2 py-1.5 text-left ${bold ? 'font-semibold' : 'font-normal'} ${highlight ? 'text-[color-mix(in_oklab,var(--series-3)_60%,var(--ink))]' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
        {expandable ? <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen(key)} onClick={() => toggle(key)}><Chevron open={isOpen(key)} />{label}</button> : label}
        {companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{companies}</span> : null}
      </th>
      <td className="whitespace-nowrap px-2 py-1.5 text-right"><Money v={now} bold={bold} /></td>
      <td className="whitespace-nowrap bg-page px-2 py-1.5 text-right"><Money v={prior} bold={bold} /></td>
    </tr>
  );
  const nodes = (list, prefix, depth) => list.flatMap((n) => {
    const key = `${prefix}|${n.fullName}`;
    const out = [row(key, n.name, n.now, n.prior, { depth, expandable: n.children.length > 0, companies: n.companies })];
    if (n.children.length && isOpen(key)) out.push(...nodes(n.children, key, depth + 1));
    return out;
  });
  const HIGHLIGHT = /^(Bank Accounts|Accounts Receivable|Accounts Payable)/;
  return (
    <Section title="Balance sheet" subtitle={`As of ${monthLabel(bs.asOf)} month-end. Highlighted rows feed the Cash, A/R and A/P figures.`}
      right={<div className="flex gap-2"><button type="button" className="control text-sm" onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button><button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button></div>}>
      {bs.sections.every((s) => !s.groups.length) ? <p className="py-6 text-center text-sm text-ink2">No balance sheet accounts in the ledger yet.</p> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="sticky top-0 z-[1] bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
              <tr><th scope="col" className="px-2 py-2 text-left font-medium">Account</th><th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium"><div>{monthEndLabel(bs.asOf)}</div><div className="font-normal text-muted">As of</div></th><th scope="col" className="whitespace-nowrap bg-page px-2 py-2 text-right font-medium"><div>{monthEndLabel(bs.prior)}</div><div className="font-normal text-muted">A year earlier</div></th></tr>
            </thead>
            <tbody>
              {bs.sections.flatMap((s) => [
                row(s.key, s.label, s.now, s.prior, { bold: true }),
                ...s.groups.flatMap((g) => {
                  const gk = `${s.key}|${g.label}`;
                  const single = g.nodes.length === 1 && !g.nodes[0].children.length;
                  if (single) return [row(gk, g.label, g.now, g.prior, { depth: 1, highlight: HIGHLIGHT.test(g.label), companies: g.nodes[0].companies })];
                  const out = [row(gk, g.label, g.now, g.prior, { depth: 1, expandable: g.nodes.length > 0, highlight: HIGHLIGHT.test(g.label) })];
                  if (g.nodes.length && isOpen(gk)) out.push(...nodes(g.nodes, gk, 2));
                  return out;
                }),
              ])}
              {(() => { const l = bs.sections.find((s) => s.key === 'liabilities'); const e = bs.sections.find((s) => s.key === 'equity'); return l && e ? row('total', 'Total Liabilities and Equity', l.now + e.now, l.prior + e.prior, { bold: true, highlight: true }) : null; })()}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------- Combined profit and loss (as booked) ----------

const PL_ORDER = [
  { type: 'Income' }, { type: 'Cost of Goods Sold' }, { subtotal: 'grossProfit', label: 'Gross Profit' },
  { type: 'Expense' }, { subtotal: 'netOperatingIncome', label: 'Net Operating Income' },
  { type: 'Other Income' }, { type: 'Other Expense' }, { subtotal: 'netOtherIncome', label: 'Net Other Income' },
  { subtotal: 'netIncome', label: 'Net Income', bold: true },
];

function CombinedPl({ data, cols: gran = null }) {
  const [view, setView] = useState('months');
  const [values, setValues] = useState('amount'); // amount | pct (% of income, as on the QuickBooks report)
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(true); // QuickBooks shows the report fully expanded
  const narrow = useNarrow();
  // Month columns folded into the chosen granularity (none = the total only); the Companies view keeps one column per company.
  const monthsView = useMemo(() => {
    const src = data.pl.months;
    const buckets = bucketsOf(src.buckets.map((b) => b.key), gran);
    const agg = (periods) => Object.fromEntries(buckets.map((b) => [b.key, sumMonths(periods, b)]));
    const node = (n) => ({ ...n, periods: agg(n.periods), own: agg(n.own), children: n.children.map(node) });
    return {
      ...src, buckets,
      types: src.types.map((t) => ({ ...t, periods: agg(t.periods), nodes: t.nodes.map(node) })),
      subtotals: Object.fromEntries(Object.entries(src.subtotals).map(([k, v]) => [k, { periods: agg(v.periods), total: v.total }])),
    };
  }, [data.pl, gran]);
  const pl = view === 'months' ? monthsView : data.pl.companies;
  const cols = narrow ? [] : pl.buckets;
  const colLabel = (b) => b.label;
  // Expand all / Collapse all folds or opens every section and account, except the Income section, which stays open.
  // A click on any row still toggles that row by hand.
  const isOpen = (k) => (k === 'type:Income' || all ? open[k] !== false : Boolean(open[k]));
  const toggle = (k, depth = 2) => setOpen((o) => ({ ...o, [k]: !isOpen(k, depth) }));
  const types = Object.fromEntries(pl.types.map((t) => [t.accountType, t]));
  const income = types.Income || { periods: {}, total: 0 };
  const show = (v, den) => (v == null ? '–' : values === 'pct' ? (den ? pct1(v / den) : '–') : money(v));
  const totalLabel = data.period.key === 'month' && view === 'months' ? `${monthLabel(data.months[0])} – ${monthLabel(data.months.at(-1))}` : `${monthLabel(data.months[0])} – ${monthLabel(data.months.at(-1))}`;
  const cell = (v, bold, den, blank) => <td className={`tabular whitespace-nowrap px-2 py-1.5 text-right ${v < 0 ? 'text-bad' : ''} ${!v ? 'text-muted' : ''} ${bold ? 'font-semibold' : ''}`}>{blank ? '' : show(v, den)}</td>;
  const line = (key, label, periods, total, { depth = 0, bold = false, expandable = false, isOpen = false, style = 'plain', companies = 0, blank = false, level = depth } = {}) => (
    <tr key={key} className={`border-t border-[var(--line)] ${style === 'subtotal' ? 'bg-[color-mix(in_oklab,var(--good)_8%,var(--surface))]' : style === 'head' ? 'bg-page' : style === 'total' ? 'bg-[color-mix(in_oklab,var(--ink)_3%,var(--surface))]' : ''}`}>
      <th scope="row" className={`sticky left-0 z-[1] whitespace-nowrap px-2 py-1.5 text-left ${bold ? 'font-semibold' : 'font-normal'} ${style === 'subtotal' ? 'bg-[color-mix(in_oklab,var(--good)_8%,var(--surface))] text-good' : style === 'head' ? 'bg-page' : 'bg-surface'}`} style={{ paddingLeft: 8 + depth * 16 }}>
        {expandable ? (
          <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen} onClick={() => toggle(key, level)}>
            <Chevron open={isOpen} />{label}{companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{companies}</span> : null}
          </button>
        ) : <span className="inline-flex items-center gap-1"><span className="w-[14px] shrink-0" aria-hidden="true" />{label}{companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{companies}</span> : null}</span>}
      </th>
      {cols.map((b) => <React.Fragment key={b.key}>{cell(periods[b.key], bold, income.periods[b.key], blank)}</React.Fragment>)}
      <td className={`tabular whitespace-nowrap bg-page px-2 py-1.5 text-right ${total < 0 ? 'text-bad' : ''} ${bold || style === 'subtotal' ? 'font-semibold' : 'font-medium'} ${style === 'subtotal' ? 'text-good' : ''}`}>{blank ? '' : show(total, income.total)}</td>
    </tr>
  );
  const node = (n, depth, prefix) => {
    const k = `${prefix}${n.key}`;
    const expandable = n.children.length > 0;
    if (!expandable || !isOpen(k, depth)) return [line(k, n.name, n.periods, n.total, { depth, expandable, isOpen: false, companies: n.companies })];
    const hasOwn = Math.abs(n.ownTotal) >= 0.005 || Object.values(n.own).some((v) => v);
    const out = [line(k, n.name, n.own, n.ownTotal, { depth, expandable, isOpen: true, companies: n.companies, blank: !hasOwn })];
    for (const c of n.children) out.push(...node(c, depth + 1, `${k}/`));
    out.push(line(`${k}:total`, `Total for ${n.name}`, n.periods, n.total, { depth, bold: true, style: 'total' }));
    return out;
  };
  const rows = [];
  for (const item of PL_ORDER) {
    if (item.type) {
      const t = types[item.type];
      if (!t || !t.nodes.length) continue;
      const k = `type:${item.type}`;
      if (isOpen(k, 0)) {
        rows.push(line(k, t.label, t.periods, t.total, { bold: true, expandable: true, isOpen: true, style: 'head', blank: true, level: 0 }));
        for (const n of t.nodes) rows.push(...node(n, 1, `${k}/`));
        rows.push(line(`${k}:total`, `Total ${t.label}`, t.periods, t.total, { bold: true, style: 'total' }));
      } else rows.push(line(k, t.label, t.periods, t.total, { bold: true, expandable: true, isOpen: false, style: 'head', level: 0 }));
    } else {
      const s = pl.subtotals[item.subtotal];
      rows.push(line(`sub:${item.subtotal}`, item.label, s.periods, s.total, { bold: true, style: 'subtotal' }));
    }
  }
  const exportCsv = () => {
    const flat = [];
    const walk = (n, depth) => { flat.push([`${'  '.repeat(depth)}${n.name}`, ...pl.buckets.map((b) => n.periods[b.key]), n.total]); for (const c of n.children) walk(c, depth + 1); };
    for (const item of PL_ORDER) {
      if (item.type) { const t = types[item.type]; if (!t) continue; flat.push([t.label, ...pl.buckets.map((b) => t.periods[b.key]), t.total]); for (const n of t.nodes) walk(n, 1); }
      else { const s = pl.subtotals[item.subtotal]; flat.push([item.label, ...pl.buckets.map((b) => s.periods[b.key]), s.total]); }
    }
    downloadCsv(`office-${data.office.key}-pl-${view}-${data.asOf}.csv`, [['Account', ...pl.buckets.map(colLabel), 'Total'], ...flat]);
  };
  return (
    <Section title="Combined profit and loss"
      subtitle={`${data.office.companies.length > 1 ? `${data.office.companies.map((c) => c.name).join(' + ')} as one. ` : ''}Accounts merged by section, type and account name; sub-accounts merge only under the same parent. As booked in QuickBooks (internal charges not removed, payroll taxes not split). Accrual basis.`}
      right={<div className="flex flex-wrap items-end gap-2"><Seg small value={view} onChange={setView} options={[['months', 'Months'], ['companies', 'Companies']]} /><Seg small value={values} onChange={setValues} options={[['amount', 'Amounts'], ['pct', '% of income']]} /><button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button></div>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: narrow ? 0 : 300 + cols.length * 96 }}>
          <thead className="text-xs text-ink2">
            <tr className="border-b border-[var(--line)]">
              <th scope="col" className="sticky left-0 z-[3] bg-surface px-2 py-2 text-left font-medium">
                <span className="flex items-center gap-3">Account
                  <button type="button" className="rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={all} onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button>
                </span>
              </th>
              {cols.map((b) => <th key={b.key} scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium" title={b.label}>{colLabel(b)}</th>)}
              <th scope="col" className="whitespace-nowrap bg-page px-2 py-2 text-right font-medium"><div>Total</div><div className="font-normal text-muted">{totalLabel}</div></th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{pl.accountCount} accounts. The office statement above removes internal charges and splits payroll taxes; this table does not, so every line ties to QuickBooks.</p>
    </Section>
  );
}

function Trends({ data }) {
  const rows = data.trend.map((t) => ({ label: shortMonth(t.month), ...t }));
  const chart = (title, key, kind, color) => (
    <div>
      <div className="mb-1 text-xs font-medium text-ink2">{title}</div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'line' ? (
            <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={24} />
              <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={52} />
              <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<ChartTip rows={(p) => [[title, money(p[key]), color]]} />} />
              <Line dataKey={key} stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={24} />
              <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={52} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [[title, money(p[key]), color]]} />} />
              <Bar dataKey={key} maxBarSize={16} isAnimationActive={false}>{rows.map((r) => <Cell key={r.month} fill={r[key] < 0 ? NEG : color} />)}</Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <Section title="Trends" subtitle={`Last ${data.trend.length} months.`}>
      <div className="grid gap-4">
        {chart('Net collections by month', 'netCollections', 'bar', 'var(--series-3)')}
        {chart('Office EBITDA by month', 'officeEbitda', 'bar', 'var(--ink-2)')}
        {chart('Cash at month-end', 'cash', 'line', POS)}
        {data.trend.some((t) => t.revenue != null) && chart('Revenue by month (as booked, both companies)', 'revenue', 'line', 'var(--series-1)')}
        {data.trend.some((t) => t.netIncome != null) && chart('Net income by month (as booked, both companies)', 'netIncome', 'bar', 'var(--series-1)')}
      </div>
    </Section>
  );
}
