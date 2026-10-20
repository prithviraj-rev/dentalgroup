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
  assert.equal(cfg.compare.maxOffices, null);
  assert.deepEqual(cfg.groups.order, ['Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses']);
  assert.equal(typeof cfg.qbo.refreshSkewMinutes, 'number');
});

test('missing file falls back to defaults; partial file deep-merges', () => {
  assert.equal(loadAppConfig(path.join(os.tmpdir(), 'does-not-exist.json')).compare.maxOffices, null);
  const cfg = loadAppConfig(tmp({ compare: { maxOffices: 3 }, dashboard: { currency: 'EUR' } }));
  assert.equal(cfg.compare.maxOffices, 3);
  assert.equal(cfg.compare.minOffices, 2);
  assert.equal(cfg.dashboard.currency, 'EUR');
  assert.equal(cfg.dashboard.locale, 'en-US');
});

test('invalid values fail at load time', () => {
  assert.throws(() => loadAppConfig(tmp({ compare: { maxOffices: 0 } })), /compare\.maxOffices/);
  assert.throws(() => loadAppConfig(tmp({ compare: { maxOffices: 4, minOffices: 9 } })), /compare\.minOffices/);
  assert.throws(() => loadAppConfig(tmp({ compare: { defaultMetric: 'ebitda' } })), /unknown metric/);
  assert.throws(() => loadAppConfig(tmp({ officeChart: { maxOffices: 0 } })), /officeChart\.maxOffices/);
  assert.equal(loadAppConfig(tmp({ officeChart: { maxOffices: null } })).officeChart.maxOffices, null);
  assert.throws(() => loadAppConfig(tmp({ sync: { startDate: '2025/01/01' } })), /sync\.startDate/);
  assert.throws(() => loadAppConfig(tmp({ charts: { main: { options: ['pie'] } } })), /charts\.main\.options/);
  assert.throws(() => loadAppConfig(tmp({ charts: { office: { default: 'ranked', options: ['lines'] } } })), /charts\.office\.default/);
  assert.equal(loadAppConfig(tmp({ charts: { office: { default: 'small', options: ['small', 'lines'] } } })).charts.office.default, 'small');
});

test('metrics: formulas, ratios and validation', async () => {
  const { deriveAll, validateMetrics } = await import('../server/metrics.js');
  const cfg = loadAppConfig(appConfigPath);
  const m = deriveAll({ Income: 1000, COGS: 200, Expenses: 500, OtherIncome: 50, OtherExpenses: 30 }, cfg);
  assert.equal(m.revenue, 1000);
  assert.equal(m.grossProfit, 800);
  assert.equal(m.netOperatingIncome, 300);
  assert.equal(m.netIncome, 320);
  assert.equal(m.grossMargin, 0.8);
  assert.equal(deriveAll({}, cfg).grossMargin, null); // zero denominator
  const bad = structuredClone(cfg);
  bad.metrics.x = { label: 'X', formula: { Nope: 1 } };
  assert.throws(() => validateMetrics(bad), /unknown group "Nope"/);
  bad.metrics.x = { label: 'X', ratio: { numerator: 'grossMargin', denominator: 'revenue' } };
  assert.throws(() => validateMetrics(bad), /must not itself be a ratio/);
});

test('analysis and unlimited compare validation', () => {
  assert.throws(() => loadAppConfig(tmp({ analysis: { dimensions: ['office', 'colour'] } })), /analysis.dimensions/);
  assert.throws(() => loadAppConfig(tmp({ analysis: { topN: 20 } })), /analysis.topN/);
  assert.equal(loadAppConfig(tmp({ compare: { maxOffices: 6 } })).compare.maxOffices, 6);
  assert.throws(() => loadAppConfig(tmp({ compare: { maxOffices: 0 } })), /compare.maxOffices/);
});
