// Offices tab core: dental practice + sub-DSO read as one office, the office statement (net collections,
// provider / staff payroll, ..., office EBITDA, operating cash flow), internal-charge elimination, flags and the
// balance sheet tree. Pure functions over ledger rows so they can be tested without a database.
import { addMonths, monthsBetween } from '../periods.js';

const round2 = (n) => Math.round(n * 100) / 100;
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const INCOME = new Set(['Income']);
const OTHER_INCOME = new Set(['OtherIncome']);
const EXPENSE = new Set(['COGS', 'Expenses', 'OtherExpenses']);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const matchAcct = (re, r) => Boolean(re && (re.test(r.account) || (r.fullName && re.test(r.fullName))));

// ---------- Offices ----------

const fill = (pattern, o) => pattern.replace(/\{(city|state|company)\}/g, (_, k) => o[k] || '');

/**
 * Companies -> offices. companies: [{ realmId, officeName, city, state }] (already limited to what the user may see).
 * categoryOf(realmId) -> office category label of cfg.autoPair.dimension. Returns [{ key, name, city, state, companies, aliases, explicit }].
 */
export function resolveOffices(companies, cfg, categoryOf = () => null) {
  const byId = Object.fromEntries(companies.map((c) => [c.realmId, c]));
  const used = new Set();
  const out = [];
  const finish = (o) => {
    const first = o.companies[0];
    const city = o.city || first.city || null;
    const state = o.state || first.state || null;
    const name = o.name || (city ? fill(cfg.naming.pattern, { city, state, company: first.name }) : fill(cfg.naming.fallback, { city, state, company: first.name }));
    const key = `${slug(name)}-${first.realmId.slice(-4)}`;
    out.push({ key, name, city, state, companies: o.companies, aliases: o.aliases || [], explicit: Boolean(o.explicit), id: o.id ?? null, saved: Boolean(o.saved) });
  };
  for (const o of cfg.offices) {
    const present = o.companies.filter((id) => byId[id]);
    for (const id of o.companies) used.add(id);
    if (!present.length) continue;
    finish({ ...o, explicit: true, companies: present.map((id) => ({ realmId: id, name: byId[id].officeName, city: byId[id].city, state: byId[id].state })) });
  }
  if (cfg.autoPair.enabled) {
    const rest = companies.filter((c) => !used.has(c.realmId));
    const isSub = (c) => Boolean(cfg.autoPair.subDso && cfg.autoPair.subDso.test(c.officeName));
    const inCats = (c) => !cfg.autoPair.categories.length || cfg.autoPair.categories.includes(categoryOf(c.realmId));
    const dental = rest.filter((c) => inCats(c) && !isSub(c));
    const subs = rest.filter((c) => isSub(c));
    const place = (c) => `${(c.city || '').toLowerCase()}|${(c.state || '').toLowerCase()}`;
    const autos = dental.map((c) => ({ companies: [{ realmId: c.realmId, name: c.officeName, city: c.city, state: c.state }] }));
    for (const s of subs) {
      const host = s.city && autos.find((a) => place(a.companies[0]) === place(s));
      if (host) host.companies.push({ realmId: s.realmId, name: s.officeName, city: s.city, state: s.state });
      else if (cfg.autoPair.standaloneSubDso) autos.push({ companies: [{ realmId: s.realmId, name: s.officeName, city: s.city, state: s.state }] });
    }
    for (const a of autos) finish(a);
  }
  // Two offices with the same name (e.g. two companies registered in the same city) get the company name appended.
  const count = {};
  for (const o of out) count[o.name] = (count[o.name] || 0) + 1;
  for (const o of out) if (count[o.name] > 1) o.name = `${o.name} (${o.companies[0].name})`;
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Combined offices the user saved (Combine on the Offices tab): extra views over several companies, shown next to the
 * offices, never replacing them. saved: listSavedOffices(); companies: as for resolveOffices (what the user may see).
 */
export function combinedOffices(saved, companies) {
  const byId = Object.fromEntries(companies.map((c) => [c.realmId, c]));
  return saved.map((s) => {
    const present = s.companies.filter((id) => byId[id]).map((id) => ({ realmId: id, name: byId[id].officeName, city: byId[id].city, state: byId[id].state }));
    if (!present.length) return null;
    return { key: `combined-${s.id}`, name: s.name || present.map((c) => c.name).join(' + '), city: s.city || null, state: s.state || null, companies: present, aliases: s.aliases || [], explicit: false, id: s.id, saved: true, combined: true };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Periods ----------

/** The KPI window ending at asOf (YYYY-MM) and the same window a year earlier. */
export function periodWindow(asOf, period, fyStart = 1) {
  let from = asOf; let label = 'Month';
  if (period === 'quarter') {
    const m = Number(asOf.slice(5, 7));
    const endQ = m % 3 === 0 ? asOf : addMonths(asOf, -(m % 3)); // last full calendar quarter
    from = addMonths(endQ, -2);
    const q = Math.ceil(Number(endQ.slice(5, 7)) / 3);
    return { key: period, label: `Q${q} ${endQ.slice(0, 4)}`, from, to: endQ, priorFrom: addMonths(from, -12), priorTo: addMonths(endQ, -12) };
  }
  if (period === 'ytd') {
    const fy = String(fyStart).padStart(2, '0');
    from = asOf.slice(5, 7) >= fy ? `${asOf.slice(0, 4)}-${fy}` : `${Number(asOf.slice(0, 4)) - 1}-${fy}`;
    label = 'Year to date';
  } else if (period === 'ttm') { from = addMonths(asOf, -11); label = 'Trailing 12 months'; }
  return { key: period, label, from, to: asOf, priorFrom: addMonths(from, -12), priorTo: addMonths(asOf, -12) };
}

// ---------- Internal charges between the companies of one office ----------

const norm = (s) => String(s || '').toLowerCase().replace(/\b(llc|inc|pllc|corp|corporation|ltd|co)\b/g, '').replace(/[^a-z0-9]/g, '');

/** True when a payee / customer name on a line of company `realmId` is another company of the office. */
export function isPartnerName(entityName, office, realmId) {
  const n = norm(entityName);
  if (n.length < 4) return false;
  for (const c of office.companies) {
    if (c.realmId === realmId) continue;
    const cn = norm(c.name);
    if (cn.length >= 4 && (n.includes(cn) || cn.includes(n))) return true;
  }
  return office.aliases.some((a) => { const an = norm(a); return an.length >= 4 && (n.includes(an) || an.includes(n)); });
}

/**
 * Mark the internal part of each line (r.internal = amount removed). Only as much as the two sides match in a
 * month is removed, split across the candidate lines in proportion. Returns { month: { expense, income, matched } }.
 */
export function eliminateInternal(lines, office, cfg) {
  const out = {};
  for (const r of lines) { r.internal = 0; r.internalSide = null; }
  if (office.companies.length < 2) return out;
  const cand = { expense: [], income: [] };
  for (const r of lines) {
    const partner = r.entity && isPartnerName(r.entity, office, r.realmId);
    if (EXPENSE.has(r.grp) && (partner || matchAcct(cfg.internal.expense.re, r))) { r.internalSide = 'expense'; cand.expense.push(r); }
    else if ((INCOME.has(r.grp) || OTHER_INCOME.has(r.grp)) && (partner || matchAcct(cfg.internal.income.re, r))) { r.internalSide = 'income'; cand.income.push(r); }
  }
  const tot = {};
  for (const side of ['expense', 'income']) for (const r of cand[side]) { (tot[r.month] ||= { expense: 0, income: 0 })[side] += r.amount; }
  for (const [m, t] of Object.entries(tot)) {
    const matched = t.expense > 0 && t.income > 0 ? Math.min(t.expense, t.income) : 0;
    out[m] = { expense: round2(t.expense), income: round2(t.income), matched: round2(matched) };
    if (!matched) continue;
    for (const side of ['expense', 'income']) for (const r of cand[side]) if (r.month === m) r.internal = r.amount * (matched / t[side]);
  }
  return out;
}

// ---------- Classification ----------

/** Which statement row (or memo line) a P&L line belongs to. */
export function classifyLine(r, cfg) {
  if (INCOME.has(r.grp)) {
    const coll = cfg.rows.find((x) => x.role === 'collections');
    // A collections row with its own account pattern takes only those accounts; other income accounts go to a memo line.
    return coll.re && !matchAcct(coll.re, r) ? { kind: 'memo', key: 'unassignedIncome' } : { kind: 'row', key: coll.key };
  }
  if (OTHER_INCOME.has(r.grp)) return { kind: 'memo', key: 'otherIncome' };
  if (matchAcct(cfg.profitTransfers, r)) return { kind: 'memo', key: 'profitTransfers' };
  if (matchAcct(cfg.notOperating, r)) return { kind: 'memo', key: 'notOperating' };
  if (matchAcct(cfg.payrollTaxes.re, r)) return { kind: 'tax', key: 'payrollTaxes' };
  for (const row of cfg.rows) if ((row.role === 'cost' || row.role === 'fees') && matchAcct(row.re, r)) return { kind: 'row', key: row.key };
  const other = cfg.rows.find((x) => x.role === 'other');
  // An "other" row with its own account pattern takes only those accounts; the rest is not in any row (memo).
  return other.re && !matchAcct(other.re, r) ? { kind: 'memo', key: 'unassigned' } : { kind: 'row', key: other.key };
}

export const MEMO = [
  ['otherIncome', 'Other income (non-operating)', 1],
  ['unassignedIncome', 'Income not assigned to a row', 1],
  ['unassigned', 'Expenses not assigned to a row', -1],
  ['notOperating', 'Depreciation, amortization & interest', -1],
  ['profitTransfers', 'Profit transfers (not a cost of the office)', -1],
  ['internalIncome', 'Internal income not matched (charged to the other company, not patient collections)', 1],
  ['internalUnmatched', 'Internal charges not matched (paid to the other company)', -1],
];

// ---------- One spelling per account across the companies of an office ----------

/** "650 Management Fees", "650 Management fee" and "650 Management Fee" -> the same key (case, spacing, punctuation, "and" and plural ignored; word order too). */
export const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().split(' ')
  .filter((w) => w && w !== 'and').map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).sort().join(' ');
const numberOf = (seg) => (String(seg).match(/^(\d+(?:\.\d+)*[a-z]?)(?=\s|$)/i) || [])[1] || null;

/**
 * Wrap an account book so every path segment uses one spelling across the given companies. Segments are the same
 * account when their names match (normKey), or when they carry the same account number and no company uses that
 * number for two different accounts (so 560 "Repairs & Maintenance" = 560 "Repairs and Maintenance", but the two
 * 503 accounts stay apart). The spelling most companies use wins (ties: capitalised / shorter first).
 */
export function canonicalBook(book, realmIds) {
  const perCompany = new Map(); // realmId -> Map(number -> Set(normKey))
  const segs = []; // [realmId, segment]
  for (const id of realmIds) {
    const nums = new Map();
    for (const a of Object.values(book(id))) {
      for (const seg of String(a.fullName || a.name).split(':')) {
        const s = seg.trim();
        segs.push([id, s]);
        const n = numberOf(s);
        if (n) { if (!nums.has(n)) nums.set(n, new Set()); nums.get(n).add(normKey(s)); }
      }
    }
    perCompany.set(id, nums);
  }
  const numberUnique = (n) => [...perCompany.values()].every((nums) => (nums.get(n)?.size || 0) <= 1);
  const keyOf = (s) => { const n = numberOf(s); return n && numberUnique(n) ? `#${n}` : normKey(s); };
  const spell = new Map(); // key -> Map(spelling -> number of accounts using it)
  for (const [, s] of segs) {
    const k = keyOf(s);
    const m = spell.get(k) || new Map();
    m.set(s, (m.get(s) || 0) + 1);
    spell.set(k, m);
  }
  const canon = (seg) => {
    const m = spell.get(keyOf(seg));
    return m ? [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] : seg;
  };
  const cache = {};
  return (id) => (cache[id] ||= Object.fromEntries(Object.entries(book(id)).map(([k, a]) => {
    const parts = String(a.fullName || a.name).split(':').map((s) => canon(s.trim()));
    return [k, { ...a, name: canon(String(a.name).trim()), fullName: parts.join(':') }];
  })));
}

// ---------- Statement ----------

/**
 * The main account a line belongs to when sub-accounts are rolled up: the top of its QuickBooks path
 * ("402 Income:402.1 Cash" -> "402 Income"); a dotted number with no parent keeps the whole number ("5000.1 Payroll" -> "5000 Payroll").
 */
export function mainAccount(r) {
  const top = String(r.fullName || r.account).split(':')[0].trim();
  const name = top.replace(/^(\d+)\.[\w.]*(?=\s|$)/, '$1');
  return [name, name];
}

/**
 * The account a line is shown under when statement.rollUpSubAccounts = "matched": the shallowest level of its
 * QuickBooks path that the row's rule matches (so a rule on 503.1 shows "503.1 Dental Contract Labor", a rule on
 * "hygien" shows "504 Hygienist"); deeper sub-accounts roll up into it. Falls back to the main account.
 */
export function matchedAccount(r, re) {
  if (re) {
    const parts = String(r.fullName || r.account).split(':').map((s) => s.trim());
    // Deepest level whose own name matches (a rule on 503.1 shows 503.1, not the "Dentist" sub-account under it and not
    // the "503 Contract Labor" parent); else the shallowest level whose path matches.
    for (let i = parts.length - 1; i >= 0; i--) if (re.test(parts[i])) return [parts[i], parts.slice(0, i + 1).join(':')];
    for (let i = 0; i < parts.length; i++) { const prefix = parts.slice(0, i + 1).join(':'); if (re.test(prefix)) return [parts[i], prefix]; }
  }
  return mainAccount(r);
}

const sumMonths = (map, from, to) => { let t = 0; for (const [m, v] of Object.entries(map)) if (m >= from && m <= to) t += v; return round2(t); };

/**
 * Build the office statement. lines: [{ realmId, month, grp, accountId, account, fullName, entity, amount }] with
 * income and expenses positive (already limited to the office's companies). cashFlow: { month: operating amount }.
 * window: periodWindow(); months: the columns to show. Returns rows, memo lines, internal summary and per-month totals.
 */
export function buildStatement(lines, office, cfg, { window, months, cashFlow = {} }) {
  const internal = eliminateInternal(lines, office, cfg);
  const rows = cfg.rows.map((r) => ({ key: r.key, label: r.label, role: r.role, months: {}, children: new Map() }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const memo = Object.fromEntries(MEMO.map(([k, label]) => [k, { key: k, label, months: {}, children: new Map() }]));
  const tax = { months: {}, children: new Map() };
  const uncategorized = {};
  const childAdd = (slot, r, amt, re = null) => {
    const mode = cfg.statement.rollUpSubAccounts;
    const [account, fullName] = mode === 'matched' ? matchedAccount(r, re) : mode ? mainAccount(r) : [r.account, r.fullName || r.account];
    const k = normKey(account); // one line per account name, however the companies spell or nest it
    const c = slot.children.get(k) || { account, fullName, companies: new Set(), months: {} };
    c.companies.add(r.realmId);
    add(c.months, r.month, amt);
    slot.children.set(k, c);
  };
  for (const r of lines) {
    const amt = r.amount - (r.internal || 0);
    if (Math.abs(amt) < 0.005) continue;
    if (matchAcct(cfg.uncategorized, r)) add(uncategorized, r.month, Math.abs(amt));
    // The unmatched part of an internal charge: money between the two companies of the office, not collections or
    // a cost (internal.<side>.unmatched = memo), or left in the rows as booked (= rows).
    const c = r.internalSide && cfg.internal[r.internalSide].unmatched === 'memo'
      ? { kind: 'memo', key: r.internalSide === 'income' ? 'internalIncome' : 'internalUnmatched' }
      : classifyLine(r, cfg);
    const slot = c.kind === 'row' ? byKey[c.key] : c.kind === 'memo' ? memo[c.key] : tax;
    add(slot.months, r.month, amt);
    childAdd(slot, r, amt, c.kind === 'row' ? cfg.rows.find((x) => x.key === c.key)?.re : c.kind === 'tax' ? cfg.payrollTaxes.re : null);
  }
  // Payroll taxes: split across the configured rows in proportion to each month's amounts.
  const targets = cfg.payrollTaxes.allocateTo.map((k) => byKey[k]).filter(Boolean);
  if (targets.length) {
    for (const [m, t] of Object.entries(tax.months)) {
      const base = targets.map((row) => Math.max(0, row.months[m] || 0));
      const total = base.reduce((a, b) => a + b, 0);
      targets.forEach((row, i) => {
        const share = total > 0 ? t * (base[i] / total) : i === targets.length - 1 ? t : 0;
        if (!share) return;
        add(row.months, m, share);
        const k = '__tax';
        const c = row.children.get(k) || { account: 'Payroll taxes (allocated)', fullName: 'Payroll taxes, share allocated to this row', companies: new Set(), months: {}, allocated: true };
        add(c.months, m, share);
        for (const tc of tax.children.values()) for (const id of tc.companies) c.companies.add(id);
        row.children.set(k, c);
      });
    }
  }
  // Subtotals.
  const allMonths = new Set([...rows.flatMap((r) => Object.keys(r.months)), ...Object.keys(cashFlow)]);
  const coll = rows.find((r) => r.role === 'collections');
  const costs = rows.filter((r) => r.role === 'cost' || r.role === 'other');
  const fees = rows.find((r) => r.role === 'fees');
  const sub = rows.find((r) => r.role === 'feesSubtotal');
  const ebitda = rows.find((r) => r.role === 'ebitda');
  const cf = rows.find((r) => r.role === 'cashFlow');
  for (const m of allMonths) {
    const before = (coll.months[m] || 0) - costs.reduce((t, r) => t + (r.months[m] || 0), 0);
    sub.months[m] = round2(before);
    ebitda.months[m] = round2(before - (fees.months[m] || 0));
    if (cf) cf.months[m] = round2(cashFlow[m] || 0);
  }
  const finishChildren = (slot) => [...slot.children.values()].map((c) => ({
    account: c.account, fullName: c.fullName, companies: c.companies.size, allocated: Boolean(c.allocated),
    months: Object.fromEntries(Object.entries(c.months).map(([m, v]) => [m, round2(v)])),
    period: sumMonths(c.months, window.from, window.to), prior: sumMonths(c.months, window.priorFrom, window.priorTo),
  })).sort((a, b) => Math.abs(b.period) - Math.abs(a.period) || a.fullName.localeCompare(b.fullName));
  const finishRow = (r) => ({
    key: r.key, label: r.label, role: r.role,
    months: Object.fromEntries(months.map((m) => [m, round2(r.months[m] || 0)])),
    period: sumMonths(r.months, window.from, window.to), prior: sumMonths(r.months, window.priorFrom, window.priorTo),
    children: finishChildren(r),
  });
  const out = {
    rows: rows.map(finishRow),
    memo: MEMO.map(([k, , sign]) => ({ ...finishRow(memo[k]), sign })).filter((m) => m.children.length || Object.values(m.months).some((v) => v)),
    internal: Object.fromEntries(Object.entries(internal).filter(([m]) => months.includes(m))),
    internalPeriod: { expense: round2(sumMonths(Object.fromEntries(Object.entries(internal).map(([m, t]) => [m, t.expense])), window.from, window.to)), income: round2(sumMonths(Object.fromEntries(Object.entries(internal).map(([m, t]) => [m, t.income])), window.from, window.to)), matched: round2(sumMonths(Object.fromEntries(Object.entries(internal).map(([m, t]) => [m, t.matched])), window.from, window.to)) },
    uncategorizedPeriod: sumMonths(uncategorized, window.from, window.to),
    all: { collections: coll.months, costs: Object.fromEntries([...allMonths].map((m) => [m, round2(costs.reduce((t, r) => t + (r.months[m] || 0), 0) + (fees.months[m] || 0))])), ebitdaBeforeFees: sub.months, officeEbitda: ebitda.months },
  };
  return out;
}

// ---------- Flags ----------

export const FLAGS = [
  ['netLoss', 'Net loss', 'bad'],
  ['collectionsDown', 'Collections down', 'warn'],
  ['uncategorized', 'Uncategorized', 'warn'],
  ['lowCash', 'Low cash', 'bad'],
  ['arHigh', 'AR high', 'warn'],
  ['booksBehind', 'Books behind', 'warn'],
  ['stale', 'Stale', 'bad'],
  ['internalUnmatched', 'Internal charges unmatched', 'info'],
  ['pullFailed', 'Pull failed', 'bad'],
];

/** Needs-attention flags for one office. s: { collections, prior, ebitda, cash, ar, monthlyCosts, monthlyCollections, uncategorized, internalUnmatched, lastChange, lastActivity, pullErrors }. */
export function flagsFor(s, cfg, { asOf, now = new Date() }) {
  const f = cfg.flags;
  const out = [];
  if (s.ebitda < 0) out.push('netLoss');
  if (s.prior > 0 && (s.collections - s.prior) / s.prior <= -f.collectionsDown) out.push('collectionsDown');
  if (s.collections > 0 && s.uncategorized / s.collections >= f.uncategorized) out.push('uncategorized');
  if (s.monthlyCosts > 0 && s.cash != null && s.cash < f.lowCashMonths * s.monthlyCosts) out.push('lowCash');
  if (s.monthlyCollections > 0 && s.ar != null && s.ar > f.arHighMonths * s.monthlyCollections) out.push('arHigh');
  if (s.lastActivity && s.lastActivity < addMonths(asOf, -1)) out.push('booksBehind');
  if (s.lastChange && (now - new Date(s.lastChange)) / 86400_000 > f.staleDays) out.push('stale');
  if (s.collections > 0 && Math.abs(s.internalUnmatched) / s.collections >= f.internalUnmatched) out.push('internalUnmatched');
  if (s.pullErrors) out.push('pullFailed');
  const meta = Object.fromEntries(FLAGS.map(([k, label, tone]) => [k, { key: k, label, tone }]));
  return out.map((k) => meta[k]);
}

// ---------- Balance sheet tree ----------

const BS_SECTIONS = [
  { key: 'assets', label: 'Assets', sign: 1, types: [['Bank', 'Bank Accounts'], ['Accounts Receivable', 'Accounts Receivable (A/R)'], ['Other Current Asset', 'Other Current Assets'], ['Fixed Asset', 'Fixed Assets'], ['Other Asset', 'Other Assets']] },
  { key: 'liabilities', label: 'Liabilities', sign: -1, types: [['Accounts Payable', 'Accounts Payable (A/P)'], ['Credit Card', 'Credit Cards'], ['Other Current Liability', 'Other Current Liabilities'], ['Long Term Liability', 'Long-Term Liabilities']] },
  { key: 'equity', label: 'Equity', sign: -1, types: [['Equity', 'Equity']] },
];
const PL_TYPES = new Set(['Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense']);

/**
 * Balance sheet of an office at two dates. balances: [{ realmId, accountId, now, prior }] (debit-positive ledger sums);
 * accountOf(realmId) -> { id: account }. Same-named accounts of the companies are merged by full path.
 */
export function balanceTree(balances, accountOf) {
  const sections = BS_SECTIONS.map((s) => ({ key: s.key, label: s.label, now: 0, prior: 0, groups: s.types.map(([type, label]) => ({ type, label, now: 0, prior: 0, nodes: new Map() })) }));
  const retained = { now: 0, prior: 0 };
  for (const b of balances) {
    const a = accountOf(b.realmId)[b.accountId];
    if (!a) continue;
    if (PL_TYPES.has(a.type)) { retained.now += -b.now; retained.prior += -b.prior; continue; }
    const sec = sections.find((s) => BS_SECTIONS.find((x) => x.key === s.key).types.some(([t]) => t === a.type));
    if (!sec) continue;
    const sign = BS_SECTIONS.find((x) => x.key === sec.key).sign;
    const grp = sec.groups.find((g) => g.type === a.type);
    const parts = String(a.fullName || a.name).split(':');
    let parent = grp.nodes;
    let path = '';
    parts.forEach((p, i) => {
      path = path ? `${path}:${p}` : p;
      const node = parent.get(path) || { name: p, fullName: path, now: 0, prior: 0, children: new Map(), companies: new Set() };
      parent.set(path, node);
      node.companies.add(b.realmId);
      if (i === parts.length - 1) { node.now += sign * b.now; node.prior += sign * b.prior; }
      parent = node.children;
    });
  }
  const finish = (map) => [...map.values()].map((n) => {
    const children = finish(n.children);
    const now = round2(n.now + children.reduce((t, c) => t + c.now, 0));
    const prior = round2(n.prior + children.reduce((t, c) => t + c.prior, 0));
    return { name: n.name, fullName: n.fullName, now, prior, companies: n.companies.size, children };
  }).filter((n) => n.now !== 0 || n.prior !== 0 || n.children.length).sort((a, b) => a.fullName.localeCompare(b.fullName));
  for (const s of sections) {
    s.groups = s.groups.map((g) => { const nodes = finish(g.nodes); return { label: g.label, now: round2(nodes.reduce((t, n) => t + n.now, 0)), prior: round2(nodes.reduce((t, n) => t + n.prior, 0)), nodes }; }).filter((g) => g.nodes.length);
    if (s.key === 'equity' && (retained.now || retained.prior)) s.groups.push({ label: 'Net income (cumulative)', now: round2(retained.now), prior: round2(retained.prior), nodes: [] });
    s.now = round2(s.groups.reduce((t, g) => t + g.now, 0));
    s.prior = round2(s.groups.reduce((t, g) => t + g.prior, 0));
  }
  return sections;
}

export { monthsBetween, addMonths, round2 };
