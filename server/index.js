// Express server: QuickBooks OAuth connect flow (one connection per company / realmId) + read API for the dashboard.
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { loadTokens, upsertToken, removeToken } from './tokenStore.js';
import { authorizeUrl, exchangeCode, getCompanyName, revoke } from './qbo.js';
import { openDb } from './db.js';

const app = express();
const db = openDb();
const pendingStates = new Map(); // state -> created ms (CSRF protection for the OAuth round trip)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- OAuth ----------

app.get('/connect', (req, res) => {
  if (!config.clientId || !config.clientSecret) {
    return res.status(500).send('QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set. Copy .env.example to .env and restart.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  res.redirect(authorizeUrl(state));
});

app.get('/callback', async (req, res) => {
  const { code, state, realmId, error, error_description } = req.query;
  if (error) return res.redirect(`/?msg=${encodeURIComponent(`Connection cancelled: ${error_description || error}`)}`);

  const created = pendingStates.get(state);
  pendingStates.delete(state);
  if (!created || Date.now() - created > 10 * 60_000) {
    return res.status(400).send('Invalid or expired state. <a href="/connect">Start again</a>.');
  }
  if (!code || !realmId) return res.status(400).send('Missing code or realmId in callback.');

  try {
    const tokens = await exchangeCode(code);
    const existing = loadTokens()[realmId];
    upsertToken(realmId, { ...tokens, environment: config.environment, connected_at: new Date().toISOString() });
    const companyName = await getCompanyName(realmId);
    upsertToken(realmId, { company_name: companyName, office_name: existing?.office_name || companyName });
    res.redirect(`/?msg=${encodeURIComponent(`Connected ${companyName} (${realmId})`)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Connection failed: ${esc(err.message)}`);
  }
});

app.post('/disconnect/:realmId', async (req, res) => {
  const t = loadTokens()[req.params.realmId];
  if (t) {
    await revoke(t.refresh_token).catch((e) => console.warn('Revoke failed:', e.message));
    removeToken(req.params.realmId);
  }
  res.redirect(`/?msg=${encodeURIComponent(`Disconnected ${t?.office_name || req.params.realmId}`)}`);
});

app.get('/', (req, res) => {
  const companies = Object.values(loadTokens());
  const lastSync = Object.fromEntries(
    db.prepare('SELECT realm_id, MAX(synced_at) AS synced_at FROM sync_runs GROUP BY realm_id').all()
      .map((r) => [r.realm_id, r.synced_at])
  );
  const rows = companies
    .map(
      (c) => `<tr>
        <td>${esc(c.office_name)}</td><td><code>${esc(c.realm_id)}</code></td>
        <td>${esc(c.connected_at?.slice(0, 10))}</td>
        <td>${esc(c.refresh_token_expires_at?.slice(0, 10))}</td>
        <td>${esc(lastSync[c.realm_id]?.slice(0, 16).replace('T', ' ') || 'never')}</td>
        <td><form method="post" action="/disconnect/${encodeURIComponent(c.realm_id)}"><button>Disconnect</button></form></td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html><meta charset="utf-8"><title>QBO connections</title>
  <style>
    body{font:14px system-ui,-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#0b0b0b;background:#f9f9f7}
    table{border-collapse:collapse;width:100%;background:#fcfcfb}th,td{text-align:left;padding:8px;border-bottom:1px solid #e1e0d9}
    .btn{display:inline-block;background:#2a78d6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none}
    .msg{background:#cde2fb;padding:10px 14px;border-radius:6px}.muted{color:#52514e}
  </style>
  <h1>QuickBooks connections <span class="muted">(${esc(config.environment)})</span></h1>
  ${req.query.msg ? `<p class="msg">${esc(req.query.msg)}</p>` : ''}
  <p><a class="btn" href="/connect">Connect a QuickBooks company</a></p>
  <p class="muted">Repeat once per company. On Intuit's consent screen pick a different company each time;
  each one is stored by realmId in tokens.json. Then run <code>npm run sync</code>.</p>
  <table><thead><tr><th>Office</th><th>Realm ID</th><th>Connected</th><th>Refresh token expires</th><th>Last sync</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">No companies connected yet.</td></tr>'}</tbody></table>`);
});

// ---------- Dashboard API ----------

app.get('/api/offices', (req, res) => {
  res.json(
    db.prepare(
      `SELECT p.realm_id, p.office_name, MAX(s.synced_at) AS synced_at
       FROM (SELECT DISTINCT realm_id, office_name FROM pnl_rows) p
       LEFT JOIN sync_runs s ON s.realm_id = p.realm_id
       GROUP BY p.realm_id, p.office_name ORDER BY p.office_name`
    ).all()
  );
});

// ?realm=all (default) or a realmId. Returns account-level monthly amounts summed over the selected
// offices, plus type-level monthly amounts per office for the office comparison chart.
app.get('/api/pnl', (req, res) => {
  const realm = req.query.realm && req.query.realm !== 'all' ? String(req.query.realm) : null;
  const where = realm ? 'WHERE realm_id = @realm' : '';
  const accounts = db.prepare(
    `SELECT account_type, account_name, period, ROUND(SUM(amount), 2) AS amount
     FROM pnl_rows ${where} GROUP BY account_type, account_name, period`
  ).all({ realm });
  const byOffice = db.prepare(
    `SELECT realm_id, office_name, account_type, period, ROUND(SUM(amount), 2) AS amount
     FROM pnl_rows ${where} GROUP BY realm_id, office_name, account_type, period`
  ).all({ realm });
  res.json({ accounts, byOffice });
});

app.listen(config.port, () => {
  console.log(`QBO connect + API server on http://localhost:${config.port} (${config.environment})`);
  console.log(`  Connect companies:  http://localhost:${config.port}/`);
  if (!config.clientId) console.warn('  ! QBO_CLIENT_ID not set - /connect will not work until .env is filled in');
});
