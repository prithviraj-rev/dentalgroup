import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, can } from '../App.jsx';
import { Button, Card, ErrorNote, Field, Loading, Modal, PageHeader, StatusBadge, timeAgo, useApi, useToast } from '../ui.jsx';

/** Role picker + entity checklist. Roles that see every entity hide the checklist. */
function AccessForm({ roles, entities, value, onChange }) {
  const role = roles.find((r) => r.id === value.role);
  const byGroup = useMemo(() => {
    const m = new Map();
    for (const e of entities) {
      const k = e.groupName || 'Ungrouped';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [entities]);
  const toggle = (id) => onChange({ ...value, entityIds: value.entityIds.includes(id) ? value.entityIds.filter((x) => x !== id) : [...value.entityIds, id] });
  const toggleGroup = (list) => {
    const ids = list.map((e) => e.id);
    const all = ids.every((id) => value.entityIds.includes(id));
    onChange({ ...value, entityIds: all ? value.entityIds.filter((x) => !ids.includes(x)) : [...new Set([...value.entityIds, ...ids])] });
  };

  return (
    <div className="grid gap-4">
      <Field label="Role">
        <div className="grid gap-2">
          {roles.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--ring)] px-3 py-2 text-sm">
              <input type="radio" className="mt-0.5" name="role" checked={value.role === r.id} onChange={() => onChange({ ...value, role: r.id })} />
              <span><span className="font-medium">{r.label}</span><span className="block text-xs text-muted">{r.description}</span></span>
            </label>
          ))}
        </div>
      </Field>
      {role && !role.seesAll && (
        <Field label={`Entity access · ${value.entityIds.length} selected`}>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--ring)] p-2">
            {byGroup.map(([group, list]) => (
              <div key={group} className="mb-2">
                <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                  <input type="checkbox" checked={list.every((e) => value.entityIds.includes(e.id))} onChange={() => toggleGroup(list)} />
                  {group}
                </label>
                {list.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 pl-6 text-sm hover:bg-[var(--wash)]">
                    <input type="checkbox" checked={value.entityIds.includes(e.id)} onChange={() => toggle(e.id)} />
                    {e.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Field>
      )}
      {role?.seesAll && <p className="text-xs text-muted">This role sees every entity in the organization, including ones added later.</p>}
    </div>
  );
}

export default function Users() {
  const { cfg, me } = useApp();
  const { org } = useOutletContext();
  const toast = useToast();
  const users = useApi(`/orgs/${org.id}/users`);
  const ents = useApi(`/orgs/${org.id}/entities`);
  const manage = can(org, 'users.manage');
  const [inviting, setInviting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const entities = ents.data?.entities || [];
  const entityName = (id) => entities.find((e) => e.id === id)?.name;
  const roles = (users.data?.roles || []).slice().sort((a, b) => (cfg.roles[a.id]?.order ?? 99) - (cfg.roles[b.id]?.order ?? 99));

  const submitInvite = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/orgs/${org.id}/users`, inviting);
      toast({ title: `Invited ${inviting.name}`, body: r.note });
      setInviting(null); users.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const submitEdit = async () => {
    setBusy(true); setError(null);
    try {
      await api.patch(`/orgs/${org.id}/users/${editing.id}`, { role: editing.role, entityIds: editing.entityIds });
      toast({ title: `Updated ${editing.name}` });
      setEditing(null); users.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Remove ${u.name} from ${org.name}?`)) return;
    try { await api.del(`/orgs/${org.id}/users/${u.id}`); toast({ title: `${u.name} removed` }); users.reload(); }
    catch (e) { toast({ kind: 'error', title: 'Could not remove', body: e.message }); }
  };

  const limits = users.data?.limits;
  const atLimit = limits?.maxUsers != null && limits.used >= limits.maxUsers;

  return (
    <>
      <PageHeader
        title="Users & access"
        subtitle={limits ? `${limits.used}${limits.maxUsers != null ? ` of ${limits.maxUsers}` : ''} users on the ${limits.plan} plan` : ''}
        actions={manage && <Button variant="primary" disabled={atLimit} onClick={() => { setError(null); setInviting({ name: '', email: '', role: cfg.defaultInviteRole, entityIds: [] }); }}>Invite user</Button>}
      />
      {users.error && <ErrorNote error={users.error} onRetry={users.reload} />}
      {users.loading && !users.data && <Loading rows={3} />}
      {users.data && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>User</th><th>Role</th><th>Entity access</th><th>Status</th><th>Last sign-in</th>{manage && <th />}</tr></thead>
              <tbody>
                {users.data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">{u.name}{u.id === me.user.id && <span className="ml-1 text-xs text-muted">(you)</span>}</div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </td>
                    <td>{cfg.roles[u.role]?.label || u.role}</td>
                    <td className="max-w-xs text-ink2">
                      {u.seesAll ? 'All entities' : u.entityIds.length === 0 ? <span style={{ color: 'var(--critical)' }}>None</span>
                        : <span title={u.entityIds.map(entityName).filter(Boolean).join(', ')}>{u.entityIds.length} of {entities.length}: {u.entityIds.slice(0, 2).map(entityName).filter(Boolean).join(', ')}{u.entityIds.length > 2 ? '…' : ''}</span>}
                    </td>
                    <td><StatusBadge label={u.status === 'invited' ? 'Invited' : 'Active'} tone={u.status === 'invited' ? 'warning' : 'good'} /></td>
                    <td className="text-ink2">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</td>
                    {manage && (
                      <td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing({ ...u }); }}>Edit access</Button>
                        <Button size="sm" variant="ghost" className="btn-danger" onClick={() => remove(u)}>Remove</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inviting && (
        <Modal open title="Invite user" wide onClose={() => setInviting(null)} footer={<>
          <Button onClick={() => setInviting(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitInvite} disabled={busy || !inviting.name || !inviting.email}>{busy ? 'Inviting…' : 'Send invite'}</Button>
        </>}>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><input className="control" value={inviting.name} onChange={(e) => setInviting({ ...inviting, name: e.target.value })} /></Field>
              <Field label="Email"><input className="control" type="email" value={inviting.email} onChange={(e) => setInviting({ ...inviting, email: e.target.value })} /></Field>
            </div>
            <AccessForm roles={roles} entities={entities} value={inviting} onChange={setInviting} />
            {cfg.auth.demoMode && <p className="text-xs text-muted">Demo mode: no email is sent. The new user signs in with the demo password.</p>}
          </div>
          {error && <p className="mt-3 text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
        </Modal>
      )}

      {editing && (
        <Modal open title={`Access for ${editing.name}`} wide onClose={() => setEditing(null)} footer={<>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
          <AccessForm roles={roles} entities={entities} value={editing} onChange={setEditing} />
          {error && <p className="mt-3 text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
        </Modal>
      )}
    </>
  );
}
