// Platform API mounted at /platform-api. Every org route checks the caller's role permissions from
// config/platform.config.json and, for roles without entities.all, filters to assigned entities.
import express, { Router } from 'express';
import { appConfig, hasCredentials } from '../config.js';
import { syncAll } from '../sync.js';
import { issueSession, clearSession, readSession, verifyPassword, hashPassword } from './auth.js';
import { uniqueSlug, prand } from './store.js';
import { publicConfig } from './config.js';

const now = () => new Date().toISOString();
const httpError = (status, message) => Object.assign(new Error(message), { status });

function lastMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const round2 = (n) => Math.round(n * 100) / 100;

export function createPlatformRouter(db, cfg) {
  const r = Router();
  r.use(express.json());

  const roleOf = (id) => cfg.roles[id];
  const permsOf = (roleId) => roleOf(roleId)?.permissions || [];
  const hasPerm = (roleId, perm) => { const p = permsOf(roleId); return p.includes('*') || p.includes(perm); };
  const orgRoles = Object.keys(cfg.roles).filter((r) => r !== 'platform_admin');
  const audit = (orgId, userId, action, detail) =>
    db.prepare('INSERT INTO pf_audit (org_id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)').run(orgId ?? null, userId ?? null, action, detail ?? null, now());
  const planOf = (id) => cfg.plans.find((p) => p.id === id) || {};

  // ---------- session ----------

  const currentUser = (req) => {
    const s = readSession(req);
    if (!s) return null;
    const u = db.prepare('SELECT * FROM pf_users WHERE id = ?').get(s.u);
    return u && u.status !== 'disabled' ? u : null;
  };
  const requireUser = (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    req.user = u;
    next();
  };
  const requirePlatformAdmin = (req, res, next) =>
    req.user.is_platform_admin ? next() : res.status(403).json({ error: 'Platform admins only' });

  function orgSummary(o, role) {
    return {
      id: o.id, name: o.name, slug: o.slug, industry: o.industry, plan: o.plan, status: o.status, currency: o.currency,
      timezone: o.timezone, fiscalYearStart: o.fiscal_year_start, syncSchedule: o.sync_schedule, brandColor: o.brand_color,
      liveDashboard: Boolean(o.live_dashboard), createdAt: o.created_at, role, permissions: permsOf(role),
    };
  }

  function me(u) {
    let orgs;
    if (u.is_platform_admin) {
      orgs = db.prepare('SELECT * FROM pf_organizations ORDER BY name').all().map((o) => orgSummary(o, 'platform_admin'));
    } else {
      orgs = db.prepare(`
        SELECT o.*, m.role FROM pf_memberships m JOIN pf_organizations o ON o.id = m.org_id
        WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.name`).all(u.id)
        .filter((o) => cfg.orgStatuses[o.status]?.canSignIn !== false)
        .map((o) => orgSummary(o, o.role));
    }
    return { user: { id: u.id, email: u.email, name: u.name, isPlatformAdmin: Boolean(u.is_platform_admin) }, orgs };
  }

  r.get('/config', (req, res) => res.json(publicConfig(cfg)));

  r.get('/demo-accounts', (req, res) => {
    if (!(cfg.auth.demoMode && cfg.auth.showDemoAccounts)) return res.json({ accounts: [] });
    const admins = db.prepare('SELECT email, name FROM pf_users WHERE is_platform_admin = 1 ORDER BY id').all()
      .map((u) => ({ ...u, label: cfg.roles.platform_admin.label, org: null }));
    const members = db.prepare(`
      SELECT u.email, u.name, m.role, o.name AS org FROM pf_memberships m
      JOIN pf_users u ON u.id = m.user_id JOIN pf_organizations o ON o.id = m.org_id
      WHERE m.status = 'active' ORDER BY o.name, m.role, u.name`).all()
      .map((u) => ({ email: u.email, name: u.name, label: roleOf(u.role)?.label || u.role, org: u.org }));
    res.json({ accounts: [...admins, ...members], password: cfg.auth.demoPassword });
  });

  r.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM pf_users WHERE email = ?').get(email);
    if (!u || u.status === 'disabled' || !verifyPassword(req.body?.password || '', u.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    db.transaction(() => {
      db.prepare(`UPDATE pf_users SET last_login_at = ?, status = 'active' WHERE id = ?`).run(now(), u.id);
      db.prepare(`UPDATE pf_memberships SET status = 'active' WHERE user_id = ? AND status = 'invited'`).run(u.id);
    })();
    issueSession(req, res, u.id, cfg.auth.sessionDays);
    const result = me({ ...u, status: 'active' });
    if (!u.is_platform_admin && result.orgs.length === 0) {
      clearSession(res);
      return res.status(403).json({ error: 'Your account has no active organization. Contact your administrator.' });
    }
    res.json(result);
  });

  r.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

  r.get('/me', requireUser, (req, res) => res.json(me(req.user)));

  r.post('/me/password', requireUser, (req, res) => {
    const { current, next: nextPw } = req.body || {};
    if (!verifyPassword(current || '', req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (String(nextPw || '').length < cfg.auth.minPasswordLength) return res.status(400).json({ error: `Use at least ${cfg.auth.minPasswordLength} characters.` });
    db.prepare('UPDATE pf_users SET password_hash = ? WHERE id = ?').run(hashPassword(nextPw), req.user.id);
    res.json({ ok: true });
  });

  // ---------- platform admin ----------

  r.get('/admin/organizations', requireUser, requirePlatformAdmin, (req, res) => {
    const attention = Object.entries(cfg.entityStatuses).filter(([, s]) => s.attention).map(([k]) => k);
    const rows = db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM pf_entities e WHERE e.org_id = o.id) AS entity_count,
        (SELECT COUNT(*) FROM pf_entities e WHERE e.org_id = o.id AND e.status IN (${attention.map(() => '?').join(',') || "''"})) AS attention_count,
        (SELECT COUNT(*) FROM pf_memberships m WHERE m.org_id = o.id) AS user_count,
        (SELECT MAX(finished_at) FROM pf_sync_runs s WHERE s.org_id = o.id) AS last_sync_at
      FROM pf_organizations o ORDER BY o.name`).all(...attention);
    const orgs = rows.map((o) => ({
      ...orgSummary(o, 'platform_admin'),
      entityCount: o.entity_count, attentionCount: o.attention_count, userCount: o.user_count, lastSyncAt: o.last_sync_at,
      planLabel: planOf(o.plan).label || o.plan,
    }));
    const totals = {
      organizations: orgs.length,
      active: orgs.filter((o) => o.status !== 'suspended').length,
      entities: orgs.reduce((s, o) => s + o.entityCount, 0),
      users: db.prepare('SELECT COUNT(*) AS n FROM pf_users WHERE is_platform_admin = 0').get().n,
      attention: orgs.reduce((s, o) => s + o.attentionCount, 0),
    };
    res.json({ organizations: orgs, totals });
  });

  r.post('/admin/organizations', requireUser, requirePlatformAdmin, (req, res) => {
    const b = req.body || {};
    const d = cfg.orgDefaults;
    const name = String(b.name || '').trim();
    const adminEmail = String(b.adminEmail || '').trim().toLowerCase();
    const adminName = String(b.adminName || '').trim();
    if (!name) return res.status(400).json({ error: 'Organization name is required.' });
    if (!/^\S+@\S+\.\S+$/.test(adminEmail) || !adminName) return res.status(400).json({ error: 'An admin name and a valid email are required.' });
    const plan = cfg.plans.some((p) => p.id === b.plan) ? b.plan : d.plan;
    const currency = cfg.options.currencies.includes(b.currency) ? b.currency : d.currency;
    const industry = (cfg.industries || []).includes(b.industry) ? b.industry : d.industry;
    const color = cfg.options.brandColors.includes(b.brandColor) ? b.brandColor : d.brandColor;

    const orgId = db.transaction(() => {
      const id = db.prepare(`
        INSERT INTO pf_organizations (name, slug, industry, plan, status, currency, timezone, fiscal_year_start, sync_schedule, brand_color, live_dashboard, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(name, uniqueSlug(db, name), industry, plan, plan === 'trial' && cfg.orgStatuses.trial ? 'trial' : d.status, currency, d.timezone, d.fiscalYearStart, d.syncSchedule, color, now())
        .lastInsertRowid;
      let user = db.prepare('SELECT * FROM pf_users WHERE email = ?').get(adminEmail);
      if (!user) {
        const uid = db.prepare(`INSERT INTO pf_users (email, name, password_hash, status, created_at) VALUES (?, ?, ?, 'invited', ?)`)
          .run(adminEmail, adminName, cfg.auth.demoMode ? hashPassword(cfg.auth.demoPassword) : null, now()).lastInsertRowid;
        user = { id: uid };
      }
      db.prepare(`INSERT INTO pf_memberships (user_id, org_id, role, status, created_at) VALUES (?, ?, ?, 'invited', ?)`).run(user.id, id, cfg.adminRole, now());
      audit(id, req.user.id, 'org.created', `Organization ${name} created`);
      audit(id, req.user.id, 'user.invited', `${adminName} (${adminEmail}) as ${roleOf(cfg.adminRole).label}`);
      return id;
    })();
    res.status(201).json({ id: orgId });
  });

  r.patch('/admin/organizations/:orgId', requireUser, requirePlatformAdmin, (req, res) => {
    const o = db.prepare('SELECT * FROM pf_organizations WHERE id = ?').get(Number(req.params.orgId));
    if (!o) return res.status(404).json({ error: 'Organization not found' });
    const b = req.body || {};
    if (b.status && !cfg.orgStatuses[b.status]) return res.status(400).json({ error: 'Unknown status' });
    if (b.plan && !cfg.plans.some((p) => p.id === b.plan)) return res.status(400).json({ error: 'Unknown plan' });
    db.prepare('UPDATE pf_organizations SET status = COALESCE(?, status), plan = COALESCE(?, plan), live_dashboard = COALESCE(?, live_dashboard) WHERE id = ?')
      .run(b.status || null, b.plan || null, typeof b.liveDashboard === 'boolean' ? Number(b.liveDashboard) : null, o.id);
    audit(o.id, req.user.id, 'org.updated', [b.status && `status → ${cfg.orgStatuses[b.status].label}`, b.plan && `plan → ${planOf(b.plan).label}`, typeof b.liveDashboard === 'boolean' && `live reports ${b.liveDashboard ? 'on' : 'off'}`].filter(Boolean).join(', '));
    res.json({ ok: true });
  });

  // Permanently delete an organization with its groups, entities, memberships, access, sync runs and activity.
  // Users left without any organization are deleted too. Body must repeat the exact name: { confirm }.
  r.delete('/admin/organizations/:orgId', requireUser, requirePlatformAdmin, (req, res) => {
    const o = db.prepare('SELECT * FROM pf_organizations WHERE id = ?').get(Number(req.params.orgId));
    if (!o) return res.status(404).json({ error: 'Organization not found' });
    if (req.body?.confirm !== o.name) return res.status(400).json({ error: `Send { "confirm": "${o.name}" } to delete this organization.` });
    const orphans = db.prepare(`
      SELECT u.id FROM pf_users u WHERE u.is_platform_admin = 0
        AND EXISTS (SELECT 1 FROM pf_memberships m WHERE m.user_id = u.id AND m.org_id = ?)
        AND NOT EXISTS (SELECT 1 FROM pf_memberships m WHERE m.user_id = u.id AND m.org_id <> ?)`).all(o.id, o.id);
    const entities = db.prepare('SELECT COUNT(*) AS n FROM pf_entities WHERE org_id = ?').get(o.id).n;
    db.transaction(() => {
      db.prepare('DELETE FROM pf_audit WHERE org_id = ?').run(o.id);
      db.prepare('DELETE FROM pf_organizations WHERE id = ?').run(o.id); // cascades
      for (const u of orphans) db.prepare('DELETE FROM pf_users WHERE id = ?').run(u.id);
    })();
    audit(null, req.user.id, 'org.deleted', `Organization ${o.name} deleted (${entities} entities, ${orphans.length} users)`);
    res.json({ ok: true, deleted: { organization: o.name, entities, users: orphans.length } });
  });

  // Permanently delete a QuickBooks connection and everything synced from it (P&L lines, accounts, sync logs).
  // Refused while an entity still links to it. Body must repeat the company name: { confirm }.
  r.delete('/admin/connections/:realmId', requireUser, requirePlatformAdmin, (req, res) => {
    const realm = String(req.params.realmId);
    const c = db.prepare('SELECT * FROM connections WHERE realm_id = ?').get(realm);
    if (!c) return res.status(404).json({ error: 'Connection not found' });
    if (req.body?.confirm !== c.company_name) return res.status(400).json({ error: `Send { "confirm": "${c.company_name}" } to delete this connection and its data.` });
    const linked = db.prepare('SELECT e.name, o.name AS org FROM pf_entities e JOIN pf_organizations o ON o.id = e.org_id WHERE e.external_id = ?').get(realm);
    if (linked) return res.status(400).json({ error: `Still linked to entity ${linked.name} in ${linked.org}. Remove that entity first.` });
    const n = (t, col) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(realm).n;
    const deleted = { company: c.company_name, plLines: n('pl_lines', 'office_realm_id'), accounts: n('accounts', 'office_realm_id'), syncLogs: n('sync_logs', 'realm_id') };
    db.transaction(() => {
      db.prepare('DELETE FROM pl_lines WHERE office_realm_id = ?').run(realm);
      db.prepare('DELETE FROM accounts WHERE office_realm_id = ?').run(realm);
      db.prepare('DELETE FROM sync_logs WHERE realm_id = ?').run(realm);
      db.prepare('DELETE FROM connections WHERE realm_id = ?').run(realm);
    })();
    audit(null, req.user.id, 'connection.deleted', `QuickBooks company ${c.company_name} (${realm}) and its data deleted`);
    res.json({ ok: true, deleted });
  });

  // Identification details QuickBooks returns for each connected company (platform admins only).
  r.get('/admin/connections', requireUser, requirePlatformAdmin, (req, res) => {
    const rows = db.prepare(`SELECT c.realm_id, c.company_name, c.legal_name, c.city, c.state, c.details_json, e.name AS entity, o.name AS org
      FROM connections c LEFT JOIN pf_entities e ON e.external_id = c.realm_id LEFT JOIN pf_organizations o ON o.id = e.org_id ORDER BY c.company_name`).all();
    res.json({ connections: rows.map((r) => ({ realmId: r.realm_id, companyName: r.company_name, legalName: r.legal_name, city: r.city, state: r.state, entity: r.entity, organization: r.org, details: r.details_json ? JSON.parse(r.details_json) : null })) });
  });

  // ---------- organization context ----------

  function orgCtx(req) {
    const org = db.prepare('SELECT * FROM pf_organizations WHERE id = ?').get(Number(req.params.orgId));
    if (!org) throw httpError(404, 'Organization not found');
    let role;
    if (req.user.is_platform_admin) role = 'platform_admin';
    else role = db.prepare(`SELECT role FROM pf_memberships WHERE user_id = ? AND org_id = ? AND status = 'active'`).get(req.user.id, org.id)?.role;
    if (!role) throw httpError(403, 'You do not have access to this organization');
    if (role !== 'platform_admin' && cfg.orgStatuses[org.status]?.canSignIn === false) throw httpError(403, 'This organization is suspended');
    const seesAll = hasPerm(role, 'entities.all');
    const assigned = seesAll ? null : new Set(db.prepare('SELECT entity_id FROM pf_user_entities WHERE user_id = ?').all(req.user.id).map((x) => x.entity_id));
    return { org, role, can: (p) => hasPerm(role, p), canSee: (id) => !assigned || assigned.has(id) };
  }

  const route = (perm, handler) => [requireUser, async (req, res) => {
    try {
      const ctx = orgCtx(req);
      if (perm && !ctx.can(perm)) throw httpError(403, `Your role cannot do this (${cfg.permissions[perm] || perm})`);
      await handler(req, res, ctx);
    } catch (err) {
      if (!err.status) console.error(err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }];

  /** Entities visible to the caller. Live entities take their status and last sync from the real sync. */
  function entities(ctx) {
    return db.prepare(`
      SELECT e.*, g.name AS group_name FROM pf_entities e LEFT JOIN pf_entity_groups g ON g.id = e.group_id
      WHERE e.org_id = ? ORDER BY COALESCE(g.name, 'zzz'), e.name`).all(ctx.org.id)
      .filter((e) => ctx.canSee(e.id))
      .map((e) => {
        if (e.data_source !== 'live' || !e.external_id) return e;
        const conn = db.prepare('SELECT 1 FROM connections WHERE realm_id = ?').get(e.external_id);
        const log = db.prepare('SELECT status, finished_at FROM sync_logs WHERE realm_id = ? ORDER BY id DESC LIMIT 1').get(e.external_id);
        const ok = db.prepare(`SELECT MAX(finished_at) AS at FROM sync_logs WHERE realm_id = ? AND status = 'success'`).get(e.external_id)?.at;
        return { ...e, status: !conn ? 'needs_reconnect' : log?.status === 'error' ? 'error' : 'connected', last_sync_at: ok || e.last_sync_at };
      });
  }
  const entityDto = (e) => ({
    id: e.id, name: e.name, groupId: e.group_id, groupName: e.group_name, connector: e.connector, externalId: e.external_id,
    status: e.status, dataSource: e.data_source, lastSyncAt: e.last_sync_at, createdAt: e.created_at,
  });

  function monthlyFigures(e, months) {
    if (cfg.entityStatuses[e.status]?.includeInFigures === false) return months.map(() => ({ revenue: 0, expenses: 0 }));
    if (e.data_source === 'live') {
      const rows = db.prepare(`
        SELECT substr(period_start, 1, 7) AS m, grp, SUM(amount) AS a FROM pl_lines
        WHERE office_realm_id = ? GROUP BY m, grp`).all(e.external_id);
      const inc = new Set(appConfig.groups.incomeGroups);
      const exp = new Set(appConfig.groups.expenseGroups);
      const by = {};
      for (const x of rows) {
        by[x.m] ||= { revenue: 0, expenses: 0 };
        if (inc.has(x.grp)) by[x.m].revenue += x.a;
        if (exp.has(x.grp)) by[x.m].expenses += x.a;
      }
      return months.map((m) => by[m] || { revenue: 0, expenses: 0 });
    }
    return months.map((m) => {
      const idx = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
      const seasonal = 1 + 0.08 * Math.sin(((Number(m.slice(5)) - 1) / 12) * 2 * Math.PI + e.id);
      const revenue = (e.annual_revenue / 12) * seasonal * (0.92 + 0.16 * prand(e.id, idx));
      const expenses = revenue * (1 - e.margin) * (0.97 + 0.06 * prand(e.id + 7, idx));
      return { revenue, expenses };
    });
  }

  // ---------- overview ----------

  r.get('/orgs/:orgId/overview', ...route('org.view', (req, res, ctx) => {
    const months = lastMonths(cfg.overview.months);
    const list = entities(ctx);
    const series = months.map((m) => ({ month: m, label: monthLabel(m), revenue: 0, expenses: 0, netIncome: 0 }));
    const byEntity = list.map((e) => {
      const f = monthlyFigures(e, months);
      let revenue = 0;
      let expenses = 0;
      f.forEach((x, i) => {
        series[i].revenue += x.revenue;
        series[i].expenses += x.expenses;
        revenue += x.revenue;
        expenses += x.expenses;
      });
      return { ...entityDto(e), revenue: round2(revenue), expenses: round2(expenses), netIncome: round2(revenue - expenses) };
    });
    for (const s of series) { s.revenue = round2(s.revenue); s.expenses = round2(s.expenses); s.netIncome = round2(s.revenue - s.expenses); }
    const revenue = series.reduce((s, x) => s + x.revenue, 0);
    const expenses = series.reduce((s, x) => s + x.expenses, 0);
    const attention = list.filter((e) => cfg.entityStatuses[e.status]?.attention);
    const visible = new Set(list.map((e) => e.id));
    const runs = db.prepare(`
      SELECT s.*, e.name AS entity_name FROM pf_sync_runs s JOIN pf_entities e ON e.id = s.entity_id
      WHERE s.org_id = ? ORDER BY s.started_at DESC LIMIT 200`).all(ctx.org.id).filter((x) => visible.has(x.entity_id)).slice(0, cfg.overview.recentRuns);
    const lastError = (id) => db.prepare(`SELECT message FROM pf_sync_runs WHERE entity_id = ? AND status = 'error' ORDER BY started_at DESC LIMIT 1`).get(id)?.message;
    res.json({
      period: { from: months[0], to: months.at(-1), months: months.length },
      kpis: {
        revenue: round2(revenue), expenses: round2(expenses), netIncome: round2(revenue - expenses),
        margin: revenue ? (revenue - expenses) / revenue : null,
        entities: list.length, connected: list.filter((e) => e.status === 'connected').length, attention: attention.length,
        users: ctx.can('users.view') ? db.prepare('SELECT COUNT(*) AS n FROM pf_memberships WHERE org_id = ?').get(ctx.org.id).n : null,
      },
      series,
      entities: byEntity.sort((a, b) => b.revenue - a.revenue).slice(0, cfg.overview.topEntities ?? undefined),
      attention: attention.map((e) => ({ ...entityDto(e), message: e.data_source === 'live' && e.status === 'needs_reconnect' ? 'This QuickBooks company is no longer connected on the server.' : lastError(e.id) || cfg.sync.messages[e.status] || null })),
      recentRuns: runs.map((x) => ({ id: x.id, entityId: x.entity_id, entityName: x.entity_name, status: x.status, trigger: x.trigger, rows: x.rows, message: x.message, startedAt: x.started_at, finishedAt: x.finished_at })),
      hasSample: list.some((e) => e.data_source === 'sample' && cfg.entityStatuses[e.status]?.includeInFigures !== false),
      hasLive: list.some((e) => e.data_source === 'live'),
    });
  }));

  // ---------- entities & groups ----------

  r.get('/orgs/:orgId/entities', ...route('entities.view', (req, res, ctx) => {
    const groups = db.prepare('SELECT id, name FROM pf_entity_groups WHERE org_id = ? ORDER BY name').all(ctx.org.id);
    const plan = planOf(ctx.org.plan);
    const total = db.prepare('SELECT COUNT(*) AS n FROM pf_entities WHERE org_id = ?').get(ctx.org.id).n;
    res.json({ entities: entities(ctx).map(entityDto), groups, limits: { maxEntities: plan.maxEntities ?? null, used: total, plan: plan.label } });
  }));

  r.get('/orgs/:orgId/available-connections', ...route('entities.manage', (req, res, ctx) => {
    const connectUrl = `/connect?org=${ctx.org.id}&return=${encodeURIComponent(`/app/o/${ctx.org.id}/entities`)}`;
    // Unlinked companies on the server may belong to another client, so only platform admins may pick from them.
    if (!ctx.org.live_dashboard || !req.user.is_platform_admin) return res.json({ connections: [], connectUrl });
    const linked = new Set(db.prepare(`SELECT external_id FROM pf_entities WHERE external_id IS NOT NULL`).all().map((x) => x.external_id));
    const rows = db.prepare('SELECT realm_id, company_name FROM connections ORDER BY company_name').all().filter((c) => !linked.has(c.realm_id));
    res.json({ connections: rows.map((c) => ({ realmId: c.realm_id, companyName: c.company_name })), connectUrl: `/connect?org=${ctx.org.id}&return=${encodeURIComponent(`/app/o/${ctx.org.id}/entities`)}` });
  }));

  function resolveGroup(ctx, b) {
    if (b.newGroup && String(b.newGroup).trim()) {
      const name = String(b.newGroup).trim();
      const found = db.prepare('SELECT id FROM pf_entity_groups WHERE org_id = ? AND name = ?').get(ctx.org.id, name);
      return found ? found.id : db.prepare('INSERT INTO pf_entity_groups (org_id, name) VALUES (?, ?)').run(ctx.org.id, name).lastInsertRowid;
    }
    if (b.groupId == null || b.groupId === '') return null;
    const g = db.prepare('SELECT id FROM pf_entity_groups WHERE id = ? AND org_id = ?').get(Number(b.groupId), ctx.org.id);
    if (!g) throw httpError(400, 'Unknown group');
    return g.id;
  }

  r.post('/orgs/:orgId/entities', ...route('entities.manage', (req, res, ctx) => {
    const b = req.body || {};
    const plan = planOf(ctx.org.plan);
    const count = db.prepare('SELECT COUNT(*) AS n FROM pf_entities WHERE org_id = ?').get(ctx.org.id).n;
    if (plan.maxEntities != null && count >= plan.maxEntities) throw httpError(400, `The ${plan.label} plan allows ${plan.maxEntities} entities.`);
    const connector = cfg.connectors.find((c) => c.id === (b.connector || 'quickbooks'));
    if (!connector?.enabled) throw httpError(400, 'That connector is not available yet.');

    let name = String(b.name || '').trim();
    let externalId = null;
    if (b.realmId) {
      if (!req.user.is_platform_admin) throw httpError(403, 'Connect the company through "Connect QuickBooks company" instead.');
      if (!ctx.org.live_dashboard) throw httpError(400, 'Live QuickBooks companies can only be linked to organizations with live reports enabled.');
      const conn = db.prepare('SELECT * FROM connections WHERE realm_id = ?').get(String(b.realmId));
      if (!conn) throw httpError(400, 'That QuickBooks company is not connected on the server.');
      if (db.prepare('SELECT 1 FROM pf_entities WHERE external_id = ?').get(conn.realm_id)) throw httpError(400, 'That company is already linked to an entity.');
      externalId = conn.realm_id;
      name ||= conn.company_name;
    }
    if (!name) throw httpError(400, 'Entity name is required.');
    const groupId = resolveGroup(ctx, b);
    const id = db.prepare(`
      INSERT INTO pf_entities (org_id, group_id, name, connector, external_id, status, data_source, annual_revenue, margin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0.1, ?)`)
      .run(ctx.org.id, groupId, name, connector.id, externalId, externalId ? 'connected' : 'pending', externalId ? 'live' : 'sample', now()).lastInsertRowid;
    audit(ctx.org.id, req.user.id, 'entity.added', `Entity ${name} added${externalId ? ' (linked to QuickBooks)' : ''}`);
    res.status(201).json({ id });
  }));

  const ownEntity = (ctx, id) => {
    const e = db.prepare('SELECT * FROM pf_entities WHERE id = ? AND org_id = ?').get(Number(id), ctx.org.id);
    if (!e || !ctx.canSee(e.id)) throw httpError(404, 'Entity not found');
    return e;
  };

  r.patch('/orgs/:orgId/entities/:entityId', ...route('entities.manage', (req, res, ctx) => {
    const e = ownEntity(ctx, req.params.entityId);
    const b = req.body || {};
    const name = b.name != null ? String(b.name).trim() : e.name;
    if (!name) throw httpError(400, 'Entity name is required.');
    const groupId = 'groupId' in b || b.newGroup ? resolveGroup(ctx, b) : e.group_id;
    db.prepare('UPDATE pf_entities SET name = ?, group_id = ? WHERE id = ?').run(name, groupId, e.id);
    audit(ctx.org.id, req.user.id, 'entity.updated', `Entity ${e.name}${name !== e.name ? ` renamed to ${name}` : ' updated'}`);
    res.json({ ok: true });
  }));

  // Sample entities reconnect instantly. Live ones hand back the real OAuth URL.
  r.post('/orgs/:orgId/entities/:entityId/connect', ...route('entities.manage', (req, res, ctx) => {
    const e = ownEntity(ctx, req.params.entityId);
    if (e.data_source === 'live') return res.json({ redirect: `/connect?org=${ctx.org.id}&return=${encodeURIComponent(`/app/o/${ctx.org.id}/entities`)}` });
    db.prepare(`UPDATE pf_entities SET status = 'connected' WHERE id = ?`).run(e.id);
    if (!e.annual_revenue) db.prepare('UPDATE pf_entities SET annual_revenue = ?, margin = ? WHERE id = ?').run(Math.round(600000 + prand(e.id) * 1400000), 0.08 + prand(e.id, 3) * 0.12, e.id);
    audit(ctx.org.id, req.user.id, 'entity.connected', `Entity ${e.name} ${e.status === 'pending' ? 'connected' : 'reconnected'} (sample)`);
    res.json({ ok: true });
  }));

  r.delete('/orgs/:orgId/entities/:entityId', ...route('entities.manage', (req, res, ctx) => {
    const e = ownEntity(ctx, req.params.entityId);
    db.prepare('DELETE FROM pf_entities WHERE id = ?').run(e.id);
    audit(ctx.org.id, req.user.id, 'entity.removed', `Entity ${e.name} removed`);
    res.json({ ok: true });
  }));

  r.post('/orgs/:orgId/groups', ...route('entities.manage', (req, res, ctx) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw httpError(400, 'Group name is required.');
    if (db.prepare('SELECT 1 FROM pf_entity_groups WHERE org_id = ? AND name = ?').get(ctx.org.id, name)) throw httpError(400, 'A group with that name exists.');
    const id = db.prepare('INSERT INTO pf_entity_groups (org_id, name) VALUES (?, ?)').run(ctx.org.id, name).lastInsertRowid;
    audit(ctx.org.id, req.user.id, 'group.added', `Group ${name} added`);
    res.status(201).json({ id });
  }));

  r.delete('/orgs/:orgId/groups/:groupId', ...route('entities.manage', (req, res, ctx) => {
    const g = db.prepare('SELECT * FROM pf_entity_groups WHERE id = ? AND org_id = ?').get(Number(req.params.groupId), ctx.org.id);
    if (!g) throw httpError(404, 'Group not found');
    db.prepare('DELETE FROM pf_entity_groups WHERE id = ?').run(g.id);
    audit(ctx.org.id, req.user.id, 'group.removed', `Group ${g.name} removed (its entities are now ungrouped)`);
    res.json({ ok: true });
  }));

  // ---------- users & access ----------

  r.get('/orgs/:orgId/users', ...route('users.view', (req, res, ctx) => {
    const rows = db.prepare(`
      SELECT u.id, u.email, u.name, u.last_login_at, m.role, m.status, m.created_at FROM pf_memberships m
      JOIN pf_users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.name`).all(ctx.org.id);
    const access = db.prepare(`
      SELECT ue.user_id, ue.entity_id FROM pf_user_entities ue JOIN pf_entities e ON e.id = ue.entity_id WHERE e.org_id = ?`).all(ctx.org.id);
    const byUser = {};
    for (const a of access) (byUser[a.user_id] ||= []).push(a.entity_id);
    const plan = planOf(ctx.org.plan);
    res.json({
      users: rows.map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, lastLoginAt: u.last_login_at, addedAt: u.created_at,
        seesAll: hasPerm(u.role, 'entities.all'), entityIds: byUser[u.id] || [],
      })),
      roles: orgRoles.map((id) => ({ id, label: cfg.roles[id].label, description: cfg.roles[id].description, seesAll: hasPerm(id, 'entities.all') })),
      limits: { maxUsers: plan.maxUsers ?? null, used: rows.length, plan: plan.label },
    });
  }));

  function setAccess(ctx, userId, entityIds) {
    const valid = new Set(db.prepare('SELECT id FROM pf_entities WHERE org_id = ?').all(ctx.org.id).map((x) => x.id).filter((id) => ctx.canSee(id)));
    db.prepare('DELETE FROM pf_user_entities WHERE user_id = ? AND entity_id IN (SELECT id FROM pf_entities WHERE org_id = ?)').run(userId, ctx.org.id);
    const ins = db.prepare('INSERT OR IGNORE INTO pf_user_entities (user_id, entity_id) VALUES (?, ?)');
    for (const id of entityIds || []) if (valid.has(Number(id))) ins.run(userId, Number(id));
  }

  r.post('/orgs/:orgId/users', ...route('users.manage', (req, res, ctx) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const role = b.role || cfg.defaultInviteRole;
    if (!/^\S+@\S+\.\S+$/.test(email) || !name) throw httpError(400, 'A name and a valid email are required.');
    if (!orgRoles.includes(role)) throw httpError(400, 'Unknown role');
    if (role === 'platform_admin') throw httpError(400, 'Platform admins cannot be invited here.');
    if (!canGrantRole(ctx, role)) throw httpError(403, `Your role cannot assign ${cfg.roles[role].label}.`);
    const plan = planOf(ctx.org.plan);
    const count = db.prepare('SELECT COUNT(*) AS n FROM pf_memberships WHERE org_id = ?').get(ctx.org.id).n;
    if (plan.maxUsers != null && count >= plan.maxUsers) throw httpError(400, `The ${plan.label} plan allows ${plan.maxUsers} users.`);
    if (!hasPerm(role, 'entities.all') && !(b.entityIds || []).length) throw httpError(400, 'Choose at least one entity this user can see.');

    db.transaction(() => {
      let u = db.prepare('SELECT * FROM pf_users WHERE email = ?').get(email);
      if (!u) {
        const id = db.prepare(`INSERT INTO pf_users (email, name, password_hash, status, created_at) VALUES (?, ?, ?, 'invited', ?)`)
          .run(email, name, cfg.auth.demoMode ? hashPassword(cfg.auth.demoPassword) : null, now()).lastInsertRowid;
        u = { id };
      } else if (db.prepare('SELECT 1 FROM pf_memberships WHERE user_id = ? AND org_id = ?').get(u.id, ctx.org.id)) {
        throw httpError(400, 'That person is already in this organization.');
      }
      db.prepare(`INSERT INTO pf_memberships (user_id, org_id, role, status, created_at) VALUES (?, ?, ?, 'invited', ?)`).run(u.id, ctx.org.id, role, now());
      setAccess(ctx, u.id, hasPerm(role, 'entities.all') ? [] : b.entityIds);
      audit(ctx.org.id, req.user.id, 'user.invited', `${name} (${email}) as ${cfg.roles[role].label}`);
    })();
    res.status(201).json({
      ok: true,
      note: cfg.auth.demoMode ? `Demo mode: no email is sent. ${email} can sign in with the demo password.` : 'Invitation recorded. Email delivery is not configured yet.',
    });
  }));

  const adminCount = (orgId) => db.prepare(`SELECT COUNT(*) AS n FROM pf_memberships WHERE org_id = ? AND role = ? AND status = 'active'`).get(orgId, cfg.adminRole).n;
  // A caller may only hand out roles whose permissions they hold themselves (no escalation by config).
  const canGrantRole = (ctx, role) => ctx.role === 'platform_admin' || permsOf(role).every((p) => p !== '*' && hasPerm(ctx.role, p));

  r.patch('/orgs/:orgId/users/:userId', ...route('users.manage', (req, res, ctx) => {
    const uid = Number(req.params.userId);
    const m = db.prepare('SELECT m.*, u.name FROM pf_memberships m JOIN pf_users u ON u.id = m.user_id WHERE m.user_id = ? AND m.org_id = ?').get(uid, ctx.org.id);
    if (!m) throw httpError(404, 'User not found in this organization');
    const b = req.body || {};
    const role = b.role || m.role;
    if (!orgRoles.includes(role)) throw httpError(400, 'Unknown role');
    if (uid === req.user.id && role !== m.role && ctx.role !== 'platform_admin') throw httpError(400, 'You cannot change your own role. Ask another administrator.');
    if (role !== m.role && !canGrantRole(ctx, role)) throw httpError(403, `Your role cannot assign ${cfg.roles[role].label}.`);
    if (m.role === cfg.adminRole && role !== cfg.adminRole && adminCount(ctx.org.id) <= 1) throw httpError(400, `An organization needs at least one ${cfg.roles[cfg.adminRole].label}.`);
    if (!hasPerm(role, 'entities.all') && Array.isArray(b.entityIds) && b.entityIds.length === 0) throw httpError(400, 'Choose at least one entity this user can see.');
    db.transaction(() => {
      db.prepare('UPDATE pf_memberships SET role = ? WHERE user_id = ? AND org_id = ?').run(role, uid, ctx.org.id);
      if (Array.isArray(b.entityIds)) setAccess(ctx, uid, hasPerm(role, 'entities.all') ? [] : b.entityIds);
    })();
    audit(ctx.org.id, req.user.id, 'user.updated', `${m.name}: ${cfg.roles[role].label}${Array.isArray(b.entityIds) && !hasPerm(role, 'entities.all') ? `, ${b.entityIds.length} entities` : ''}`);
    res.json({ ok: true });
  }));

  r.delete('/orgs/:orgId/users/:userId', ...route('users.manage', (req, res, ctx) => {
    const uid = Number(req.params.userId);
    const m = db.prepare('SELECT m.*, u.name FROM pf_memberships m JOIN pf_users u ON u.id = m.user_id WHERE m.user_id = ? AND m.org_id = ?').get(uid, ctx.org.id);
    if (!m) throw httpError(404, 'User not found in this organization');
    if (m.role === cfg.adminRole && adminCount(ctx.org.id) <= 1) throw httpError(400, `An organization needs at least one ${cfg.roles[cfg.adminRole].label}.`);
    db.transaction(() => {
      db.prepare('DELETE FROM pf_memberships WHERE user_id = ? AND org_id = ?').run(uid, ctx.org.id);
      db.prepare('DELETE FROM pf_user_entities WHERE user_id = ? AND entity_id IN (SELECT id FROM pf_entities WHERE org_id = ?)').run(uid, ctx.org.id);
    })();
    audit(ctx.org.id, req.user.id, 'user.removed', `${m.name} removed`);
    res.json({ ok: true });
  }));

  // ---------- sync ----------

  r.get('/orgs/:orgId/sync-runs', ...route('sync.view', (req, res, ctx) => {
    const visible = new Set(entities(ctx).map((e) => e.id));
    const runs = db.prepare(`
      SELECT s.*, e.name AS entity_name FROM pf_sync_runs s JOIN pf_entities e ON e.id = s.entity_id
      WHERE s.org_id = ? ORDER BY s.started_at DESC LIMIT ?`).all(ctx.org.id, cfg.sync.historyLimit)
      .filter((x) => visible.has(x.entity_id));
    const since = Date.now() - cfg.sync.historyDays * 864e5;
    const recent = runs.filter((x) => Date.parse(x.started_at) >= since);
    res.json({
      schedule: cfg.options.syncSchedules.find((s) => s.id === ctx.org.sync_schedule)?.label || ctx.org.sync_schedule,
      stats: {
        days: cfg.sync.historyDays, runs: recent.length, failed: recent.filter((x) => x.status === 'error').length,
        successRate: recent.length ? recent.filter((x) => x.status === 'success').length / recent.length : null,
        lastRunAt: runs[0]?.started_at || null,
      },
      runs: runs.map((x) => ({ id: x.id, entityId: x.entity_id, entityName: x.entity_name, trigger: x.trigger, status: x.status, rows: x.rows, message: x.message, startedAt: x.started_at, finishedAt: x.finished_at })),
    });
  }));

  r.post('/orgs/:orgId/sync', ...route('sync.run', async (req, res, ctx) => {
    const list = entities(ctx).filter((e) => cfg.entityStatuses[e.status]?.includeInFigures !== false || e.data_source === 'live');
    const startedAt = now();
    let live = null;
    if (list.some((e) => e.data_source === 'live')) {
      // Only this organization's companies (the caller may only see some of them).
      const realmIds = list.filter((e) => e.data_source === 'live').map((e) => e.external_id);
      live = hasCredentials() ? await syncAll(db, { realmIds }) : { results: [], error: 'QuickBooks credentials are not configured on the server.' };
    }
    const ins = db.prepare(`INSERT INTO pf_sync_runs (org_id, entity_id, trigger, status, rows, message, started_at, finished_at) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?)`);
    const results = [];
    db.transaction(() => {
      list.forEach((e, i) => {
        let status;
        let rows = null;
        let message = null;
        if (e.data_source === 'live') {
          const r0 = live.results.find((x) => x.realmId === e.external_id);
          if (r0?.status === 'success') { status = 'success'; rows = r0.rows; }
          else { status = 'error'; message = r0?.error || live.error || 'This QuickBooks company is not connected on the server.'; }
        } else if (cfg.entityStatuses[e.status]?.attention) {
          status = 'error';
          message = cfg.sync.messages[e.status] || 'Sync failed.';
        } else {
          status = 'success';
          rows = Math.round(cfg.sync.sampleRows.min + Math.random() * (cfg.sync.sampleRows.max - cfg.sync.sampleRows.min));
        }
        const finished = new Date(Date.parse(startedAt) + (i + 1) * 1500).toISOString();
        ins.run(ctx.org.id, e.id, status, rows, message, startedAt, finished);
        if (status === 'success' && e.data_source === 'sample') db.prepare('UPDATE pf_entities SET last_sync_at = ? WHERE id = ?').run(finished, e.id);
        results.push({ entity: e.name, status, rows, message });
      });
    })();
    const failed = results.filter((x) => x.status === 'error').length;
    audit(ctx.org.id, req.user.id, 'sync.run', `Manual sync: ${results.length - failed} succeeded, ${failed} failed`);
    res.json({ results, succeeded: results.length - failed, failed });
  }));

  // ---------- activity & settings ----------

  r.get('/orgs/:orgId/activity', ...route('activity.view', (req, res, ctx) => {
    const rows = db.prepare(`
      SELECT a.*, u.name AS user_name FROM pf_audit a LEFT JOIN pf_users u ON u.id = a.user_id
      WHERE a.org_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 300`).all(ctx.org.id);
    res.json({ activity: rows.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.at, user: a.user_name || 'System' })) });
  }));

  r.get('/orgs/:orgId/settings', ...route('org.view', (req, res, ctx) => res.json({ organization: orgSummary(ctx.org, ctx.role) })));

  r.patch('/orgs/:orgId/settings', ...route('settings.manage', (req, res, ctx) => {
    const b = req.body || {};
    const o = ctx.org;
    const next = {
      name: b.name != null ? String(b.name).trim() : o.name,
      industry: b.industry ?? o.industry,
      currency: b.currency ?? o.currency,
      timezone: b.timezone ?? o.timezone,
      fiscal_year_start: b.fiscalYearStart != null ? Number(b.fiscalYearStart) : o.fiscal_year_start,
      sync_schedule: b.syncSchedule ?? o.sync_schedule,
      brand_color: b.brandColor ?? o.brand_color,
    };
    if (!next.name) throw httpError(400, 'Organization name is required.');
    if (!cfg.options.currencies.includes(next.currency)) throw httpError(400, 'Unknown currency');
    if (!cfg.options.timezones.includes(next.timezone)) throw httpError(400, 'Unknown time zone');
    if (!cfg.options.syncSchedules.some((s) => s.id === next.sync_schedule)) throw httpError(400, 'Unknown sync schedule');
    if (!(next.fiscal_year_start >= 1 && next.fiscal_year_start <= 12)) throw httpError(400, 'Fiscal year start must be a month');
    if (!/^#[0-9a-f]{6}$/i.test(next.brand_color)) throw httpError(400, 'Brand color must be a hex color');
    db.prepare(`UPDATE pf_organizations SET name = @name, industry = @industry, currency = @currency, timezone = @timezone,
      fiscal_year_start = @fiscal_year_start, sync_schedule = @sync_schedule, brand_color = @brand_color WHERE id = @id`).run({ ...next, id: o.id });
    const changed = Object.keys(next).filter((k) => next[k] !== o[k]);
    audit(o.id, req.user.id, 'settings.updated', changed.length ? `Changed ${changed.map((k) => k.replace(/_/g, ' ')).join(', ')}` : 'No changes');
    res.json({ ok: true });
  }));

  return { router: r, currentUser, hasPerm };
}
