// Theme page (platform admins): pick the colours of the banner, side panel, button rows, table headers, page and cards, plus the
// logo, for every user of the dashboard and Ledgerview. Picks preview live in this shell (the Reports tab picks them up when it
// next loads); Save keeps them in the database (server/theme.js), Reset all returns to config/theme.json.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { applyTheme, useApp } from '../App.jsx';
import { Button, Card, ErrorNote, Field, Loading, PageHeader, useApi, useToast } from '../ui.jsx';

const toHex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c) ? `#${c.slice(1).split('').map((x) => x + x).join('')}`.toLowerCase() : null);

/** Every token's on-screen value for one mode: the set value, else the token it follows, else the stylesheet default. */
function effective(groups, colors, mode) {
  const byKey = Object.fromEntries(groups.flatMap((g) => g.tokens.map((t) => [t.key, t])));
  const of = (k, seen = new Set()) => { if (colors[k]) return colors[k]; const t = byKey[k]; if (t.inherits && !seen.has(k)) { seen.add(k); return of(t.inherits, seen); } return t[mode]; };
  return Object.fromEntries(Object.keys(byKey).map((k) => [k, of(k)]));
}
const cssOf = (groups, draft) => {
  const v = Object.fromEntries(groups.flatMap((g) => g.tokens.map((t) => [t.key, t.css])));
  const decl = (o) => Object.entries(o).map(([k, c]) => `${v[k]}: ${c};`).join(' ');
  return [Object.keys(draft.colors).length ? `:root { ${decl(draft.colors)} }` : '', Object.keys(draft.dark).length ? `@media (prefers-color-scheme: dark) { :root { ${decl(draft.dark)} } }` : ''].filter(Boolean).join('\n');
};

