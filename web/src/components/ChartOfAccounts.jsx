import React, { useEffect, useMemo, useState } from 'react';
import { api, API_BASE } from '../api.js';
import { fmtMoney } from '../format.js';
import CoaDashboard from './CoaCharts.jsx';

const CLASS_LABELS = { Revenue: 'Revenue', Expense: 'Expenses', Asset: 'Assets', Liability: 'Liabilities', Equity: 'Equity', Other: 'Other' };

function Amount({ value, strong, muted }) {
  const neg = value < 0;
  return (
    <td className={`tabular whitespace-nowrap px-3 py-1.5 text-right ${strong ? 'font-medium' : ''} ${neg ? 'text-bad' : ''} ${value === 0 || muted ? 'text-muted' : ''}`}>
      {value === 0 ? '–' : fmtMoney(value)}
    </td>
  );
}

/** One account row plus its (possibly collapsed) sub-accounts. */
function AccountRows({ node, periods, open, toggle, visible, showSubType, balanceOnly }) {
  if (!visible(node)) return null;
  const isOpen = open.has(node.key);
  const hasKids = node.children.some(visible);
  const pad = 16 + node.depth * 18;
  return (
    <>
      <tr className={`border-t border-[var(--line)] hover:bg-page ${!node.active ? 'opacity-60' : ''}`}>
        <td className="sticky left-0 z-10 bg-surface py-1.5 pr-3" style={{ paddingLeft: pad }}>
          <div className="flex items-center gap-1.5">
            {hasKids ? (
              <button type="button" onClick={() => toggle(node.key)} aria-expanded={isOpen} className="w-4 text-muted" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-4" aria-hidden="true" />
            )}
            <span className={node.depth === 0 ? 'font-medium' : 'text-ink2'}>{node.name}</span>
            {showSubType && node.accountSubType && <span className="rounded bg-page px-1.5 py-0.5 text-[10px] text-muted">{node.accountSubType}</span>}
            {!node.active && <span className="rounded bg-page px-1.5 py-0.5 text-[10px] text-muted">inactive</span>}
            {node.unmapped && <span className="rounded bg-page px-1.5 py-0.5 text-[10px] text-muted" title="Appears in the P&L report but not in the chart of accounts">not in chart</span>}
            {node.offices?.length > 1 && <span className="text-[10px] text-muted">{node.offices.length} offices</span>}
          </div>
        </td>
        {balanceOnly ? (
          <Amount value={node.currentBalance} strong={node.depth === 0} />
        ) : (
          <>
            {periods.map((p) => <Amount key={p.key} value={node.periods[p.key]} strong={hasKids} />)}
            <Amount value={node.total} strong />
          </>
        )}
      </tr>
      {isOpen && hasKids && node.children.map((c) => (
        <AccountRows key={c.key} node={c} periods={periods} open={open} toggle={toggle} visible={visible} showSubType={showSubType} balanceOnly={balanceOnly} />
      ))}
    </>
  );
}

