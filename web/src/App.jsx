import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, API_BASE } from './api.js';
import { addMonths, currentMonth, configureFormat, metric as metricOf } from './format.js';
import { readUrlState, writeUrlState } from './urlState.js';
import Controls, { COMPARE } from './components/Controls.jsx';
import KpiCards, { CompareKpis } from './components/KpiCards.jsx';
import { MainChart, OfficeChart } from './components/charts.jsx';
import OfficeTable from './components/OfficeTable.jsx';
import ChartOfAccounts from './components/ChartOfAccounts.jsx';
import Analysis from './components/Analysis.jsx';
import Executive from './components/Executive.jsx';
import CategoryCompare from './components/CategoryCompare.jsx';
import GroupOverview from './components/GroupOverview.jsx';
import CashBalance from './components/CashBalance.jsx';
import Offices from './components/Offices.jsx';
import KpiDashboard from './components/KpiDashboard.jsx';
import CompareCharts from './components/CompareCharts.jsx';
import Toast from './components/Toast.jsx';

const TABS = [
  { id: 'executive', label: 'Executive', enabled: (c) => c.executive?.enabled !== false && Boolean(c.executiveView) },
  { id: 'dashboard', label: 'Dashboard', enabled: () => true },
  { id: 'analysis', label: 'Analysis', enabled: (c) => c.analysis?.enabled !== false && c.offices?.enabled !== false },
  { id: 'categories', label: 'Category compare', enabled: (c) => c.categoryView?.enabled !== false },
  { id: 'offices', label: 'Offices', enabled: (c) => c.offices?.enabled !== false },
  { id: 'officesSheet', label: (c) => c.officesSheet?.label || 'Financial KPIs', enabled: (c) => c.offices?.enabled !== false && c.officesSheet?.enabled !== false },
  { id: 'kpi', label: (c) => c.kpiDashboard?.label || 'KPI dashboard', enabled: (c) => c.offices?.enabled !== false && c.kpiDashboard?.enabled !== false && (c.kpiDashboard?.source !== 'officesSheet' || c.officesSheet?.enabled !== false) },
  { id: 'charts', label: (c) => c.compareCharts?.label || 'Compare charts', enabled: (c) => c.offices?.enabled !== false && c.compareCharts?.enabled !== false && (c.compareCharts?.source !== 'officesSheet' || c.officesSheet?.enabled !== false) },
  { id: 'group', label: 'Group overview', enabled: (c) => c.groupOverview?.enabled !== false },
  { id: 'cash', label: 'Cash & balance sheet', enabled: (c) => c.finance?.enabled !== false },
  { id: 'coa', label: 'Chart of accounts', enabled: (c) => c.chartOfAccounts.enabled },
];
// app.config.json dashboard.tabs: the tab ids to show (null = every enabled tab).
const tabShown = (t, c) => t.enabled(c) && (!Array.isArray(c.dashboard.tabs) || c.dashboard.tabs.includes(t.id));
const CATEGORY = 'cat:'; // office filter value for an office category: cat:<dimension id>:<category label>

/**
 * dashboard.periodPicker = buttons: the months actually shown come from the period button, anchored on the last full
 * month with data (Custom = the header From / To). The Financial KPIs API gets the same months plus the period key for its label.
 */
function periodRange(period, filters, lastFull) {
  if (!period || period === 'custom' || !lastFull) return { from: filters.from, to: filters.to };
  if (/^year:\d{4}$/.test(period)) { // one calendar year; the running year ends at the last full month
    const yy = period.slice(5);
    const to = `${yy}-12` < lastFull ? `${yy}-12` : lastFull;
    return { from: `${yy}-01` <= to ? `${yy}-01` : to, to };
  }
  const y = Number(lastFull.slice(0, 4));
  if (period === 'month') return { from: lastFull, to: lastFull };
  if (period === 'quarter') { const m = Number(lastFull.slice(5, 7)); const end = m % 3 === 0 ? lastFull : addMonths(lastFull, -(m % 3)); return { from: addMonths(end, -2), to: end }; }
  if (period === 'ytd') return { from: `${y}-01`, to: lastFull };
  if (period === 'lastYear') return { from: `${y - 1}-01`, to: `${y - 1}-12` };
  if (period === 'ttm') return { from: addMonths(lastFull, -11), to: lastFull };
  return { from: filters.from, to: filters.to };
}

