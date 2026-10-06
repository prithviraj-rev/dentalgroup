export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    throw new Error(`Cannot reach the server at ${API_BASE}. Is \`npm run dev\` running?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, body: json });
  return json;
}

const qs = (params) => new URLSearchParams(params).toString();

export const api = {
  config: () => request('/api/config'),
  offices: () => request('/api/offices'),
  meta: () => request('/api/meta'),
  pl: (filters) => request(`/api/pl?${qs(filters)}`),
  accounts: (filters) => request(`/api/pl/accounts?${qs(filters)}`),
  sync: () => request('/sync', { method: 'POST' }),
};
