import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Button, Card, Empty, ErrorNote, Field, Kpi, Loading, Modal, PageHeader, StatusBadge, Tag, timeAgo, useApi, useToast } from '../ui.jsx';

function NewOrgModal({ open, onClose, onCreated }) {
  const { cfg } = useApp();
  const toast = useToast();
  const d = cfg.orgDefaults;
  const blank = { name: '', industry: d.industry, plan: d.plan, currency: d.currency, brandColor: d.brandColor, adminName: '', adminEmail: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/admin/organizations', f);
      toast({ title: `${f.name} created`, body: cfg.auth.demoMode ? `${f.adminEmail} can sign in with the demo password.` : 'The admin has been invited.' });
      setF(blank);
      onCreated(r.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New organization" wide footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={busy || !f.name || !f.adminEmail || !f.adminName}>{busy ? 'Creating…' : 'Create organization'}</Button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organization name" className="sm:col-span-2"><input className="control" value={f.name} onChange={set('name')} placeholder="Acme Dental Partners" /></Field>
        <Field label="Industry">
          <select className="control" value={f.industry} onChange={set('industry')}>{cfg.industries.map((i) => <option key={i}>{i}</option>)}</select>
        </Field>
        <Field label="Plan">
          <select className="control" value={f.plan} onChange={set('plan')}>
            {cfg.plans.map((p) => <option key={p.id} value={p.id}>{p.label}{p.maxEntities ? ` · up to ${p.maxEntities} entities` : ' · unlimited'}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select className="control" value={f.currency} onChange={set('currency')}>{cfg.options.currencies.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Brand color">
          <div className="flex h-9 items-center gap-2">
            {cfg.options.brandColors.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, brandColor: c })} aria-label={c} aria-pressed={f.brandColor === c}
                className="h-6 w-6 rounded-full" style={{ background: c, boxShadow: f.brandColor === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }} />
            ))}
          </div>
        </Field>
        <div className="sm:col-span-2 border-t border-[var(--line)] pt-3 text-sm font-medium">First administrator</div>
        <Field label="Name"><input className="control" value={f.adminName} onChange={set('adminName')} /></Field>
        <Field label="Email"><input className="control" type="email" value={f.adminEmail} onChange={set('adminEmail')} /></Field>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
    </Modal>
  );
}

export default function Organizations() {
  const { cfg, refreshMe } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/admin/organizations');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => (data?.organizations || []).filter((o) => !q || `${o.name} ${o.industry}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const setStatus = async (o, status) => {
    try {
      await api.patch(`/admin/organizations/${o.id}`, { status });
      toast({ title: `${o.name}: ${cfg.orgStatuses[status].label}` });
      reload();
      refreshMe();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not update', body: e.message });
    }
  };

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Every client on the platform, their entities, users and sync health."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>New organization</Button>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={3} />}
      {data && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Organizations" value={data.totals.organizations} sub={`${data.totals.active} active or on trial`} />
            <Kpi label="Entities" value={data.totals.entities} />
            <Kpi label="Users" value={data.totals.users} />
            <Kpi label="Entities needing attention" value={data.totals.attention} sub="Sync errors or expired connections" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <h2 className="text-sm font-medium">All organizations</h2>
              <input className="control max-w-xs" type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="mt-3 overflow-x-auto">
              {rows.length === 0 ? <Empty title="No organizations match" /> : (
                <table className="table">
                  <thead>
                    <tr><th>Organization</th><th>Plan</th><th>Status</th><th className="text-right">Entities</th><th className="text-right">Users</th><th>Last sync</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => {
                      const st = cfg.orgStatuses[o.status] || { label: o.status, tone: 'neutral' };
                      return (
                        <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/o/${o.id}/overview`)}>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-3 w-3 shrink-0 rounded" style={{ background: o.brandColor }} aria-hidden="true" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 font-medium">{o.name}{o.liveDashboard && <Tag>Live reports</Tag>}</div>
                                <div className="text-xs text-muted">{o.industry}</div>
                              </div>
                            </div>
                          </td>
                          <td>{o.planLabel}</td>
                          <td><StatusBadge label={st.label} tone={st.tone} /></td>
                          <td className="tabular text-right">
                            {o.entityCount}
                            {o.attentionCount > 0 && <div className="text-xs" style={{ color: 'var(--critical)' }}>{o.attentionCount} need attention</div>}
                          </td>
                          <td className="tabular text-right">{o.userCount}</td>
                          <td className="text-ink2">{timeAgo(o.lastSyncAt)}</td>
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            {o.status === 'suspended'
                              ? <Button size="sm" onClick={() => setStatus(o, 'active')}>Reactivate</Button>
                              : cfg.orgStatuses.suspended && <Button size="sm" variant="ghost" onClick={() => setStatus(o, 'suspended')}>Suspend</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}
      <NewOrgModal open={creating} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await refreshMe(); reload(); navigate(`/o/${id}/overview`); }} />
    </>
  );
}
