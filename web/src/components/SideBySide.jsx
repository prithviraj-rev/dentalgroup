import React, { useState } from 'react';
import { Section, Seg, Toolbar, BackLink, Money, Chevron, VALUE_OPTIONS, pct1, downloadCsv } from './ui.jsx';
import { useComparison, SetPicker, nid, periodLabel, signed, delta } from './compareSet.jsx';

/**
 * Side by side (VJ 2026-10-29 / rebuilt 2026-10-30): two rows of chips, COMPANIES and PERIODS, and the table shows every
 * company (or group of companies) over every period, the periods grouped under each company like VJ's own Excel.
 * That one layout covers all four cases: A over 2026 and 2025 (one company, two periods); A next to X + Y + Z
 * (two chips, one period); A next to B (two companies, one period); A's March next to ABC's March (two chips, one month).
 * Every column is one GET /api/<base>/set (the statement rows consolidated over the chip's companies, with the accounts
 * behind each row). "Change" compares each period with the first period of the same company, or, with a single
 * period, each company with the first company. The pickers and the fetching live in compareSet.jsx, shared with the
 * Compare charts tab.
 */
export default function SideBySide({ ids, q, base, lastFull, controls = null, onBack = null, title = 'Synopsis comparison', reloadKey = 0 }) {
  const y = Number(lastFull.slice(0, 4));
  // Start: the compared companies as one chip, this year and last year.
  const cmp = useComparison({
    initialSets: [{ id: nid(), ids, compared: true }], initialPeriods: [{ id: nid(), mode: 'year', year: y }, { id: nid(), mode: 'year', year: y - 1 }],
    lastFull, basis: q.basis, base, reloadKey,
  });
  const { sets, periods, cols: colData, rows, collectionsKey: ck, nameOf, overTime, baseOf, vsLabel } = cmp;
  const [values, setValues] = useState('amount'); // amount | pct (% of collections) | both
  const [change, setChange] = useState(true);
  const [open, setOpen] = useState({});
  const pctOf = (d, v) => { const b = ck && d ? d.values[ck] : 0; return b > 0 && v != null ? v / b : null; };
  const bold = (r) => ['feesSubtotal', 'ebitda', 'cashFlow'].includes(r.role);
  const rowCls = (r) => (bold(r) || r.role === 'collections' ? 'bg-total' : '');
  const isOpen = (k) => Boolean(open[k]);
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !isOpen(k) }));
  /** The accounts behind a row: every account seen in any column, in the first column's order. */
  const accountsOf = (rk) => {
    const seen = new Map();
    for (const { r } of colData) for (const a of r.data?.accounts?.[rk] || []) if (!seen.has(a.fullName)) seen.set(a.fullName, a);
    return [...seen.values()];
  };
  const firstOfSet = (i) => i % periods.length === 0; // the first period column of a company: a thicker line before it
  const colCls = (i) => `${firstOfSet(i) && i > 0 ? 'border-l-2 border-l-[var(--axis)]' : ''} ${i < periods.length ? 'bg-total' : ''}`;
  /** One cell: the amount, the % of collections, both, plus the change when asked (fixed sub-columns, so the figures line up). */
  const cell = (c, i, v, p, baseV, { bold: b = false, small = false } = {}) => {
    const parts = [];
    if (values !== 'pct') parts.push(['a', v == null ? <span className="text-muted">–</span> : <Money v={v} bold={b} />, 'auto']);
    if (values !== 'amount') parts.push(['p', <span className="tabular text-[11px] font-normal text-muted">{p == null ? '–' : pct1(p)}</span>, '48px']);
    if (change && baseOf(c)) parts.push(['c', <span className="tabular text-[11px] font-normal text-ink2" title={vsLabel}>{signed(delta(v, baseV))}</span>, '56px']);
    return (
      <td key={c.key} className={`whitespace-nowrap px-1.5 py-0.5 text-right align-top ${b ? 'font-semibold' : ''} ${small ? 'text-[11px]' : ''} ${colCls(i)}`}>
        {parts.length === 1 ? parts[0][1] : <span className="inline-grid items-baseline gap-x-2" style={{ gridTemplateColumns: parts.map((x) => x[2]).join(' ') }}>{parts.map((x) => <span key={x[0]}>{x[1]}</span>)}</span>}
      </td>
    );
  };
  const valueAt = (c, rk) => c?.r.data?.values?.[rk];
  const exportCsv = () => downloadCsv(`side-by-side-${lastFull}.csv`, [
    ['Row', 'Account', ...colData.map((c) => `${nameOf(c.s)} ${periodLabel(c.p, lastFull)}`)],
    ...rows.flatMap((r) => [[r.label, '', ...colData.map((c) => valueAt(c, r.key) ?? '')], ...accountsOf(r.key).map((a) => ['', a.fullName, ...colData.map((c) => (c.r.data?.accounts?.[r.key] || []).find((h) => h.fullName === a.fullName)?.period ?? '')])]),
  ]);
  const labelCls = 'sticky left-0 z-[1] w-[260px] min-w-[260px] max-w-[260px] whitespace-normal break-words';
  const body = rows.flatMap((r) => {
    const accounts = accountsOf(r.key);
    const out = [(
      <tr key={r.key} className={`border-t border-[var(--line)] ${rowCls(r)}`}>
        <th scope="row" className={`${labelCls} px-2 py-0.5 text-left ${bold(r) ? 'font-semibold' : 'font-normal'} ${rowCls(r) || 'bg-surface'}`}>
          {accounts.length ? (
            <button type="button" className="inline-flex items-center gap-1 hover:underline" aria-expanded={isOpen(r.key)} onClick={() => toggle(r.key)}>
              <Chevron open={isOpen(r.key)} /><span className={bold(r) || r.role === 'collections' ? 'font-semibold' : ''}>{r.label}</span>
            </button>
          ) : <span className={`inline-flex items-center gap-1 ${bold(r) ? 'font-semibold' : ''}`}><span className="w-[14px] shrink-0" aria-hidden="true" />{r.label}</span>}
        </th>
        {colData.map((c, i) => { const v = valueAt(c, r.key); return cell(c, i, v, pctOf(c.r.data, v), valueAt(baseOf(c), r.key), { bold: bold(r) }); })}
      </tr>
    )];
    if (isOpen(r.key)) for (const a of accounts) {
      const hitOf = (c) => (c?.r.data?.accounts?.[r.key] || []).find((h) => h.fullName === a.fullName);
      out.push(
        <tr key={`${r.key}|${a.fullName}`} className="border-t border-[var(--line)] text-ink2">
          <th scope="row" className={`${labelCls} bg-surface px-2 py-0.5 text-left text-[11px] font-normal`} style={{ paddingLeft: 26 }} title={a.fullName}>{a.account}</th>
          {colData.map((c, i) => { const v = hitOf(c)?.period ?? null; return cell(c, i, v, pctOf(c.r.data, v), hitOf(baseOf(c))?.period, { small: true }); })}
        </tr>,
      );
    }
    return out;
  });
  const toggleBtn = (on, onClick, label, titleText) => (
    <button type="button" className="control h-8 text-xs" aria-pressed={on} onClick={onClick} title={titleText} style={on ? { background: 'var(--accent)', color: '#fff', borderColor: 'transparent' } : undefined}>{label}</button>
  );
  const note = sets.length > 1 || periods.length > 1 ? <span className="text-[11px] text-muted">{change ? `change ${vsLabel}` : ''}</span> : null;
  return (
    <Section left={(
      <Toolbar sticky
        head={<>{onBack && <BackLink onBack={onBack} />}<span className="toolbar-title">{title}</span><span className="toolbar-note">every company over every period: one column each</span></>}
        left={<>
          <Seg small value={values} onChange={setValues} options={VALUE_OPTIONS} />
          {toggleBtn(change, () => setChange(!change), 'Change', 'Show the change: each period against the first period of the same company, or each company against the first company')}
        </>}
        center={controls ? controls({ period: false, companies: false, sync: false }) : null}
        end={<button type="button" className="control h-8 text-sm" onClick={exportCsv}>Export CSV</button>} />
    )}>
      <SetPicker cmp={cmp} note={note} />
      <div className="max-h-[75vh] overflow-auto">
        <table className="cols-lined min-w-full text-xs">
          <thead className="sticky top-0 z-[2] bg-thead text-xs text-theadInk shadow-[0_1px_0_var(--line)]">
            <tr>
              <th scope="col" rowSpan={2} className="sticky left-0 z-[3] w-[260px] min-w-[260px] max-w-[260px] bg-thead px-2 py-1.5 text-left align-bottom font-medium" />
              {sets.map((s, i) => <th key={s.id} scope="colgroup" colSpan={periods.length} className={`whitespace-nowrap px-1.5 pb-0.5 pt-1.5 text-center font-semibold text-ink ${i > 0 ? 'border-l-2 border-l-[var(--axis)]' : 'bg-total'}`} title={cmp.titleOf(s)}>{nameOf(s)}</th>)}
            </tr>
            <tr>
              {colData.map((c, i) => (
                <th key={c.key} scope="col" className={`whitespace-nowrap px-1.5 pb-1.5 text-right align-bottom font-medium ${colCls(i)}`}>
                  <span className="block">{periodLabel(c.p, lastFull)}</span>
                  {change && baseOf(c) && <span className="block text-[10px] font-normal text-muted">{vsLabel}</span>}
                  {c.r.loading && <span className="block text-[10px] font-normal text-muted">loading…</span>}
                  {c.r.error && <span className="block text-[10px] font-normal text-bad">{c.r.error}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? body : (
              <tr><td className="px-2 py-6 text-center text-sm text-ink2" colSpan={colData.length + 1}>{colData.some((x) => x.r.error) ? 'Could not load these columns.' : 'Loading…'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