export default function Theme() {
  const { cfg, setCfg } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/admin/theme');
  const [draft, setDraft] = useState(null); // { brand, colors, dark } = the set tokens (file defaults + saved picks)
  const [mode, setMode] = useState('light');
  const [busy, setBusy] = useState(false);
  const savedCss = useRef(cfg.theme?.css || '');

  useEffect(() => { if (data) { setDraft({ brand: { ...data.theme.brand }, colors: { ...data.theme.colors }, dark: { ...data.theme.dark } }); savedCss.current = data.theme.css; } }, [data]);
  // Live preview in this shell while editing; what was saved comes back when the page is left.
  useEffect(() => { if (draft && data) applyTheme({ css: cssOf(data.groups, draft) }); }, [draft, data]);
  useEffect(() => () => applyTheme({ css: savedCss.current }), []);

  const groups = data?.groups || [];
  const layer = mode === 'light' ? 'colors' : 'dark';
  const eff = useMemo(() => (draft ? effective(groups, mode === 'light' ? draft.colors : { ...draft.colors, ...draft.dark }, mode) : {}), [groups, draft, mode]);
  const labelOf = (key) => groups.flatMap((g) => g.tokens).find((t) => t.key === key)?.label || key;
  const setColor = (key, value) => setDraft((d) => ({ ...d, [layer]: { ...d[layer], [key]: value } }));
  const unset = (key) => setDraft((d) => { const o = { ...d[layer] }; delete o[key]; return { ...d, [layer]: o }; });

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/theme', draft);
      savedCss.current = r.theme.css;
      setCfg({ ...cfg, theme: r.theme });
      toast({ title: 'Theme saved', body: 'Everyone sees the new colours when their page next loads; the Reports tab too.' });
      reload();
    } catch (err) { toast({ kind: 'error', title: 'Could not save', body: err.message }); } finally { setBusy(false); }
  };
  const resetAll = async () => {
    if (!window.confirm('Return every colour and the logo to the defaults of config/theme.json?')) return;
    setBusy(true);
    try {
      const r = await api.del('/admin/theme');
      savedCss.current = r.theme.css;
      setCfg({ ...cfg, theme: r.theme });
      toast({ title: 'Theme reset' });
      reload();
    } catch (err) { toast({ kind: 'error', title: 'Could not reset', body: err.message }); } finally { setBusy(false); }
  };

  const brand = draft?.brand || {};
  const logoText = brand.logoText || cfg.platform.logoText;
  const preview = (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: eff.line, background: eff.page, color: eff.ink }}>
      <div className="flex items-center gap-3 px-3 py-2 text-sm font-semibold" style={{ background: `linear-gradient(90deg, ${eff.banner}, ${eff.banner2})`, color: eff.bannerInk }}>
        {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-6 w-6 rounded object-contain" style={{ background: '#fff' }} /> : <span className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold" style={{ background: '#fff', color: eff.banner }}>{logoText}</span>}
        <span>Banner</span>
        <span className="relative pb-1 font-medium">Open tab<span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t" style={{ background: eff.bannerMark }} /></span>
        <span className="font-medium opacity-80">Tab</span>
      </div>
      <div className="flex">
        <div className="flex w-24 shrink-0 flex-col gap-1 p-2 text-[11px]" style={{ background: `linear-gradient(180deg, ${eff.sidebar}, ${eff.sidebar2})`, color: eff.sidebarInk }}>
          <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: 'rgba(255,255,255,0.14)', boxShadow: `inset 3px 0 0 ${eff.sidebarMark}` }}>Reports</span>
          <span className="px-1.5 py-0.5 opacity-80">Entities</span><span className="px-1.5 py-0.5 opacity-80">Users</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 text-[11px]" style={{ background: eff.toolbar, borderColor: eff.toolbarLine }}>
            <span className="rounded border px-1.5 py-0.5" style={{ background: eff.button, color: eff.buttonInk, borderColor: eff.line }}>Select companies</span>
            <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: eff.pressed, color: eff.pressedInk }}>Cash</span>
            <span className="rounded border px-1.5 py-0.5" style={{ background: eff.button, color: eff.buttonInk, borderColor: eff.line }}>Accrual</span>
            <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: eff.pressed, color: eff.pressedInk }}>YTD</span>
          </div>
          <table className="w-full rounded-md text-[11px]" style={{ background: eff.surface, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead><tr style={{ background: eff.tableHead, color: eff.tableHeadInk }}><th className="px-2 py-1 text-left font-medium uppercase">Company</th><th className="px-2 py-1 text-right font-medium uppercase" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>Collections</th><th className="px-2 py-1 text-right font-medium uppercase" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>EBITDA</th></tr></thead>
            <tbody>
              <tr style={{ borderTop: `1px solid ${eff.line}` }}><td className="px-2 py-1">Admire Dental</td><td className="px-2 py-1 text-right" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>$123,154</td><td className="px-2 py-1 text-right" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>$39,019</td></tr>
              <tr className="font-semibold" style={{ background: eff.totalRow }}><td className="px-2 py-1">Dental total</td><td className="px-2 py-1 text-right" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>$322,867</td><td className="px-2 py-1 text-right" style={{ borderLeft: `1px solid ${eff.tableLine}` }}>-$245,684</td></tr>
            </tbody>
          </table>
          <div className="text-[11px]"><span style={{ color: eff.accent }}>Synopsis P&amp;L</span> · <span style={{ color: eff.ink2 }}>Sept 2026</span> · <span style={{ color: eff.muted }}>Compared 12 companies</span> · <span style={{ color: eff.good }}>▲ 4.2%</span> <span style={{ color: eff.bad }}>▼ 1.1%</span></div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Theme" subtitle="Colours and logo of the dashboard and Ledgerview, for every user"
        actions={<>
          <div className="seg" role="group" aria-label="Mode"><button type="button" aria-pressed={mode === 'light'} onClick={() => setMode('light')}>Light</button><button type="button" aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>Dark</button></div>
          <Button variant="danger" onClick={resetAll} disabled={busy || !draft}>Reset all</Button>
          <Button variant="primary" onClick={save} disabled={busy || !draft}>{busy ? 'Saving…' : 'Save theme'}</Button>
        </>} />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !draft && <Loading />}
      {draft && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-4">
            {groups.map((g) => (
              <Card key={g.id} className="p-4">
                <h2 className="text-sm font-semibold">{g.label}</h2>
                {g.hint && <p className="text-xs text-muted">{g.hint}</p>}
                <div className="mt-2 divide-y divide-[var(--line)]">
                  {g.tokens.map((t) => {
                    const set = draft[layer][t.key];
                    const value = eff[t.key] || '';
                    const hex = toHex(value);
                    const status = set ? 'set here' : t.inherits && !draft.colors[t.inherits] && !(mode === 'dark' && draft.dark[t.inherits]) ? `follows ${labelOf(t.inherits)}` : t.inherits ? `follows ${labelOf(t.inherits)}` : 'default';
                    return (
                      <div key={t.key} className="flex flex-wrap items-center gap-3 py-2">
                        <input type="color" aria-label={`${t.label} colour`} value={hex || '#000000'} onChange={(e) => setColor(t.key, e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0.5" />
                        <input className="control w-32 shrink-0 font-mono text-xs" style={{ width: 128 }} aria-label={`${t.label} value`} value={value} onChange={(e) => setColor(t.key, e.target.value)} placeholder="#rrggbb" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{t.label}</div>
                          {t.hint && <div className="truncate text-xs text-muted">{t.hint}</div>}
                        </div>
                        <span className="text-xs text-muted">{status}</span>
                        {set && <button type="button" className="btn btn-ghost btn-sm" onClick={() => unset(t.key)} title="Back to the default">↺ Reset</button>}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
          <div className="grid content-start gap-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Preview ({mode})</h2>
              <p className="mb-2 text-xs text-muted">The side panel and this page already use the picks; the dashboard does when it next loads.</p>
              {preview}
            </Card>
            <Card className="grid gap-3 p-4">
              <h2 className="text-sm font-semibold">Logo</h2>
              <Field label="Logo image URL" hint="Shown in the side panel tile and before the dashboard title in the banner. Leave empty for the letters below (banner: title only).">
                <input className="control" value={brand.logoUrl || ''} placeholder="https://…/logo.png" onChange={(e) => setDraft({ ...draft, brand: { ...brand, logoUrl: e.target.value || null } })} />
              </Field>
              <Field label="Logo letters" hint={`1-4 characters in the side panel tile when there is no image (now "${logoText}").`}>
                <input className="control" maxLength={4} value={brand.logoText || ''} placeholder={cfg.platform.logoText} onChange={(e) => setDraft({ ...draft, brand: { ...brand, logoText: e.target.value || null } })} />
              </Field>
            </Card>
            <p className="text-xs text-muted">Defaults come from config/theme.json; what you save here wins and survives deploys. Any CSS colour works in the text box (#rrggbb, rgb(…), hsl(…), a name).</p>
          </div>
        </div>
      )}
    </>
  );
}
