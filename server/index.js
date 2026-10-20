// Express server: QuickBooks OAuth connect flow (one connection per company / realmId),
// POST /sync, and the read API for the dashboard.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config, appConfig, hasCredentials, ROOT } from './config.js';
import { openDb } from './db.js';
import { listConnections, saveConnection, deleteConnection } from './tokenStore.js';
import { authorizeUrl, exchangeCode, fetchCompanyNameWithToken } from './qbo.js';
import { syncAll } from './sync.js';
import { createApiRouter, parseFilters } from './api.js';
import { createCategoryViewRouter } from './categoryView.js';
import { createFinanceRouter } from './finance/api.js';
import { createOfficesRouter } from './offices/api.js';
import { startDailySync, validateSchedule } from './scheduler.js';
import { mountPlatform } from './platform/index.js';

const app = express();
const db = openDb();
const pendingStates = new Map(); // state -> created ms (CSRF protection for the OAuth round trip)

app.set('trust proxy', 1); // behind the host's HTTPS proxy
app.get('/health', (req, res) => res.json({ ok: true, environment: config.environment }));

// Intuit "Disconnect URL": where QuickBooks sends a customer after they disconnect the app from inside
// QuickBooks. Public landing page only; the stored tokens stop working on Intuit's side.
app.get('/disconnected', (req, res) => {
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disconnected</title>
  <style>body{font:15px system-ui,-apple-system,"Segoe UI",sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;color:#0b0b0b;background:#f9f9f7}
  a{color:#2a78d6}.card{background:#fcfcfb;border:1px solid rgba(11,11,11,.1);border-radius:12px;padding:24px}</style>
  <div class="card"><h1 style="font-size:20px;margin:0 0 8px">QuickBooks disconnected</h1>
  <p>Your QuickBooks company is no longer connected. We will stop syncing its data.</p>
  <p>To connect again, <a href="/connect">reconnect QuickBooks</a> or <a href="/app">sign in</a>.</p></div>`);
});

// Multi-client platform (/app, /platform-api). Has its own login, so it sits before the password gate.
const platform = mountPlatform(app, db);

// Reject state-changing requests sent from another site (basic-auth credentials are sent by the browser
// automatically, so a page elsewhere could otherwise POST /sync or /disconnect on the user's behalf).
const allowedOrigins = new Set([config.webOrigin, config.publicUrl].filter(Boolean));
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (curl, server-to-server)
  let host = null;
  try { host = new URL(origin).host; } catch { /* malformed */ }
  if (host && (host === req.headers.host || allowedOrigins.has(origin))) return next();
  res.status(403).json({ error: 'Cross-site request blocked' });
});

// Who is asking: a platform session gets a scope (which companies, which actions); basic auth or no gate
// (local development) means full access. req.dashboardScope: null = everything, else { realms, canSync, ... }.
app.use((req, res, next) => {
  const scope = platform.dashboardScope(req);
  req.dashboardScope = scope && !scope.all ? scope : null;
  req.platformSession = scope;
  next();
});

// Optional password gate (APP_USER / APP_PASSWORD in .env). Always on when the dashboard is served from
// here in production, since the P&L of every office is behind it. A platform session also passes it.
if (config.appUser && config.appPassword) {
  const expected = Buffer.from(`${config.appUser}:${config.appPassword}`);
  app.use((req, res, next) => {
    const scope = req.platformSession;
    if (scope && (scope.all || scope.orgIds.length)) return next();
    const h = req.headers.authorization || '';
    const given = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64') : Buffer.alloc(0);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) { req.basicAuth = true; return next(); }
    res.set('WWW-Authenticate', 'Basic realm="P&L dashboard", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  });
} else if (config.serveWeb) {
  console.warn('  ! APP_USER / APP_PASSWORD not set - the hosted dashboard is open to anyone with the URL');
}

/** Scoped (non-admin) platform users need a permission for actions; full-access callers pass. */
const allow = (perm) => (req, res, next) => {
  const s = req.dashboardScope;
  if (!s) return next();
  if (perm === 'admin' || !s[perm]) {
    return req.accepts(['json', 'html']) === 'json' || req.path === '/sync'
      ? res.status(403).json({ error: 'Your role does not allow this action.' })
      : res.status(403).send('Your role does not allow this action. <a href="/app">Back to the app</a>.');
  }
  next();
};

app.use(cors({ origin: config.webOrigin }));
// Practice KPI imports can be large CSVs; parsed here before the default 100 kB JSON parser.
app.use('/api/practice-kpis', express.json({ limit: '10mb' }));
app.use(express.json());

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- OAuth ----------

const pruneStates = () => {
  const cutoff = Date.now() - config.oauthStateTtlMs;
  for (const [k, v] of pendingStates) if (v.created < cutoff) pendingStates.delete(k);
};

app.get('/connect', allow('canManage'), (req, res) => {
  pruneStates();
  if (!hasCredentials()) {
    return res.status(500).send('QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set. Fill in .env at the repo root and restart.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  // ?org=<id>&return=/app/... : started from an organization in the platform. The company is added to that
  // organization on return, if the signed-in user may manage its entities.
  const orgId = req.query.org && platform.canManageEntities(req, Number(req.query.org)) ? Number(req.query.org) : null;
  const returnTo = typeof req.query.return === 'string' && /^\/app\/[\w\-/]*$/.test(req.query.return) ? req.query.return : null;
  pendingStates.set(state, { created: Date.now(), orgId, returnTo });
  res.redirect(authorizeUrl(state));
});

app.get('/callback', allow('canManage'), async (req, res) => {
  const { code, state, realmId, error, error_description } = req.query;
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  const back = (msg) => `${pending?.returnTo || '/connections'}?msg=${encodeURIComponent(msg)}`;
  if (error) return res.redirect(back(`Connection cancelled: ${error_description || error}`));

  if (!pending || Date.now() - pending.created > config.oauthStateTtlMs) {
    return res.status(400).send('Invalid or expired state. <a href="/connect">Start again</a>.');
  }
  if (!code || !realmId) return res.status(400).send('Missing code or realmId in callback.');

  try {
    const tokens = await exchangeCode(String(code));
    const companyName = await fetchCompanyNameWithToken(String(realmId), tokens.access_token);
    saveConnection(db, { realm_id: String(realmId), company_name: companyName, ...tokens });
    let msg = `Connected ${companyName}`;
    // Connected from an organization, or (from the plain connect page) the only organization with live reports.
    const targetOrg = pending.orgId || platform.defaultLiveOrgId();
    if (targetOrg) {
      const link = platform.linkConnection(targetOrg, String(realmId), companyName);
      if (link.error) msg += `, but it was not added to the organization: ${link.error}`;
      else if (link.created) msg += ' and added it to the organization';
    }
    // Pull its data now so it shows up immediately instead of on the next sync.
    const synced = await syncAll(db, { realmIds: [String(realmId)] }).catch((e) => ({ results: [{ status: 'error', error: e.message }] }));
    const r0 = synced.results[0];
    msg += r0?.status === 'success' ? `. First sync: ${r0.rows} P&L rows.` : `. First sync failed: ${r0?.error || 'unknown error'}`;
    console.log(`[connect] ${companyName} (${realmId}) org=${targetOrg ?? 'none'} source=${pending.orgId ? 'organization' : 'plain connect'}: ${msg}`);
    res.redirect(back(msg));
  } catch (err) {
    console.error(err);
    res.status(500).send(`Connection failed: ${esc(err.message)}`);
  }
});

app.post('/disconnect/:realmId', allow('admin'), (req, res) => {
  deleteConnection(db, req.params.realmId);
  res.redirect(`/connections?msg=${encodeURIComponent(`Disconnected ${req.params.realmId}`)}`);
});

// ---------- Sync ----------

let syncInFlight = null;
app.post('/sync', allow('canSync'), async (req, res) => {
  if (!hasCredentials()) return res.status(500).json({ error: 'QBO credentials missing in .env' });
  try {
    const scope = req.dashboardScope;
    let result;
    if (scope) {
      result = await syncAll(db, { realmIds: scope.realms });
    } else {
      // Share one full run if two callers hit /sync at the same time.
      syncInFlight ??= syncAll(db).finally(() => { syncInFlight = null; });
      result = await syncInFlight;
    }
    res.status(result.failed && !result.succeeded ? 502 : 200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Dashboard API ----------

app.use('/api', createApiRouter(db));

// Category compare tab (separate router and config; does not touch the routes above).
validateSchedule(appConfig.sync.schedule);
const scheduleEnabled = appConfig.sync.schedule?.enabled !== false && !['0', 'off', 'false'].includes(String(process.env.SYNC_SCHEDULE || '').toLowerCase());
let dailySync = { status: () => null };
if (appConfig.categoryView?.enabled !== false) app.use('/api', createCategoryViewRouter(db, { parseFilters, scheduleStatus: () => dailySync.status() }));
// Group overview, Cash & balance sheet, Budget, Practice KPIs, live transactions (separate router and config files).
app.use('/api', createFinanceRouter(db, { parseFilters }));
// Offices tab: dental practice + sub-DSO as one office (separate router and config file).
if (appConfig.offices?.enabled !== false) app.use('/api', createOfficesRouter(db, { parseFilters }));
// Second Offices tab built from the client's own KPI sheet (same code, other row rules; config/offices-sheet.json).
if (appConfig.offices?.enabled !== false && appConfig.officesSheet?.enabled !== false) {
  app.use('/api', createOfficesRouter(db, { parseFilters, file: path.resolve(ROOT, appConfig.officesSheet.file), base: appConfig.officesSheet.apiPath, analysis: false }));
}

// ---------- Connections page ----------

// In dev this page is also the root; in production the dashboard owns '/'.
app.get(config.serveWeb ? '/connections' : ['/', '/connections'], allow('admin'), (req, res) => {
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
  Then open the dashboard at <a href="${esc(config.serveWeb ? '/' : config.webOrigin)}">${esc(config.serveWeb ? 'the dashboard' : config.webOrigin)}</a> and press <b>Sync now</b>.</p>
  <table><thead><tr><th>Company</th><th>Realm ID</th><th>Connected</th><th>Refresh token expires</th><th>Last sync</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">No companies connected yet.</td></tr>'}</tbody></table>`);
});

// ---------- Production: serve the built dashboard from the same origin ----------

const webDist = path.join(ROOT, 'web', 'dist');
if (config.serveWeb) {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    console.error(`SERVE_WEB is on but ${webDist} is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
  // The connections page moves to /connections so the dashboard can own "/".
  app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  app.use(express.static(webDist));
}

// Errors (malformed JSON bodies, unexpected exceptions) come back as JSON, without stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

app.listen(config.port, '0.0.0.0', () => {
  const base = config.publicUrl || `http://localhost:${config.port}`;
  console.log(`QBO server on ${base} (${config.environment}${config.serveWeb ? ', serving web/dist' : ''})`);
  console.log(`  Connect a company:  ${base}/connect`);
  console.log(`  Connections page:   ${base}/connections`);
  console.log(`  Dashboard:          ${config.serveWeb ? base : config.webOrigin}`);
  if (!hasCredentials()) console.warn('  ! QBO_CLIENT_ID / QBO_CLIENT_SECRET not set - fill in .env before connecting');
  // Daily pull from QuickBooks (sync.schedule in app.config.json; SYNC_SCHEDULE=off disables it).
  if (scheduleEnabled && hasCredentials()) {
    dailySync = startDailySync({
      schedule: appConfig.sync.schedule,
      run: () => syncAll(db),
      lastSuccess: () => db.prepare(`SELECT MAX(finished_at) AS at FROM sync_logs WHERE status = 'success'`).get()?.at || null,
      // First start after the raw-data release: pull raw QuickBooks records for companies that have none yet.
      missingData: () => {
        try {
          const n = db.prepare('SELECT COUNT(*) AS n FROM connections WHERE realm_id NOT IN (SELECT DISTINCT realm_id FROM qbo_raw_state)').get().n;
          return n ? `${n} companies have no raw QuickBooks records yet` : null;
        } catch { return null; }
      },
    });
  }
});
