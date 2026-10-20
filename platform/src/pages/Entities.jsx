import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, can } from '../App.jsx';
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, StatusBadge, Tag, timeAgo, useApi, useToast } from '../ui.jsx';

function EntityModal({ org, entity, groups, onClose, onSaved }) {
  const { cfg } = useApp();
  const toast = useToast();
  const editing = Boolean(entity?.id);
  const [f, setF] = useState({ name: entity?.name || '', groupId: entity?.groupId ?? '', newGroup: '', connector: entity?.connector || cfg.connectors.find((c) => c.enabled)?.id, realmId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (!editing && org.liveDashboard) api.get(`/orgs/${org.id}/available-connections`).then(setLive).catch(() => {});
  }, [editing, org]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: f.name, groupId: f.groupId === '__new' ? null : f.groupId, newGroup: f.groupId === '__new' ? f.newGroup : '', connector: f.connector, realmId: f.realmId || undefined };
      if (editing) await api.patch(`/orgs/${org.id}/entities/${entity.id}`, body);
      else await api.post(`/orgs/${org.id}/entities`, body);
      toast({ title: editing ? 'Entity updated' : 'Entity added', body: !editing && !f.realmId ? 'It is awaiting connection. Use Connect to link it.' : undefined });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${entity.name}` : 'Add entity'} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={busy || (!f.name && !f.realmId) || (f.groupId === '__new' && !f.newGroup)}>{busy ? 'Saving…' : 'Save'}</Button>
    </>}>
      <div className="grid gap-4">
        {!editing && live?.connections?.length > 0 && (
          <Field label="Link a connected QuickBooks company" hint="Live: figures come from the real QuickBooks sync.">
            <select className="control" value={f.realmId} onChange={(e) => setF({ ...f, realmId: e.target.value, name: f.name || live.connections.find((c) => c.realmId === e.target.value)?.companyName || '' })}>
              <option value="">None, add a new entity</option>
              {live.connections.map((c) => <option key={c.realmId} value={c.realmId}>{c.companyName}</option>)}
            </select>
          </Field>
        )}
        <Field label="Entity name"><input className="control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Downtown clinic" /></Field>
        <Field label="Group">
          <select className="control" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>
            <option value="">Ungrouped</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="__new">New group…</option>
          </select>
        </Field>
        {f.groupId === '__new' && <Field label="New group name"><input className="control" value={f.newGroup} onChange={(e) => setF({ ...f, newGroup: e.target.value })} /></Field>}
        {!editing && (
          <Field label="Accounting system">
            <div className="grid gap-2 sm:grid-cols-2">
              {cfg.connectors.map((c) => (
                <label key={c.id} className={`flex items-center gap-2 rounded-lg border border-[var(--ring)] px-3 py-2 text-sm ${c.enabled ? 'cursor-pointer' : 'opacity-50'}`}>
                  <input type="radio" name="connector" disabled={!c.enabled} checked={f.connector === c.id} onChange={() => setF({ ...f, connector: c.id })} />
                  <span className="flex-1">{c.label}</span>
                  {c.note && <span className="text-xs text-muted">{c.note}</span>}
                </label>
              ))}
            </div>
          </Field>
        )}
        {!editing && org.liveDashboard && (
          <p className="text-xs text-muted">To add a company that is not listed above, <a className="text-accent hover:underline" href={live?.connectUrl || '/connect'}>connect it to QuickBooks</a>. It is added to this organization and synced automatically.</p>
        )}
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
    </Modal>
  );
}

export default function Entities() {
  const { cfg } = useApp();
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/orgs/${org.id}/entities`);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const manage = can(org, 'entities.manage');
  const connectUrl = `/connect?org=${org.id}&return=${encodeURIComponent(`/app/o/${org.id}/entities`)}`;
  const [params, setParams] = useSearchParams();
  // Message from the QuickBooks connect flow (?msg=...), shown once.
  useEffect(() => {
    const msg = params.get('msg');
    if (!msg) return;
    toast({ kind: /failed|not added|cancelled/i.test(msg) ? 'warn' : 'success', title: msg });
    params.delete('msg');
    setParams(params, { replace: true });
  }, [params, setParams, toast]);
  const status = (s) => cfg.entityStatuses[s] || { label: s, tone: 'neutral' };
  const connectorLabel = (id) => cfg.connectors.find((c) => c.id === id)?.label || id;

  const grouped = useMemo(() => {
    const m = new Map();
    for (const e of data?.entities || []) {
      if (q && !e.name.toLowerCase().includes(q.toLowerCase())) continue;
      const k = e.groupName || 'Ungrouped';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [data, q]);

  const act = async (fn, ok) => {
    try { const r = await fn(); if (r?.redirect) { window.location.href = r.redirect; return; } toast({ title: ok }); reload(); }
    catch (e) { toast({ kind: 'error', title: 'Action failed', body: e.message }); }
  };

  const atLimit = data?.limits.maxEntities != null && data.limits.used >= data.limits.maxEntities;

  return (
    <>
      <PageHeader
        title="Entities"
        subtitle={data ? `${data.limits.used}${data.limits.maxEntities != null ? ` of ${data.limits.maxEntities}` : ''} entities on the ${data.limits.plan} plan` : ''}
        actions={manage && <>
          {org.liveDashboard && (atLimit ? <Button disabled title="Plan limit reached">Connect QuickBooks company</Button> : <a className="btn btn-primary" href={connectUrl}>Connect QuickBooks company</a>)}
          <Button variant={org.liveDashboard ? 'secondary' : 'primary'} disabled={atLimit} title={atLimit ? 'Plan limit reached' : ''} onClick={() => setEditing({})}>Add entity</Button>
        </>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={3} />}
      {data && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input className="control max-w-xs" type="search" placeholder="Find entity…" value={q} onChange={(e) => setQ(e.target.value)} />
            {manage && (
              <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newGroup.trim()) act(() => api.post(`/orgs/${org.id}/groups`, { name: newGroup.trim() }), `Group ${newGroup.trim()} added`).then(() => setNewGroup('')); }}>
                <input className="control w-44" placeholder="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                <Button type="submit" disabled={!newGroup.trim()}>Add group</Button>
              </form>
            )}
          </div>

          {grouped.length === 0 && <Card><Empty title={q ? 'No entities match' : 'No entities yet'}>{manage && !q ? 'Add an entity to start syncing its books.' : null}</Empty></Card>}

          {grouped.map(([group, list]) => {
            const g = data.groups.find((x) => x.name === group);
            return (
              <Card key={group} className="overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3">
                  <h2 className="text-sm font-medium">{group} <span className="font-normal text-muted">{list.length}</span></h2>
                  {manage && g && list.length === 0 && <Button size="sm" variant="ghost" onClick={() => act(() => api.del(`/orgs/${org.id}/groups/${g.id}`), 'Group removed')}>Remove group</Button>}
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Entity</th><th>System</th><th>Status</th><th>Last sync</th>{manage && <th />}</tr></thead>
                    <tbody>
                      {list.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <div className="flex items-center gap-2 font-medium">{e.name}{e.dataSource === 'live' ? <Tag>Live</Tag> : <Tag>{cfg.sampleData.badge}</Tag>}</div>
                            {e.externalId && <div className="text-xs text-muted">Company ID {e.externalId}</div>}
                          </td>
                          <td className="text-ink2">{connectorLabel(e.connector)}</td>
                          <td><StatusBadge {...status(e.status)} /></td>
                          <td className="text-ink2">{timeAgo(e.lastSyncAt)}</td>
                          {manage && (
                            <td className="whitespace-nowrap text-right">
                              {e.status !== 'connected' && <Button size="sm" variant="primary" onClick={() => act(() => api.post(`/orgs/${org.id}/entities/${e.id}/connect`), `${e.name} connected`)}>{e.status === 'pending' ? 'Connect' : 'Reconnect'}</Button>}
                              <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>
                              <Button size="sm" variant="ghost" className="btn-danger" onClick={() => window.confirm(`Remove ${e.name}? Its sync history is deleted too.`) && act(() => api.del(`/orgs/${org.id}/entities/${e.id}`), `${e.name} removed`)}>Remove</Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          {manage && data.groups.filter((g) => !grouped.some(([n]) => n === g.name)).length > 0 && !q && (
            <p className="text-xs text-muted">
              Empty groups: {data.groups.filter((g) => !grouped.some(([n]) => n === g.name)).map((g) => (
                <button key={g.id} type="button" className="mr-2 underline" onClick={() => act(() => api.del(`/orgs/${org.id}/groups/${g.id}`), `Group ${g.name} removed`)}>{g.name} (remove)</button>
              ))}
            </p>
          )}
        </div>
      )}
      {editing && <EntityModal org={org} entity={editing} groups={data?.groups || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
