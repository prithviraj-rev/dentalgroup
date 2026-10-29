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
const VALUE_OPTIONS = [['amount', 'Amounts'], ['pct', '%'], ['both', 'Both']]; // amounts | % of collections (income) | both in one cell
const basisLabel = (d) => (d?.basis === 'cash' ? 'Cash basis' : 'Accrual basis');
const Money = ({ v, bold }) => <span className={`tabular ${bold ? 'font-semibold' : ''}`}>{v == null ? '–' : money(v)}</span>;

export default function Offices({ filters, officeParam, singleOffice, reloadKey, base = 'office-view', controls = null, customRange = null }) {
  const [period, setPeriod] = useState(null);
  const [selected, setSelected] = useState(null);
  const [edits, setEdits] = useState(0); // bumps after an office is saved or removed
  const [combine, setCombine] = useState(null); // null | { office?: current office to edit }
  const [compareKeys, setCompareKeys] = useState(null); // office keys picked for the Compare view
  const headerPeriod = filters.period || null; // dashboard.periodPicker = buttons: the header holds the period
  const q = { from: filters.from, to: filters.to, office: officeParam, ...(headerPeriod || period ? { period: headerPeriod || period } : {}), ...(filters.basis ? { basis: filters.basis } : {}) };
  const { data, loading, error } = useApi(() => api.officeView(q, base), [filters.from, filters.to, officeParam, headerPeriod, period, filters.basis, reloadKey, edits, base]);
  const setup = useApi(() => api.officeSetup(base), [reloadKey, edits, base]);
  const canManage = setup.data?.canManage === true;
  // A single company picked in the header opens its office straight away.
  useEffect(() => { if (singleOffice && data?.offices?.length === 1) setSelected(data.offices[0].key); }, [singleOffice, data]);
  useEffect(() => { if (!singleOffice) setSelected(null); setCompareKeys(null); }, [officeParam, singleOffice]);
  if (error) return <ErrorBox title="Could not load the offices" error={error} />;
  if (!data) return <Loading />;
  const periodSeg = headerPeriod ? null : <Seg small value={data.period.key} onChange={setPeriod} options={data.period.options} />;
  const panel = combine && setup.data && (
    <CombinePanel setup={setup.data} base={base} initial={combine.office || null} onClose={() => setCombine(null)}
      onSaved={(res) => { setCombine(null); setEdits((n) => n + 1); if (res?.key) setSelected(res.key); else if (!singleOffice) setSelected(null); }} />
  );
  const combineNow = async (offices) => {
    const places = offices.map((o) => o.city || o.name);
    const name = `Combined: ${places.slice(0, 3).join(', ')}${places.length > 3 ? ` +${places.length - 3}` : ''}`;
    const res = await api.officeSave({ id: null, name, city: null, state: null, companies: [...new Set(offices.flatMap((o) => o.companies.map((c) => c.realmId)))] }, base);
    setEdits((n) => n + 1);
    setCompareKeys(null);
    if (res?.key) setSelected(res.key); // open the combined office straight away
    return res;
  };
  const separateNow = async (id) => { await api.officeDelete(id, base); setEdits((n) => n + 1); };
  // The companies ticked in the popup of a Compare / combined view (VJ 2026-10-29: "show what is selected"): one office opens on
  // its own, several are compared (from Compare) or combined into a new view (from a combined view; needs the manage right).
  const openView = (ids, mode) => {
    const offs = data.offices.filter((o) => o.companies.some((c) => ids.includes(c.realmId)));
    if (!offs.length) return;
    if (offs.length === 1) { setCompareKeys(null); setSelected(offs[0].key); return; }
    if (mode === 'combine' && canManage) { combineNow(offs); return; }
    setSelected(null); setCompareKeys(offs.map((o) => o.key));
  };
  if (compareKeys) return <>{panel}<Compare keys={compareKeys} q={q} base={base} reloadKey={reloadKey + edits} periodSeg={periodSeg} controls={controls} customRange={customRange} onBack={() => setCompareKeys(null)} onPick={(ids) => openView(ids, 'compare')} /></>;
  if (selected) {
    return (
      <>
        {panel}
        <OfficeDetail officeKey={selected} q={q} base={base} reloadKey={reloadKey + edits} periodSeg={periodSeg} controls={controls} customRange={customRange} onBack={() => setSelected(null)} canBack={!singleOffice || data.offices.length !== 1}
          onCombine={canManage ? (office) => setCombine({ office }) : null} onPick={(ids) => openView(ids, 'combine')} />
      </>
    );
  }
  return <>{panel}<Portfolio data={data} loading={loading} periodSeg={periodSeg} onOpen={setSelected} onCombine={canManage ? (office) => setCombine({ office: office || null }) : null} onCombineNow={canManage ? combineNow : null} onSeparate={canManage ? separateNow : null} onCompare={setCompareKeys} controls={controls} /></>;
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
            <button type="button" className="h-8 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !picked.length} onClick={save}>{form.id ? 'Save changes' : 'Save office'}</button>
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

// Columns of the office list: config/offices*.json page.portfolio.columns, else these.
const DEFAULT_COLUMNS = [
  { key: 'netCollections', label: 'Net collections' }, { key: 'ebitdaMargin', label: 'EBITDA margin' },
  { key: 'officeEbitda', label: 'Office EBITDA' }, { key: 'cash', label: 'Cash' }, { key: 'vsPrior', label: 'vs prior year' },
];
const PCT_COLS = { ebitdaMargin: pct1, vsPrior: signedPct };
const valueOf = (o, key) => (o.values && key in o.values ? o.values[key] : o[key]);
const SORT_LABEL = { name: 'office name', netCollections: 'net collections', ebitdaMargin: 'EBITDA margin', officeEbitda: 'office EBITDA', cash: 'cash', vsPrior: 'change vs prior year' };
const ValueCell = ({ col, v, bold }) => (
  <td className={`whitespace-nowrap px-2 py-2 text-right align-top tabular ${col.key === 'vsPrior' ? 'bg-page' : ''} ${bold ? 'font-semibold' : ''}`}>
    {PCT_COLS[col.key] ? PCT_COLS[col.key](v) : <Money v={v} bold={bold} />}
  </td>
);
/** Sum of a column over offices; the two ratio columns are recomputed from the sums. */
const subtotalOf = (list, columns) => Object.fromEntries(columns.map((c) => {
  if (c.key === 'ebitdaMargin') { const n = list.reduce((t, o) => t + (o.netCollections || 0), 0); return [c.key, n ? list.reduce((t, o) => t + (o.officeEbitda || 0), 0) / n : null]; }
  if (c.key === 'vsPrior') { const p = list.reduce((t, o) => t + (o.priorNetCollections || 0), 0); return [c.key, p > 0 ? list.reduce((t, o) => t + (o.netCollections || 0), 0) / p - 1 : null]; }
  return [c.key, list.reduce((t, o) => t + (valueOf(o, c.key) || 0), 0)];
}));

function Portfolio({ data, loading, periodSeg, onOpen, onCombine, onCombineNow, onSeparate, onCompare, controls = null }) {
  const [flag, setFlag] = useState(null);
  const [sort, setSort] = useState({ col: 'netCollections', dir: -1 });
  const [picked, setPicked] = useState(() => new Set());
  const pick = (key) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const pickedOffices = data.offices.filter((o) => picked.has(o.key));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone, text } after a combine
  const [collapsed, setCollapsed] = useState(() => new Set()); // bucket keys folded to their header + totals
  const toggleGroup = (key) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const pg = data.page?.portfolio || {}; // config/offices*.json page.portfolio
  const showFlags = pg.flags !== false;
  const showTags = pg.tags !== false;
  const columns = pg.columns || DEFAULT_COLUMNS;
  const buckets = data.buckets || null; // [{ key, label }] in fixed order, or null = one flat list
  const rows = useMemo(() => {
    const list = flag === 'all' ? data.offices.filter((o) => o.flags.length) : flag ? data.offices.filter((o) => o.flags.some((f) => f.key === flag)) : data.offices;
    return [...list].sort(sorter(sort, (r, c) => (c === 'name' ? r.name : valueOf(r, c))));
  }, [data.offices, flag, sort]);
  const groups = useMemo(() => (buckets ? buckets.map((b) => ({ ...b, rows: rows.filter((o) => o.bucket === b.key) })) : [{ key: null, label: null, rows }]), [buckets, rows]);
  const oneBucket = !buckets || new Set(pickedOffices.map((o) => o.bucket)).size <= 1;
  const combinePicked = async () => {
    if (pickedOffices.length < 2 || !onCombineNow || !oneBucket) return;
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
  const ready = pickedOffices.length >= 2 && oneBucket;
  const actionCls = `h-8 rounded-lg px-3 text-xs font-medium transition-colors ${ready ? 'bg-accent text-white shadow-sm' : 'control opacity-50'}`;
  const allTotal = subtotalOf(rows, columns); // "All companies" line at the top of the list
  // Column names on every open group header, sortable like the main header (same sort for the whole list); a group may
  // name a column differently (bucket columns, VJ 2026-10-29: "Revenue" outside the dental practices).
  const groupTh = (c, g) => (
    <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-1 text-right text-[11px] font-medium uppercase tracking-wide text-ink2" aria-sort={sort.col === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="inline-flex items-center gap-0.5 hover:text-ink" onClick={() => setSort((x) => ({ col: c.key, dir: x.col === c.key ? -x.dir : -1 }))}>
        {g?.columns?.[c.key] || c.label}
        <span className={`ml-0.5 text-[9px] ${sort.col === c.key ? 'text-ink' : 'text-muted opacity-40'}`} aria-hidden="true">{sort.col === c.key && sort.dir > 0 ? '▲' : '▼'}</span>
      </button>
    </th>
  );
  const max = Math.max(1, ...data.offices.map((o) => Math.abs(o.netCollections)));
  const t = data.totals;
  const sortLabel = SORT_LABEL[sort.col] || columns.find((c) => c.key === sort.col)?.label?.toLowerCase() || sort.col;
  const exportCsv = () => downloadCsv(`offices-${data.asOf}.csv`, [['Group', pg.label || 'Office', 'City', 'State', 'Companies', ...columns.map((c) => c.label), 'Flags'],
    ...groups.flatMap((g) => g.rows.map((o) => [g.label || '', o.name, o.city, o.state, o.companies.map((c) => c.name).join(' + '), ...columns.map((c) => valueOf(o, c.key)), o.flags.map((f) => f.label).join('; ')]))]);
  const periodLine = `${data.period.label}${data.period.key !== 'month' ? ` (${monthLabel(data.period.from)} to ${monthLabel(data.period.to)})` : ` ${monthLabel(data.asOf)}`} · Balances as of ${monthEndLabel(data.asOf)} · ${basisLabel(data)}${data.to && data.to !== data.asOf ? ` · ${monthLabel(data.to)} is not finished, so figures are as of ${monthLabel(data.asOf)}` : ''}`;
  if (!data.hasData) return <Empty title="No office data for this selection">Offices are built from the raw QuickBooks records of each dental company and its sub-DSO (config/offices.json). They appear after the next sync.{onCombine && <div className="mt-3"><button type="button" className="control text-sm" onClick={() => onCombine(null)}>Combine companies</button></div>}</Empty>;
  const officeRow = (o) => (
    <tr key={o.key} className={`cursor-pointer border-b border-[var(--line)] hover:bg-page ${picked.has(o.key) ? 'bg-[color-mix(in_oklab,var(--series-1)_8%,var(--surface))]' : ''}`} onClick={() => onOpen(o.key)}>
      <td className="px-2 py-0.5 align-middle" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="block" aria-label={`Select ${o.name}`} checked={picked.has(o.key)} onChange={() => pick(o.key)} />
      </td>
      <td className="px-2 py-0.5 leading-5">
        <button type="button" className="text-left font-medium hover:underline" title={o.companies.length > 1 ? o.companies.map((c) => c.name).join(' + ') : o.companies[0]?.name !== o.name ? o.companies[0]?.name : undefined} onClick={(e) => { e.stopPropagation(); onOpen(o.key); }}>{o.name}</button>
        {o.note && <span className="ml-1.5 text-[10px] text-muted">{o.note}</span>}
        {(showTags || showFlags) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {showTags && o.companies.length > 1 && <Tag title={o.companies.map((c) => c.name).join(' + ')}>{o.companies.length} companies</Tag>}
            {showTags && o.companies.length === 1 && o.companies[0].name !== o.name && <Tag>{o.companies[0].name}</Tag>}
            {showFlags && o.flags.map((f) => <Pill key={f.key} tone={f.tone}>{f.label}</Pill>)}
            {showTags && o.lastActivity && o.lastActivity < data.asOf && <span className="text-[10px] uppercase tracking-wide text-muted">Books to {shortMonth(o.lastActivity)}</span>}
          </div>
        )}
      </td>
      {columns.map((c) => c.key === 'netCollections' ? (
        <td key={c.key} className="px-2 py-0.5 text-right align-middle leading-5">
          <span className="inline-flex items-center justify-end gap-1.5"><span className="inline-block h-1 rounded bg-[var(--series-3)]" style={{ width: Math.round((Math.abs(o.netCollections) / max) * 40) }} aria-hidden="true" /><Money v={valueOf(o, c.key)} /></span>
        </td>
      ) : <ValueCell key={c.key} col={c} v={valueOf(o, c.key)} />)}
    </tr>
  );
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      {pg.summary !== false && <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Portfolio</h2>
          <p className="text-sm text-ink2">{periodLine}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">{onCombine && <button type="button" className="control text-sm" onClick={() => onCombine(null)}>Combine companies</button>}{periodSeg}</div>
      </div>
      <Tiles cols={4} items={[
        { label: 'Net collections', value: money(t.netCollections), sub: t.vsPrior == null ? 'No prior-year data' : `${signedPct(t.vsPrior)} vs prior year`, subTone: t.vsPrior == null ? null : t.vsPrior >= 0 ? 'good' : 'bad' },
        { label: 'Office EBITDA', value: money(t.officeEbitda), bad: t.officeEbitda < 0, sub: `EBITDA margin ${pct1(t.ebitdaMargin)}` },
        { label: 'Cash', value: money(t.cash), sub: `As of ${monthEndLabel(data.asOf)}` },
        { label: 'Receivables', value: money(t.ar), sub: `As of ${monthEndLabel(data.asOf)}` },
      ]} />
      </>}
      <Section title={showFlags ? `Needs attention (${t.flagged} ${t.flagged === 1 ? 'office' : 'offices'})` : (pg.label || 'Offices')}
        left={pg.summary === false && !showFlags ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><h2 className="text-sm font-medium">{pg.label || 'Offices'}</h2><span className="text-xs text-muted">{periodLine}</span></div> : undefined}
        right={pg.summary === false ? periodSeg : undefined}>
        {showFlags && (data.flags.length === 0 ? <p className="text-sm text-ink2">Nothing flagged for this period.</p> : (
          <div className="flex flex-wrap gap-2">
            <Chip active={flag === 'all'} onClick={() => setFlag(flag === 'all' ? null : 'all')} label="All flagged" count={t.flagged} />
            {data.flags.map((f) => <Chip key={f.key} active={flag === f.key} tone={f.tone} onClick={() => setFlag(flag === f.key ? null : f.key)} label={f.label} count={f.count} />)}
          </div>
        ))}
        {/* One bar: Combine and Compare (same style, both light up together once two companies of one group are ticked), then the
            page controls (period, companies, basis, sync) when officesSheet.controls = inline, Export CSV at the right. */}
        {/* VJ 2026-10-28: Combine | Compare | Collapse all | Select companies on the left, Accrual / Cash in the middle, the period at the right. */}
        <div className={showFlags ? 'mt-4' : ''}>
          <Toolbar
            left={<>
              {onCombineNow && (
                <button type="button" disabled={busy || !ready} onClick={combinePicked} className={actionCls}>
                  {busy ? 'Combining…' : ready ? `Combine ${pickedOffices.length} selected` : 'Combine selected'}
                </button>
              )}
              {onCompare && (
                <button type="button" disabled={!ready} onClick={() => onCompare(pickedOffices.map((o) => o.key))} className={actionCls}>
                  {ready ? `Compare ${pickedOffices.length} selected` : 'Compare selected'}
                </button>
              )}
              {picked.size > 0 && <button type="button" className="control h-8 text-xs" onClick={() => { setPicked(new Set()); setNote(null); }}>Unselect all</button>}
              {buckets && <button type="button" className="control h-8 text-xs" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(buckets.map((b) => b.key)))}>{collapsed.size ? 'Expand all' : 'Collapse all'}</button>}
              {controls && controls({ period: false, basis: false })}
              {note ? <span className={`text-xs ${note.tone === 'bad' ? 'text-bad' : 'text-good'}`}>{note.text}{note.undoId && onSeparate && <> <button type="button" className="ml-1 font-medium text-accent underline" disabled={busy} onClick={() => separate(note.undoId, 'Undone: the combination was removed; the offices were never changed.')}>Undo</button></>}</span>
                : null}
            </>}
            center={controls ? controls({ period: false, companies: false, sync: false }) : null}
            right={<>{controls && controls({ companies: false, basis: false, sync: false })}<button type="button" className="control h-8 text-xs" onClick={exportCsv}>Export CSV</button></>} />
        </div>
        <div className="mt-1 overflow-x-auto lg:overflow-visible">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-xs text-ink2">
              <tr className="border-b border-[var(--line)] [&>th]:sticky [&>th]:top-[var(--hdr,0px)] [&>th]:z-[2] [&>th]:bg-surface [&>th]:shadow-[0_1px_0_var(--line)]">
                <th scope="col" className="w-8 px-2 py-2" />
                {sortTh(sort, setSort, 'name', pg.nameColumn || (pg.label && pg.label !== 'Offices' ? pg.label : 'Office'), 'text-left')}
                {columns.map((c) => sortTh(sort, setSort, c.key, c.label, `text-right${c.key === 'vsPrior' ? ' bg-page' : ''}`))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 1 && (
                <tr className="border-b-2 border-[var(--line)] bg-[color-mix(in_oklab,var(--ink)_5%,var(--surface))]">
                  <td />
                  <td className="px-2 py-1 text-xs font-semibold">All companies <span className="font-normal text-muted">({rows.length})</span></td>
                  {columns.map((c) => <ValueCell key={c.key} col={c} v={allTotal[c.key]} bold />)}
                </tr>
              )}
              {groups.map((g) => {
                if (!buckets) return g.rows.map(officeRow);
                const all = g.rows.length > 0 && g.rows.every((o) => picked.has(o.key));
                const sub = subtotalOf(g.rows, columns);
                const open = !collapsed.has(g.key);
                return (
                  <React.Fragment key={g.key}>
                    {/* Group header: highlighted, click to fold the companies away (the totals then sit on this row). */}
                    <tr className="cursor-pointer border-y border-[color-mix(in_oklab,var(--series-1)_35%,var(--line))] bg-[color-mix(in_oklab,var(--series-1)_14%,var(--surface))] hover:bg-[color-mix(in_oklab,var(--series-1)_20%,var(--surface))]" onClick={() => toggleGroup(g.key)}>
                      <td className="px-2 py-1 align-middle" onClick={(e) => e.stopPropagation()}>{g.rows.length > 0 && <input type="checkbox" className="block" aria-label={`Select every company in ${g.label}`} checked={all} onChange={(e) => setPicked((p) => { const n = new Set(p); for (const o of g.rows) { if (e.target.checked) n.add(o.key); else n.delete(o.key); } return n; })} />}</td>
                      <th scope="rowgroup" className="px-2 py-1 text-left text-[13px] font-semibold">
                        <button type="button" className="inline-flex items-center gap-1.5 text-left" aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggleGroup(g.key); }}>
                          <Chevron open={open} />{g.label} <span className="font-normal text-muted">({g.rows.length})</span>{!open && g.rows.length > 0 && <span className="ml-2 text-xs font-normal text-muted">total</span>}
                        </button>
                      </th>
                      {/* Open: the column names repeat on every group header (VJ); folded: the group totals sit here. */}
                      {open ? columns.map((c) => groupTh(c, g)) : columns.map((c) => <ValueCell key={c.key} col={c} v={g.rows.length ? sub[c.key] : null} bold />)}
                    </tr>
                    {open && (g.rows.length === 0 ? <tr className="border-b border-[var(--line)]"><td /><td colSpan={columns.length + 1} className="px-2 py-2 text-xs text-muted">No companies in this group yet.</td></tr> : g.rows.map(officeRow))}
                    {open && g.rows.length > 0 && (
                      <tr className="border-b-2 border-[var(--line)] bg-page">
                        <td />
                        <td className="px-2 py-0.5 text-xs font-semibold">{g.label} total</td>
                        {columns.map((c) => <ValueCell key={c.key} col={c} v={sub[c.key]} bold />)}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {pg.combinedList !== false && (combos.length > 0 || onCombineNow) && (
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

// ---------- Compare: the statement rows side by side, one column per office, all selected first ----------

function Compare({ keys, q, base, periodSeg, onBack, reloadKey, controls = null, customRange = null, onPick = null }) {
  // Each table has its own period (VJ: compare the statement over one period and the P&L over another). The header's
  // months stay the anchor; Custom uses the header From / To. The P&L refetches only when its period differs.
  // A period per table (VJ: the two reports are read at different intervals): the statement follows p1, the P&L p2;
  // the P&L refetches only when they differ.
  const [p1, setP1] = useState(q.period || null);
  const [p2, setP2] = useState(q.period || null);
  const qFor = (p) => (p === 'custom' && customRange ? { ...q, period: 'custom', from: customRange.from, to: customRange.to } : { ...q, ...(p ? { period: p } : {}) });
  const customKey = (p) => (p === 'custom' && customRange ? `${customRange.from}..${customRange.to}` : ''); // refetch when the Custom dates move
  const k = keys.join(',');
  const { data, loading, error } = useApi(() => api.officeCompare({ ...qFor(p1), keys: k }, base), [k, q.from, q.to, q.office, q.basis, p1, customKey(p1), reloadKey, base]);
  const r2 = useApi(() => (p2 === p1 ? Promise.resolve(null) : api.officeCompare({ ...qFor(p2), keys: k }, base)), [k, q.from, q.to, q.office, q.basis, p1, p2, customKey(p1), customKey(p2), reloadKey, base]);
  const data2 = p2 === p1 ? data : r2.data;
  const [values, setValues] = useState('amount'); // the statement's Amounts | % | Both; the P&L has its own // amount | pct (% of collections) | both (VJ: everything on one screen first, % on demand)
  const [freeze, setFreeze] = useState(true); // keep the "All N selected" column in view while scrolling sideways
  const narrow = useNarrow();
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(false);
  const [focus, setFocus] = useState(null); // office key whose column is highlighted in both tables (click a column header)
  if (error) return <div className="grid gap-3"><BackLink onBack={onBack} /><ErrorBox title="Could not compare these offices" error={error} /></div>;
  if (!data) return <Loading />;
  const n = data.offices.length;
  const cols = [{ key: '__all', name: 'Grand total', values: data.consolidated.values, accounts: data.consolidated.accounts }, ...data.offices];
  const titles = data.page?.titles || {}; // config page.titles (VJ: "Synopsis P&L" / "Detailed P&L")
  // VJ 2026-10-29: name what is compared; the companies popup opens with these ticked and Done opens the new set.
  // VJ 2026-10-29: only the count ("Compared 9 companies"); the names are in the tooltip and in the companies popup.
  const companiesNote = <span className="toolbar-note" title={data.offices.map((o) => o.name).join(', ')}>Compared {n} {n === 1 ? 'company' : 'companies'}</span>;
  const viewPick = onPick ? { ids: data.offices.flatMap((o) => o.companies.map((c) => c.realmId)), onApply: onPick, hint: 'Done compares the ticked companies (one company opens on its own).' } : undefined;
  const companiesCtl = controls && controls({ period: false, basis: false, sync: false, view: viewPick });
  const ck = data.collectionsKey;
  const pctOf = (c, v) => { const b = ck ? c.values[ck] : 0; return b > 0 && v != null ? v / b : null; }; // the collections row itself shows 100%
  const bold = (r) => ['feesSubtotal', 'ebitda', 'cashFlow'].includes(r.role);
  const frozen = freeze && !narrow;
  const two = values === 'both'; // amount and % of collections together in one cell per office (2026-10-29: no gap between them)
  // Frozen "Grand total" column: the row label is 200px wide, the amount cell 96px (160px with the % beside it): sticky offsets.
  const stickyCls = (i) => (frozen && i === 0 ? `sticky left-[200px] z-[1] ${two ? 'w-[160px] min-w-[160px]' : 'w-[96px] min-w-[96px]'}` : '');
  const labelCls = 'sticky left-0 z-[1] w-[200px] min-w-[200px] max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap';
  /** Two header lines when the office has a short name: "Admire Dental" over "Branford", so more offices fit left to right. */
  const nameLines = (c) => (c.short && c.name.endsWith(c.short) && c.name.length > c.short.length ? [c.name.slice(0, -c.short.length).trim(), c.short] : [c.name]);
  const isOpen = (k) => (all ? open[k] !== false : Boolean(open[k]));
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !isOpen(k) }));
  const colCls = (c, i) => `${i === 0 ? 'bg-page' : ''} ${focus && focus !== c.key ? 'opacity-40' : ''} ${focus === c.key ? 'bg-[color-mix(in_oklab,var(--series-1)_12%,var(--surface))]' : ''}`;
  /** The cell of one office for one value: Amounts, %, or Both = the amount with the % right beside it (fixed 48px, so both stay aligned). */
  const cells = (c, i, v, p, { bold: b = false, small = false } = {}) => {
    const cls = `${colCls(c, i)} ${small ? 'text-[11px]' : ''}`;
    if (values === 'pct') return [<td key={c.key} className={`tabular whitespace-nowrap px-1.5 py-0.5 text-right align-top ${b ? 'font-semibold' : ''} ${cls} ${stickyCls(i)}`}>{p == null ? '–' : pct1(p)}</td>];
    const amount = v == null ? <span className="text-muted">–</span> : <Money v={v} bold={b} />;
    return [<td key={c.key} className={`whitespace-nowrap px-1.5 py-0.5 text-right align-top ${b ? 'font-semibold' : ''} ${cls} ${stickyCls(i)}`}>
      {two ? <span className="inline-grid grid-cols-[auto_48px] items-baseline gap-x-2"><span>{amount}</span><span className="tabular text-[11px] font-normal text-muted">{p == null ? '–' : pct1(p)}</span></span> : amount}
    </td>];
  };
  const exportCsv = () => downloadCsv(`compare-${data.asOf}.csv`, [
    ['Row', 'Account', ...cols.map((c) => c.name)],
    ...data.rows.flatMap((r) => [[r.label, '', ...cols.map((c) => c.values[r.key])], ...(cols[0].accounts[r.key] || []).map((a) => ['', a.fullName, ...cols.map((c) => (c.accounts[r.key] || []).find((x) => x.fullName === a.fullName)?.period ?? '')])]),
  ]);
  const rowCls = (r) => (bold(r) || r.role === 'collections' ? 'bg-page' : '');
  const body = data.rows.flatMap((r) => {
    const accounts = cols[0].accounts[r.key] || []; // the consolidated list = every account seen in any office
    const expandable = accounts.length > 0;
    const out = [(
      <tr key={r.key} className={`border-t border-[var(--line)] ${rowCls(r)}`}>
        <th scope="row" className={`${labelCls} px-2 py-0.5 text-left ${bold(r) ? 'font-semibold' : 'font-normal'} ${rowCls(r) || 'bg-surface'}`}>
          {expandable ? (
            <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen(r.key)} onClick={() => toggle(r.key)}>
              <Chevron open={isOpen(r.key)} /><span className={bold(r) || r.role === 'collections' ? 'font-semibold' : ''}>{r.label}</span>
            </button>
          ) : <span className={`inline-flex items-center gap-1 ${bold(r) ? 'font-semibold' : ''}`}><span className="w-[14px] shrink-0" aria-hidden="true" />{r.label}</span>}
        </th>
        {cols.map((c, i) => {
          const v = c.values[r.key]; const p = pctOf(c, v);
          return cells(c, i, v, p, { bold: bold(r) });
        })}
      </tr>
    )];
    if (expandable && isOpen(r.key)) for (const a of accounts) out.push(
      <tr key={`${r.key}|${a.fullName}`} className="border-t border-[var(--line)] text-ink2">
        <th scope="row" className={`${labelCls} bg-surface px-2 py-0.5 text-left text-[11px] font-normal`} style={{ paddingLeft: 26 }} title={a.fullName}>
          {a.account}{a.offices > 1 ? <span className="ml-1 text-[10px] text-muted">×{a.offices}</span> : null}
        </th>
        {cols.map((c, i) => {
          const hit = (c.accounts[r.key] || []).find((x) => x.fullName === a.fullName);
          const v = hit ? hit.period : null; const p = pctOf(c, v);
          return cells(c, i, v, p, { small: true });
        })}
      </tr>,
    );
    return out;
  });
  const head = (c, i) => {
    const lines = nameLines(c);
    const label = lines.length === 2 ? <><span className="block font-normal text-muted">{lines[0]}</span><span className="block">{lines[1]}</span></> : c.name;
    return (
      <th key={c.key} scope="col" className={`whitespace-nowrap px-1.5 py-1.5 text-right align-bottom font-medium ${colCls(c, i)} ${frozen && i === 0 ? 'sticky left-[200px] z-[3]' : ''}`} title={c.companies ? c.companies.map((x) => x.name).join(' + ') : undefined}>
        {i === 0 ? label : <button type="button" className="text-right hover:underline" aria-pressed={focus === c.key} onClick={() => setFocus(focus === c.key ? null : c.key)}>{label}</button>}
      </th>
    );
  };
  // VJ 2026-10-29: Compare and a combined view are the same report, Synopsis and Detailed the same table, and BOTH panels
  // carry the full control set (back, title, the period shown, what is compared, Select companies, the table's switches,
  // Accrual / Cash, its own period, Export CSV last), each bar sticky inside its card.
  const periodOf = (d) => (d.period.key === 'month' ? monthLabel(d.asOf) : `${monthLabel(d.period.from)} to ${monthLabel(d.period.to)}`);
  const bar = (title, d, p, setP) => (switches, exportBtn) => (
    <Toolbar sticky
      head={<><BackLink onBack={onBack} /><span className="toolbar-title">{title}</span><span className="toolbar-note">{periodOf(d)}</span>{companiesNote}</>}
      left={<>
        {companiesCtl}
        {switches}
      </>}
      center={controls ? controls({ period: false, companies: false, sync: false }) : null}
      right={controls ? controls({ companies: false, basis: false, sync: false, periodValue: p, onPeriod: setP }) : periodSeg || <Seg small value={p} onChange={setP} options={data.period.options} />}
      end={exportBtn} />
  );
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <Section left={bar(titles.statement || 'Office statement', data, p1, setP1)(<Seg small value={values} onChange={setValues} options={VALUE_OPTIONS} />, <button type="button" className="control h-8 text-sm" onClick={exportCsv}>Export CSV</button>)}>
        <div className="max-h-[75vh] overflow-auto">
          <table className="cols-lined min-w-full text-xs">
            <thead className="sticky top-0 z-[2] bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
              <tr>
                <th scope="col" className="sticky left-0 z-[3] w-[200px] min-w-[200px] max-w-[200px] bg-surface px-2 py-1.5 text-left align-bottom font-medium">
                  <span className="flex items-center gap-2">
                    <button type="button" className="whitespace-nowrap rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={all} onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button>
                    {/* VJ 2026-10-29: Freeze total sits next to Expand all in the table header, not in the toolbar. */}
                    {!narrow && <button type="button" className="whitespace-nowrap rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={freeze} onClick={() => setFreeze(!freeze)} title="Keep the Grand total column in view while scrolling sideways">{freeze ? 'Unfreeze total' : 'Freeze total'}</button>}
                  </span>
                </th>
                {cols.map(head)}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      </Section>
      {data.pl && (data2 ? (
        <CombinedPl
          data={{ pl: { offices: data2.pl }, office: { key: 'compare', companies: data2.offices.flatMap((o) => o.companies) }, months: data2.months, period: data2.period, asOf: data2.asOf }}
          byOffice="Grand total" focus={focus} onFocus={setFocus} freeze={frozen} freezeOn={freeze} onFreeze={setFreeze} nameLines={nameLines} offices={data2.offices}
          bar={bar(titles.pl || 'Combined profit and loss', data2, p2, setP2)} />
      ) : r2.error ? <ErrorBox title="Could not load the profit and loss for this period" error={r2.error} /> : <Loading />)}
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

function OfficeDetail({ officeKey, q, reloadKey, periodSeg, onBack, canBack, onCombine, base = 'office-view', controls = null, customRange = null, onPick = null }) {
  // A period per table (VJ: the two reports are read at different intervals): the statement follows p1, the P&L p2;
  // the P&L refetches only when they differ.
  const [p1, setP1] = useState(q.period || null);
  const [p2, setP2] = useState(q.period || null);
  const qFor = (p) => (p === 'custom' && customRange ? { ...q, period: 'custom', from: customRange.from, to: customRange.to } : { ...q, ...(p ? { period: p } : {}) });
  const customKey = (p) => (p === 'custom' && customRange ? `${customRange.from}..${customRange.to}` : ''); // refetch when the Custom dates move
  const { data, loading, error } = useApi(() => api.officeDetail(officeKey, qFor(p1), base), [officeKey, q.from, q.to, q.office, q.basis, p1, customKey(p1), reloadKey, base]);
  const r2 = useApi(() => (p2 === p1 ? Promise.resolve(null) : api.officeDetail(officeKey, qFor(p2), base)), [officeKey, q.from, q.to, q.office, q.basis, p1, p2, customKey(p1), customKey(p2), reloadKey, base]);
  const data2 = p2 === p1 ? data : r2.data;
  const [cols, setCols] = useState(null); // null = the period total only; month | quarter | year adds those columns to both tables
  if (error) return <div className="grid gap-3">{canBack && <BackLink onBack={onBack} />}<ErrorBox title="Could not load this office" error={error} /></div>;
  if (!data) return <Loading />;
  const o = data.office;
  const b = data.badges;
  const show = (s) => !data.page || data.page.sections.includes(s); // config/offices*.json page.sections
  const columnsSeg = <Seg small value={cols || ''} options={COLUMN_OPTIONS} onChange={(v) => setCols(v === cols ? null : v)} />;
  const periodOf = (d) => (d.period.key === 'month' ? monthLabel(d.asOf) : `${monthLabel(d.period.from)} to ${monthLabel(d.period.to)}`);
  const allTitles = data.page?.titles || {}; // config page.titles; a combined view has its own pair (titles.combined)
  const titles = o.combined && allTitles.combined ? allTitles.combined : allTitles;
  const compactHead = data.page?.portfolio?.tags === false; // the Financial KPIs page: no heading block, the toolbar names the view
  // VJ 2026-10-29: "Combine: A, B, C" with every company of the view (or the office name) next to the title; the companies
  // popup opens with these ticked and Done opens the new set as a view.
  // VJ 2026-10-29: a combined view says only "Combined N companies" (the names are in the tooltip and the companies popup).
  const viewNote = <span className="toolbar-note" title={o.combined ? o.companies.map((c) => c.displayName || c.name).join(', ') : undefined}>{o.combined ? `Combined ${o.companies.length} ${o.companies.length === 1 ? 'company' : 'companies'}` : o.name}{o.note && !o.combined ? <span className="ml-1 text-[10px] text-muted">{o.note}</span> : null}</span>;
  const viewPick = onPick ? { ids: o.companies.map((c) => c.realmId), onApply: onPick, hint: 'Done opens the ticked companies as one combined view (one company opens on its own).' } : undefined;
  const companiesCtl = controls && controls({ period: false, basis: false, sync: false, view: viewPick });
  const split = data.page?.split || [6, 6]; // statement : P&L widths side by side (config page.split, VJ: 3 and 9)
  const basisCtl = controls ? controls({ period: false, companies: false, sync: false }) : null;
  const periodCtl = (p, setP) => (controls ? controls({ companies: false, basis: false, sync: false, periodValue: p, onPeriod: setP }) : periodSeg || <Seg small value={p} onChange={setP} options={data.period.options} />);
  // The same bar on BOTH panels, as on Compare (VJ 2026-10-29: the same report, read at different intervals): back | title |
  // the period shown | view | Select companies | the table's switches | Monthly / Quarterly / Yearly ... Accrual / Cash ...
  // its own period, Export CSV last; sticky inside its card. Edit / Combine with… only on the Offices tab (the Financial KPIs
  // page makes combinations from the list and the companies popup).
  const bar = (title, d, p, setP) => (switches, exportBtn) => (
    <Toolbar sticky periodLeft
      head={<>{canBack && <BackLink onBack={onBack} />}<span className="toolbar-title">{title}</span><span className="toolbar-note">{periodOf(d)}</span>{viewNote}</>}
      left={<>
        {companiesCtl}
        {switches}
        {columnsSeg}
        {onCombine && !compactHead && <button type="button" className="control h-8 text-sm" onClick={() => onCombine({ id: o.id, name: o.name, city: o.city, state: o.state, companies: o.companies })}>{o.combined ? 'Edit' : 'Combine with…'}</button>}
      </>}
      center={basisCtl}
      right={periodCtl(p, setP)}
      end={exportBtn} />
  );
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      {!show('statement') && bar(titles.statement || 'Office statement', data, p1, setP1)(null, null)}
      {!compactHead && <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{o.name}</h2>
            {o.combined && <Pill tone="info">Combined view</Pill>}
            {data.page?.portfolio?.tags !== false && o.companies.map((c) => <Tag key={c.realmId} title={c.name}>{c.name}</Tag>)}
          </div>
          <p className="text-sm text-ink2">{data.period.label}{data.period.key !== 'month' ? ` (${monthLabel(data.period.from)} to ${monthLabel(data.period.to)})` : ` ${monthLabel(data.asOf)}`} · Balances as of {monthEndLabel(data.asOf)} · ${basisLabel(data)}{o.companies.length > 1 ? ` · ${o.companies.length} companies read as one` : ''}</p>
        </div>
      </div>}
      {!compactHead && <div className="flex flex-wrap gap-1.5">
        {b.balancesDiffer === 0 && b.balancesMatch > 0 ? <Pill tone="good">Totals tie ✓</Pill> : b.balancesMatch + b.balancesDiffer > 0 ? <Pill tone="warn" title="Ledger balances compared with the CurrentBalance QuickBooks returns on each account">{b.balancesDiffer} of {b.balancesMatch + b.balancesDiffer} balances differ</Pill> : null}
        <Tag>Last synced {ago(b.lastChange)}</Tag>
        <Tag>{b.errors ? `Pull failed for ${b.errors}` : b.pulled === o.companies.length ? 'Connected' : `${b.pulled} of ${o.companies.length} pulled`}</Tag>
        {o.lastActivity && <Tag>Books to {monthLabel(o.lastActivity)}</Tag>}
        {data.page?.portfolio?.flags !== false && o.flags.map((f) => <Pill key={f.key} tone={f.tone}>{f.label}</Pill>)}
      </div>}
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
            <div className={`grid grid-cols-[minmax(0,1fr)] gap-2 ${!cols && show('statement') && show('pl') && data.pl ? 'lg:grid-cols-[var(--split)]' : ''}`} style={{ '--split': `minmax(0,${split[0]}fr) minmax(0,${split[1]}fr)` }}>
              {show('statement') && <Statement data={data} cols={cols} bar={bar(titles.statement || 'Office statement', data, p1, setP1)} />}
              {show('pl') && data.pl && (data2 ? <CombinedPl data={{ ...data2, months: data2.plMonths || data2.months }} cols={cols} companiesView={!compactHead} bar={bar(titles.pl || 'Combined profit and loss', data2, p2, setP2)} />
                : r2.error ? <ErrorBox title="Could not load the profit and loss for this period" error={r2.error} /> : <Loading />)}
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

/** One button bar: a left group (back, title, view, companies, switches), Accrual / Cash next to it, the period at the right,
 *  end = Export CSV always last. sticky = stays under the tab row while its card scrolls past (VJ 2026-10-29). */
const Toolbar = ({ head = null, left, center = null, right = null, end = null, sticky = false, periodLeft = false }) => (
  <div className={`toolbar ${sticky ? 'banner' : ''} ${periodLeft ? 'period-left' : ''}`}>
    {head && <div className="toolbar-head">{head}</div>}
    <div>{left}</div>
    {center ? <div>{center}</div> : <span />}
    {right || end ? <div className="justify-end">{right}{end}</div> : null}
  </div>
);
/** A column width the user set by dragging, remembered per table in localStorage (null = the browser's own width). */
function useColumnWidth(storageKey) {
  const [width, setWidth] = useState(() => { try { const v = Number(localStorage.getItem(storageKey)); return v >= 40 ? v : null; } catch { return null; } });
  const set = (w) => {
    if (w == null) { setWidth(null); try { localStorage.removeItem(storageKey); } catch { /* private mode */ } return; }
    const v = Math.max(44, Math.min(480, Math.round(w)));
    setWidth(v); try { localStorage.setItem(storageKey, String(v)); } catch { /* private mode */ }
  };
  return [width, set];
}
/** Drag handle at the right edge of a header cell: drag to set the width (of every period column), double-click to reset. */
const ColResizer = ({ onResize, title = 'Drag to resize the columns, double-click to reset' }) => {
  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const th = e.currentTarget.parentElement;
    const startX = e.clientX; const startW = th.getBoundingClientRect().width;
    const move = (ev) => onResize(startW + (ev.clientX - startX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <span role="separator" aria-orientation="vertical" aria-label={title} title={title} onPointerDown={onDown} onDoubleClick={(e) => { e.stopPropagation(); onResize(null); }} onClick={(e) => e.stopPropagation()}
    className="absolute right-0 top-0 z-[1] h-full w-2 cursor-col-resize select-none touch-none hover:bg-[color-mix(in_oklab,var(--series-1)_40%,transparent)]" />;
};
/** Inline style pinning a column to a dragged width (table-layout fixed makes the browser honour it). */
const colStyle = (w) => (w ? { width: w, minWidth: w, maxWidth: w } : undefined);
/** "Sep 2026" / "Q3 2026" as two stacked lines (the year muted beneath), so period columns stay narrow. */
const stackLabel = (label) => {
  const i = String(label).lastIndexOf(' ');
  return i > 0 ? <><span className="block">{label.slice(0, i)}</span><span className="block font-normal text-muted">{label.slice(i + 1)}</span></> : label;
};
/** Back to the list: an arrow icon only (VJ 2026-10-29), the label stays for screen readers and the tooltip. */
const BackLink = ({ onBack, label = 'Go back' }) => (
  <button type="button" className="control inline-flex h-8 w-8 shrink-0 items-center justify-center p-0 text-ink2 hover:bg-page hover:text-ink" onClick={onBack} title={label} aria-label={label}>
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </button>
);

const ROLE_STYLE = { feesSubtotal: 'subtotal', ebitda: 'subtotal', cashFlow: 'subtotal', collections: 'head', fees: 'plain' };

function Statement({ data, cols = null, bar }) {
  const [values, setValues] = useState('amount'); // amount | pct (% of the collections row) | both
  const [colW, setColW] = useColumnWidth('pnl.colWidth.statement'); // one width for every period column
  const [labelColW, setLabelColW] = useColumnWidth('pnl.colWidth.statement.label');
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
  // % = share of the collections row in the same column (Amounts | % | Both from the banner, VJ 2026-10-29).
  const coll = rows.find((x) => x.role === 'collections');
  const denOf = (b) => (coll ? (b ? sumMonths(coll.months, b) : coll.period) : 0);
  const pctTxt = (v, den) => (v == null || !den ? '–' : pct1(v / den));
  const show = (v, den, bold) => (values === 'pct' ? <span className={`tabular ${bold ? 'font-semibold' : ''}`}>{pctTxt(v, den)}</span>
    : values === 'both' ? <span className="inline-grid grid-cols-[auto_48px] items-baseline gap-x-2"><Money v={v} bold={bold} /><span className="text-[11px] font-normal text-muted">{pctTxt(v, den)}</span></span>
    : <Money v={v} bold={bold} />);
  const cell = (v, bold, den) => <td className={`whitespace-nowrap px-2 py-1 text-right ${bold ? 'font-semibold' : ''}`}>{show(v, den, bold)}</td>;
  const line = (r, depth, key, expandable, sub, memoSign) => {
    const style = ROLE_STYLE[r.role] || (depth ? 'child' : 'plain');
    const bold = style === 'subtotal' || style === 'head';
    const cls = style === 'subtotal' || style === 'head' ? 'bg-page' : depth ? 'text-ink2' : '';
    return (
      <tr key={key} className={`border-t border-[var(--line)] ${cls}`}>
        <th scope="row" className={`sticky left-0 z-[1] whitespace-nowrap px-2 py-1.5 text-left font-normal ${style === 'subtotal' || style === 'head' ? 'bg-page' : 'bg-surface'}`} style={{ paddingLeft: 8 + depth * 18 }}>
          {expandable ? (
            <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen(key)} onClick={() => toggle(key)}>
              <Chevron open={isOpen(key)} /><span className={bold ? 'font-semibold' : ''}>{r.label}</span>
            </button>
          ) : <span className={`${bold ? 'font-semibold' : ''} ${depth ? 'text-xs' : ''}`} title={sub || undefined}>{r.label}{r.companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{r.companies}</span> : null}</span>}
          {memoSign != null && !depth && <span className="ml-2 text-[10px] text-muted">{memoSign > 0 ? 'income' : 'expense'}</span>}
        </th>
        {buckets.map((b) => <React.Fragment key={b.key}>{cell(sumMonths(r.months, b), bold, denOf(b))}</React.Fragment>)}
        <td className={`whitespace-nowrap bg-page px-2 py-1.5 text-right ${bold ? 'font-semibold' : ''}`}>{show(r.period, denOf(null), bold)}</td>
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
    <Section left={bar(<Seg small value={values} onChange={setValues} options={VALUE_OPTIONS} />, <button type="button" className="control h-8 text-sm" onClick={exportCsv}>Export CSV</button>)}>
      <div className="max-h-[75vh] overflow-auto">
        <table className={`cols-lined w-full text-xs ${colW || labelColW ? '[&_td]:overflow-hidden [&_td]:text-ellipsis' : ''}`} style={{ minWidth: narrow ? 0 : (labelColW || 240) + (buckets.length + 1) * (colW || 84), tableLayout: colW || labelColW ? 'fixed' : 'auto' }}>
          <thead className="sticky top-0 z-[2] bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" className="relative sticky left-0 z-[3] bg-surface px-2 py-2 text-left font-medium" style={colStyle(labelColW)}>
                <span className="flex items-center gap-2">
                  <button type="button" className="whitespace-nowrap rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={all} onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button>
                </span>
                <ColResizer onResize={setLabelColW} title="Drag to resize the account column, double-click to reset" />
              </th>
              {buckets.map((b) => <th key={b.key} scope="col" className="relative whitespace-nowrap px-2 py-1.5 text-right align-bottom font-medium" style={colStyle(colW)}>{stackLabel(b.label)}<ColResizer onResize={setColW} /></th>)}
              <th scope="col" className="relative whitespace-nowrap bg-page px-2 py-1.5 text-right align-bottom font-medium" style={colStyle(colW)}><div>{data.period.key === 'month' ? 'Month' : data.period.label}</div><div className="font-normal text-muted">{periodLabel}</div><ColResizer onResize={setColW} /></th>
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
      <th scope="row" className={`px-2 py-1.5 text-left ${bold ? 'font-semibold' : 'font-normal'} ${highlight ? 'font-semibold' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
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

/**
 * One office: Months | Companies views over the header months. byOffice (the Compare view): data.pl.offices is the
 * view with one bucket per office; the consolidated column ("byOffice" = its label) comes first and the office
 * columns follow; a click on an office header highlights it (focus / onFocus shared with the statement above).
 * values (amount | pct | both) can be driven from outside; otherwise the table has its own switch.
 */
function CombinedPl({ data, cols: gran = null, byOffice = null, focus = null, onFocus = null, freeze = false, freezeOn = null, onFreeze = null, nameLines = null, offices = [], companiesView = true, bar }) {
  const [colW, setColW] = useColumnWidth('pnl.colWidth.pl'); // office page only: one width for every period / company column
  const [labelColW, setLabelColW] = useColumnWidth('pnl.colWidth.pl.label');
  const resizable = !byOffice;
  const [view, setView] = useState(byOffice ? 'offices' : 'months');
  const [values, setValues] = useState('amount'); // amount | pct (% of income, as on the QuickBooks report) | both
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(!byOffice); // QuickBooks shows the report fully expanded; side by side starts folded to the top-level accounts
  const narrow = useNarrow();
  // Month columns folded into the chosen granularity (none = the total only); the Companies view keeps one column per company.
  const monthsView = useMemo(() => {
    const src = data.pl.months;
    if (!src) return null;
    const buckets = bucketsOf(src.buckets.map((b) => b.key), gran);
    const agg = (periods) => Object.fromEntries(buckets.map((b) => [b.key, sumMonths(periods, b)]));
    const node = (n) => ({ ...n, periods: agg(n.periods), own: agg(n.own), children: n.children.map(node) });
    return {
      ...src, buckets,
      types: src.types.map((t) => ({ ...t, periods: agg(t.periods), nodes: t.nodes.map(node) })),
      subtotals: Object.fromEntries(Object.entries(src.subtotals).map(([k, v]) => [k, { periods: agg(v.periods), total: v.total }])),
    };
  }, [data.pl, gran]);
  const pl = view === 'offices' ? data.pl.offices : view === 'months' ? monthsView : data.pl.companies;
  const cols = narrow ? [] : pl.buckets;
  // Companies view: the display names people know (naming.companies) instead of the QuickBooks company names.
  const colLabel = (b) => (view === 'companies' ? (data.office.companies.find((c) => c.realmId === b.key)?.displayName || b.label) : b.label);
  const colCls = (key) => (byOffice ? `${focus && focus !== key ? 'opacity-40' : ''} ${focus === key ? 'bg-[color-mix(in_oklab,var(--series-1)_12%,var(--surface))]' : ''}` : '');
  const two = values === 'both'; // amount and % of income together in one cell per column (2026-10-29: no gap between them)
  // byOffice: the row label is 200px wide so the "Grand total" column can be frozen next to it (amount 96px, 160px with the % beside it).
  const labelW = byOffice ? 'w-[200px] min-w-[200px] max-w-[200px] overflow-hidden text-ellipsis' : '';
  const stickyTotal = (z = 1) => (freeze ? `sticky left-[200px] z-[${z}] ${two ? 'w-[160px] min-w-[160px]' : 'w-[96px] min-w-[96px]'}` : '');
  const py = byOffice ? 'py-0.5' : 'py-1';
  // Expand all / Collapse all folds or opens every section and account, except the Income section, which stays open.
  // A click on any row still toggles that row by hand.
  const isOpen = (k) => (k === 'type:Income' || all ? open[k] !== false : Boolean(open[k]));
  const toggle = (k, depth = 2) => setOpen((o) => ({ ...o, [k]: !isOpen(k, depth) }));
  const types = Object.fromEntries(pl.types.map((t) => [t.accountType, t]));
  const income = types.Income || { periods: {}, total: 0 };
  const pctOf = (v, den) => (v == null || !den ? '–' : pct1(v / den));
  // Both: the amount with the % right beside it in the same cell (fixed 48px for the %, so amounts and % both stay aligned).
  const show = (v, den) => (v == null ? '–' : values === 'pct' ? pctOf(v, den) : two ? <span className="inline-grid grid-cols-[auto_48px] items-baseline gap-x-2"><span>{money(v)}</span><span className="text-[11px] font-normal text-muted">{pctOf(v, den)}</span></span> : money(v));
  const totalLabel = data.months.length === 1 ? monthLabel(data.months[0]) : `${monthLabel(data.months[0])} – ${monthLabel(data.months.at(-1))}`;
  const cell = (v, bold, den, blank, key) => <td key={key} className={`tabular whitespace-nowrap ${py} px-1.5 text-right align-top ${!v ? 'text-muted' : ''} ${bold ? 'font-semibold' : ''} ${colCls(key)}`}>{blank ? '' : show(v, den)}</td>;
  const line = (key, label, periods, total, { depth = 0, bold = false, expandable = false, isOpen = false, style = 'plain', companies = 0, blank = false, level = depth } = {}) => {
    const totalCell = <td key="__total" className={`tabular whitespace-nowrap bg-page ${py} px-1.5 text-right align-top ${bold || style === 'subtotal' ? 'font-semibold' : 'font-medium'} ${stickyTotal()}`}>{blank ? '' : show(total, income.total)}</td>;
    const cells = cols.flatMap((b) => cell(periods[b.key], bold, income.periods[b.key], blank, b.key));
    return (
      <tr key={key} className={`border-t border-[var(--line)] ${style === 'subtotal' || style === 'head' || style === 'total' ? 'bg-page' : ''}`}>
        <th scope="row" className={`sticky left-0 z-[1] whitespace-nowrap px-2 ${py} text-left ${labelW} ${bold ? 'font-semibold' : 'font-normal'} ${style === 'subtotal' || style === 'head' ? 'bg-page' : 'bg-surface'}`} style={{ paddingLeft: 8 + depth * 16 }}>
          {expandable ? (
            <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen} onClick={() => toggle(key, level)}>
              <Chevron open={isOpen} />{label}{companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{companies}</span> : null}
            </button>
          ) : <span className="inline-flex items-center gap-1"><span className="w-[14px] shrink-0" aria-hidden="true" />{label}{companies > 1 ? <span className="ml-1 text-[10px] text-muted">×{companies}</span> : null}</span>}
        </th>
        {byOffice ? [totalCell, cells] : [cells, totalCell]}
      </tr>
    );
  };
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
    downloadCsv(`office-${data.office.key}-pl-${view}-${data.asOf}.csv`, [['Account', ...pl.buckets.map(colLabel), byOffice || 'Total'], ...flat]);
  };
  const totalHead = <th key="__total" scope="col" className={`relative whitespace-nowrap bg-page px-1.5 py-1.5 text-right align-bottom font-medium ${freeze ? 'sticky left-[200px] z-[3]' : ''}`} style={resizable ? colStyle(colW) : undefined}><div>{byOffice || 'Total'}</div><div className="font-normal text-muted">{totalLabel}</div>{resizable && <ColResizer onResize={setColW} />}</th>;
  const officeOf = Object.fromEntries(offices.map((o) => [o.key, o]));
  // Companies view: the same two-line heads as Compare ("Admire Dental" muted over "Lincoln"), from the company's display name and short name.
  const companyOf = Object.fromEntries((data.office.companies || []).map((c) => [c.realmId, c]));
  const companyLines = (c) => { const nm = c.displayName || c.name; return c.short && nm.endsWith(c.short) && nm.length > c.short.length ? [nm.slice(0, -c.short.length).trim(), c.short] : [nm]; };
  const headLabel = (b) => {
    const lines = nameLines && officeOf[b.key] ? nameLines(officeOf[b.key]) : view === 'companies' && companyOf[b.key] ? companyLines(companyOf[b.key]) : null;
    if (lines) return lines.length === 2 ? <><span className="block font-normal text-muted">{lines[0]}</span><span className="block">{lines[1]}</span></> : lines[0];
    return byOffice ? colLabel(b) : stackLabel(colLabel(b));
  };
  const heads = cols.map((b) => (
    <th key={b.key} scope="col" className={`relative whitespace-nowrap px-1.5 py-1.5 text-right align-bottom font-medium ${colCls(b.key)}`} title={b.label} style={resizable ? colStyle(colW) : undefined}>
      {byOffice && onFocus ? <button type="button" className="text-right hover:underline" aria-pressed={focus === b.key} onClick={() => onFocus(focus === b.key ? null : b.key)}>{headLabel(b)}</button> : headLabel(b)}
      {resizable && <ColResizer onResize={setColW} />}
    </th>
  ));
  // VJ 2026-10-29: a combined view does not compare its companies (Compare is for that), so the Months | Companies switch
  // stays only on the Offices tab (companiesView).
  return (
    <Section left={bar(<>
        {!byOffice && companiesView && <Seg small value={view} onChange={setView} options={[['months', 'Months'], ['companies', 'Companies']]} />}
        <Seg small value={values} onChange={setValues} options={VALUE_OPTIONS} />
      </>, <button type="button" className="control h-8 text-sm" onClick={exportCsv}>Export CSV</button>)}>
      <div className={byOffice ? 'max-h-[75vh] overflow-auto' : 'overflow-x-auto'}>
        <table className={`cols-lined w-full text-xs ${resizable && (colW || labelColW) ? '[&_td]:overflow-hidden [&_td]:text-ellipsis' : ''}`}
          style={{ minWidth: narrow ? 0 : (byOffice ? 200 : labelColW || 240) + (cols.length + 1) * (resizable && colW ? colW : two ? 148 : 84), tableLayout: resizable && (colW || labelColW) ? 'fixed' : 'auto' }}>
          <thead className={`text-xs text-ink2 ${byOffice ? 'sticky top-0 z-[2] bg-surface shadow-[0_1px_0_var(--line)]' : ''}`}>
            <tr className="border-b border-[var(--line)]">
              <th scope="col" className={`relative sticky left-0 z-[3] bg-surface px-2 py-1.5 text-left align-bottom font-medium ${labelW}`} style={resizable ? colStyle(labelColW) : undefined}>
                <span className="flex items-center gap-2">
                  <button type="button" className="whitespace-nowrap rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={all} onClick={() => { setAll((a) => !a); setOpen({}); }}>{all ? 'Collapse all' : 'Expand all'}</button>
                  {onFreeze && <button type="button" className="whitespace-nowrap rounded border border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-page" aria-pressed={freezeOn} onClick={() => onFreeze(!freezeOn)} title="Keep the Grand total column in view while scrolling sideways">{freezeOn ? 'Unfreeze total' : 'Freeze total'}</button>}
                </span>
                {resizable && <ColResizer onResize={setLabelColW} title="Drag to resize the account column, double-click to reset" />}
              </th>
              {byOffice ? [totalHead, ...heads] : [...heads, totalHead]}
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
