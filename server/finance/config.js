// Loads and validates config/finance.json, config/group-overview.json and config/practice-kpis.json.
// Errors name the file and key, so a bad edit fails at startup.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from '../config.js';

const readJson = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }
};
const regex = (src, where, name) => {
  if (!src) return null;
  try { return new RegExp(src, 'i'); } catch (e) { throw new Error(`${name}: ${where} is not a valid pattern: ${e.message}`); }
};
const posInt = (v, where, name, max = 1000) => {
  if (!Number.isInteger(v) || v < 1 || v > max) throw new Error(`${name}: ${where} must be a whole number 1..${max}`);
  return v;
};
const fileOf = (key, def) => path.resolve(ROOT, appConfig[key]?.file || def);

export function loadFinanceConfig(file = fileOf('finance', 'config/finance.json')) {
  const name = path.basename(file);
  const raw = readJson(file);
  const SUBS = ['BankAccounts', 'AR', 'OtherCurrentAssets', 'FixedAssets', 'OtherAssets', 'AP', 'CreditCards', 'OtherCurrentLiabilities', 'LongTermLiabilities', 'Equity'];
  const debtSubsections = raw.cash?.debtSubsections ?? ['CreditCards', 'LongTermLiabilities'];
  for (const s of debtSubsections) if (!SUBS.includes(s)) throw new Error(`${name}: cash.debtSubsections "${s}" is not one of ${SUBS.join(' | ')}`);
  const BUCKETS = ['current', '1-30', '31-60', '61-90', '91+'];
  const overdueFrom = raw.aging?.overdueFrom ?? '31-60';
  if (!BUCKETS.includes(overdueFrom)) throw new Error(`${name}: aging.overdueFrom must be one of ${BUCKETS.join(' | ')}`);
  return {
    cash: { debtSubsections, debtAccounts: regex(raw.cash?.debtAccounts, 'cash.debtAccounts', name), runwayMonths: posInt(raw.cash?.runwayMonths ?? 3, 'cash.runwayMonths', name, 24) },
    aging: { topParties: posInt(raw.aging?.topParties ?? 15, 'aging.topParties', name, 200), overdueFrom },
    vendors: { top: posInt(raw.vendors?.top ?? 20, 'vendors.top', name, 200), exclude: regex(raw.vendors?.exclude, 'vendors.exclude', name) },
    budget: { preferName: regex(raw.budget?.preferName, 'budget.preferName', name) },
  };
}

const compileSide = (side, where, name) => {
  if (!side?.accounts) throw new Error(`${name}: ${where}.accounts is required`);
  if (side.segments != null && !Array.isArray(side.segments)) throw new Error(`${name}: ${where}.segments must be a list`);
  return { segments: side.segments || [], re: regex(side.accounts, `${where}.accounts`, name) };
};

export function loadGroupConfig(file = fileOf('groupOverview', 'config/group-overview.json')) {
  const name = path.basename(file);
  const raw = readJson(file);
  const rules = (raw.intercompany?.rules || []).map((r, i) => {
    if (!r.label) throw new Error(`${name}: intercompany.rules[${i}] needs a label`);
    return { label: r.label, income: compileSide(r.income, `intercompany.rules[${i}].income`, name), expense: compileSide(r.expense, `intercompany.rules[${i}].expense`, name) };
  });
  const f = raw.forecast || {};
  if (!['seasonal', 'runRate'].includes(f.method ?? 'seasonal')) throw new Error(`${name}: forecast.method must be seasonal | runRate`);
  const a = raw.alerts || {};
  const nonNeg = (v, def, k) => { const x = v ?? def; if (typeof x !== 'number' || x < 0) throw new Error(`${name}: alerts.${k} must be a number >= 0`); return x; };
  const SC = ['revenue', 'revenueGrowth', 'netMargin', 'ebitda', 'ebitdaMargin', 'targetsMet'];
  const columns = raw.scorecard?.columns || SC;
  for (const c of columns) if (!SC.includes(c)) throw new Error(`${name}: scorecard.columns "${c}" is not one of ${SC.join(' | ')}`);
  const defaultSort = raw.scorecard?.defaultSort || columns[0];
  if (!columns.includes(defaultSort)) throw new Error(`${name}: scorecard.defaultSort must be one of scorecard.columns`);
  return {
    segmentDimension: raw.segments?.dimension || null,
    rules,
    ebitdaAddBack: regex(raw.ebitda?.addBack, 'ebitda.addBack', name),
    forecast: { method: f.method ?? 'seasonal', runRateMonths: posInt(f.runRateMonths ?? 3, 'forecast.runRateMonths', name, 12), fiscalYearStartMonth: posInt(f.fiscalYearStartMonth ?? 1, 'forecast.fiscalYearStartMonth', name, 12) },
    alerts: {
      spikePts: nonNeg(a.spikePts, 3, 'spikePts') / 100, trailingMonths: posInt(a.trailingMonths ?? 3, 'alerts.trailingMonths', name, 12),
      minShare: nonNeg(a.minSharePct, 2, 'minSharePct') / 100, revenueDrop: nonNeg(a.revenueDropPct, 15, 'revenueDropPct') / 100,
      lossStreakMonths: posInt(a.lossStreakMonths ?? 3, 'alerts.lossStreakMonths', name, 24), overTarget: a.overTarget !== false, max: posInt(a.max ?? 40, 'alerts.max', name, 500),
    },
    scorecard: { columns, defaultSort },
  };
}