/** Initial UI state from app.config.json, overridden by anything in the URL. */
function initialState(config) {
  const d = config.dashboard;
  const url = readUrlState();
  const office = url.office || d.defaultOffice;
  const isList = office.includes(',');
  // dashboard.officePicker = companies: no Office dropdown; the picked companies are the filter (none = all).
  const chips = d.officePicker === 'companies';
  return {
    filters: {
      office: isList || chips ? COMPARE : office,
      compare: isList ? office.split(',').slice(0, config.compare.maxOffices ?? undefined) : chips && office !== 'all' && !office.startsWith(CATEGORY) ? [office] : [],
      from: url.from || d.defaultRange.from,
      to: url.to || (d.defaultRange.to === 'current' ? currentMonth() : d.defaultRange.to),
      granularity: url.granularity || d.defaultGranularity,
      period: d.periodPicker === 'buttons' ? (d.periods.includes(url.period) || (d.periods.includes('years') && /^year:\d{4}$/.test(url.period || '')) ? url.period : d.defaultPeriod) : null,
      basis: d.basis.available.includes(url.basis) ? url.basis : d.basis.default,
      metric: config.compare.metrics.includes(url.metric) ? url.metric : config.compare.defaultMetric,
    },
    chartTypes: {
      main: config.charts.main.options.includes(url.mainChart) ? url.mainChart : config.charts.main.default,
      office: config.charts.office.options.includes(url.officeChart) ? url.officeChart : config.charts.office.default,
    },
    yoy: url.yoy ?? d.defaultYoy,
    tab: TABS.find((t) => t.id === url.tab && tabShown(t, config))?.id || TABS.find((t) => t.id === d.defaultTab && tabShown(t, config))?.id || TABS.find((t) => tabShown(t, config))?.id || 'dashboard',
    analysis: {
      metric: config.analysis.metrics.includes(url.ametric) ? url.ametric : config.analysis.defaultMetric,
      by: config.analysis.dimensions.includes(url.by) ? url.by : config.analysis.defaultBy,
      chart: config.analysis.chart.options.includes(url.achart) ? url.achart : config.analysis.chart.default,
    },
    category: url.cat || null,
    fromUrl: Boolean(url.from || url.to),
  };
}

