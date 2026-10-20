import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, upsertPlLines } from '../server/db.js';
import { executiveData, loadExecutiveConfig } from '../server/executive.js';
import { initPlatformSchema, seedPlatform } from '../server/platform/store.js';
import { loadPlatformConfig, loadSeed } from '../server/platform/config.js';

const line = (account_id, account_name, grp, month, amount) => ({
  account_id, account_name, grp, period_start: `${month}-01`, period_end: `${month}-28`, amount,
});
const filters = (from, to) => ({ from, to, where: 'WHERE substr(period_start, 1, 7) BETWEEN @from AND @to', params: { from, to } });

test('executive YoY compares only months that exist in both years', () => {
  const db = openDb(':memory:');
  // Last year: Jan-Mar revenue 100 each. This year: Jan-Feb 120 each, March not synced yet.
  upsertPlLines(db, 'A', 'Office A', [
    line('1', 'Sales', 'Income', '2025-01', 100), line('1', 'Sales', 'Income', '2025-02', 100), line('1', 'Sales', 'Income', '2025-03', 100),
    line('1', 'Sales', 'Income', '2026-01', 120), line('1', 'Sales', 'Income', '2026-02', 120),
  ], { startDate: '2025-01-01', endDate: '2026-12-31' });
  const d = executiveData(db, loadExecutiveConfig(), filters('2026-01', '2026-03'));
  assert.equal(d.totals.revenue, 240);
  assert.equal(d.priorTotals.revenue, 200, 'March 2025 must not count: March 2026 has no data');
  assert.equal(d.comparableTotals.revenue, 240);
  assert.equal(d.prior.overlapMonths, 2);
  assert.equal(d.offices[0].prior.revenue, 200);
  const mover = d.movers.find((m) => m.account === 'Sales');
  assert.equal(mover.impact, 40);
  db.close();
});

test('executive YoY ignores current months that last year lacks', () => {
  const db = openDb(':memory:');
  upsertPlLines(db, 'A', 'Office A', [
    line('1', 'Sales', 'Income', '2025-02', 100),
    line('1', 'Sales', 'Income', '2026-01', 500), line('1', 'Sales', 'Income', '2026-02', 110),
  ], { startDate: '2025-01-01', endDate: '2026-12-31' });
  const d = executiveData(db, loadExecutiveConfig(), filters('2026-01', '2026-02'));
  assert.equal(d.totals.revenue, 610);
  assert.equal(d.comparableTotals.revenue, 110, 'January has no prior-year data, so it is left out of the comparison');
  assert.equal(d.priorTotals.revenue, 100);
  db.close();
});

test('platform seed runs once: deleting the sample organizations does not bring them back', () => {
  const db = openDb(':memory:');
  initPlatformSchema(db);
  const cfg = loadPlatformConfig();
  assert.equal(seedPlatform(db, cfg, loadSeed(cfg)), true);
  db.prepare('DELETE FROM pf_organizations').run();
  assert.equal(seedPlatform(db, cfg, loadSeed(cfg)), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pf_organizations').get().n, 0);
  db.close();
});

test('an existing database counts as seeded', () => {
  const db = openDb(':memory:');
  initPlatformSchema(db);
  const cfg = loadPlatformConfig();
  db.prepare(`INSERT INTO pf_organizations (name, slug, plan, status, currency, timezone, fiscal_year_start, sync_schedule, brand_color, created_at)
              VALUES ('Real client', 'real', 'pro', 'active', 'USD', 'America/New_York', 1, 'nightly', '#2a78d6', '2026-01-01')`).run();
  assert.equal(seedPlatform(db, cfg, loadSeed(cfg)), false);
  db.prepare('DELETE FROM pf_organizations').run();
  assert.equal(seedPlatform(db, cfg, loadSeed(cfg)), false);
  db.close();
});

test('seed rejects duplicate users and entity names', () => {
  const cfg = loadPlatformConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfseed2-'));
  const write = (org) => fs.writeFileSync(path.join(dir, cfg.sampleData.file), JSON.stringify({ organizations: [org] }));
  write({ name: 'X', groups: [], entities: [{ name: 'A', status: 'connected' }, { name: 'A', status: 'connected' }], users: [] });
  assert.throws(() => loadSeed(cfg, dir), /two entities with the same name/);
  write({ name: 'X', groups: [], entities: [{ name: 'A', status: 'connected' }], users: [{ name: 'U', email: 'u@x.demo', role: 'member', entities: 'all' }, { name: 'U2', email: 'U@x.demo', role: 'member', entities: 'all' }] });
  assert.throws(() => loadSeed(cfg, dir), /same user twice/);
});

test('breakdown works with an office filter (regression: WHERE prefixing)', async () => {
  const express = (await import('express')).default;
  const { createApiRouter } = await import('../server/api.js');
  const db = openDb(':memory:');
  initPlatformSchema(db);
  upsertPlLines(db, 'A', 'Office A', [line('1', 'Sales', 'Income', '2026-01', 100), line('2', 'Rent', 'Expenses', '2026-01', 40)], { startDate: '2026-01-01', endDate: '2026-12-31' });
  upsertPlLines(db, 'B', 'Office A', [line('1', 'Sales', 'Income', '2026-01', 50)], { startDate: '2026-01-01', endDate: '2026-12-31' });
  const app = express();
  app.use((req, res, next) => { req.dashboardScope = req.query.scoped ? { realms: ['A'] } : null; next(); });
  app.use('/api', createApiRouter(db));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    for (const by of ['office', 'grp', 'accountType', 'accountSubType', 'account']) {
      const r = await fetch(`${base}/breakdown?from=2026-01&to=2026-01&by=${by}&office=A,B&metric=netIncome`);
      assert.equal(r.status, 200, `by=${by}`);
    }
    // Two companies with the same name stay separate rows, keyed by company id.
    const byOffice = await (await fetch(`${base}/breakdown?from=2026-01&to=2026-01&by=office&metric=revenue`)).json();
    assert.deepEqual(byOffice.rows.map((x) => x.key).sort(), ['A', 'B']);
    // A scoped caller only ever sees its own companies, even when asking for others.
    const scoped = await (await fetch(`${base}/pl?from=2026-01&to=2026-01&office=B&scoped=1`)).json();
    assert.equal(scoped.totals.revenue, 0);
    const scopedAll = await (await fetch(`${base}/pl?from=2026-01&to=2026-01&scoped=1`)).json();
    assert.equal(scopedAll.totals.revenue, 100);
  } finally {
    server.close();
    db.close();
  }
});
