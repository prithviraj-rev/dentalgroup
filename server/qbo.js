import { config } from './config.js';
import { loadTokens, upsertToken } from './tokenStore.js';

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
    throw new Error(`Token request failed (${res.status}): ${json.error || ''} ${json.error_description || ''}`.trim());
  }
  return json;
}

function tokenFields(t) {
  const now = Date.now();
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    access_token_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + t.x_refresh_token_expires_in * 1000).toISOString(),
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

export async function refresh(realmId) {
  const current = loadTokens()[realmId];
  if (!current) throw new Error(`No tokens stored for realm ${realmId}`);
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
  // Intuit rotates refresh tokens - persist the new one immediately.
  return upsertToken(realmId, { ...tokenFields(t), refreshed_at: new Date().toISOString() });
}

export async function revoke(refreshToken) {
  await fetch(config.revokeUrl, {
    method: 'POST',
    headers: { Authorization: basicAuth(), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: refreshToken }),
  });
}

async function validAccessToken(realmId) {
  const t = loadTokens()[realmId];
  if (!t) throw new Error(`No tokens stored for realm ${realmId}`);
  const expiresAt = Date.parse(t.access_token_expires_at || 0);
  if (Date.now() > expiresAt - 60_000) return (await refresh(realmId)).access_token;
  return t.access_token;
}

/** GET /v3/company/{realmId}/{path}; refreshes the access token when needed and retries once on 401. */
export async function qboGet(realmId, path, query = {}) {
  const url = new URL(`${config.apiBase}/v3/company/${realmId}/${path}`);
  for (const [k, v] of Object.entries({ ...query, minorversion: config.minorVersion })) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = attempt === 0 ? await validAccessToken(realmId) : (await refresh(realmId)).access_token;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) continue;
    const body = await res.text();
    if (!res.ok) {
      const tid = res.headers.get('intuit_tid');
      throw new Error(`QBO ${res.status} for ${path}${tid ? ` (intuit_tid ${tid})` : ''}: ${body.slice(0, 500)}`);
    }
    return JSON.parse(body);
  }
}

export async function getCompanyName(realmId) {
  const json = await qboGet(realmId, `companyinfo/${realmId}`);
  return json.CompanyInfo?.CompanyName || realmId;
}