/** True inside the Ledgerview Reports page (an iframe): the shell's sidebar brands the banner, the dashboard shows only its tabs. */
const EMBEDDED = (() => { try { return window.self !== window.top; } catch { return true; } })();
/** config/theme.json: the server renders the colour overrides as a stylesheet (theme.css); one <style> element carries it. */
function applyTheme(theme) {
  if (!theme) return;
  let el = document.getElementById('theme-config');
  if (!el) { el = document.createElement('style'); el.id = 'theme-config'; document.head.appendChild(el); }
  el.textContent = theme.css || '';
}
export default function App() {
  const [config, setConfig] = useState(null);
  const [offices, setOffices] = useState([]);
  const [meta, setMeta] = useState(null);
  const [rawFilters, setFilters] = useState(null); // what the header controls hold; filters below = what the tabs read
  const [chartTypes, setChartTypes] = useState({ main: 'combo', office: 'lines' });
  const [tab, setTab] = useState('dashboard');
  const [analysis, setAnalysis] = useState(null);
  const [categories, setCategories] = useState([]);
  const [groups, setGroups] = useState(null); // company groups for the chip picker (dashboard.officePicker = companies)
  const [groupNames, setGroupNames] = useState({}); // display names for the picker chips (naming.companies)
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [yoy, setYoy] = useState(false);
  const [rangeFromUrl, setRangeFromUrl] = useState(false);
  const [pl, setPl] = useState(null);
  const [prior, setPrior] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plError, setPlError] = useState(null); // dashboard-tab data errors only
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [snapped, setSnapped] = useState(false);
  const headerRef = React.useRef(null);

  // VJ 2026-10-29: the tab row stays frozen at the top while scrolling; tables that scroll with the page stick their
  // header just under it (CSS variable --hdr = the header's height, read by the Financial KPIs list header).
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => document.documentElement.style.setProperty('--hdr', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [config]);

  // 1. Config first: everything else (defaults, labels, limits) depends on it.
  useEffect(() => {
    let cancelled = false;
    api.config()
      .then((c) => {
        if (cancelled) return;
        configureFormat(c);
        applyTheme(c.theme);
        const s = initialState(c);
        setConfig(c);
        setFilters(s.category ? { ...s.filters, office: `${CATEGORY}${s.category}` } : s.filters);
        setChartTypes(s.chartTypes);
        setTab(s.tab);
        setAnalysis(s.analysis);
        setYoy(s.yoy);
        setRangeFromUrl(s.fromUrl);
        document.title = c.dashboard.title;
      })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Refresh offices and figures when the page becomes visible again, so newly connected companies appear.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 15000) {
        last = Date.now();
        setReloadKey((k) => k + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, []);

  // 2. Offices + data range. Snap the default range onto the synced data once (unless the URL set one).
  useEffect(() => {
    if (!config) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const groupsBase = config.officesSheet?.enabled !== false && config.offices?.enabled !== false ? config.officesSheet.apiPath : 'office-view';
        const [o, m, cats, g] = await Promise.all([api.offices(), api.meta(), api.officeCategories().catch(() => ({ dimensions: [] })),
          config.dashboard.officePicker === 'companies' && config.offices?.enabled !== false ? api.officeGroups(groupsBase).catch(() => ({ groups: null })) : Promise.resolve({ groups: null })]);
        if (cancelled) return;
        setOffices(o);
        setGroups(g.groups);
        setGroupNames(g.names || {});
        setCategories(cats.dimensions);
        setCategoriesLoaded(true);
        setMeta(m);
        setError(null);
        if (!snapped && config.dashboard.defaultRange.snapToData && !rangeFromUrl && m.minPeriod && m.maxPeriod) {
          // Trailing window ending at the latest synced month (dashboard.defaultRange.snapMonths, null = all history).
          const n = config.dashboard.defaultRange.snapMonths;
          const from = n ? [m.minPeriod, addMonths(m.maxPeriod, -(n - 1))].sort().at(-1) : m.minPeriod;
          setFilters((f) => ({ ...f, from, to: m.maxPeriod }));
          setSnapped(true);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [config, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Period buttons: the window is anchored on the last full month that has data (never the unfinished current month).
  const lastFull = useMemo(() => { const prev = addMonths(currentMonth(), -1); return meta?.maxPeriod && meta.maxPeriod < prev ? meta.maxPeriod : prev; }, [meta]);
  const filters = useMemo(() => (rawFilters && config?.dashboard.periodPicker === 'buttons' ? { ...rawFilters, ...periodRange(rawFilters.period, rawFilters, lastFull) } : rawFilters), [rawFilters, config, lastFull]);
  // The period buttons: "years" in dashboard.periods becomes one button per calendar year (dashboard.yearButtons of them, latest first).
  const periodOptions = useMemo(() => (config ? config.dashboard.periods.flatMap((p) => (p === 'years' ? Array.from({ length: config.dashboard.yearButtons }, (_, i) => `year:${Number(lastFull.slice(0, 4)) - i}`) : [p])) : []), [config, lastFull]);
  const chipPicker = config?.dashboard.officePicker === 'companies';
  const isCompare = filters?.office === COMPARE;
  const compareReady = isCompare && (chipPicker || filters.compare.length >= (config?.compare.minOffices ?? 2));
  // An office category selected in the office picker: the combined figures of its offices.
  const categoryKey = filters?.office?.startsWith(CATEGORY) ? filters.office.slice(CATEGORY.length) : null;
  const category = useMemo(() => {
    if (!categoryKey) return null;
    const i = categoryKey.indexOf(':');
    const dim = categories.find((d) => d.id === categoryKey.slice(0, i));
    const cat = dim?.categories.find((c) => c.label === categoryKey.slice(i + 1));
    return cat ? { dimension: dim.label, label: cat.label, realmIds: cat.realmIds } : { dimension: '', label: categoryKey.slice(i + 1), realmIds: [] };
  }, [categoryKey, categories]);
  // What the API gets as `office`: all | realmId | id,id,...
  const officeParam = isCompare ? (filters.compare.join(',') || 'all') : category ? (category.realmIds.join(',') || '__none__') : filters?.office;
  const singleOffice = isCompare ? filters.compare.length === 1 : !category && filters?.office !== 'all';
  const waitingForCategory = Boolean(categoryKey) && !categoriesLoaded;

  // Keep the URL in sync so the view can be shared.
  useEffect(() => {
    if (!filters) return;
    writeUrlState({
      tab: tab !== (config.dashboard.defaultTab || 'dashboard') ? tab : null,
      office: category ? null : officeParam, cat: categoryKey, period: rawFilters.period, basis: rawFilters.basis !== config.dashboard.basis.default ? rawFilters.basis : null, from: rawFilters.from, to: rawFilters.to, granularity: filters.granularity, yoy: yoy === config.dashboard.defaultYoy ? null : yoy ? '1' : '0',
      metric: isCompare ? filters.metric : null,
      mainChart: chartTypes.main !== config.charts.main.default ? chartTypes.main : null,
      officeChart: chartTypes.office !== config.charts.office.default ? chartTypes.office : null,
      ...(tab === 'analysis' && analysis ? { ametric: analysis.metric, by: analysis.by, achart: analysis.chart } : {}),
    });
  }, [filters, rawFilters, yoy, officeParam, isCompare, chartTypes, config, tab, analysis, categoryKey, category]);

  const chartOptions = (which) => (config.charts.showPicker ? config.charts[which].options : null);
  const setChartType = (which) => (t) => setChartTypes((c) => ({ ...c, [which]: t }));

  // 3. Main data for the current filters (+ same range one year earlier when YoY is on).
  useEffect(() => {
    if (!filters) return undefined;
    if (tab !== 'dashboard') return undefined;
    if (waitingForCategory) return undefined;
    if (isCompare && !compareReady) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    const q = { granularity: filters.granularity, from: filters.from, to: filters.to, office: officeParam };
    const priorQ = { ...q, from: addMonths(filters.from, -12), to: addMonths(filters.to, -12) };
    (async () => {
      try {
        const [p, prev] = await Promise.all([
          api.pl(q),
          yoy ? api.pl(priorQ) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPl(p);
        setPrior(prev);
        setPlError(null);
      } catch (e) {
        if (!cancelled) setPlError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters, yoy, reloadKey, officeParam, isCompare, compareReady, tab, waitingForCategory]);

  const closeToast = useCallback(() => setToast(null), []);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await api.sync();
      const lines = r.results.map((x) =>
        x.status === 'success' ? `${x.companyName}: ${x.rows} rows` : `${x.companyName}: failed, ${x.error}`
      );
      if (r.companies === 0) {
        setToast({ kind: 'warn', title: 'No companies to sync', lines: [meta?.can?.connect !== false ? `Open ${API_BASE}/connect to connect a QuickBooks company first.` : 'No companies are available to you yet. Ask an administrator.'] });
      } else {
        setToast({
          kind: r.failed ? (r.succeeded ? 'warn' : 'error') : 'success',
          title: `Sync finished: ${r.succeeded} of ${r.companies} ${r.companies === 1 ? 'company' : 'companies'} succeeded`,
          lines,
        });
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      const body = e.body;
      const lines = body?.results ? body.results.map((x) => `${x.companyName}: ${x.status === 'success' ? `${x.rows} rows` : x.error}`) : [];
      setToast({ kind: 'error', title: body?.results ? 'Sync failed' : `Sync failed: ${e.message}`, lines });
      setReloadKey((k) => k + 1);
    } finally {
      setSyncing(false);
    }
  }, []);

  const colorIndexOf = useCallback(
    (realmId) => offices.find((o) => o.realmId === realmId)?.colorIndex ?? 0,
    [offices]
  );

  const hasData = Boolean(pl?.hasData);
  const noConnections = meta && meta.connections === 0;
  const nothingSynced = meta && meta.lineCount === 0;

  const subtitle = useMemo(() => {
    if (!meta) return '';
    const parts = [`${meta.connections} ${meta.connections === 1 ? 'office' : 'offices'} connected`];
    if (meta.lastSync) parts.push(`last sync ${new Date(meta.lastSync).toLocaleString()}`);
    if (meta.minPeriod) parts.push(`data ${meta.minPeriod} to ${meta.maxPeriod}`);
    return parts.join(' · ');
  }, [meta]);

  if (!config || !filters) {
    return (
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        {error ? <ErrorCard error={error} onRetry={() => window.location.reload()} /> : <div className="card h-24 animate-pulse" />}
      </div>
    );
  }

  const inlineControls = (tab === 'officesSheet' && config.officesSheet?.controls === 'inline') || tab === 'charts'; // the Compare charts tab holds its own periods and companies: only Accrual / Cash and Sync, in its own bar
  const controlsEl = <Controls config={config} offices={offices} filters={rawFilters} onChange={setFilters} periods={periodOptions} yoy={yoy} onYoy={setYoy} onSync={onSync} syncing={syncing} compact={tab !== 'dashboard'} categories={categories} groups={groups} names={groupNames} canSync={meta?.can?.sync !== false} lastSync={meta?.lastSync || null} inline={inlineControls} />;
  const metricLabel = metricOf(filters.metric).label;
  const compareMax = config.compare.maxOffices ?? undefined;
  const visibleTabs = TABS.filter((t) => tabShown(t, config));

  return (
    <div className="w-full px-1 pb-1">
      <header ref={headerRef} className="sticky top-0 z-20 -mx-1 mb-1 flex flex-col gap-0 bg-page">
        {config.dashboard.showHeader !== false && ( // app.config.json dashboard.showHeader: title + "N offices connected · last sync · data range" line
          <div className="px-2 pt-1">
            <h1 className="text-lg font-semibold sm:text-xl">{config.dashboard.title}</h1>
            <p className="text-sm text-ink2">{subtitle}</p>
          </div>
        )}
        {/* Tabs on the top line as a navy banner (CSS .app-banner; the product name at its left when showHeader is off, Manage connections
            at its right); the filters sit below, or in the page's own bar (officesSheet.controls = inline). */}
        <div className="app-banner flex flex-wrap items-end justify-between gap-x-5 gap-y-1 px-2">
          <div className="flex min-w-0 items-center">
            {config.dashboard.showHeader === false && !EMBEDDED && ( // standalone only: inside Ledgerview the sidebar's brand strip is the banner's left end and the tabs follow it directly (VJ 2026-10-30: one product, one banner)
              <span className="banner-brand hidden items-center gap-2 self-center sm:inline-flex">
                {config.theme?.brand?.logoUrl && <img className="banner-logo" src={config.theme.brand.logoUrl} alt="" />}
                <span>{config.dashboard.title}</span>
              </span>
            )}
            {visibleTabs.length > 1 ? (
              <nav className="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
                {visibleTabs.map((t) => (
                  <button
                    key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                    className={`tab shrink-0 whitespace-nowrap px-4 py-3 text-base ${tab === t.id ? 'active' : ''}`}
                  >
                    {typeof t.label === 'function' ? t.label(config) : t.label}
                  </button>
                ))}
              </nav>
            ) : <span />}
          </div>
          {meta?.can?.manageConnections !== false && <a className="banner-link pb-3 text-sm" href={`${API_BASE}/connections`} target="_blank" rel="noreferrer">Manage connections ↗</a>}
        </div>
        {!inlineControls && <div className="px-1 pt-1">{controlsEl}</div>}
        {category && <p className="px-1 text-xs text-ink2">Showing {category.dimension ? `${category.dimension}: ` : ''}<b>{category.label}</b>, {category.realmIds.length} {category.realmIds.length === 1 ? 'office' : 'offices'} combined.</p>}
      </header>

      {error && <ErrorCard error={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />}

      {!error && tab === 'dashboard' && plError && <ErrorCard error={plError} onRetry={() => { setPlError(null); setReloadKey((k) => k + 1); }} />}

      {!error && waitingForCategory && <div className="card h-40 animate-pulse" />}

      {!error && !waitingForCategory && tab === 'executive' && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">Pick at least {config.compare.minOffices} offices above, or choose All offices, a category or a single office.</div>
      ) : (
        <Executive config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey}
          onOpenOffice={(id) => { setFilters((f) => ({ ...f, office: id })); setTab('dashboard'); window.scrollTo(0, 0); }} />
      ))}

      {!error && !waitingForCategory && tab === 'analysis' && analysis && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">Pick at least {config.compare.minOffices} offices above, or choose All offices, a category or a single office.</div>
      ) : (
        <Analysis config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey} categories={categories} state={analysis} onState={setAnalysis} />
      ))}

      {!error && !waitingForCategory && tab === 'categories' && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">Pick at least {config.compare.minOffices} offices above, or choose All offices, a category or a single office.</div>
      ) : (
        <CategoryCompare config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey} offices={offices} categories={categories} />
      ))}

      {!error && !waitingForCategory && ['offices', 'officesSheet', 'group', 'cash'].includes(tab) && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">Pick at least {config.compare.minOffices} offices above, or choose All offices, a category or a single office.</div>
      ) : tab === 'offices' ? (
        <Offices filters={filters} officeParam={officeParam} singleOffice={singleOffice} reloadKey={reloadKey} />
      ) : tab === 'officesSheet' ? (
        <Offices key="sheet" filters={filters} officeParam={officeParam} singleOffice={singleOffice} reloadKey={reloadKey} base={config.officesSheet.apiPath}
          controls={inlineControls ? (parts) => <Controls config={config} offices={offices} filters={rawFilters} onChange={setFilters} periods={periodOptions} yoy={yoy} onYoy={setYoy} onSync={onSync} syncing={syncing} compact categories={categories} groups={groups} names={groupNames} canSync={meta?.can?.sync !== false} lastSync={meta?.lastSync || null} inline parts={parts} /> : null}
          customRange={{ from: rawFilters.from, to: rawFilters.to }} />
      ) : tab === 'group' ? (
        <GroupOverview filters={filters} officeParam={officeParam} reloadKey={reloadKey}
          onOpenOffice={(id) => { setFilters((f) => ({ ...f, office: id })); setTab('dashboard'); window.scrollTo(0, 0); }} />
      ) : (
        <CashBalance filters={filters} officeParam={officeParam} reloadKey={reloadKey} />
      ))}

      {!error && !waitingForCategory && tab === 'kpi' && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">Pick at least {config.compare.minOffices} offices above, or choose All offices, a category or a single office.</div>
      ) : (
        <KpiDashboard config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey}
          onOpenOffice={(id) => { setFilters((f) => ({ ...f, office: id })); setTab(config.kpiDashboard?.source === 'offices' ? 'offices' : 'officesSheet'); window.scrollTo(0, 0); }} />
      ))}

      {!error && !waitingForCategory && tab === 'charts' && (
        <CompareCharts key={`charts-${filters.basis || ''}`} config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey} lastFull={lastFull}
          base={config.compareCharts?.source === 'offices' ? 'office-view' : config.officesSheet.apiPath}
          controls={(parts) => <Controls config={config} offices={offices} filters={rawFilters} onChange={setFilters} periods={periodOptions} yoy={yoy} onYoy={setYoy} onSync={onSync} syncing={syncing} compact categories={categories} groups={groups} names={groupNames} canSync={meta?.can?.sync !== false} lastSync={meta?.lastSync || null} inline parts={parts} />} />
      )}

      {!error && !waitingForCategory && tab === 'coa' && (isCompare && !compareReady ? (
        <div className="card px-6 py-12 text-center text-sm text-ink2">
          Pick at least {config.compare.minOffices} offices above, or choose All offices or a single office.
        </div>
      ) : (
        <ChartOfAccounts config={config} filters={filters} officeParam={officeParam} reloadKey={reloadKey} onSync={onSync} syncing={syncing} meta={meta} />
      ))}

      {!error && !plError && tab === 'dashboard' && isCompare && !compareReady && (
        <div className="card px-6 py-12 text-center text-sm text-ink2">
          Pick at least {config.compare.minOffices} offices above to compare them{compareMax ? ` (up to ${compareMax})` : ''}.
        </div>
      )}

      {!error && !plError && tab === 'dashboard' && (!isCompare || compareReady) && loading && !pl && (
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
          <div className="card h-[380px] animate-pulse" />
        </div>
      )}

      {!error && !plError && tab === 'dashboard' && (!isCompare || compareReady) && pl && !hasData && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="text-lg font-medium">No data yet, run sync</div>
          {noConnections && meta?.can?.connect === false ? (
            <p className="max-w-md text-sm text-ink2">No companies are available to you yet. Ask an administrator for access.</p>
          ) : noConnections ? (
            <p className="max-w-md text-sm text-ink2">
              No QuickBooks companies are connected. Open <a className="text-accent hover:underline" href={`${API_BASE}/connect`}>{API_BASE}/connect</a> once
              per sandbox company, then come back and press <b>Sync now</b>.
            </p>
          ) : nothingSynced ? (
            <p className="max-w-md text-sm text-ink2">
              {meta.connections} {meta.connections === 1 ? 'company is' : 'companies are'} connected but nothing has been synced. Press <b>Sync now</b> to pull the P&amp;L.
            </p>
          ) : (
            <p className="max-w-md text-sm text-ink2">
              Nothing in {filters.from} to {filters.to} for this selection. Synced data covers {meta?.minPeriod} to {meta?.maxPeriod}.
            </p>
          )}
          {meta?.can?.sync !== false && (
            <button type="button" onClick={onSync} disabled={syncing} className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      )}

      {!error && !plError && tab === 'dashboard' && pl && hasData && !isCompare && (
        <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          <KpiCards totals={pl.totals} prior={prior?.hasData ? prior.totals : null} yoy={yoy} secondary={config.dashboard.secondaryKpis || []} />
          <MainChart
            periods={pl.periods} height={config.dashboard.chartHeights.main} expenseGroups={config.groups.expenseGroups}
            type={chartTypes.main} options={chartOptions('main')} onTypeChange={setChartType('main')}
          />
          {config.officeChart.enabled && !singleOffice && pl.offices.length > 1 && (
            <OfficeChart
              periods={pl.periods} offices={pl.offices} metricKey={config.officeChart.metric} colorIndexOf={colorIndexOf}
              maxOffices={config.officeChart.maxOffices} height={config.dashboard.chartHeights.office}
              type={chartTypes.office} options={chartOptions('office')} onTypeChange={setChartType('office')}
            />
          )}
        </div>
      )}

      {!error && !plError && tab === 'dashboard' && pl && hasData && isCompare && compareReady && (
        <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          <CompareKpis offices={pl.offices} priorOffices={prior?.hasData ? prior.offices : null} yoy={yoy} metricKey={filters.metric} colorIndexOf={colorIndexOf} />
          <OfficeChart
            periods={pl.periods} offices={pl.offices} metricKey={filters.metric} colorIndexOf={colorIndexOf}
            maxOffices={compareMax} height={config.dashboard.chartHeights.office}
            title={`${metricLabel} by office`}
            type={chartTypes.office} options={chartOptions('office')} onTypeChange={setChartType('office')}
          />
          <OfficeTable
            periods={pl.periods} offices={pl.offices} metricKey={filters.metric} colorIndexOf={colorIndexOf} yoy={yoy} priorOffices={prior?.hasData ? prior.offices : null}
            combined={{ periods: Object.fromEntries(pl.periods.map((p) => [p.key, p[filters.metric]])), total: pl.totals[filters.metric] }}
          />
        </div>
      )}

      <Toast toast={toast} onClose={closeToast} seconds={config.dashboard.syncToastSeconds} />
    </div>
  );
}

function ErrorCard({ error, onRetry }) {
  return (
    <div className="card border-l-4 border-l-bad p-4 text-sm">
      <div className="font-medium">Could not load data</div>
      <div className="text-ink2">{error}</div>
      <button type="button" className="mt-2 text-accent hover:underline" onClick={onRetry}>Retry</button>
    </div>
  );
}
