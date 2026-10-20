import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api } from './api.js';
import { ToastProvider, ErrorNote, Loading } from './ui.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Organizations from './pages/Organizations.jsx';
import Overview from './pages/Overview.jsx';
import Reports from './pages/Reports.jsx';
import Entities from './pages/Entities.jsx';
import Users from './pages/Users.jsx';
import Sync from './pages/Sync.jsx';
import Activity from './pages/Activity.jsx';
import Settings from './pages/Settings.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/** Permission check for the current organization, using the role permissions from platform.config.json. */
export function can(org, perm) {
  return Boolean(org?.permissions?.includes('*') || org?.permissions?.includes(perm));
}

function Root() {
  const [cfg, setCfg] = useState(null);
  const [me, setMe] = useState(undefined); // undefined = loading, null = signed out
  const [error, setError] = useState(null);

  const refreshMe = useCallback(() => api.get('/me').then(setMe).catch((e) => (e.status === 401 ? setMe(null) : setError(e.message))), []);
  useEffect(() => {
    api.get('/config').then((c) => { setCfg(c); document.title = c.platform.name; }).catch((e) => setError(e.message));
    refreshMe();
  }, [refreshMe]);

  if (error) return <div className="mx-auto max-w-lg p-6"><ErrorNote error={error} onRetry={() => window.location.reload()} /></div>;
  if (!cfg || me === undefined) return <div className="mx-auto max-w-lg p-6"><Loading rows={2} /></div>;

  const value = { cfg, me, setMe, refreshMe, signOut: async () => { await api.post('/logout'); setMe(null); } };
  return (
    <AppCtx.Provider value={value}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={me?.user.isPlatformAdmin ? <Organizations /> : <Navigate to="/" replace />} />
            <Route path="/o/:orgId" element={<OrgScope />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<Guard module="overview"><Overview /></Guard>} />
              <Route path="reports" element={<Guard module="reports"><Reports /></Guard>} />
              <Route path="entities" element={<Guard module="entities"><Entities /></Guard>} />
              <Route path="users" element={<Guard module="users"><Users /></Guard>} />
              <Route path="sync" element={<Guard module="sync"><Sync /></Guard>} />
              <Route path="activity" element={<Guard module="activity"><Activity /></Guard>} />
              <Route path="settings" element={<Guard module="settings"><Settings /></Guard>} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppCtx.Provider>
  );
}

function RequireAuth() {
  const { me } = useApp();
  const loc = useLocation();
  return me ? <Outlet /> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}

function Home() {
  const { me } = useApp();
  if (me.user.isPlatformAdmin) return <Navigate to="/admin" replace />;
  if (me.orgs[0]) return <Navigate to={`/o/${me.orgs[0].id}/overview`} replace />;
  return <div className="p-6 text-sm text-ink2">Your account is not part of any active organization yet.</div>;
}

/** Resolves the organization from the URL and exposes it to pages. */
function OrgScope() {
  const { me } = useApp();
  const { orgId } = useParams();
  const org = me.orgs.find((o) => String(o.id) === orgId);
  if (!org) return <Navigate to="/" replace />;
  return <Outlet key={org.id} context={{ org }} />;
}

/** Hides a module that is disabled in config or not permitted for the user's role. */
function Guard({ module, children }) {
  const { cfg, me } = useApp();
  const { orgId } = useParams();
  const org = me.orgs.find((o) => String(o.id) === orgId);
  const item = cfg.navigation.org.find((n) => n.id === module);
  if (!item || item.enabled === false || (item.permission && !can(org, item.permission))) return <Navigate to={`/o/${orgId}/overview`} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <ToastProvider>
        <Root />
      </ToastProvider>
    </BrowserRouter>
  );
}
