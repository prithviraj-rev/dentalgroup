import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlatformConfig, loadSeed, validatePlatformConfig } from '../server/platform/config.js';

const cfg = loadPlatformConfig();

test('repo platform config and seed load', () => {
  assert.ok(cfg.platform.name);
  assert.ok(cfg.roles.platform_admin.permissions.includes('*'));
  const seed = loadSeed(cfg);
  assert.ok(seed.organizations.length > 0);
});

test('config validation names the bad key', () => {
  const bad = (patch) => () => validatePlatformConfig({ ...structuredClone(cfg), ...patch(structuredClone(cfg)) });
  assert.throws(bad((c) => ({ roles: { ...c.roles, member: { ...c.roles.member, permissions: ['nope'] } } })), /unknown permission "nope"/);
  assert.throws(bad(() => ({ adminRole: 'platform_admin' })), /adminRole/);
  assert.throws(bad((c) => ({ orgDefaults: { ...c.orgDefaults, plan: 'gold' } })), /orgDefaults.plan/);
  assert.throws(bad((c) => ({ entityStatuses: { ...c.entityStatuses, connected: { ...c.entityStatuses.connected, tone: 'blue' } } })), /tone/);
  assert.throws(bad((c) => ({ connectors: c.connectors.map((x) => ({ ...x, enabled: false })) })), /connector/);
});

test('seed references are checked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfseed-'));
  fs.writeFileSync(path.join(dir, cfg.sampleData.file), JSON.stringify({ organizations: [{ name: 'X', groups: [], entities: [{ name: 'A', status: 'connected' }], users: [{ name: 'U', email: 'u@x.demo', role: 'member', entities: ['B'] }] }] }));
  assert.throws(() => loadSeed(cfg, dir), /unknown entity "B"/);
});
