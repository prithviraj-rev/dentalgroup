import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAppConfig, appConfigPath } from '../server/config.js';

const tmp = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'appcfg-')), 'app.config.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
};

test('repo app.config.json loads and keeps defaults for keys it omits', () => {
  const cfg = loadAppConfig(appConfigPath);
  assert.equal(cfg.compare.maxOffices, 4);
  assert.deepEqual(cfg.groups.order, ['Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses']);
  assert.equal(typeof cfg.qbo.refreshSkewMinutes, 'number');
});

test('missing file falls back to defaults; partial file deep-merges', () => {
  assert.equal(loadAppConfig(path.join(os.tmpdir(), 'does-not-exist.json')).compare.maxOffices, 4);
  const cfg = loadAppConfig(tmp({ compare: { maxOffices: 3 }, dashboard: { currency: 'EUR' } }));
  assert.equal(cfg.compare.maxOffices, 3);
  assert.equal(cfg.compare.minOffices, 2);
  assert.equal(cfg.dashboard.currency, 'EUR');
  assert.equal(cfg.dashboard.locale, 'en-US');
});

test('invalid values fail at load time', () => {
  assert.throws(() => loadAppConfig(tmp({ compare: { maxOffices: 0 } })), /compare\.maxOffices/);
  assert.throws(() => loadAppConfig(tmp({ compare: { minOffices: 9 } })), /compare\.minOffices/);
  assert.throws(() => loadAppConfig(tmp({ compare: { defaultMetric: 'ebitda' } })), /unknown metric/);
  assert.throws(() => loadAppConfig(tmp({ officeChart: { maxOffices: 12 } })), /officeChart\.maxOffices/);
  assert.throws(() => loadAppConfig(tmp({ sync: { startDate: '2025/01/01' } })), /sync\.startDate/);
  assert.throws(() => loadAppConfig(tmp({ charts: { main: { options: ['pie'] } } })), /charts\.main\.options/);
  assert.throws(() => loadAppConfig(tmp({ charts: { office: { default: 'ranked', options: ['lines'] } } })), /charts\.office\.default/);
  assert.equal(loadAppConfig(tmp({ charts: { office: { default: 'small', options: ['small', 'lines'] } } })).charts.office.default, 'small');
});
