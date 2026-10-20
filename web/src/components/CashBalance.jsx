import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import {
  Section, Tiles, Seg, Swatches, ErrorBox, Loading, Empty, Status, SourceLine, Sparkline, ChartTip, NameTick, sortTh, sorter, downloadCsv, useApi, useNarrow,
  POS, NEG, axisTick, pct1, money, compact, monthLabel,
} from './ui.jsx';

// Cash & balance sheet: cash, working capital, debt, cash flow, profit-to-cash conversion, A/R and A/P aging
// and vendor spend. Data from /api/finance/cash (balance sheet, cash flow, aging and vendor reports pulled
// from QuickBooks on every sync).

const BUCKETS = ['current', '1-30', '31-60', '61-90', '91+'];
const BUCKET_LABEL = { current: 'Current', '1-30': '1-30 days', '31-60': '31-60', '61-90': '61-90', '91+': '91+ days' };
// Aging is ordinal: one hue, light (current) to dark (oldest).
const BUCKET_COLOR = { current: 'color-mix(in oklab, var(--series-7) 22%, var(--surface))', '1-30': 'color-mix(in oklab, var(--series-7) 42%, var(--surface))', '31-60': 'color-mix(in oklab, var(--series-7) 62%, var(--surface))', '61-90': 'color-mix(in oklab, var(--series-7) 82%, var(--surface))', '91+': 'var(--series-7)' };
const CF = [['operating', 'Operating', 'var(--series-1)'], ['investing', 'Investing', 'var(--series-4)'], ['financing', 'Financing', 'var(--series-5)']];

