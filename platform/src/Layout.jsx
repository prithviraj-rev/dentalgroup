import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
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
  palette: 'M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 22 9.8C22 6 17.5 3 12 3zM7.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
};

function Icon({ name }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] || ICONS.list} />
    </svg>
  );
}

function OrgSwitcher({ orgs, current, home }) {
  const navigate = useNavigate();
  const loc = useLocation();
  if (orgs.length <= 1 && current) {
    return <div className="truncate px-1 text-sm font-medium" title={current.name}>{current.name}</div>;
  }
  const section = loc.pathname.split('/')[3] || home;
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
  // Desktop sidebar folded to icons (remembered per browser).
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem('lv.sidebar') === 'folded'; } catch { return false; } });
  const toggleFold = () => setFolded((f) => { const n = !f; try { localStorage.setItem('lv.sidebar', n ? 'folded' : 'open'); } catch { /* private window */ } return n; });
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  // Organization brand color drives the accent everywhere in the shell.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', org?.brandColor || cfg.theme?.colors?.accent || cfg.platform.primaryColor);
  }, [org, cfg]);

  // One banner on every page (VJ 2026-10-30): the embedded dashboard brings its own tab row as the banner on Reports; every other
  // page gets the SAME banner from the shell (the dashboard's title, its tabs linking to Reports, Manage connections), level with
  // the sidebar's brand strip. The tabs open the reports of the current organization, or of the first one with live reports.
  const embedded = /\/o\/[^/]+\/reports$/.test(loc.pathname) && Boolean(org?.liveDashboard) && cfg.reports?.embed?.enabled !== false;
  const reportsOrg = org || me.orgs.find((o) => o.liveDashboard) || null;
  const reportsTabs = reportsOrg ? cfg.reports?.tabs || [] : [];
  const navItems = org ? cfg.navigation.org.filter((n) => n.enabled !== false && (!n.permission || can(org, n.permission))) : [];
  const roleLabel = org ? cfg.roles[org.role]?.label : me.user.isPlatformAdmin ? cfg.roles.platform_admin.label : '';
  const initials = String(me.user.name || me.user.email || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  const sidebar = (mini = false) => (
    <nav className={`flex h-full flex-col gap-4 ${mini ? 'mini items-center p-2' : 'p-3'}`}>
      <button type="button" onClick={toggleFold} title={mini ? 'Expand the menu' : 'Collapse the menu'} aria-label={`${cfg.platform.name}: ${mini ? 'expand' : 'collapse'} the menu`}
        className={`brand brand-strip flex items-center gap-2 text-left ${mini ? 'justify-center' : ''}`}>
        {cfg.theme?.brand?.logoUrl ? <img className="logo h-8 w-8 shrink-0 rounded-lg object-contain" src={cfg.theme.brand.logoUrl} alt="" />
          : <span className="logo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold">{cfg.theme?.brand?.logoText || cfg.platform.logoText}</span>}
        {!mini && <span className="text-[15px] font-semibold tracking-wide">{cfg.platform.name}</span>}
      </button>

      {me.user.isPlatformAdmin && (
        <div className="flex flex-col gap-0.5">
          {!mini && <div className="side-label px-2 pb-1 text-[11px] uppercase tracking-wide">Platform</div>}
          {cfg.navigation.platform.filter((n) => n.enabled !== false).map((n) => (
            <NavLink key={n.id} to={n.path || '/admin'} end title={mini ? n.label : undefined} className={({ isActive }) => `nav-item ${mini ? 'justify-center' : ''} ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{!mini && n.label}
            </NavLink>
          ))}
        </div>
      )}

      {!mini && (
        <div className="flex flex-col gap-2">
          <div className="side-label px-2 text-[11px] uppercase tracking-wide">Organization</div>
          <OrgSwitcher orgs={me.orgs} current={org} home={cfg.navigation.home} />
        </div>
      )}

      {org && (
        <div className="flex flex-col gap-0.5">
          {navItems.map((n) => (
            <NavLink key={n.id} to={`/o/${org.id}/${n.id}`} title={mini ? n.label : undefined} className={({ isActive }) => `nav-item ${mini ? 'justify-center' : ''} ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{!mini && n.label}
            </NavLink>
          ))}
        </div>
      )}

      <div className={`side-foot mt-auto pt-3 ${mini ? 'w-full' : ''}`}>
        {mini ? (
          <span className="avatar mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold" title={`${me.user.name}\n${me.user.email}`}>{initials}</span>
        ) : <>
          <div className="flex items-center gap-2 px-1">
            <span className="avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{initials}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.user.name}</div>
              <div className="side-muted truncate text-xs">{roleLabel || me.user.email}</div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm mt-2 w-full justify-start" onClick={signOut}>Sign out</button>
        </>}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* VJ 2026-10-30: no collapse handle; a click anywhere on the sidebar outside its items (brand, links, buttons, the
          organization switcher, the user block) folds it to icons; a click on the folded bar outside its icons opens it again. */}
      <aside className={`sidebar relative sticky top-0 hidden h-screen shrink-0 cursor-pointer transition-[width] lg:block ${folded ? 'w-14' : 'w-60'}`}
        title={folded ? 'Click to open the menu' : 'Click an empty spot to collapse the menu'}
        onClick={(e) => { if (e.target.closest('a, button, select, input, label, [role=button]')) return; toggleFold(); }}>
        {sidebar(folded)}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="sidebar relative h-full w-72 max-w-[85vw] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {sidebar(false)}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="topbar sticky top-0 z-30 flex items-center gap-3 px-3 py-2 shadow-md lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
            className="menu-btn flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            Menu
          </button>
          <span className="truncate font-medium">{org?.name || cfg.platform.name}</span>
        </header>
        {!embedded && (
          <div className="page-banner hidden lg:flex">
            <div className="flex min-w-0 items-center">
              {reportsTabs.length > 0 && (
                <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Reports">
                  {reportsTabs.map((t) => <Link key={t.id} className="tab" to={`/o/${reportsOrg.id}/reports?tab=${encodeURIComponent(t.id)}`}>{t.label}</Link>)}
                </nav>
              )}
            </div>
            {me.user.isPlatformAdmin && <a className="banner-link" href="/connections" target="_blank" rel="noreferrer">Manage connections ↗</a>}
          </div>
        )}
        <main className="w-full px-3 py-3 sm:px-4 sm:py-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
