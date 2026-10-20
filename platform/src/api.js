async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/platform-api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status });
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  patch: (p, b) => request('PATCH', p, b || {}),
  del: (p) => request('DELETE', p),
};

/** URL of the existing P&L dashboard to embed: Vite dev server in development, same origin in production. */
export function dashboardUrl(cfg) {
  const e = cfg.reports.embed;
  return import.meta.env.DEV ? e.devUrl : e.path;
}