export function loadPracticeConfig(file = fileOf('practiceKpis', 'config/practice-kpis.json')) {
  const name = path.basename(file);
  const raw = readJson(file);
  const FORMATS = ['money', 'count', 'percent'];
  const keys = new Set();
  const metrics = (raw.metrics || []).map((m, i) => {
    if (!m.key || !/^[a-z][a-zA-Z0-9]*$/.test(m.key)) throw new Error(`${name}: metrics[${i}].key must be camelCase letters/digits`);
    if (keys.has(m.key)) throw new Error(`${name}: duplicate metric key "${m.key}"`);
    keys.add(m.key);
    if (!FORMATS.includes(m.format || 'money')) throw new Error(`${name}: metrics[${i}].format must be ${FORMATS.join(' | ')}`);
    if (!['sum', 'last'].includes(m.aggregate || 'sum')) throw new Error(`${name}: metrics[${i}].aggregate must be sum | last`);
    return { key: m.key, label: m.label || m.key, format: m.format || 'money', aggregate: m.aggregate || 'sum', aliases: (m.aliases || []).map((s) => String(s).toLowerCase()) };
  });
  const PL = ['pl:revenue', 'pl:income', 'pl:expenses', 'pl:netIncome', 'pl:ebitda'];
  const derived = (raw.derived || []).map((d, i) => {
    const where = `derived[${i}]`;
    if (!d.key || keys.has(d.key)) throw new Error(`${name}: ${where}.key missing or duplicate`);
    if (!FORMATS.includes(d.format || 'money')) throw new Error(`${name}: ${where}.format must be ${FORMATS.join(' | ')}`);
    const refs = d.ratio || Object.keys(d.formula || {});
    if (!d.ratio && !d.formula) throw new Error(`${name}: ${where} needs ratio [numerator, denominator] or formula`);
    if (d.ratio && (!Array.isArray(d.ratio) || d.ratio.length !== 2)) throw new Error(`${name}: ${where}.ratio must be [numerator, denominator]`);
    for (const r of refs) if (!keys.has(r) && !PL.includes(r)) throw new Error(`${name}: ${where} refers to unknown "${r}" (use a metric key, an earlier derived key, or ${PL.join(' | ')})`);
    keys.add(d.key);
    const target = d.target ? Object.fromEntries(Object.entries(d.target).map(([k, v]) => [k, d.format === 'percent' ? v / 100 : v])) : null;
    return { key: d.key, label: d.label || d.key, format: d.format || 'money', ratio: d.ratio || null, formula: d.formula || null, target };
  });
  for (const k of [...(raw.tiles || []), ...(raw.table || [])]) if (!keys.has(k)) throw new Error(`${name}: tiles/table refer to unknown "${k}"`);
  const aliases = Object.fromEntries(Object.entries(raw.officeAliases || {}).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    officeColumn: (raw.officeColumn || ['office']).map((s) => s.toLowerCase()),
    monthColumn: (raw.monthColumn || ['month']).map((s) => s.toLowerCase()),
    officeAliases: aliases, metrics, derived, tiles: raw.tiles || [], table: raw.table || [],
  };
}
