import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// ---------- data hook ----------

export function useApi(path) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    api.get(path)
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((e) => !cancelled && setState({ data: null, loading: false, error: e.message }));
    return () => { cancelled = true; };
  }, [path, key]);
  return { ...state, reload: useCallback(() => setKey((k) => k + 1), []) };
}

// ---------- formatting ----------

export function money(n, currency = 'USD', compact = false) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: compact ? 1 : 0, notation: compact ? 'compact' : 'standard',
  }).format(v);
}
export const pct = (p) => (p == null || !Number.isFinite(p) ? '–' : `${(p * 100).toFixed(1)}%`);
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '–');
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–');
export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(iso);
}

// ---------- primitives ----------

export function Button({ variant = 'secondary', size, className = '', ...p }) {
  const v = { primary: 'btn btn-primary', secondary: 'btn', ghost: 'btn btn-ghost', danger: 'btn btn-danger' }[variant];
  return <button type="button" className={`${v} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...p} />;
}

export function Card({ className = '', children, ...p }) {
  return <section className={`card ${className}`} {...p}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions, badge }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">{title}{badge}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-ink2">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

const TONE = {
  good: { color: 'var(--good)', icon: '●' },
  warning: { color: 'var(--warning)', icon: '▲' },
  critical: { color: 'var(--critical)', icon: '■' },
  neutral: { color: 'var(--muted)', icon: '○' },
};

/** Status chip: colored icon + text label, never color alone. */
export function StatusBadge({ label, tone = 'neutral' }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--ring)] px-2 py-0.5 text-xs text-ink2">
      <span style={{ color: t.color, fontSize: 9 }} aria-hidden="true">{t.icon}</span>
      {label}
    </span>
  );
}

export function Tag({ children }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-[var(--wash)] px-1.5 py-0.5 text-[11px] text-ink2">{children}</span>;
}

export function Kpi({ label, value, sub, swatch }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2 text-sm text-ink2">
        {swatch && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: swatch }} aria-hidden="true" />}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-ink2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  return (
    <Card className="border-l-4 p-4 text-sm" style={{ borderLeftColor: 'var(--critical)' }}>
      <div className="font-medium">Something went wrong</div>
      <div className="text-ink2">{error}</div>
      {onRetry && <button type="button" className="mt-2 text-accent hover:underline" onClick={onRetry}>Retry</button>}
    </Card>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="card h-20 animate-pulse" />)}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('[data-modal-body] input, [data-modal-body] select, [data-modal-body] textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} shadow-xl`}>
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
          <h2 className="font-medium">{title}</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-muted hover:text-ink" aria-label="Close">×</button>
        </div>
        <div className="px-5 py-4" data-modal-body>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[var(--line)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- toasts ----------

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, ...t }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.kind === 'error' ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role="status" className="card border-l-4 px-4 py-3 text-sm shadow-lg"
               style={{ borderLeftColor: t.kind === 'error' ? 'var(--critical)' : t.kind === 'warn' ? 'var(--warning)' : 'var(--good)' }}>
            <div className="font-medium">{t.title}</div>
            {t.body && <div className="mt-0.5 text-ink2">{t.body}</div>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