export default function ChartOfAccounts({ config, filters, officeParam, reloadKey, onSync, syncing, meta }) {
  const cfg = config.chartOfAccounts;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideNoActivity, setHideNoActivity] = useState(cfg.hideNoActivity);
  const [hideInactive, setHideInactive] = useState(cfg.hideInactive);
  const [balanceSheet, setBalanceSheet] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(new Set());
  const [openInit, setOpenInit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.coa({ granularity: filters.granularity, from: filters.from, to: filters.to, office: officeParam, balanceSheet: balanceSheet ? 1 : 0 })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.granularity, filters.from, filters.to, officeParam, balanceSheet, reloadKey]);

  // Open the first `expandDepth` levels once data arrives (only the first time, so user toggles stick).
  useEffect(() => {
    if (!data || openInit) return;
    const next = new Set();
    const walk = (n) => { if (n.depth < cfg.expandDepth) { next.add(n.key); n.children.forEach(walk); } };
    for (const s of data.sections) for (const t of s.types) { next.add(`type:${s.classification}:${t.accountType}`); t.nodes.forEach(walk); }
    setOpen(next);
    setOpenInit(true);
  }, [data, openInit, cfg.expandDepth]);

  const toggle = (key) => setOpen((o) => { const n = new Set(o); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const allKeys = useMemo(() => {
    const keys = [];
    const walk = (n) => { keys.push(n.key); n.children.forEach(walk); };
    for (const s of data?.sections || []) for (const t of s.types) { keys.push(`type:${s.classification}:${t.accountType}`); t.nodes.forEach(walk); }
    return keys;
  }, [data]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const memo = new Map();
    const v = (n) => {
      if (memo.has(n.key)) return memo.get(n.key);
      const kids = n.children.some(v);
      let ok = true;
      if (hideInactive && !n.active && !kids) ok = false;
      if (hideNoActivity && !n.hasActivity && !kids && !['Asset', 'Liability', 'Equity'].includes(n.classification)) ok = false;
      if (q && !n.fqn.toLowerCase().includes(q) && !kids) ok = false;
      memo.set(n.key, ok || kids);
      return ok || kids;
    };
    return v;
  }, [hideInactive, hideNoActivity, q]);

  if (error) {
    return <div className="card border-l-4 border-l-bad p-4 text-sm"><div className="font-medium">Could not load the chart of accounts</div><div className="text-ink2">{error}</div></div>;
  }
  if (loading && !data) return <div className="card h-[420px] animate-pulse" />;
  if (!data) return null;

  if (!data.hasAccounts) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="text-lg font-medium">No chart of accounts yet, run sync</div>
        <p className="max-w-md text-sm text-ink2">
          {meta?.connections ? 'The chart of accounts is pulled from QuickBooks on every sync.' : <>Connect a company at <a className="text-accent hover:underline" href={`${API_BASE}/connect`}>{API_BASE}/connect</a> first.</>}
        </p>
        <button type="button" onClick={onSync} disabled={syncing} className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">{syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>
    );
  }

  const { periods } = data;
  const colCount = periods.length + 2;

  return (
    <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      {cfg.dashboard?.enabled && data.hasData && <CoaDashboard data={data} cfg={cfg.dashboard} />}

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <input className="control w-56" type="search" placeholder="Find account…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-ink2"><input type="checkbox" className="accent-[var(--series-1)]" checked={hideNoActivity} onChange={(e) => setHideNoActivity(e.target.checked)} />Hide accounts with no activity</label>
        <label className="flex items-center gap-2 text-ink2"><input type="checkbox" className="accent-[var(--series-1)]" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />Hide inactive</label>
        {cfg.balanceSheetToggle && (
          <label className="flex items-center gap-2 text-ink2"><input type="checkbox" className="accent-[var(--series-1)]" checked={balanceSheet} onChange={(e) => setBalanceSheet(e.target.checked)} />Show balance sheet accounts</label>
        )}
        <div className="flex-1" />
        <button type="button" className="text-accent hover:underline" onClick={() => setOpen(new Set(allKeys))}>Expand all</button>
        <button type="button" className="text-accent hover:underline" onClick={() => setOpen(new Set())}>Collapse all</button>
        <span className="text-xs text-muted">
          {data.accountCount} accounts{data.unmappedCount ? `, ${data.unmappedCount} P&L lines not in the chart` : ''}{data.merged ? ' · merged across offices by name' : ''}
        </span>
      </div>

      <section className="card overflow-hidden">
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-ink2">
                <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">Account</th>
                {periods.map((p) => <th key={p.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">{p.label}</th>)}
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.sections.map((s) => {
                const balanceOnly = ['Asset', 'Liability', 'Equity'].includes(s.classification);
                return (
                  <React.Fragment key={s.classification}>
                    <tr className="border-t-2 border-[var(--axis)] bg-page">
                      <td className="sticky left-0 z-10 bg-page px-4 py-2 font-semibold" colSpan={balanceOnly ? 1 : 1}>{CLASS_LABELS[s.classification] || s.classification}</td>
                      {balanceOnly ? (
                        <td className="px-3 py-2 text-right text-xs text-muted" colSpan={colCount - 1}>Current balance</td>
                      ) : (
                        <>
                          {periods.map((p) => <Amount key={p.key} value={s.periods[p.key]} strong />)}
                          <Amount value={s.total} strong />
                        </>
                      )}
                    </tr>
                    {s.types.map((t) => {
                      const tkey = `type:${s.classification}:${t.accountType}`;
                      const isOpen = open.has(tkey);
                      const rows = t.nodes.filter(visible);
                      if (rows.length === 0 && (hideNoActivity || hideInactive || q)) return null;
                      return (
                        <React.Fragment key={tkey}>
                          <tr className="cursor-pointer border-t border-[var(--line)] hover:bg-page" onClick={() => toggle(tkey)}>
                            <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium">
                              <span className="flex items-center gap-2">
                                <span className="inline-block w-3 text-muted" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                                {t.accountType}
                                <span className="text-xs font-normal text-muted">{rows.length}</span>
                              </span>
                            </td>
                            {balanceOnly ? (
                              <><Amount value={t.balance} strong />{periods.length > 0 && <td colSpan={colCount - 2} />}</>
                            ) : (
                              <>
                                {periods.map((p) => <Amount key={p.key} value={t.periods[p.key]} strong />)}
                                <Amount value={t.total} strong />
                              </>
                            )}
                          </tr>
                          {isOpen && rows.map((n) => (
                            <AccountRows key={n.key} node={n} periods={periods} open={open} toggle={toggle} visible={visible} showSubType={cfg.showSubType} balanceOnly={balanceOnly} />
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              <tr className="border-t-2 border-[var(--axis)]">
                <td className="sticky left-0 z-10 bg-surface px-4 py-2 font-semibold">Net income</td>
                {periods.map((p) => <Amount key={p.key} value={data.netIncome.periods[p.key]} strong />)}
                <Amount value={data.netIncome.total} strong />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
