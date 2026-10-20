// Loads and validates config/offices.json. Errors name the file and key, so a bad edit fails at startup.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from '../config.js';

const ROLES = ['collections', 'cost', 'other', 'feesSubtotal', 'fees', 'ebitda', 'cashFlow'];
export const PERIODS = ['month', 'quarter', 'ytd', 'ttm'];

const regex = (src, where, name) => {
  if (src == null || src === '') return null;
  try { return new RegExp(src, 'i'); } catch (e) { throw new Error(`${name}: ${where} is not a valid pattern: ${e.message}`); }
};
const unmatchedMode = (v, def, where, name) => {
  const x = v ?? def;
  if (!['memo', 'rows'].includes(x)) throw new Error(`${name}: ${where} must be memo | rows`);
  return x;
};
const num = (v, def, where, name, { min = 0, max = 1e9 } = {}) => {
  const x = v ?? def;
  if (typeof x !== 'number' || !(x >= min && x <= max)) throw new Error(`${name}: ${where} must be a number ${min}..${max}`);
  return x;
};

const readJson = (file) => {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function loadOfficesConfig(file = path.resolve(ROOT, appConfig.offices?.file || 'config/offices.json')) {
  const name = path.basename(file);
  let raw = readJson(file);
  // extends: another offices config this one is based on; each top-level key here replaces or (for objects) overlays the base.
  if (raw.extends) {
    const baseFile = path.resolve(ROOT, String(raw.extends));
    if (path.resolve(baseFile) === path.resolve(file)) throw new Error(`${name}: extends must name a different file`);
    const base = readJson(baseFile);
    if (base.extends) throw new Error(`${name}: extends can only point at a file that does not itself extend another`);
    const merged = { ...base };
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'extends' || k === '$comment') continue;
      merged[k] = isObj(v) && isObj(base[k]) ? { ...base[k], ...v } : v;
    }
    raw = merged;
  }

  const naming = { pattern: raw.naming?.pattern || 'Dental Office - {city}', fallback: raw.naming?.fallback || '{company}' };

  const seen = new Set();
  const offices = (raw.offices?.list || []).map((o, i) => {
    const where = `offices.list[${i}]`;
    if (!Array.isArray(o.companies) || o.companies.length === 0) throw new Error(`${name}: ${where}.companies must list at least one QuickBooks realm id`);
    const companies = o.companies.map(String);
    for (const c of companies) {
      if (seen.has(c)) throw new Error(`${name}: company ${c} appears in more than one office`);
      seen.add(c);
    }
    return { companies, city: o.city || null, state: o.state || null, name: o.name || null, aliases: (o.aliases || []).map(String) };
  });

  const ap = raw.autoPair || {};
  const autoPair = {
    enabled: ap.enabled !== false,
    dimension: ap.dimension || null,
    categories: (ap.categories || []).map(String),
    subDso: regex(ap.subDsoPattern, 'autoPair.subDsoPattern', name),
    standaloneSubDso: ap.standaloneSubDso !== false,
  };
  if (autoPair.enabled && autoPair.categories.length && !autoPair.dimension) throw new Error(`${name}: autoPair.dimension is required when autoPair.categories is set`);

  const rows = (raw.rows?.list || []).map((r, i) => {
    const where = `rows.list[${i}]`;
    if (!r.key || !/^[a-z][a-zA-Z0-9]*$/.test(r.key)) throw new Error(`${name}: ${where}.key must be camelCase letters/digits`);
    if (!ROLES.includes(r.role)) throw new Error(`${name}: ${where}.role must be one of ${ROLES.join(' | ')}`);
    if (['cost', 'fees'].includes(r.role) && !r.accounts) throw new Error(`${name}: ${where}.accounts is required for role ${r.role}`);
    return { key: r.key, label: r.label || r.key, role: r.role, re: regex(r.accounts, `${where}.accounts`, name) };
  });
  const keys = rows.map((r) => r.key);
  if (new Set(keys).size !== keys.length) throw new Error(`${name}: rows.list has duplicate keys`);
  for (const role of ['collections', 'other', 'feesSubtotal', 'fees', 'ebitda']) {
    if (rows.filter((r) => r.role === role).length !== 1) throw new Error(`${name}: rows.list needs exactly one row with role ${role}`);
  }

  const pt = raw.payrollTaxes || {};
  const allocateTo = (pt.allocateTo || []).map(String);
  for (const k of allocateTo) if (!rows.some((r) => r.key === k && r.role === 'cost')) throw new Error(`${name}: payrollTaxes.allocateTo "${k}" is not a cost row key`);
  if (pt.accounts && !allocateTo.length) throw new Error(`${name}: payrollTaxes.allocateTo must name at least one cost row`);

  const periodDefault = raw.periods?.default || 'month';
  const asOfMode = raw.periods?.asOf || 'lastFullMonth';
  if (!['lastFullMonth', 'toMonth'].includes(asOfMode)) throw new Error(`${name}: periods.asOf must be lastFullMonth | toMonth`);
  if (!PERIODS.includes(periodDefault)) throw new Error(`${name}: periods.default must be one of ${PERIODS.join(' | ')}`);
  const fy = raw.periods?.fiscalYearStartMonth ?? 1;
  if (!Number.isInteger(fy) || fy < 1 || fy > 12) throw new Error(`${name}: periods.fiscalYearStartMonth must be 1..12`);

  const f = raw.flags || {};
  const rollUp = raw.statement?.rollUpSubAccounts ?? true;
  if (![true, false, 'matched'].includes(rollUp)) throw new Error(`${name}: statement.rollUpSubAccounts must be true | false | "matched"`);
  const statement = { rollUpSubAccounts: rollUp };
  const includeLoanPayments = raw.cashFlow?.includeLoanPayments ?? false;
  if (typeof includeLoanPayments !== 'boolean') throw new Error(`${name}: cashFlow.includeLoanPayments must be true or false`);
  return {
    statement,
    cashFlow: { includeLoanPayments },
    naming, offices, autoPair, rows,
    payrollTaxes: { re: regex(pt.accounts, 'payrollTaxes.accounts', name), allocateTo },
    internal: {
      expense: { re: regex(raw.internal?.expense?.accounts, 'internal.expense.accounts', name), unmatched: unmatchedMode(raw.internal?.expense?.unmatched, 'rows', 'internal.expense.unmatched', name) },
      income: { re: regex(raw.internal?.income?.accounts, 'internal.income.accounts', name), unmatched: unmatchedMode(raw.internal?.income?.unmatched, 'memo', 'internal.income.unmatched', name) },
    },
    notOperating: regex(raw.notOperating?.accounts, 'notOperating.accounts', name),
    profitTransfers: regex(raw.profitTransfers?.accounts, 'profitTransfers.accounts', name),
    uncategorized: regex(raw.uncategorized?.accounts, 'uncategorized.accounts', name),
    periods: { default: periodDefault, fiscalYearStartMonth: fy, asOf: asOfMode },
    flags: {
      collectionsDown: num(f.collectionsDownPct, 10, 'flags.collectionsDownPct', name, { max: 100 }) / 100,
      uncategorized: num(f.uncategorizedPct, 2, 'flags.uncategorizedPct', name, { max: 100 }) / 100,
      lowCashMonths: num(f.lowCashMonths, 1, 'flags.lowCashMonths', name, { max: 36 }),
      arHighMonths: num(f.arHighMonths, 2, 'flags.arHighMonths', name, { max: 36 }),
      staleDays: num(f.staleDays, 3, 'flags.staleDays', name, { max: 365 }),
      internalUnmatched: num(f.internalUnmatchedPct, 5, 'flags.internalUnmatchedPct', name, { max: 100 }) / 100,
    },
    trendMonths: Math.round(num(raw.trendMonths, 24, 'trendMonths', name, { min: 3, max: 60 })),
  };
}
