import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Button, Field } from '../ui.jsx';

export default function Login() {
  const { cfg, setMe } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [demo, setDemo] = useState(null);

  useEffect(() => {
    if (cfg.auth.showDemoAccounts) api.get('/demo-accounts').then(setDemo).catch(() => {});
  }, [cfg]);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post('/login', creds || { email, password });
      setMe(me);
      navigate(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Group demo accounts by organization for the picker.
  const groups = {};
  for (const a of demo?.accounts || []) (groups[a.org || 'Platform'] ||= []).push(a);

  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-[8vh]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: cfg.platform.primaryColor }}>{cfg.platform.logoText}</span>
          <div>
            <div className="text-lg font-semibold">{cfg.platform.name}</div>
            <div className="text-sm text-ink2">{cfg.platform.tagline}</div>
          </div>
        </div>

        <form className="card flex flex-col gap-4 p-6" onSubmit={submit}>
          <h1 className="text-base font-medium">Sign in</h1>
          <Field label="Email">
            <input className="control" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="control" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <div className="text-sm" style={{ color: 'var(--critical)' }}>{error}</div>}
          <Button variant="primary" type="submit" disabled={busy} style={{ background: cfg.platform.primaryColor }}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="text-xs text-muted">Trouble signing in? Contact {cfg.platform.supportEmail}.</p>
        </form>

        {demo?.accounts?.length > 0 && (
          <div className="card mt-4 p-4">
            <div className="mb-1 text-sm font-medium">Demo accounts</div>
            <p className="mb-3 text-xs text-muted">Sample data. Every account uses the password <code className="rounded bg-[var(--wash)] px-1">{demo.password}</code>. Pick one to sign in.</p>
            <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
              {Object.entries(groups).map(([org, accounts]) => (
                <div key={org}>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{org}</div>
                  <div className="flex flex-col">
                    {accounts.map((a) => (
                      <button
                        key={`${org}-${a.email}`} type="button" disabled={busy}
                        onClick={() => submit(null, { email: a.email, password: demo.password })}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--wash)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{a.name}</span>
                          <span className="block truncate text-xs text-muted">{a.email}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink2">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
