// Loads and validates config/platform.config.json and the seed file.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

export const PLATFORM_CONFIG_DIR = path.resolve(ROOT, process.env.PLATFORM_CONFIG_DIR || 'config');

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing platform config file: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

/** Drop every "$comment" key, at any depth. */
const stripComments = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '$comment' ? undefined : v)));

function fail(msg) {
  throw new Error(`platform.config.json: ${msg}`);
}

export function validatePlatformConfig(cfg) {
  for (const key of ['platform', 'auth', 'permissions', 'roles', 'navigation', 'entityStatuses', 'orgStatuses', 'connectors', 'plans', 'options', 'orgDefaults', 'overview', 'sync', 'reports', 'sampleData']) {
    if (!cfg[key]) fail(`missing "${key}"`);
  }
  if (!cfg.platform.name) fail('platform.name is required');
  if (!cfg.roles.platform_admin) fail('roles.platform_admin is required');
  const perms = new Set(Object.keys(cfg.permissions));
  for (const [id, role] of Object.entries(cfg.roles)) {
    if (!Array.isArray(role.permissions)) fail(`roles.${id}.permissions must be a list`);
    for (const p of role.permissions) if (p !== '*' && !perms.has(p)) fail(`roles.${id} grants unknown permission "${p}"`);
  }
  if (!cfg.roles[cfg.adminRole] || cfg.adminRole === 'platform_admin') fail('adminRole must be an organization role');
  if (!cfg.roles[cfg.adminRole].permissions.includes('users.manage')) fail('adminRole must have users.manage');
  if (!cfg.roles[cfg.defaultInviteRole] || cfg.defaultInviteRole === 'platform_admin') fail('defaultInviteRole must be an organization role');
  for (const item of cfg.navigation.org || []) {
    if (!item.id || !item.label) fail('every navigation.org item needs id and label');
    if (item.permission && !perms.has(item.permission)) fail(`navigation.org "${item.id}" uses unknown permission "${item.permission}"`);
  }
  for (const [id, s] of Object.entries(cfg.entityStatuses)) {
    if (!['good', 'warning', 'critical', 'neutral'].includes(s.tone)) fail(`entityStatuses.${id}.tone must be good | warning | critical | neutral`);
  }
  if (!cfg.entityStatuses.connected || !cfg.entityStatuses.pending) fail('entityStatuses must include connected and pending');
  const planIds = cfg.plans.map((p) => p.id);
  if (new Set(planIds).size !== planIds.length) fail('plan ids must be unique');
  const d = cfg.orgDefaults;
  if (!planIds.includes(d.plan)) fail(`orgDefaults.plan "${d.plan}" is not in plans`);
  if (!cfg.orgStatuses[d.status]) fail(`orgDefaults.status "${d.status}" is not in orgStatuses`);
  if (!cfg.options.currencies.includes(d.currency)) fail('orgDefaults.currency is not in options.currencies');
  if (!cfg.options.timezones.includes(d.timezone)) fail('orgDefaults.timezone is not in options.timezones');
  if (!cfg.options.syncSchedules.some((s) => s.id === d.syncSchedule)) fail('orgDefaults.syncSchedule is not in options.syncSchedules');
  if (!(d.fiscalYearStart >= 1 && d.fiscalYearStart <= 12)) fail('orgDefaults.fiscalYearStart must be 1..12');
  if (!cfg.connectors.some((c) => c.enabled)) fail('at least one connector must be enabled');
  if (!(cfg.overview.months >= 1 && cfg.overview.months <= 36)) fail('overview.months must be 1..36');
  const r = cfg.sync.sampleRows;
  if (!(r && r.min >= 0 && r.max >= r.min)) fail('sync.sampleRows needs min <= max');
  if (!(cfg.auth.sessionDays > 0)) fail('auth.sessionDays must be > 0');
  if (cfg.auth.demoMode && String(cfg.auth.demoPassword || '').length < cfg.auth.minPasswordLength) fail('auth.demoPassword is shorter than auth.minPasswordLength');
  return cfg;
}

export function loadPlatformConfig(dir = PLATFORM_CONFIG_DIR) {
  const cfg = stripComments(readJson(path.join(dir, 'platform.config.json')));
  if (process.env.PLATFORM_NAME) cfg.platform.name = process.env.PLATFORM_NAME;
  return validatePlatformConfig(cfg);
}

export function loadSeed(cfg, dir = PLATFORM_CONFIG_DIR) {
  const seed = stripComments(readJson(path.join(dir, cfg.sampleData.file)));
  const roles = new Set(Object.keys(cfg.roles).filter((r) => r !== 'platform_admin'));
  for (const org of seed.organizations || []) {
    const names = new Set((org.entities || []).map((e) => e.name));
    if (names.size !== (org.entities || []).length) throw new Error(`seed: ${org.name} has two entities with the same name`);
    const emails = (org.users || []).map((u) => String(u.email).toLowerCase());
    if (new Set(emails).size !== emails.length) throw new Error(`seed: ${org.name} lists the same user twice`);
    for (const e of org.entities || []) {
      if (!cfg.entityStatuses[e.status || 'pending']) throw new Error(`seed: entity "${e.name}" has unknown status "${e.status}"`);
      if (e.group && !(org.groups || []).includes(e.group)) throw new Error(`seed: entity "${e.name}" uses group "${e.group}" not listed in ${org.name}.groups`);
    }
    for (const u of org.users || []) {
      if (!roles.has(u.role)) throw new Error(`seed: user ${u.email} has unknown role "${u.role}"`);
      if (Array.isArray(u.entities)) for (const n of u.entities) if (!names.has(n)) throw new Error(`seed: user ${u.email} references unknown entity "${n}"`);
    }
  }
  return seed;
}

/** The subset of the config the browser needs. Nothing here is secret. */
export function publicConfig(cfg) {
  return {
    platform: cfg.platform,
    auth: { showDemoAccounts: cfg.auth.demoMode && cfg.auth.showDemoAccounts, minPasswordLength: cfg.auth.minPasswordLength, demoMode: cfg.auth.demoMode },
    roles: Object.fromEntries(Object.entries(cfg.roles).map(([id, r]) => [id, { label: r.label, description: r.description, permissions: r.permissions, order: r.order ?? 99 }])),
    adminRole: cfg.adminRole,
    defaultInviteRole: cfg.defaultInviteRole,
    navigation: cfg.navigation,
    entityStatuses: cfg.entityStatuses,
    orgStatuses: cfg.orgStatuses,
    connectors: cfg.connectors,
    plans: cfg.plans,
    industries: cfg.industries,
    options: cfg.options,
    orgDefaults: cfg.orgDefaults,
    overview: cfg.overview,
    reports: cfg.reports,
    sampleData: { badge: cfg.sampleData.badge },
  };
}
