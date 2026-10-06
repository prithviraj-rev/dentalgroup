import React, { useEffect } from 'react';

export default function Toast({ toast, onClose, seconds = { success: 8, error: 12 } }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, (toast.kind === 'error' ? seconds.error : seconds.success) * 1000);
    return () => clearTimeout(t);
  }, [toast, onClose, seconds]);

  if (!toast) return null;
  const border = toast.kind === 'error' ? 'border-l-bad' : toast.kind === 'warn' ? 'border-l-[var(--series-4)]' : 'border-l-good';
  return (
    <div role="status" className={`card fixed bottom-4 right-4 z-50 max-w-md border-l-4 ${border} px-4 py-3 text-sm shadow-lg`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{toast.title}</div>
          {toast.lines?.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-ink2">
              {toast.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-muted hover:text-ink">×</button>
      </div>
    </div>
  );
}
