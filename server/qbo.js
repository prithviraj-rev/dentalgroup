// QuickBooks Online OAuth2 + REST client. Tokens live in the SQLite `connections` table.
import { config } from './config.js';
import { getConnection, updateTokens } from './tokenStore.js';

const basicAuth = () =>
  'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: config.scope,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${config.authorizeUrl}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Token request failed (${res.status}): ${json.error || ''} ${json.error_description || ''}`.trim()
    );
  }
  return json;
}

/** Map an Intuit token response onto the `connections` columns. */
function tokenFields(t) {
  const now = Date.now();
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(now + t.expires_in * 1000).toISOString(),
    refresh_token_expires_at: t.x_refresh_token_expires_in
      ? new Date(now + t.x_refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

export async function exchangeCode(code) {
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
  return tokenFields(t);
}

export async function refreshTokens(db, realmId) {
  const current = getConnection(db, realmId);
  if (!current) throw new Error(`No connection stored for realm ${realmId}`);
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
  // Intuit rotates refresh tokens: persist the new pair immediately.
  return updateTokens(db, realmId, tokenFields(t));
}

/** Returns a usable access token, refreshing first when it is within 5 minutes of expiry. */
export async function getValidAccessToken(db, realmId) {
  const c = getConnection(db, realmId);
  if (!c) throw new Error(`No connection stored for realm ${realmId}`);
  const expiresAt = Date.parse(c.expires_at || 0);
  if (!expiresAt || Date.now() >= expiresAt - config.refreshSkewMs) {
    return (await refreshTokens(db, realmId)).access_token;
  }
  return c.access_token;
}

/** GET /v3/company/{realmId}/{path}. Refreshes when needed and retries once on 401. */
export async function qboGet(db, realmId, path, query = {}) {
  const url = new URL(`${config.apiBase}/v3/company/${realmId}/${path}`);
  for (const [k, v] of Object.entries({ ...query, minorversion: config.minorVersion })) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const token =
      attempt === 0 ? await getValidAccessToken(db, realmId) : (await refreshTokens(db, realmId)).access_token;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) continue;
    const body = await res.text();
    if (!res.ok) {
      const tid = res.headers.get('intuit_tid');
      throw new Error(`QBO ${res.status} for ${path}${tid ? ` (intuit_tid ${tid})` : ''}: ${body.slice(0, 500)}`);
    }
    return JSON.parse(body);
  }
  throw new Error(`QBO request for ${path} failed after token refresh`);
}

/** Company name straight from the token (used right after /callback, before the row exists). */
export async function fetchCompanyNameWithToken(realmId, accessToken) {
  const url = new URL(`${config.apiBase}/v3/company/${realmId}/companyinfo/${realmId}`);
  url.searchParams.set('minorversion', String(config.minorVersion));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok) throw new Error(`companyinfo failed (${res.status}): ${body.slice(0, 300)}`);
  return JSON.parse(body).CompanyInfo?.CompanyName || realmId;
}

export async function getCompanyName(db, realmId) {
  const json = await qboGet(db, realmId, `companyinfo/${realmId}`);
  return json.CompanyInfo?.CompanyName || realmId;
}

/**
 * Chart of accounts: every Account entity (active and inactive) via the query API, paged 1000 at a time.
 * https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
 */
export async function fetchChartOfAccounts(db, realmId, { pageSize = 1000 } = {}) {
  const out = [];
  for (let start = 1; ; start += pageSize) {
    const json = await qboGet(db, realmId, 'query', {
      query: `select * from Account startposition ${start} maxresults ${pageSize}`,
    });
    const rows = json.QueryResponse?.Account || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function fetchProfitAndLoss(db, realmId, { startDate, endDate }) {
  return qboGet(db, realmId, 'reports/ProfitAndLoss', {
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Month',
    accounting_method: config.accountingMethod,
  });
}
