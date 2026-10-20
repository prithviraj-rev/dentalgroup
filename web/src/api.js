// In development the dashboard runs on :5173 and talks to the server on :3000 (CORS). In a production
// build the server serves the dashboard itself, so requests are same-origin (relative URLs).
export const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '');

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    throw new Error(`Cannot reach the server at ${API_BASE || window.location.origin}. Is it running?`);
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
  coa: (filters) => request(`/api/coa?${qs(filters)}`),
  officeCategories: () => request('/api/office-categories'),
  analysis: (filters) => request(`/api/analysis?${qs(filters)}`),
  executive: (filters) => request(`/api/executive?${qs(filters)}`),
  categoryView: (filters) => request(`/api/category-view?${qs(filters)}`),
  groupOverview: (filters) => request(`/api/group-overview?${qs(filters)}`),
  financeCash: (filters) => request(`/api/finance/cash?${qs(filters)}`),
  // Offices tabs: base is the URL segment of the instance (office-view, or officesSheet.apiPath for the client-sheet tab).
  officeView: (filters, base = 'office-view') => request(`/api/${base}?${qs(filters)}`),
  officeSetup: (base = 'office-view') => request(`/api/${base}/setup`),
  officeSave: (body, base = 'office-view') => request(`/api/${base}/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  officeDelete: (id, base = 'office-view') => request(`/api/${base}/setup/${id}`, { method: 'DELETE' }),
  officeDetail: (key, filters, base = 'office-view') => request(`/api/${base}/${encodeURIComponent(key)}?${qs(filters)}`),
  transactions: (params) => request(`/api/transactions?${qs(params)}`),
  sync: () => request('/sync', { method: 'POST' }),
};
