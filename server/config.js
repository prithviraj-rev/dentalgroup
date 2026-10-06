import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env (secrets, ports, paths) lives at the repo root and is gitignored. Node 20.12+ loads it natively.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

// ---------- app.config.json: behaviour shared by server and dashboard ----------

const APP_CONFIG_DEFAULTS = {
  dashboard: {
    title: 'P&L dashboard',
    locale: 'en-US',
    currency: 'USD',
    defaultGranularity: 'month',
    defaultOffice: 'all',
    defaultRange: { from: '2025-01', to: 'current', snapToData: true },
    defaultYoy: false,
    granularities: ['month', 'quarter', 'year'],
    chartHeights: { main: 320, office: 280 },
    syncToastSeconds: { success: 8, error: 12 },
  },
  compare: { maxOffices: 4, minOffices: 2, defaultMetric: 'netIncome', metrics: ['income', 'expenses', 'netIncome'] },
  officeChart: { enabled: true, maxOffices: 8, metric: 'netIncome' },
  charts: {
    main: { default: 'combo', options: ['combo', 'lines', 'bars', 'stacked'] },
    office: { default: 'lines', options: ['lines', 'bars', 'stacked', 'small', 'ranked'] },
    showPicker: true,
  },
  chartOfAccounts: {
    enabled: true, hideNoActivity: true, hideInactive: true, expandDepth: 1, balanceSheetToggle: true, showSubType: true,
    dashboard: {
      enabled: true,
      mix: { default: 'donut', options: ['donut', 'pie', 'bars'], maxSlices: 6 },
      trend: { default: 'lines', options: ['lines', 'stacked', 'small'], topAccounts: 5 },
      subType: { enabled: true, maxRows: 10 },
    },
  },
  metrics: {
    income: { label: 'Income', upIsGood: true, color: 1 },
    expenses: { label: 'Expenses', upIsGood: false, color: 2 },
    netIncome: { label: 'Net income', upIsGood: true, color: 3 },
  },
  groups: {
    order: ['Income', 'COGS', 'Expenses', 'OtherIncome', 'OtherExpenses'],
    labels: { Income: 'Income', COGS: 'Cost of goods sold', Expenses: 'Expenses', OtherIncome: 'Other income', OtherExpenses: 'Other expenses' },
    incomeGroups: ['Income', 'OtherIncome'],
    expenseGroups: ['COGS', 'Expenses', 'OtherExpenses'],
    colors: { Income: 1, COGS: 2, Expenses: 5, OtherIncome: 6, OtherExpenses: 7 }, // palette slots
  },
  sync: { startDate: '2025-01-01', endDate: '2026-12-31', accountingMethod: 'Accrual', sequential: true, includeChartOfAccounts: true },
  qbo: { minorVersion: 75, refreshSkewMinutes: 5, oauthStateTtlMinutes: 10 },
};

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '$comment') continue;
    out[k] = isPlainObject(base?.[k]) && isPlainObject(v) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export const appConfigPath = path.resolve(ROOT, env.APP_CONFIG_PATH || 'app.config.json');

