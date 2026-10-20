import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Empty, ErrorNote, Loading, PageHeader, Tag, dateTime, useApi } from '../ui.jsx';

const KIND = (action) => action.split('.')[0];
const KIND_LABELS = { all: 'All', org: 'Organization', entity: 'Entities', group: 'Groups', user: 'Users', sync: 'Sync', settings: 'Settings' };

export default function Activity() {
  const { org } = useOutletContext();
  const { data, loading, error, reload } = useApi(`/orgs/${org.id}/activity`);
  const [kind, setKind] = useState('all');
  const kinds = useMemo(() => ['all', ...new Set((data?.activity || []).map((a) => KIND(a.action)))], [data]);
  const rows = (data?.activity || []).filter((a) => kind === 'all' || KIND(a.action) === kind);

  return (
    <>
      <PageHeader title="Activity" subtitle="Who changed what in this organization." />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={3} />}
      {data && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-2 px-4 pt-4">
            <div className="seg" role="group" aria-label="Filter">
              {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABELS[k] || k}</button>)}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            {rows.length === 0 ? <Empty title="No activity yet" /> : (
              <table className="table">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-ink2">{dateTime(a.at)}</td>
                      <td>{a.user}</td>
                      <td><Tag>{a.action}</Tag></td>
                      <td className="text-ink2">{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
