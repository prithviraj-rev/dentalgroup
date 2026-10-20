import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useApp, can } from './App.jsx';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  building: 'M4 21V5l8-3 8 3v16M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6m13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.3-1.3L14.3 3h-4l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1c.7.6 1.4 1 2.2 1.3l.4 2.4h4l.4-2.4c.8-.3 1.6-.7 2.3-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
};

function Icon({ name }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ICONS.list} />
    </svg>
  );
}

function OrgSwitcher({ orgs, current }) {
  const navigate = useNavigate();
  const loc = useLocation();
  if (orgs.length <= 1 && current) {
    return <div className="truncate px-1 text-sm font-medium" title={current.name}>{current.name}</div>;
  }
  const section = loc.pathname.split('/')[3] || 'overview';
  return (
    <select
      className="control" aria-label="Organization" value={current?.id ?? ''}
      onChange={(e) => e.target.value && navigate(`/o/${e.target.value}/${section}`)}
    >
      {!current && <option value="">Choose an organization…</option>}
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

export default function Layout() {
  const { cfg, me, signOut } = useApp();
  const match = useMatch('/o/:orgId/*');
  const org = match ? me.orgs.find((o) => String(o.id) === match.params.orgId) : null;
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  // Organization brand color drives the accent everywhere in the shell.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', org?.brandColor || cfg.platform.primaryColor);
  }, [org, cfg]);

  const navItems = org ? cfg.navigation.org.filter((n) => n.enabled !== false && (!n.permission || can(org, n.permission))) : [];
  const roleLabel = org ? cfg.roles[org.role]?.label : me.user.isPlatformAdmin ? cfg.roles.platform_admin.label : '';

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: cfg.platform.primaryColor }}>{cfg.platform.logoText}</span>
        <span className="font-semibold">{cfg.platform.name}</span>
      </div>

      {me.user.isPlatformAdmin && (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Platform</div>
          {cfg.navigation.platform.filter((n) => n.enabled !== false).map((n) => (
            <NavLink key={n.id} to="/admin" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="px-2 text-[11px] uppercase tracking-wide text-muted">Organization</div>
        <OrgSwitcher orgs={me.orgs} current={org} />
      </div>

      {org && (
        <div className="flex flex-col gap-0.5">
          {navItems.map((n) => (
            <NavLink key={n.id} to={`/o/${org.id}/${n.id}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </div>
      )}

      <div className="mt-auto border-t border-[var(--line)] pt-3">
        <div className="px-1 text-sm font-medium">{me.user.name}</div>
        <div className="truncate px-1 text-xs text-muted">{me.user.email}</div>
        {roleLabel && <div className="px-1 text-xs text-ink2">{roleLabel}</div>}
        <button type="button" className="btn btn-ghost btn-sm mt-2 w-full justify-start" onClick={signOut}>Sign out</button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-[var(--line)] bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="relative h-full w-72 max-w-[85vw] overflow-y-auto bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-ink2 hover:bg-page">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--line)] bg-page/95 px-3 py-2 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-[var(--line)] bg-surface px-3 text-sm font-medium text-ink shadow-sm active:bg-page">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            Menu
          </button>
          <span className="truncate font-medium">{org?.name || cfg.platform.name}</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