export function loadAppConfig(file = appConfigPath) {
  let fromFile = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Could not parse ${file}: ${err.message}`);
    }
  }
  const cfg = deepMerge(APP_CONFIG_DEFAULTS, fromFile);

  // Sanity checks so a bad edit fails loudly at startup instead of producing odd dashboards.
  const c = cfg.compare;
  if (!Number.isInteger(c.maxOffices) || c.maxOffices < 1) throw new Error('app.config.json: compare.maxOffices must be a positive integer');
  if (!Number.isInteger(c.minOffices) || c.minOffices < 1 || c.minOffices > c.maxOffices) throw new Error('app.config.json: compare.minOffices must be between 1 and compare.maxOffices');
  if (!Number.isInteger(cfg.officeChart.maxOffices) || cfg.officeChart.maxOffices < 1 || cfg.officeChart.maxOffices > 8) throw new Error('app.config.json: officeChart.maxOffices must be 1..8 (the palette has 8 slots)');
  for (const m of [...c.metrics, c.defaultMetric, cfg.officeChart.metric]) {
    if (!cfg.metrics[m]) throw new Error(`app.config.json: unknown metric "${m}"`);
  }
  if (!cfg.dashboard.granularities.includes(cfg.dashboard.defaultGranularity)) throw new Error('app.config.json: dashboard.defaultGranularity is not in dashboard.granularities');
  const CHART_TYPES = {
    'charts.main': [cfg.charts.main, ['combo', 'lines', 'bars', 'stacked']],
    'charts.office': [cfg.charts.office, ['lines', 'bars', 'stacked', 'small', 'ranked']],
    'chartOfAccounts.dashboard.mix': [cfg.chartOfAccounts.dashboard.mix, ['donut', 'pie', 'bars']],
    'chartOfAccounts.dashboard.trend': [cfg.chartOfAccounts.dashboard.trend, ['lines', 'stacked', 'small']],
  };
  for (const [path, [c, allowed]] of Object.entries(CHART_TYPES)) {
    if (!Array.isArray(c.options) || c.options.length === 0 || c.options.some((t) => !allowed.includes(t))) {
      throw new Error(`app.config.json: ${path}.options must be a non-empty list from ${allowed.join(' | ')}`);
    }
    if (!c.options.includes(c.default)) throw new Error(`app.config.json: ${path}.default must be one of ${path}.options`);
  }
  const mix = cfg.chartOfAccounts.dashboard.mix;
  if (!Number.isInteger(mix.maxSlices) || mix.maxSlices < 2 || mix.maxSlices > 8) throw new Error('app.config.json: chartOfAccounts.dashboard.mix.maxSlices must be 2..8');
  const trend = cfg.chartOfAccounts.dashboard.trend;
  if (!Number.isInteger(trend.topAccounts) || trend.topAccounts < 1 || trend.topAccounts > 8) throw new Error('app.config.json: chartOfAccounts.dashboard.trend.topAccounts must be 1..8');
  for (const g of [...cfg.groups.incomeGroups, ...cfg.groups.expenseGroups]) {
    if (!cfg.groups.order.includes(g)) throw new Error(`app.config.json: group "${g}" is not in groups.order`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.sync.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.sync.endDate)) throw new Error('app.config.json: sync.startDate/endDate must be YYYY-MM-DD');
  return cfg;
}

export const appConfig = loadAppConfig();

// ---------- deployment config (.env overrides app.config.json where both exist) ----------

const environment = (env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();

export const config = {
  clientId: env.QBO_CLIENT_ID || '',
  clientSecret: env.QBO_CLIENT_SECRET || '',
  redirectUri: env.QBO_REDIRECT_URI || 'http://localhost:3000/callback',
  environment,
  port: Number(env.PORT || 3000),
  webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',
  dbPath: path.resolve(ROOT, env.DB_PATH || 'data/pnl.db'),
  apiBase:
    environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com',
  authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  scope: 'com.intuit.quickbooks.accounting',
  minorVersion: Number(env.QBO_MINOR_VERSION || appConfig.qbo.minorVersion),
  // P&L report window pulled on every sync.
  syncStartDate: env.SYNC_START_DATE || appConfig.sync.startDate,
  syncEndDate: env.SYNC_END_DATE || appConfig.sync.endDate,
  accountingMethod: env.SYNC_ACCOUNTING_METHOD || appConfig.sync.accountingMethod,
  // Refresh the access token when it is within this many ms of expiry.
  refreshSkewMs: appConfig.qbo.refreshSkewMinutes * 60_000,
  oauthStateTtlMs: appConfig.qbo.oauthStateTtlMinutes * 60_000,
};

export function hasCredentials() {
  const isSet = (v) => Boolean(v) && !/^<.*>$/.test(v.trim()); // treat "<PASTE_ID>" placeholders as unset
  return isSet(config.clientId) && isSet(config.clientSecret);
}
