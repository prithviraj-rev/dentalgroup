import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import { useApp, can } from '../App.jsx';
import { Button, Card, Empty, ErrorNote, Kpi, Loading, PageHeader, StatusBadge, Tag, money, pct, timeAgo, useApi, useToast } from '../ui.jsx';

const SERIES = [
  { key: 'revenue', label: 'Income', color: 'var(--series-1)', kind: 'bar' },
  { key: 'expenses', label: 'Expenses', color: 'var(--series-2)', kind: 'bar' },
  { key: 'netIncome', label: 'Net income', color: 'var(--series-3)', kind: 'line' },
];
const axisTick = { fill: 'var(--muted)', fontSize: 12 };

function TrendChart({ series, currency }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Income, expenses and net income by month</h2>
        <ul className="flex flex-wrap gap-x-4 text-xs text-ink2">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={s.kind === 'line' ? 'inline-block h-0.5 w-4 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'} style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barGap={2} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} interval="preserveStartEnd" minTickGap={20} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => money(v, currency, true)} width={64} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--wash)' }} content={({ active, payload, label }) => active && payload?.length ? (
              <div className="card px-3 py-2 text-sm shadow-sm">
                <div className="mb-1 text-ink2">{label}</div>
                {SERIES.map((s) => (
                  <div key={s.key} className="flex justify-between gap-4">
                    <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />{s.label}</span>
                    <span className="tabular">{money(payload[0].payload[s.key], currency)}</span>
                  </div>
                ))}
              </div>
            ) : null} />
            <Bar dataKey="revenue" fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="expenses" fill="var(--series-2)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line type="monotone" dataKey="netIncome" stroke="var(--series-3)" strokeWidth={2} dot={{ r: 4, fill: 'var(--series-3)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function Overview() {
  const { cfg } = useApp();
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/orgs/${org.id}/overview`);
  const status = (s) => cfg.entityStatuses[s] || { label: s, tone: 'neutral' };

  const reconnect = async (e) => {
    try {
      const r = await api.post(`/orgs/${org.id}/entities/${e.id}/connect`);
      if (r.redirect) { window.location.href = r.redirect; return; }
      toast({ title: `${e.name} reconnected`, body: 'Sample data: the connection is simulated.' });
      reload();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not reconnect', body: err.message });
    }
  };

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={data ? `Last ${data.period.months} months · ${org.industry} · ${cfg.plans.find((p) => p.id === org.plan)?.label || org.plan} plan` : ''}
        badge={data?.hasSample ? <Tag>{cfg.sampleData.badge}</Tag> : null}
        actions={can(org, 'reports.view') && cfg.navigation.org.some((n) => n.id === 'reports' && n.enabled !== false) && <Link className="btn" to={`/o/${org.id}/reports`}>Open reports</Link>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={3} />}
      {data && (data.kpis.entities === 0 ? (
        <Card><Empty title="No entities yet" action={can(org, 'entities.manage') && <Link className="btn btn-primary" to={`/o/${org.id}/entities`}>Add an entity</Link>}>
          {can(org, 'entities.manage') ? 'Add the first entity and connect it to QuickBooks to see figures here.' : 'You have not been given access to any entities yet. Ask an organization admin.'}
        </Empty></Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Income" value={money(data.kpis.revenue, org.currency)} sub="incl. other income" swatch="var(--series-1)" />
            <Kpi label="Expenses" value={money(data.kpis.expenses, org.currency)} swatch="var(--series-2)" />
            <Kpi label="Net income" value={money(data.kpis.netIncome, org.currency)} sub={`${pct(data.kpis.margin)} margin`} swatch="var(--series-3)" />
            <Kpi label="Entities" value={`${data.kpis.connected} / ${data.kpis.entities}`} sub="connected" />
            <Kpi label="Needs attention" value={data.kpis.attention} sub={data.kpis.attention ? 'see below' : 'all syncing normally'} />
          </div>

          <TrendChart series={data.series} currency={org.currency} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden lg:col-span-2">
              <div className="flex items-baseline justify-between px-4 pt-4">
                <h2 className="text-sm font-medium">Entity performance</h2>
                {can(org, 'entities.view') && <Link className="text-sm text-accent hover:underline" to={`/o/${org.id}/entities`}>All entities</Link>}
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Entity</th><th>Status</th><th className="text-right">Income</th><th className="text-right">Net income</th><th className="text-right">Margin</th></tr></thead>
                  <tbody>
                    {data.entities.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div className="font-medium">{e.name}</div>
                          <div className="flex gap-1.5 text-xs text-muted">{e.groupName || 'Ungrouped'}{e.dataSource === 'live' && <Tag>Live</Tag>}</div>
                        </td>
                        <td><StatusBadge {...status(e.status)} /></td>
                        <td className="tabular text-right">{money(e.revenue, org.currency)}</td>
                        <td className="tabular text-right" style={{ color: e.netIncome < 0 ? 'var(--critical)' : undefined }}>{money(e.netIncome, org.currency)}</td>
                        <td className="tabular text-right text-ink2">{pct(e.revenue ? e.netIncome / e.revenue : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid content-start gap-4">
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-medium">Needs attention</h2>
                {data.attention.length === 0 ? <p className="text-sm text-ink2">Every entity is syncing normally.</p> : (
                  <ul className="flex flex-col gap-3">
                    {data.attention.map((e) => (
                      <li key={e.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{e.name}</span>
                          <StatusBadge {...status(e.status)} />
                        </div>
                        {e.message && <p className="mt-0.5 text-xs text-ink2">{e.message}</p>}
                        {can(org, 'entities.manage') && <Button size="sm" className="mt-1.5" onClick={() => reconnect(e)}>Reconnect</Button>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {can(org, 'sync.view') && (
                <Card className="p-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-sm font-medium">Recent syncs</h2>
                    <Link className="text-sm text-accent hover:underline" to={`/o/${org.id}/sync`}>History</Link>
                  </div>
                  {data.recentRuns.length === 0 ? <p className="text-sm text-ink2">No syncs yet.</p> : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {data.recentRuns.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{r.entityName}</span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                            {timeAgo(r.startedAt)}
                            <StatusBadge label={r.status === 'success' ? 'OK' : 'Failed'} tone={r.status === 'success' ? 'good' : 'critical'} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
