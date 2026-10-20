// Platform tables (organizations, entities, users, memberships, access, sync runs, audit) and seeding.
// They live in the same SQLite file as the P&L data, prefixed pf_.
import { hashPassword } from './auth.js';

export function initPlatformSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pf_organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      industry TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      timezone TEXT NOT NULL,
      fiscal_year_start INTEGER NOT NULL,
      sync_schedule TEXT NOT NULL,
      brand_color TEXT NOT NULL,
      live_dashboard INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pf_entity_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES pf_organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE (org_id, name)
    );
    CREATE TABLE IF NOT EXISTS pf_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES pf_organizations(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES pf_entity_groups(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      connector TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL,
      data_source TEXT NOT NULL DEFAULT 'sample',  -- sample | live
      annual_revenue REAL NOT NULL DEFAULT 0,
      margin REAL NOT NULL DEFAULT 0.1,
      last_sync_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pf_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      is_platform_admin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',   -- active | invited | disabled
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pf_memberships (
      user_id INTEGER NOT NULL REFERENCES pf_users(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES pf_organizations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',   -- active | invited
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, org_id)
    );
    CREATE TABLE IF NOT EXISTS pf_user_entities (
      user_id INTEGER NOT NULL REFERENCES pf_users(id) ON DELETE CASCADE,
      entity_id INTEGER NOT NULL REFERENCES pf_entities(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS pf_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES pf_organizations(id) ON DELETE CASCADE,
      entity_id INTEGER NOT NULL REFERENCES pf_entities(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL,       -- scheduled | manual
      status TEXT NOT NULL,        -- success | error
      rows INTEGER,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pf_runs_org ON pf_sync_runs (org_id, started_at);
    CREATE TABLE IF NOT EXISTS pf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pf_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      at TEXT NOT NULL
    );
  `);
}

export function ensureUniqueRealmLinks(db) {
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_pf_entities_external_id ON pf_entities (external_id) WHERE external_id IS NOT NULL');
  } catch (err) {
    console.warn(`  ! Could not enforce one entity per QuickBooks company: ${err.message}`);
  }
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'org';
}

export function uniqueSlug(db, name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM pf_organizations WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

const daysAgoIso = (d, hour = 9) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

// Deterministic pseudo-random in [0,1) so sample figures and runs are stable between restarts.
export const prand = (a, b = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Load the seed into an empty platform database. Returns true when it seeded. */
export function seedPlatform(db, cfg, seed) {
  // Seed once per database. An existing database (organizations present) counts as seeded, so deleting the
  // sample organizations later never brings them back on restart.
  const seeded = db.prepare("SELECT value FROM pf_meta WHERE key = 'seeded'").get();
  const hasOrgs = db.prepare('SELECT COUNT(*) AS n FROM pf_organizations').get().n > 0;
  if (seeded || hasOrgs) {
    if (!seeded) db.prepare("INSERT INTO pf_meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
    return false;
  }
  const d = cfg.orgDefaults;
  const pwHash = cfg.auth.demoMode ? hashPassword(cfg.auth.demoPassword) : null;

  const insUser = db.prepare(`INSERT INTO pf_users (email, name, password_hash, is_platform_admin, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const findUser = db.prepare('SELECT id FROM pf_users WHERE email = ?');
  const insOrg = db.prepare(`
    INSERT INTO pf_organizations (name, slug, industry, plan, status, currency, timezone, fiscal_year_start, sync_schedule, brand_color, live_dashboard, created_at)
    VALUES (@name, @slug, @industry, @plan, @status, @currency, @timezone, @fiscal_year_start, @sync_schedule, @brand_color, @live_dashboard, @created_at)`);
  const insGroup = db.prepare('INSERT INTO pf_entity_groups (org_id, name) VALUES (?, ?)');
  const insEntity = db.prepare(`
    INSERT INTO pf_entities (org_id, group_id, name, connector, external_id, status, data_source, annual_revenue, margin, last_sync_at, created_at)
    VALUES (@org_id, @group_id, @name, @connector, @external_id, @status, @data_source, @annual_revenue, @margin, @last_sync_at, @created_at)`);
  const insMember = db.prepare('INSERT INTO pf_memberships (user_id, org_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)');
  const insAccess = db.prepare('INSERT OR IGNORE INTO pf_user_entities (user_id, entity_id) VALUES (?, ?)');
  const insRun = db.prepare(`INSERT INTO pf_sync_runs (org_id, entity_id, trigger, status, rows, message, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insAudit = db.prepare('INSERT INTO pf_audit (org_id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)');

  const userId = (u, isPlatformAdmin, status, createdAt) => {
    const found = findUser.get(u.email.toLowerCase());
    if (found) return found.id;
    return insUser.run(u.email.toLowerCase(), u.name, pwHash, isPlatformAdmin ? 1 : 0, status, createdAt).lastInsertRowid;
  };

  db.transaction(() => {
    for (const a of seed.platformAdmins || []) userId(a, true, 'active', daysAgoIso(365));

    for (const o of seed.organizations || []) {
      const age = o.daysAgo ?? 30;
      const createdAt = daysAgoIso(age);
      const orgId = insOrg.run({
        name: o.name, slug: uniqueSlug(db, o.name), industry: o.industry || d.industry, plan: o.plan || d.plan, status: o.status || d.status,
        currency: o.currency || d.currency, timezone: o.timezone || d.timezone, fiscal_year_start: o.fiscalYearStart || d.fiscalYearStart,
        sync_schedule: o.syncSchedule || d.syncSchedule, brand_color: o.brandColor || d.brandColor, live_dashboard: o.liveDashboard ? 1 : 0, created_at: createdAt,
      }).lastInsertRowid;
      insAudit.run(orgId, null, 'org.created', `Organization ${o.name} created`, createdAt);

      const groupIds = {};
      for (const g of o.groups || []) groupIds[g] = insGroup.run(orgId, g).lastInsertRowid;

      const entityIds = {};
      (o.entities || []).forEach((e, i) => {
        const status = e.status || 'pending';
        const live = Boolean(e.externalId);
        const id = insEntity.run({
          org_id: orgId, group_id: e.group ? groupIds[e.group] : null, name: e.name, connector: e.connector || 'quickbooks',
          external_id: e.externalId || null, status, data_source: live ? 'live' : 'sample', annual_revenue: e.annualRevenue || 0,
          margin: e.margin ?? 0.1, last_sync_at: null, created_at: daysAgoIso(Math.max(0, age - 1 - i)),
        }).lastInsertRowid;
        entityIds[e.name] = id;
        insAudit.run(orgId, null, 'entity.added', `Entity ${e.name} added`, daysAgoIso(Math.max(0, age - 1 - i), 10));

        // Simulated nightly history for sample entities. Live entities record real runs when synced.
        if (!live && status !== 'pending') {
          let last = null;
          const days = Math.min(cfg.sync.historyDays, age);
          for (let day = days; day >= 1; day--) {
            const failing = (status === 'error' && day <= 3) || (status === 'needs_reconnect' && day <= 2);
            const started = daysAgoIso(day, 2);
            const finished = new Date(Date.parse(started) + (20 + Math.round(prand(id, day) * 70)) * 1000).toISOString();
            const rows = failing ? null : Math.round(cfg.sync.sampleRows.min + prand(id, day + 50) * (cfg.sync.sampleRows.max - cfg.sync.sampleRows.min));
            insRun.run(orgId, id, 'scheduled', failing ? 'error' : 'success', rows, failing ? cfg.sync.messages[status] : null, started, finished);
            if (!failing) last = finished;
          }
          if (last) db.prepare('UPDATE pf_entities SET last_sync_at = ? WHERE id = ?').run(last, id);
        }
      });

      for (const u of o.users || []) {
        const status = u.status === 'invited' ? 'invited' : 'active';
        const uid = userId(u, false, status, createdAt);
        insMember.run(uid, orgId, u.role, status, createdAt);
        const ids = u.entities === 'all' ? Object.values(entityIds) : (u.entities || []).map((n) => entityIds[n]);
        for (const eid of ids) insAccess.run(uid, eid);
        insAudit.run(orgId, null, status === 'invited' ? 'user.invited' : 'user.added', `${u.name} (${u.email}) as ${cfg.roles[u.role]?.label || u.role}`, createdAt);
      }
    }
    db.prepare("INSERT OR REPLACE INTO pf_meta (key, value) VALUES ('seeded', ?)").run(new Date().toISOString());
  })();
  return true;
}
