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
  compare: { maxOffices: null, minOffices: 2, defaultMetric: 'netIncome', metrics: ['income', 'expenses', 'netIncome'] },
  analysis: {
    enabled: true, defaultMetric: 'netCollections', defaultBy: 'office', percentOf: 'netCollections',
    metrics: ['netCollections', 'officeEbitda', 'pct:officeEbitda'],
    dimensions: ['office', 'row', 'account'],
    dimensionLabels: { office: 'Office', row: 'Statement row', account: 'QuickBooks account' },
    topN: 8,
    chart: { default: 'lines', options: ['lines', 'bars', 'stacked', 'small', 'ranked'] },
  },
  officeCategories: { file: 'config/dashboard-categories.json' },
  executive: { enabled: true, file: 'config/executive.json' },
  categoryView: { enabled: true, file: 'config/category-view.json' },
  groupOverview: { enabled: true, file: 'config/group-overview.json' },
  finance: { enabled: true, file: 'config/finance.json' },
  practiceKpis: { enabled: true, file: 'config/practice-kpis.json' },
  offices: { enabled: true, file: 'config/offices.json' },
  officesSheet: { enabled: true, file: 'config/offices-sheet.json', apiPath: 'office-sheet', label: 'Financial KPIs' },
  rawSync: { file: 'config/raw-sync.json' },
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
  sync: {
    startDate: '2025-01-01', endDate: '2026-12-31', accountingMethod: 'Accrual', sequential: true, includeChartOfAccounts: true,
    schedule: { enabled: true, time: '03:00', timezone: 'America/Chicago', catchUpOnStart: true, maxAgeHours: 26 },
  },
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
  if (c.maxOffices !== null && (!Number.isInteger(c.maxOffices) || c.maxOffices < 1)) throw new Error('app.config.json: compare.maxOffices must be a positive integer or null (no limit)');
  if (!Number.isInteger(c.minOffices) || c.minOffices < 1 || (c.maxOffices !== null && c.minOffices > c.maxOffices)) throw new Error('app.config.json: compare.minOffices must be between 1 and compare.maxOffices');
  if (cfg.officeChart.maxOffices !== null && (!Number.isInteger(cfg.officeChart.maxOffices) || cfg.officeChart.maxOffices < 1)) throw new Error('app.config.json: officeChart.maxOffices must be a positive integer or null (every office)');
  const a = cfg.analysis;
  const DIMS = ['office', 'row', 'account'];
  for (const d of a.dimensions) if (!DIMS.includes(d) && !/^category:[a-z0-9_-]+$/i.test(d)) throw new Error(`app.config.json: analysis.dimensions has unknown "${d}" (use ${DIMS.join(' | ')} | category:<id>)`);
  if (!a.dimensions.includes(a.defaultBy)) throw new Error('app.config.json: analysis.defaultBy must be one of analysis.dimensions');
  // Metric keys are checked against the office statement rows when the Offices router starts (server/offices/api.js).
  if (!Array.isArray(a.metrics) || !a.metrics.length) throw new Error('app.config.json: analysis.metrics must list at least one office statement row key');
  for (const m of a.metrics) if (!/^(pct:)?[a-z][A-Za-z0-9]*$/.test(m)) throw new Error(`app.config.json: analysis.metrics has invalid "${m}" (use a row key from config/offices.json rows.list, or pct:<row key>)`);
  if (!a.metrics.includes(a.defaultMetric)) throw new Error('app.config.json: analysis.defaultMetric must be one of analysis.metrics');
  if (typeof a.percentOf !== 'string' || !a.percentOf) throw new Error('app.config.json: analysis.percentOf must be the collections row key of config/offices.json');
  const os = cfg.officesSheet;
  if (!/^[a-z][a-z0-9-]*$/.test(String(os.apiPath)) || os.apiPath === 'office-view' || os.apiPath === 'analysis') throw new Error('app.config.json: officesSheet.apiPath must be a lower-case URL segment other than office-view');
  if (typeof os.label !== 'string' || !os.label.trim()) throw new Error('app.config.json: officesSheet.label is required');
  if (!Number.isInteger(a.topN) || a.topN < 1 || a.topN > 8) throw new Error('app.config.json: analysis.topN must be 1..8');
  if (!a.chart.options.length || a.chart.options.some((t) => !['lines', 'bars', 'stacked', 'small', 'ranked'].includes(t)) || !a.chart.options.includes(a.chart.default)) throw new Error('app.config.json: analysis.chart options must come from lines | bars | stacked | small | ranked and include the default');
  for (const m of [...c.metrics, c.defaultMetric, cfg.officeChart.metric, ...(cfg.dashboard.secondaryKpis || [])]) {
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
  redirectUri: env.QBO_REDIRECT_URI || (env.PUBLIC_URL ? `${env.PUBLIC_URL.replace(/\/$/, '')}/callback` : 'http://localhost:3000/callback'),
  environment,
  port: Number(env.PORT || 3000),
  webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',
  // Hosting: serve web/dist from this process (one origin), public URL for logs, optional basic auth.
  serveWeb: ['1', 'true', 'yes'].includes(String(env.SERVE_WEB || (env.NODE_ENV === 'production' ? '1' : '')).toLowerCase()),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  appUser: env.APP_USER || '',
  appPassword: env.APP_PASSWORD || '',
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
