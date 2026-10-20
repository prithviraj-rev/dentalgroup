// Wires the multi-client platform into the Express app:
//   /platform-api/*  JSON API
//   /app/*           the platform web app (platform/dist), SPA fallback
// and decides whether a platform session may open the embedded P&L dashboard.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, config } from '../config.js';
import { loadPlatformConfig, loadSeed } from './config.js';
import { initPlatformSchema, seedPlatform, ensureUniqueRealmLinks } from './store.js';
import { createPlatformRouter } from './routes.js';
import { sessionSecretIsEphemeral } from './auth.js';

export function mountPlatform(app, db) {
  const cfg = loadPlatformConfig();
  initPlatformSchema(db);
  ensureUniqueRealmLinks(db);
  if (cfg.sampleData.seedOnStartup && seedPlatform(db, cfg, loadSeed(cfg))) {
    console.log(`  Platform: seeded sample organizations from config/${cfg.sampleData.file}`);
  }
  if (sessionSecretIsEphemeral) console.warn('  ! SESSION_SECRET not set - platform sessions reset when the server restarts');

  const { router, currentUser, hasPerm } = createPlatformRouter(db, cfg);
  app.use('/platform-api', router);

  const dist = path.join(ROOT, 'platform', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use('/app', express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/app(\/.*)?$/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else if (!config.serveWeb) {
    // Local development: the platform runs under Vite on :5174.
    app.get(/^\/app(\/.*)?$/, (req, res) => res.redirect(`http://localhost:5174${req.originalUrl}`));
  }

  /**
   * A signed-in platform user may open the existing dashboard (and its API) only if they are a platform
   * admin, or hold reports.view in an active organization flagged liveDashboard, since the dashboard
   * shows that organization's real QuickBooks data.
   */
  /**
   * What a signed-in platform user may see and do in the dashboard (/, /api/*, /sync, /connect).
   *   null                      -> no platform session (fall back to basic auth)
   *   { all: true, ... }        -> platform admin: every company, every action
   *   { all: false, realms, canSync, canManage, orgIds }
   *                             -> only the QuickBooks companies (realm ids) of entities this user can see
   *                                in active organizations with live reports; canSync / canManage from the
   *                                role permissions sync.run / entities.manage.
   * A user with a session but no live-reports organization gets an empty scope (sees nothing).
   */
  function dashboardScope(req) {
    const u = currentUser(req);
    if (!u) return null;
    if (u.is_platform_admin) return { all: true, realms: null, canSync: true, canManage: true, isAdmin: true, orgIds: null };
    const memberships = db.prepare(`
      SELECT m.role, o.id AS orgId, o.status FROM pf_memberships m JOIN pf_organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status = 'active' AND o.live_dashboard = 1`).all(u.id)
      .filter((m) => cfg.orgStatuses[m.status]?.canSignIn !== false && hasPerm(m.role, 'reports.view'));
    const realms = new Set();
    let canSync = false;
    let canManage = false;
    for (const m of memberships) {
      const rows = hasPerm(m.role, 'entities.all')
        ? db.prepare('SELECT external_id FROM pf_entities WHERE org_id = ? AND external_id IS NOT NULL').all(m.orgId)
        : db.prepare(`SELECT e.external_id FROM pf_entities e JOIN pf_user_entities ue ON ue.entity_id = e.id
                      WHERE e.org_id = ? AND ue.user_id = ? AND e.external_id IS NOT NULL`).all(m.orgId, u.id);
      for (const r of rows) realms.add(r.external_id);
      canSync ||= hasPerm(m.role, 'sync.run');
      canManage ||= hasPerm(m.role, 'entities.manage');
    }
    return { all: false, realms: [...realms], canSync, canManage, isAdmin: false, orgIds: memberships.map((m) => m.orgId) };
  }

  /** Back-compat: true when the session may open the dashboard at all. */
  const grantsDashboard = (req) => {
    const s = dashboardScope(req);
    return Boolean(s && (s.all || s.orgIds.length));
  };

  /** True when the signed-in user may add entities to this organization. */
  function canManageEntities(req, orgId) {
    const u = currentUser(req);
    if (!u || !orgId) return false;
    if (u.is_platform_admin) return true;
    const m = db.prepare(`SELECT role FROM pf_memberships WHERE user_id = ? AND org_id = ? AND status = 'active'`).get(u.id, orgId);
    return Boolean(m && hasPerm(m.role, 'entities.manage'));
  }

  /**
   * After an OAuth connect started from an organization: add the QuickBooks company to it as a live entity.
   * A company already linked (to this or another organization) is left where it is; reconnecting just
   * refreshes its tokens.
   */
  function linkConnection(orgId, realmId, companyName) {
    const org = db.prepare('SELECT * FROM pf_organizations WHERE id = ?').get(orgId);
    if (!org) return { error: 'organization not found' };
    const existing = db.prepare('SELECT org_id FROM pf_entities WHERE external_id = ?').get(realmId);
    if (existing) return existing.org_id === orgId ? { created: false } : { error: 'it already belongs to another organization' };
    if (!org.live_dashboard) return { error: 'live reports are not enabled for this organization' };
    const plan = cfg.plans.find((p) => p.id === org.plan) || {};
    const count = db.prepare('SELECT COUNT(*) AS n FROM pf_entities WHERE org_id = ?').get(orgId).n;
    if (plan.maxEntities != null && count >= plan.maxEntities) return { error: `the ${plan.label} plan allows ${plan.maxEntities} entities` };
    const connector = cfg.connectors.find((c) => c.id === 'quickbooks') ? 'quickbooks' : cfg.connectors.find((c) => c.enabled).id;
    db.prepare(`INSERT INTO pf_entities (org_id, group_id, name, connector, external_id, status, data_source, annual_revenue, margin, created_at)
                VALUES (?, NULL, ?, ?, ?, 'connected', 'live', 0, 0.1, ?)`).run(orgId, companyName, connector, realmId, new Date().toISOString());
    db.prepare('INSERT INTO pf_audit (org_id, user_id, action, detail, at) VALUES (?, NULL, ?, ?, ?)')
      .run(orgId, 'entity.added', `Entity ${companyName} added (connected to QuickBooks)`, new Date().toISOString());
    return { created: true };
  }

  /** Live QuickBooks companies of one organization (for syncing just that organization). */
  const orgRealms = (orgId) => db.prepare('SELECT external_id FROM pf_entities WHERE org_id = ? AND external_id IS NOT NULL').all(orgId).map((r) => r.external_id);

  /** When exactly one organization has live reports, connections made without an organization belong to it. */
  const defaultLiveOrgId = () => {
    const rows = db.prepare('SELECT id FROM pf_organizations WHERE live_dashboard = 1').all();
    return rows.length === 1 ? rows[0].id : null;
  };

  return { cfg, grantsDashboard, dashboardScope, canManageEntities, linkConnection, orgRealms, defaultLiveOrgId };
}