export default function CashBalance({ filters, officeParam, reloadKey }) {
  const { data, loading, error } = useApi(() => api.financeCash({ from: filters.from, to: filters.to, office: officeParam }), [filters.from, filters.to, officeParam, reloadKey]);
  if (error) return <ErrorBox title="Could not load cash and balance sheet" error={error} />;
  if (!data) return <Loading />;
  if (!data.hasData) return <NoData source={data.source} />;
  const s = data.summary;
  const rw = data.cashFlow.runway;
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <SourceLine source={data.source} extra={data.latest ? `Balances as of ${monthLabel(data.latest)} month end.` : null} />
      {s && (
        <Tiles cols={6} items={[
          { label: 'Cash', value: compact(s.cash), sub: s.prior ? `${s.cash >= s.prior.cash ? '+' : ''}${compact(s.cash - s.prior.cash)} vs prior month` : `as of ${monthLabel(data.latest)}`, subTone: s.prior ? (s.cash >= s.prior.cash ? 'good' : 'bad') : null },
          { label: 'Working capital', value: compact(s.workingCapital), bad: s.workingCapital < 0, sub: `Current ratio ${s.currentRatio == null ? '–' : s.currentRatio.toFixed(2)}` },
          { label: 'Receivables (A/R)', value: compact(data.aging.ar.total || s.ar), sub: `${compact(data.aging.ar.overdue)} overdue` },
          { label: 'Payables (A/P)', value: compact(data.aging.ap.total || s.ap), sub: `${compact(data.aging.ap.overdue)} overdue` },
          { label: 'Debt', value: compact(s.debt), sub: s.equity ? `Debt / equity ${(s.debt / s.equity).toFixed(2)}` : null },
          { label: rw.months != null ? 'Cash runway' : 'Operating cash flow', value: rw.months != null ? `${rw.months.toFixed(1)} mo` : rw.avgOperating == null ? '–' : `${compact(rw.avgOperating)}/mo`, bad: rw.months != null && rw.months < 6, sub: rw.basisMonths ? `avg of last ${rw.basisMonths} months` : 'no cash flow data yet' },
        ]} />
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CashTrend data={data} />
        <CashByCompany data={data} />
      </div>
      <CashFlow data={data} />
      <Aging data={data} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Conversion data={data} />
        <Vendors data={data} />
      </div>
      <BalanceTable data={data} />
    </div>
  );
}

function NoData({ source }) {
  return (
    <Empty title="No balance sheet data yet">
      Balances, cash flow, aging and vendor spend are computed from the raw QuickBooks records (invoices, bills, payments, journal entries...)
      pulled with every sync (daily, or <b>Sync now</b>). They will appear here after the next sync.
      {source?.errors?.length > 0 && <span className="mt-2 block text-bad">Last pull failed: {source.errors[0].message}</span>}
    </Empty>
  );
}

function CashTrend({ data }) {
  const rows = data.trend.map((t) => ({ label: monthLabel(t.month), cash: t.cash, debt: t.debt }));
  if (!rows.length) return <Section title="Cash and debt by month"><p className="py-6 text-center text-sm text-ink2">No balance sheet months in this range.</p></Section>;
  return (
    <Section title="Cash and debt by month" subtitle="Month-end balances, all selected companies.">
      <Swatches items={[{ label: 'Cash', color: POS, kind: 'line' }, { label: 'Debt', color: NEG, kind: 'line' }]} />
      <div className="mt-2 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={56} />
            <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<ChartTip rows={(p) => [['Cash', money(p.cash), POS], ['Debt', money(p.debt), NEG]]} />} />
            <Line dataKey="cash" stroke={POS} strokeWidth={2} dot={{ r: 3, fill: POS, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            <Line dataKey="debt" stroke={NEG} strokeWidth={2} dot={{ r: 3, fill: NEG, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function CashByCompany({ data }) {
  const narrow = useNarrow();
  const rows = data.companies.filter((c) => c.cash !== 0).map((c) => ({ label: c.officeName, cash: c.cash, prev: c.prevCash, asOf: c.asOf }));
  const height = Math.max(160, rows.length * 22 + 44);
  return (
    <Section title="Cash by company" subtitle={`Month-end bank balances${data.latest ? `, ${monthLabel(data.latest)}` : ''}.`}>
      <div className="max-h-[300px] overflow-y-auto">
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={3}>
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis type="number" tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={narrow ? 110 : 180} tick={<NameTick max={narrow ? 15 : 26} />} axisLine={false} tickLine={false} interval={0} />
              <ReferenceLine x={0} stroke="var(--axis)" />
              <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [['Cash', money(p.cash)], p.prev != null && ['Prior month', money(p.prev)], p.asOf !== data.latest && ['As of', monthLabel(p.asOf)]]} />} />
              <Bar dataKey="cash" fill={POS} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Section>
  );
}

function CashFlow({ data }) {
  const rows = data.cashFlow.monthly.filter((m) => !m.empty).map((m) => ({ label: monthLabel(m.month), ...m }));
  if (!rows.length) return null;
  return (
    <Section title="Cash flow by month" subtitle="Every transaction that moved a bank account, split by what it paid for or came from: operations, investments (equipment, buildouts) and financing (loans, owner draws). The line is the net change in cash.">
      <Swatches items={[...CF.map(([, l, c]) => ({ label: l, color: c })), { label: 'Net change', color: 'var(--ink)', kind: 'line' }]} />
      <div className="mt-2 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={16} />
            <YAxis tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [...CF.map(([k, l, c]) => [l, money(p[k]), c]), ['Net change', money(p.netChange), 'var(--ink)']]} />} />
            {CF.map(([k, , c]) => <Bar key={k} dataKey={k} stackId="cf" fill={c} stroke="var(--surface)" strokeWidth={1} maxBarSize={26} isAnimationActive={false} />)}
            <Line dataKey="netChange" stroke="var(--ink)" strokeWidth={2} dot={{ r: 3, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Aging({ data }) {
  const [kind, setKind] = useState('ar');
  const narrow = useNarrow();
  const a = data.aging[kind];
  const rows = a.byCompany.map((c) => ({ label: c.officeName, ...c.buckets, total: c.total, overdue: c.overdue }));
  const height = Math.max(140, rows.length * 22 + 30);
  const who = kind === 'ar' ? 'Customer / payer' : 'Vendor';
  return (
    <Section title={kind === 'ar' ? 'Receivables aging (money owed to us)' : 'Payables aging (bills we owe)'}
      subtitle={`Open invoices and bills from the raw QuickBooks records, aged by due date as of ${a.reportDate}. Darker = older. Practices that bill insurance mainly through the practice-management system may show little A/R here.`}
      right={<Seg small value={kind} onChange={setKind} options={[['ar', 'Receivables'], ['ap', 'Payables']]} />}>
      {a.total === 0 ? <p className="py-6 text-center text-sm text-ink2">No open {kind === 'ar' ? 'receivables' : 'payables'} in QuickBooks for these companies.</p> : (
        <>
          <div className="mb-3 grid grid-cols-5 gap-1 text-center text-xs">
            {BUCKETS.map((b) => (
              <div key={b} className="rounded-md p-2" style={{ background: BUCKET_COLOR[b], color: b === '91+' || b === '61-90' ? '#fff' : 'var(--ink)' }}>
                <div className="truncate">{BUCKET_LABEL[b]}</div>
                <div className="font-semibold tabular">{compact(a.buckets[b])}</div>
              </div>
            ))}
          </div>
          <Swatches items={BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], color: BUCKET_COLOR[b] }))} />
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="max-h-[340px] overflow-y-auto">
              <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={3}>
                    <XAxis type="number" tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={narrow ? 110 : 170} tick={<NameTick max={narrow ? 15 : 24} />} axisLine={false} tickLine={false} interval={0} />
                    <Tooltip cursor={{ fill: 'var(--ring)' }} content={<ChartTip rows={(p) => [...BUCKETS.map((b) => [BUCKET_LABEL[b], money(p[b]), BUCKET_COLOR[b]]), ['Total', money(p.total)]]} />} />
                    {BUCKETS.map((b) => <Bar key={b} dataKey={b} stackId="age" fill={BUCKET_COLOR[b]} stroke="var(--surface)" strokeWidth={1} maxBarSize={14} isAnimationActive={false} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="max-h-[340px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-ink2">
                  <tr><th className="py-1 text-left font-medium">{who}</th><th className="py-1 text-right font-medium">Overdue</th><th className="py-1 text-right font-medium">Total</th></tr>
                </thead>
                <tbody>
                  {a.topParties.map((p) => (
                    <tr key={p.party} className="border-t border-[var(--line)]">
                      <td className="max-w-[220px] truncate py-1" title={`${p.party}${p.companies > 1 ? ` · ${p.companies} companies` : ''}`}>{p.party}{p.companies > 1 && <span className="text-xs text-muted"> · {p.companies}</span>}</td>
                      <td className={`tabular py-1 text-right ${p.overdue > 0 ? 'text-bad' : 'text-ink2'}`}>{compact(p.overdue)}</td>
                      <td className="tabular py-1 text-right">{compact(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function Conversion({ data }) {
  const rows = data.cashFlow.conversion;
  return (
    <Section title="Profit vs cash" subtitle="Operating cash flow against net income over the same months. Below 100% means profit is tied up in receivables or other working capital.">
      {!rows.length ? <p className="py-6 text-center text-sm text-ink2">No cash flow data yet.</p> : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-ink2">
              <tr><th className="py-1 text-left font-medium">Company</th><th className="py-1 text-right font-medium">Net income</th><th className="py-1 text-right font-medium">Operating cash</th><th className="py-1 text-right font-medium">Conversion</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.realmId} className="border-t border-[var(--line)]">
                  <td className="max-w-[200px] truncate py-1" title={r.officeName}>{r.officeName}</td>
                  <td className={`tabular py-1 text-right ${r.netIncome < 0 ? 'text-bad' : ''}`}>{compact(r.netIncome)}</td>
                  <td className={`tabular py-1 text-right ${r.operatingCashFlow < 0 ? 'text-bad' : ''}`}>{compact(r.operatingCashFlow)}</td>
                  <td className="tabular py-1 text-right">{r.conversion == null ? '–' : <span className={r.conversion < 0.8 ? 'text-bad' : ''}>{pct1(r.conversion)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Vendors({ data }) {
  const v = data.vendors;
  return (
    <Section title="Top vendors" subtitle={`Spend by vendor across the selected companies (${v.count} vendors, ${compact(v.total)}). Vendors used by several companies are where group pricing helps most.`}>
      {!v.top.length ? <p className="py-6 text-center text-sm text-ink2">No vendor spend yet.</p> : (
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-ink2">
              <tr><th className="py-1 text-left font-medium">Vendor</th><th className="py-1 text-right font-medium">Companies</th><th className="py-1 text-right font-medium">Spend</th><th className="hidden py-1 text-right font-medium sm:table-cell">Share</th><th className="hidden py-1 pl-2 text-right font-medium sm:table-cell">Trend</th></tr>
            </thead>
            <tbody>
              {v.top.map((x) => (
                <tr key={x.vendor} className="border-t border-[var(--line)]">
                  <td className="max-w-[200px] truncate py-1" title={x.vendor}>{x.vendor}</td>
                  <td className="tabular py-1 text-right">{x.companies}</td>
                  <td className="tabular py-1 text-right">{compact(x.total)}</td>
                  <td className="hidden py-1 text-right sm:table-cell">
                    <span className="inline-flex items-center justify-end gap-1.5 tabular"><span className="inline-block h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(2, (x.share || 0) * 120)}px` }} aria-hidden="true" />{pct1(x.share)}</span>
                  </td>
                  <td className="hidden py-1 pl-2 text-right sm:table-cell"><Sparkline values={x.monthly} width={72} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function BalanceTable({ data }) {
  const [sort, setSort] = useState({ col: 'cash', dir: -1 });
  const cols = [['cash', 'Cash'], ['ar', 'A/R'], ['ap', 'A/P'], ['debt', 'Debt'], ['workingCapital', 'Working capital'], ['currentRatio', 'Current ratio'], ['totalAssets', 'Assets'], ['equity', 'Equity']];
  const rows = useMemo(() => [...data.companies].sort(sorter(sort, (r, c) => (c === 'name' ? r.officeName : r[c]))), [data.companies, sort]);
  const exportCsv = () => downloadCsv(`balance-sheet-${data.latest}.csv`, [['Company', 'As of', ...cols.map(([, l]) => l)], ...rows.map((r) => [r.officeName, r.asOf, ...cols.map(([k]) => r[k])])]);
  return (
    <Section title="Balance sheet by company" subtitle="Latest month-end balances. Companies whose latest month is older are marked."
      right={<button type="button" className="control text-sm" onClick={exportCsv}>Export CSV</button>}>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-ink2 shadow-[0_1px_0_var(--line)]">
            <tr>{sortTh(sort, setSort, 'name', 'Company', 'text-left')}{cols.map(([k, l]) => sortTh(sort, setSort, k, l, 'text-right'))}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.realmId} className="border-t border-[var(--line)]">
                <th scope="row" className="max-w-[240px] truncate px-2 py-1.5 text-left font-normal" title={r.officeName}>
                  {r.officeName}{r.asOf !== data.latest && <span className="ml-1 text-xs text-muted">({monthLabel(r.asOf)})</span>}
                </th>
                {cols.map(([k]) => (
                  <td key={k} className={`tabular whitespace-nowrap px-2 text-right ${(k === 'workingCapital' || k === 'equity' || k === 'cash') && r[k] < 0 ? 'text-bad' : ''}`}>
                    {k === 'currentRatio' ? (r[k] == null ? '–' : r[k].toFixed(2)) : compact(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
