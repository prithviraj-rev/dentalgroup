// Loads and validates config/offices.json. Errors name the file and key, so a bad edit fails at startup.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from '../config.js';

const ROLES = ['collections', 'cost', 'other', 'feesSubtotal', 'fees', 'ebitda', 'cashFlow', 'item'];
export const PERIODS = ['month', 'quarter', 'ytd', 'lastYear', 'ttm', 'custom'];
// periods.options may also hold "years": one button per calendar year (the last periods.yearButtons years), period key year:<YYYY>.
export const PERIOD_OPTIONS = [...PERIODS, 'years'];
export const isYearPeriod = (p) => /^year:\d{4}$/.test(String(p));
export const PERIOD_LABELS = { month: 'Last month', quarter: 'Last quarter', ytd: 'YTD', lastYear: 'Last year', ttm: 'TTM', custom: 'Custom' };

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

  const naming = { pattern: raw.naming?.pattern || 'Dental Office - {city}', fallback: raw.naming?.fallback || '{company}', companies: null, pairNote: raw.naming?.pairNote ?? null };
  if (naming.pairNote !== null && typeof naming.pairNote !== 'string') throw new Error(`${name}: naming.pairNote must be a string (shown next to offices made of more than one company) or null`);
  // naming.companies: display names by the first company's QuickBooks realm id: { name, short?, note? }.
  if (raw.naming?.companies != null) {
    if (!isObj(raw.naming.companies)) throw new Error(`${name}: naming.companies must be an object { "<realm id>": { name, short?, note? } }`);
    naming.companies = {};
    for (const [id, v] of Object.entries(raw.naming.companies)) {
      if (id.startsWith('$')) continue;
      if (!isObj(v) || typeof v.name !== 'string' || !v.name.trim()) throw new Error(`${name}: naming.companies["${id}"].name must be a non-empty string`);
      for (const k of ['short', 'note']) if (v[k] != null && typeof v[k] !== 'string') throw new Error(`${name}: naming.companies["${id}"].${k} must be a string`);
      if (v.short && !v.name.endsWith(v.short)) throw new Error(`${name}: naming.companies["${id}"].short "${v.short}" must be the end of the name "${v.name}" (the second header line)`);
      naming.companies[id] = { name: v.name.trim(), short: v.short || null, note: v.note || null };
    }
  }

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
    otherCompanies: ap.otherCompanies ?? 'ignore',
  };
  if (!['ignore', 'offices'].includes(autoPair.otherCompanies)) throw new Error(`${name}: autoPair.otherCompanies must be ignore | offices (every company outside autoPair.categories becomes its own office)`);
  if (autoPair.enabled && autoPair.categories.length && !autoPair.dimension) throw new Error(`${name}: autoPair.dimension is required when autoPair.categories is set`);

  const rows = (raw.rows?.list || []).map((r, i) => {
    const where = `rows.list[${i}]`;
    if (!r.key || !/^[a-z][a-zA-Z0-9]*$/.test(r.key)) throw new Error(`${name}: ${where}.key must be camelCase letters/digits`);
    if (!ROLES.includes(r.role)) throw new Error(`${name}: ${where}.role must be one of ${ROLES.join(' | ')}`);
    if (['cost', 'fees', 'item'].includes(r.role) && !r.accounts) throw new Error(`${name}: ${where}.accounts is required for role ${r.role}`);
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
  // periods.options: the period buttons offered, in order (default: all).
  const periodOptions = raw.periods?.options ?? PERIODS;
  const yearButtons = raw.periods?.yearButtons ?? 3;
  if (!Number.isInteger(yearButtons) || yearButtons < 1 || yearButtons > 8) throw new Error(`${name}: periods.yearButtons must be 1..8 (how many calendar-year buttons "years" adds)`);
  if (!Array.isArray(periodOptions) || !periodOptions.length || periodOptions.some((p) => !PERIOD_OPTIONS.includes(p))) throw new Error(`${name}: periods.options must be a non-empty list from ${PERIODS.join(' | ')}`);
  if (!periodOptions.includes(periodDefault)) throw new Error(`${name}: periods.default "${periodDefault}" is not in periods.options`);

  const f = raw.flags || {};
  const rollUp = raw.statement?.rollUpSubAccounts ?? true;
  if (![true, false, 'matched'].includes(rollUp)) throw new Error(`${name}: statement.rollUpSubAccounts must be true | false | "matched"`);
  const sortAccounts = raw.statement?.sortAccounts ?? 'amount';
  if (!['amount', 'number'].includes(sortAccounts)) throw new Error(`${name}: statement.sortAccounts must be amount | number`);
  const statement = { rollUpSubAccounts: rollUp, sortAccounts };
  const SECTIONS = ['tiles', 'statement', 'pl', 'balanceSheet', 'trends', 'sideBySide']; // sideBySide = the Side by side card on Compare (VJ 2026-10-29)
  const sections = raw.page?.sections ?? SECTIONS.filter((x) => x !== 'sideBySide'); // sideBySide is opt-in
  if (!Array.isArray(sections) || !sections.length || sections.some((x) => !SECTIONS.includes(x))) throw new Error(`${name}: page.sections must be a non-empty list from ${SECTIONS.join(' | ')}`);
  const memo = raw.page?.memo ?? true;
  if (typeof memo !== 'boolean') throw new Error(`${name}: page.memo must be true or false`);
  const portfolio = {};
  for (const k of ['summary', 'flags', 'tags', 'combinedList']) {
    const v = raw.page?.portfolio?.[k] ?? true;
    if (typeof v !== 'boolean') throw new Error(`${name}: page.portfolio.${k} must be true or false`);
    portfolio[k] = v;
  }
  portfolio.label = raw.page?.portfolio?.label ?? 'Offices';
  if (typeof portfolio.label !== 'string' || !portfolio.label.trim()) throw new Error(`${name}: page.portfolio.label must be a non-empty string (the heading of the office list)`);
  // page.portfolio.nameColumn: the header of the first list column (default: the label).
  portfolio.nameColumn = raw.page?.portfolio?.nameColumn ?? portfolio.label;
  if (typeof portfolio.nameColumn !== 'string' || !portfolio.nameColumn.trim()) throw new Error(`${name}: page.portfolio.nameColumn must be a non-empty string`);
  // page.portfolio.columns: the office list columns, each a statement row key or a derived figure.
  const DERIVED = ['totalExpenses', 'operatingCosts', 'loanPayments', 'withdrawals', 'cash', 'ar', 'ap', 'ebitdaMargin', 'vsPrior'];
  const colRaw = raw.page?.portfolio?.columns ?? null;
  if (colRaw !== null && (!Array.isArray(colRaw) || !colRaw.length || colRaw.length > 12)) throw new Error(`${name}: page.portfolio.columns must be a list of 1..12 { key, label }`);
  portfolio.columns = colRaw && colRaw.map((col, i) => {
    const where = `page.portfolio.columns[${i}]`;
    if (!isObj(col) || typeof col.key !== 'string') throw new Error(`${name}: ${where} must be { key, label }`);
    if (!rows.some((r) => r.key === col.key) && !DERIVED.includes(col.key)) throw new Error(`${name}: ${where}.key "${col.key}" is not a statement row key or one of ${DERIVED.join(' | ')}`);
    const label = col.label ?? rows.find((r) => r.key === col.key)?.label ?? col.key;
    if (typeof label !== 'string' || !label.trim()) throw new Error(`${name}: ${where}.label must be a non-empty string`);
    return { key: col.key, label };
  });
  // page.portfolio.buckets: the office list in groups (fixed order, subtotal per group). A bucket takes an office when one of
  // its companies is listed in companies, else when the first company's category (autoPair.dimension) is in categories; rest = the bucket for the others.
  const bRaw = raw.page?.portfolio?.buckets ?? null;
  portfolio.buckets = null;
  if (bRaw !== null) {
    if (!isObj(bRaw) || !Array.isArray(bRaw.list) || !bRaw.list.length) throw new Error(`${name}: page.portfolio.buckets must be { list: [{ key, label, categories?, companies? }], rest }`);
    const keys = new Set();
    const list = bRaw.list.map((b, i) => {
      const where = `page.portfolio.buckets.list[${i}]`;
      if (!isObj(b) || typeof b.key !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(b.key)) throw new Error(`${name}: ${where}.key must be a camelCase key`);
      if (keys.has(b.key)) throw new Error(`${name}: ${where}.key "${b.key}" is used twice`);
      keys.add(b.key);
      if (typeof b.label !== 'string' || !b.label.trim()) throw new Error(`${name}: ${where}.label must be a non-empty string`);
      for (const k of ['categories', 'companies']) if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].some((x) => typeof x !== 'string'))) throw new Error(`${name}: ${where}.${k} must be a list of strings`);
      if (b.show !== undefined && typeof b.show !== 'boolean') throw new Error(`${name}: ${where}.show must be true or false`);
      // columns: other column names on this group's header row, { "<page.portfolio.columns key>": "<label>" } (VJ 2026-10-29: "Revenue" instead of "Collections" outside Dental).
      const columns = {};
      if (b.columns !== undefined) {
        if (!isObj(b.columns)) throw new Error(`${name}: ${where}.columns must be an object { "<column key>": "<label>" }`);
        for (const [ck, cl] of Object.entries(b.columns)) {
          if (ck.startsWith('$')) continue;
          if (!portfolio.columns?.some((c) => c.key === ck)) throw new Error(`${name}: ${where}.columns.${ck} is not a key of page.portfolio.columns`);
          if (typeof cl !== 'string' || !cl.trim()) throw new Error(`${name}: ${where}.columns.${ck} must be a non-empty string`);
          columns[ck] = cl;
        }
      }
      return { key: b.key, label: b.label, categories: b.categories || [], companies: (b.companies || []).map(String), show: b.show !== false, columns };
    });
    if (typeof bRaw.rest !== 'string' || !keys.has(bRaw.rest)) throw new Error(`${name}: page.portfolio.buckets.rest must be one of the bucket keys`);
    if (list.some((b) => b.categories.length) && !autoPair.dimension) throw new Error(`${name}: autoPair.dimension is required when page.portfolio.buckets use categories`);
    portfolio.buckets = { list, rest: bRaw.rest };
  }
  // page.titles: the card titles of the office page and the Compare view (VJ 2026-10-28: "Synopsis P&L" / "Detailed P&L");
  // titles.combined = the two titles on a combined view (VJ 2026-10-29: "Combined Synopsis" / "Combined Details").
  const tRaw = raw.page?.titles || {};
  if (!isObj(tRaw) || (tRaw.combined !== undefined && !isObj(tRaw.combined))) throw new Error(`${name}: page.titles must be { statement, pl, combined: { statement, pl } }`);
  const titles = { statement: 'Office statement', pl: 'Combined profit and loss', sideBySide: 'Synopsis comparison', ...tRaw, combined: { statement: 'Combined statement', pl: 'Combined profit and loss', ...(tRaw.combined || {}) } };
  if (typeof titles.sideBySide !== 'string' || !titles.sideBySide.trim()) throw new Error(`${name}: page.titles.sideBySide must be a non-empty string`);
  for (const k of ['statement', 'pl']) {
    if (typeof titles[k] !== 'string' || !titles[k].trim()) throw new Error(`${name}: page.titles.${k} must be a non-empty string`);
    if (typeof titles.combined[k] !== 'string' || !titles.combined[k].trim()) throw new Error(`${name}: page.titles.combined.${k} must be a non-empty string`);
  }
  // page.split: grid columns (of 12) for the statement and the P&L when they sit side by side (VJ 2026-10-29: 5 and 7, about 40 / 60).
  const split = raw.page?.split ?? [6, 6];
  if (!Array.isArray(split) || split.length !== 2 || split.some((n) => !Number.isInteger(n) || n < 1) || split[0] + split[1] !== 12) throw new Error(`${name}: page.split must be two whole numbers adding up to 12, e.g. [3, 9] (the statement's and the P&L's share of the width side by side)`);
  const page = { sections, memo, portfolio, titles: { statement: titles.statement, pl: titles.pl, sideBySide: titles.sideBySide, combined: { statement: titles.combined.statement, pl: titles.combined.pl } }, split: [split[0], split[1]] };
  // picker: the header company picker in groups by company (not by office): same shape as page.portfolio.buckets
  // (a company goes to the first group listing it in companies, else to the first group whose categories hold its
  // Company type, else to rest). null = the page.portfolio.buckets by office.
  const pRaw = raw.picker ?? null;
  let picker = null;
  if (pRaw !== null) {
    if (!isObj(pRaw) || !Array.isArray(pRaw.groups) || !pRaw.groups.length) throw new Error(`${name}: picker must be { groups: [{ key, label, categories?, companies? }], rest }`);
    const keys = new Set();
    const list = pRaw.groups.map((b, i) => {
      const where = `picker.groups[${i}]`;
      if (!isObj(b) || typeof b.key !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(b.key)) throw new Error(`${name}: ${where}.key must be a camelCase key`);
      if (keys.has(b.key)) throw new Error(`${name}: ${where}.key "${b.key}" is used twice`);
      keys.add(b.key);
      if (typeof b.label !== 'string' || !b.label.trim()) throw new Error(`${name}: ${where}.label must be a non-empty string`);
      for (const k of ['categories', 'companies']) if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].some((x) => typeof x !== 'string'))) throw new Error(`${name}: ${where}.${k} must be a list of strings`);
      return { key: b.key, label: b.label, categories: b.categories || [], companies: (b.companies || []).map(String) };
    });
    if (typeof pRaw.rest !== 'string' || !keys.has(pRaw.rest)) throw new Error(`${name}: picker.rest must be one of the group keys`);
    if (list.some((b) => b.categories.length) && !autoPair.dimension) throw new Error(`${name}: autoPair.dimension is required when picker groups use categories`);
    picker = { list, rest: pRaw.rest };
  }
  const includeLoanPayments = raw.cashFlow?.includeLoanPayments ?? false;
  if (typeof includeLoanPayments !== 'boolean') throw new Error(`${name}: cashFlow.includeLoanPayments must be true or false`);
  return {
    statement, page,
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
    periods: { default: periodDefault, fiscalYearStartMonth: fy, asOf: asOfMode, options: periodOptions, yearButtons },
    picker,
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
