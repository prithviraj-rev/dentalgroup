// Express server: QuickBooks OAuth connect flow (one connection per company / realmId),
// POST /sync, and the read API for the dashboard.
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { config, hasCredentials } from './config.js';
import { openDb } from './db.js';
import { listConnections, saveConnection, deleteConnection } from './tokenStore.js';
import { authorizeUrl, exchangeCode, fetchCompanyNameWithToken } from './qbo.js';
import { syncAll } from './sync.js';
import { createApiRouter } from './api.js';

const app = express();
const db = openDb();
const pendingStates = new Map(); // state -> created ms (CSRF protection for the OAuth round trip)

app.use(cors({ origin: config.webOrigin }));
app.use(express.json());

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- OAuth ----------

app.get('/connect', (req, res) => {
  if (!hasCredentials()) {
    return res.status(500).send('QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set. Fill in .env at the repo root and restart.');
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
  if (!created || Date.now() - created > config.oauthStateTtlMs) {
    return res.status(400).send('Invalid or expired state. <a href="/connect">Start again</a>.');
  }
  if (!code || !realmId) return res.status(400).send('Missing code or realmId in callback.');

  try {
    const tokens = await exchangeCode(String(code));
    const companyName = await fetchCompanyNameWithToken(String(realmId), tokens.access_token);
    saveConnection(db, { realm_id: String(realmId), company_name: companyName, ...tokens });
    res.redirect(`/?msg=${encodeURIComponent(`Connected ${companyName} (${realmId})`)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Connection failed: ${esc(err.message)}`);
  }
});

app.post('/disconnect/:realmId', (req, res) => {
  deleteConnection(db, req.params.realmId);
  res.redirect(`/?msg=${encodeURIComponent(`Disconnected ${req.params.realmId}`)}`);
});

// ---------- Sync ----------

let syncInFlight = null;
app.post('/sync', async (req, res) => {
  if (!hasCredentials()) return res.status(500).json({ error: 'QBO credentials missing in .env' });
  try {
    // Share one run if two callers hit /sync at the same time.
    syncInFlight ??= syncAll(db).finally(() => { syncInFlight = null; });
    const result = await syncInFlight;
    res.status(result.failed && !result.succeeded ? 502 : 200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Dashboard API ----------

app.use('/api', createApiRouter(db));

// ---------- Connections page ----------

app.get('/', (req, res) => {
  const lastSync = Object.fromEntries(
    db.prepare(`SELECT realm_id, MAX(finished_at) AS at FROM sync_logs WHERE status = 'success' GROUP BY realm_id`).all()
      .map((r) => [r.realm_id, r.at])
  );
  const rows = listConnections(db)
    .map((c) => `<tr>
        <td>${esc(c.company_name)}</td><td><code>${esc(c.realm_id)}</code></td>
        <td>${esc(c.connected_at?.slice(0, 10))}</td>
        <td>${esc(c.refresh_token_expires_at?.slice(0, 10) || '')}</td>
        <td>${esc(lastSync[c.realm_id]?.slice(0, 16).replace('T', ' ') || 'never')}</td>
        <td><form method="post" action="/disconnect/${encodeURIComponent(c.realm_id)}"><button>Disconnect</button></form></td>
      </tr>`)
    .join('');

  res.send(`<!doctype html><meta charset="utf-8"><title>QBO connections</title>
  <style>
    body{font:14px system-ui,-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#0b0b0b;background:#f9f9f7}
    table{border-collapse:collapse;width:100%;background:#fcfcfb}th,td{text-align:left;padding:8px;border-bottom:1px solid #e1e0d9}
    .btn{display:inline-block;background:#2a78d6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;border:0;font:inherit;cursor:pointer}
    .msg{background:#cde2fb;padding:10px 14px;border-radius:6px}.muted{color:#52514e}
  </style>
  <h1>QuickBooks connections <span class="muted">(${esc(config.environment)})</span></h1>
  ${req.query.msg ? `<p class="msg">${esc(req.query.msg)}</p>` : ''}
  ${hasCredentials() ? '' : '<p class="msg">QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set in .env - connecting will fail until they are.</p>'}
  <p><a class="btn" href="/connect">Connect a QuickBooks company</a>
     <form method="post" action="/sync" style="display:inline" onsubmit="this.querySelector('button').disabled=true"><button class="btn" style="background:#52514e">Sync now (JSON)</button></form></p>
  <p class="muted">Repeat <b>Connect</b> once per sandbox company, picking a different company on Intuit's consent screen each time.
  Then open the dashboard at <a href="${esc(config.webOrigin)}">${esc(config.webOrigin)}</a> and press <b>Sync now</b>.</p>
  <table><thead><tr><th>Company</th><th>Realm ID</th><th>Connected</th><th>Refresh token expires</th><th>Last sync</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">No companies connected yet.</td></tr>'}</tbody></table>`);
});

app.listen(config.port, () => {
  console.log(`QBO server on http://localhost:${config.port} (${config.environment})`);
  console.log(`  Connect a company:  http://localhost:${config.port}/connect`);
  console.log(`  Dashboard:          ${config.webOrigin}`);
  if (!hasCredentials()) console.warn('  ! QBO_CLIENT_ID / QBO_CLIENT_SECRET not set - fill in .env before connecting');
});
