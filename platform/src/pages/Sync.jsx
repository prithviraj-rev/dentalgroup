import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { can } from '../App.jsx';
import { Button, Card, Empty, ErrorNote, Kpi, Loading, PageHeader, StatusBadge, dateTime, pct, timeAgo, useApi, useToast } from '../ui.jsx';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'error', label: 'Failed' }, { id: 'success', label: 'Succeeded' }];

export default function Sync() {
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/orgs/${org.id}/sync-runs`);
  const [filter, setFilter] = useState('all');
  const [running, setRunning] = useState(false);

  const runs = useMemo(() => (data?.runs || []).filter((r) => filter === 'all' || r.status === filter), [data, filter]);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api.post(`/orgs/${org.id}/sync`);
      toast({
        kind: r.failed ? (r.succeeded ? 'warn' : 'error') : 'success',
        title: `Sync finished: ${r.succeeded} succeeded, ${r.failed} failed`,
        body: r.results.filter((x) => x.status === 'error').map((x) => `${x.entity}: ${x.message}`).join(' · ') || undefined,
      });
      reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Sync failed', body: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sync"
        subtitle={data ? `Schedule: ${data.schedule}` : ''}
        actions={can(org, 'sync.run') && <Button variant="primary" onClick={runNow} disabled={running}>{running ? 'Syncing…' : 'Sync now'}</Button>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={3} />}
      {data && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Last run" value={timeAgo(data.stats.lastRunAt)} sub={dateTime(data.stats.lastRunAt)} />
            <Kpi label={`Runs, last ${data.stats.days} days`} value={data.stats.runs} />
            <Kpi label="Success rate" value={pct(data.stats.successRate)} />
            <Kpi label="Failed runs" value={data.stats.failed} />
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="text-sm font-medium">Run history</h2>
              <div className="seg" role="group" aria-label="Filter">
                {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              {runs.length === 0 ? <Empty title="No runs to show" /> : (
                <table className="table">
                  <thead><tr><th>Started</th><th>Entity</th><th>Trigger</th><th>Status</th><th className="text-right">Rows</th><th className="text-right">Duration</th><th>Message</th></tr></thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-ink2">{dateTime(r.startedAt)}</td>
                        <td className="font-medium">{r.entityName}</td>
                        <td className="capitalize text-ink2">{r.trigger}</td>
                        <td><StatusBadge label={r.status === 'success' ? 'Succeeded' : 'Failed'} tone={r.status === 'success' ? 'good' : 'critical'} /></td>
                        <td className="tabular text-right">{r.rows ?? '–'}</td>
                        <td className="tabular text-right text-ink2">{r.finishedAt ? `${Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000))}s` : '–'}</td>
                        <td className="max-w-sm text-xs text-ink2">{r.message || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
