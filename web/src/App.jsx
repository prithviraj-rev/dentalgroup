import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, API_BASE } from './api.js';
import { addMonths, currentMonth, configureFormat, metric as metricOf } from './format.js';
import { readUrlState, writeUrlState } from './urlState.js';
import Controls, { COMPARE } from './components/Controls.jsx';
import KpiCards, { CompareKpis } from './components/KpiCards.jsx';
import { MainChart, OfficeChart } from './components/charts.jsx';
import BreakdownTable from './components/BreakdownTable.jsx';
import OfficeTable from './components/OfficeTable.jsx';
import Toast from './components/Toast.jsx';

/** Initial UI state from app.config.json, overridden by anything in the URL. */
function initialState(config) {
  const d = config.dashboard;
  const url = readUrlState();
  const office = url.office || d.defaultOffice;
  const isList = office.includes(',');
  return {
    filters: {
      office: isList ? COMPARE : office,
      compare: isList ? office.split(',').slice(0, config.compare.maxOffices) : [],
      from: url.from || d.defaultRange.from,
      to: url.to || (d.defaultRange.to === 'current' ? currentMonth() : d.defaultRange.to),
      granularity: url.granularity || d.defaultGranularity,
      metric: config.compare.metrics.includes(url.metric) ? url.metric : config.compare.defaultMetric,
    },
    chartTypes: {
      main: config.charts.main.options.includes(url.mainChart) ? url.mainChart : config.charts.main.default,
      office: config.charts.office.options.includes(url.officeChart) ? url.officeChart : config.charts.office.default,
    },
    yoy: url.yoy ?? d.defaultYoy,
    fromUrl: Boolean(url.from || url.to),
  };
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [offices, setOffices] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(null);
  const [chartTypes, setChartTypes] = useState({ main: 'combo', office: 'lines' });
  const [yoy, setYoy] = useState(false);
  const [rangeFromUrl, setRangeFromUrl] = useState(false);
  const [pl, setPl] = useState(null);
  const [prior, setPrior] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [snapped, setSnapped] = useState(false);

  // 1. Config first: everything else (defaults, labels, limits) depends on it.
  useEffect(() => {
    let cancelled = false;
    api.config()
      .then((c) => {
        if (cancelled) return;
        configureFormat(c);
        const s = initialState(c);
        setConfig(c);
        setFilters(s.filters);
        setChartTypes(s.chartTypes);
        setYoy(s.yoy);
        setRangeFromUrl(s.fromUrl);
        document.title = c.dashboard.title;
      })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // 2. Offices + data range. Snap the default range onto the synced data once (unless the URL set one).
  useEffect(() => {
    if (!config) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [o, m] = await Promise.all([api.offices(), api.meta()]);
        if (cancelled) return;
        setOffices(o);
        setMeta(m);
        setError(null);
        if (!snapped && config.dashboard.defaultRange.snapToData && !rangeFromUrl && m.minPeriod && m.maxPeriod) {
          setFilters((f) => ({ ...f, from: m.minPeriod, to: m.maxPeriod }));
          setSnapped(true);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [config, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCompare = filters?.office === COMPARE;
  const compareReady = isCompare && filters.compare.length >= (config?.compare.minOffices ?? 2);
  // What the API gets as `office`: all | realmId | id,id,...
  const officeParam = isCompare ? filters.compare.join(',') : filters?.office;

  // Keep the URL in sync so the view can be shared.
  useEffect(() => {
    if (!filters) return;
    writeUrlState({
      office: officeParam, from: filters.from, to: filters.to, granularity: filters.granularity, yoy,
      metric: isCompare ? filters.metric : null,
      mainChart: chartTypes.main !== config.charts.main.default ? chartTypes.main : null,
      officeChart: chartTypes.office !== config.charts.office.default ? chartTypes.office : null,
    });
  }, [filters, yoy, officeParam, isCompare, chartTypes, config]);

  const chartOptions = (which) => (config.charts.showPicker ? config.charts[which].options : null);
  const setChartType = (which) => (t) => setChartTypes((c) => ({ ...c, [which]: t }));

  // 3. Main data for the current filters (+ same range one year earlier when YoY is on).
  useEffect(() => {
    if (!filters || error) return undefined;
    if (isCompare && !compareReady) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    const q = { granularity: filters.granularity, from: filters.from, to: filters.to, office: officeParam };
    const priorQ = { ...q, from: addMonths(filters.from, -12), to: addMonths(filters.to, -12) };
    const accountsQ = isCompare ? { ...q, by: 'office' } : q;
    (async () => {
      try {
        const [p, a, prev] = await Promise.all([
          api.pl(q),
          api.accounts(accountsQ),
          yoy ? api.pl(priorQ) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPl(p);
        setAccounts(a);
        setPrior(prev);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters, yoy, reloadKey, error, officeParam, isCompare, compareReady]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await api.sync();
      const lines = r.results.map((x) =>
        x.status === 'success' ? `${x.companyName}: ${x.rows} rows` : `${x.companyName}: failed, ${x.error}`
      );
      if (r.companies === 0) {
        setToast({ kind: 'warn', title: 'No companies connected', lines: [`Open ${API_BASE}/connect to connect a QuickBooks company first.`] });
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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error ? <ErrorCard error={error} onRetry={() => window.location.reload()} /> : <div className="card h-24 animate-pulse" />}
      </div>
    );
  }

  const metricLabel = metricOf(filters.metric).label;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{config.dashboard.title}</h1>
            <p className="text-sm text-ink2">{subtitle}</p>
          </div>
          <a className="text-sm text-accent hover:underline" href={`${API_BASE}/`} target="_blank" rel="noreferrer">Manage connections ↗</a>
        </div>
        <Controls config={config} offices={offices} filters={filters} onChange={setFilters} yoy={yoy} onYoy={setYoy} onSync={onSync} syncing={syncing} />
      </header>

      {error && <ErrorCard error={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />}

      {!error && isCompare && !compareReady && (
        <div className="card px-6 py-12 text-center text-sm text-ink2">
          Pick at least {config.compare.minOffices} offices above to compare them (up to {config.compare.maxOffices}).
        </div>
      )}

      {!error && (!isCompare || compareReady) && loading && !pl && (
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
          </div>
          <div className="card h-[380px] animate-pulse" />
        </div>
      )}

      {!error && (!isCompare || compareReady) && pl && !hasData && (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="text-lg font-medium">No data yet, run sync</div>
          {noConnections ? (
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
          <button type="button" onClick={onSync} disabled={syncing} className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      {!error && pl && hasData && !isCompare && (
        <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          <KpiCards totals={pl.totals} prior={prior?.hasData ? prior.totals : null} yoy={yoy} />
          <MainChart
            periods={pl.periods} height={config.dashboard.chartHeights.main} expenseGroups={config.groups.expenseGroups}
            type={chartTypes.main} options={chartOptions('main')} onTypeChange={setChartType('main')}
          />
          {config.officeChart.enabled && pl.office === 'all' && pl.offices.length > 1 && (
            <OfficeChart
              periods={pl.periods} offices={pl.offices} metricKey={config.officeChart.metric} colorIndexOf={colorIndexOf}
              maxOffices={config.officeChart.maxOffices} height={config.dashboard.chartHeights.office}
              type={chartTypes.office} options={chartOptions('office')} onTypeChange={setChartType('office')}
            />
          )}
          {accounts && <BreakdownTable data={accounts} config={config} />}
        </div>
      )}

      {!error && pl && hasData && isCompare && compareReady && (
        <div className={`grid gap-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
          <CompareKpis offices={pl.offices} priorOffices={prior?.hasData ? prior.offices : null} yoy={yoy} metricKey={filters.metric} colorIndexOf={colorIndexOf} />
          <OfficeChart
            periods={pl.periods} offices={pl.offices} metricKey={filters.metric} colorIndexOf={colorIndexOf}
            maxOffices={config.compare.maxOffices} height={config.dashboard.chartHeights.office}
            title={`${metricLabel} by office`}
            type={chartTypes.office} options={chartOptions('office')} onTypeChange={setChartType('office')}
          />
          <OfficeTable periods={pl.periods} offices={pl.offices} metricKey={filters.metric} colorIndexOf={colorIndexOf} yoy={yoy} priorOffices={prior?.hasData ? prior.offices : null} />
          {accounts && <BreakdownTable data={accounts} config={config} title={`Account breakdown by office (${filters.from} to ${filters.to})`} />}
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} seconds={config.dashboard.syncToastSeconds} />
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
