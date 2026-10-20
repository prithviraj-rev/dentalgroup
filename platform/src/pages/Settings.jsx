import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Button, Card, ErrorNote, Field, Loading, PageHeader, useApi, useToast } from '../ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Settings() {
  const { cfg, me, refreshMe } = useApp();
  const { org } = useOutletContext();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/orgs/${org.id}/settings`);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setF(data.organization); }, [data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/orgs/${org.id}/settings`, f);
      toast({ title: 'Settings saved' });
      await refreshMe();
      reload();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save', body: err.message });
    } finally {
      setBusy(false);
    }
  };

  const plan = cfg.plans.find((p) => p.id === org.plan);

  return (
    <>
      <PageHeader title="Settings" subtitle={org.name} />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !f && <Loading rows={2} />}
      {f && (
        <form className="grid gap-4 lg:grid-cols-3" onSubmit={save}>
          <Card className="grid gap-4 p-5 lg:col-span-2 sm:grid-cols-2">
            <h2 className="text-sm font-medium sm:col-span-2">Organization</h2>
            <Field label="Name" className="sm:col-span-2"><input className="control" value={f.name} onChange={set('name')} required /></Field>
            <Field label="Industry">
              <select className="control" value={f.industry || ''} onChange={set('industry')}>{cfg.industries.map((i) => <option key={i}>{i}</option>)}</select>
            </Field>
            <Field label="Currency" hint="Used for figures on the overview.">
              <select className="control" value={f.currency} onChange={set('currency')}>{cfg.options.currencies.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
            <Field label="Time zone">
              <select className="control" value={f.timezone} onChange={set('timezone')}>{cfg.options.timezones.map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Fiscal year starts">
              <select className="control" value={f.fiscalYearStart} onChange={(e) => setF({ ...f, fiscalYearStart: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <Field label="Sync schedule" className="sm:col-span-2">
              <select className="control" value={f.syncSchedule} onChange={set('syncSchedule')}>{cfg.options.syncSchedules.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </Field>
            <Field label="Brand color" hint="Used for the accent color across this organization." className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                {cfg.options.brandColors.map((c) => (
                  <button key={c} type="button" onClick={() => setF({ ...f, brandColor: c })} aria-label={c} aria-pressed={f.brandColor === c}
                    className="h-7 w-7 rounded-full" style={{ background: c, boxShadow: f.brandColor === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }} />
                ))}
              </div>
            </Field>
            <div className="sm:col-span-2"><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button></div>
          </Card>

          <div className="grid content-start gap-4">
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-medium">Plan</h2>
              <div className="text-lg font-semibold">{plan?.label || org.plan}</div>
              <ul className="mt-2 text-ink2">
                <li>{plan?.maxEntities != null ? `Up to ${plan.maxEntities} entities` : 'Unlimited entities'}</li>
                <li>{plan?.maxUsers != null ? `Up to ${plan.maxUsers} users` : 'Unlimited users'}</li>
              </ul>
              <p className="mt-2 text-xs text-muted">{me.user.isPlatformAdmin ? 'Change the plan from the Organizations page.' : `Contact ${cfg.platform.supportEmail} to change plans.`}</p>
            </Card>
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-medium">Reports</h2>
              <p className="text-ink2">{org.liveDashboard ? 'Live reports are on. The P&L dashboard is embedded under Reports.' : 'Live reports are not enabled for this organization yet.'}</p>
              {me.user.isPlatformAdmin && (
                <Button size="sm" className="mt-3" onClick={async () => {
                  await api.patch(`/admin/organizations/${org.id}`, { liveDashboard: !org.liveDashboard });
                  await refreshMe();
                  toast({ title: `Live reports ${org.liveDashboard ? 'off' : 'on'}` });
                }}>{org.liveDashboard ? 'Turn off live reports' : 'Turn on live reports'}</Button>
              )}
            </Card>
          </div>
        </form>
      )}
    </>
  );
}
