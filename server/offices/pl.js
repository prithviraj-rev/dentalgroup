// Combined profit and loss of one office: the companies' accounts merged by section, account type and account path
// (sub-accounts merge only under the same parent), as booked in QuickBooks (no internal-charge removal, no payroll
// split), with one column per month and one column per company. Pure function over ledger P&L lines.
import { buildCoaTree } from '../coa.js';

const round2 = (n) => Math.round(n * 100) / 100;
const CLASS_OF_TYPE = { Income: 'Revenue', 'Other Income': 'Revenue', 'Cost of Goods Sold': 'Expense', Expense: 'Expense', 'Other Expense': 'Expense' };
const TYPE_LABEL = { Income: 'Income', 'Cost of Goods Sold': 'Cost of Goods Sold', Expense: 'Expenses', 'Other Income': 'Other Income', 'Other Expense': 'Other Expenses' };

const zero = (buckets) => Object.fromEntries(buckets.map((b) => [b.key, 0]));
const minus = (a, b, buckets) => ({ periods: Object.fromEntries(buckets.map((x) => [x.key, round2((a?.periods[x.key] || 0) - (b?.periods[x.key] || 0))])), total: round2((a?.total || 0) - (b?.total || 0)) });
const plus = (a, b, buckets) => ({ periods: Object.fromEntries(buckets.map((x) => [x.key, round2((a?.periods[x.key] || 0) + (b?.periods[x.key] || 0))])), total: round2((a?.total || 0) + (b?.total || 0)) });

function view({ accounts, lines, buckets }) {
  const tree = buildCoaTree({ accounts, lines, buckets, merge: true });
  const typeOf = (t) => tree.sections.flatMap((s) => s.types).find((x) => x.accountType === t) || { periods: zero(buckets), total: 0 };
  const income = typeOf('Income'); const cogs = typeOf('Cost of Goods Sold'); const expense = typeOf('Expense');
  const otherIncome = typeOf('Other Income'); const otherExpense = typeOf('Other Expense');
  const grossProfit = minus(income, cogs, buckets);
  const netOperatingIncome = minus(grossProfit, expense, buckets);
  const netOtherIncome = minus(otherIncome, otherExpense, buckets);
  const netIncome = plus(netOperatingIncome, netOtherIncome, buckets);
  const types = tree.sections.flatMap((s) => s.types).map((t) => ({ accountType: t.accountType, label: TYPE_LABEL[t.accountType] || t.accountType, periods: t.periods, total: t.total, nodes: t.nodes.filter((n) => n.hasActivity).map(strip) }));
  return { buckets, types, subtotals: { grossProfit, netOperatingIncome, netOtherIncome, netIncome }, accountCount: tree.accountCount };
}

/** Keep what the page needs; sub-accounts without activity are dropped. */
function strip(n) {
  return { key: n.key, name: n.name, fqn: n.fqn, companies: [...new Set(n.offices)].length, periods: n.periods, total: n.total, own: n.own, ownTotal: n.ownTotal, children: n.children.filter((c) => c.hasActivity).map(strip) };
}

/**
 * companies: [{ realmId, name }]; book(realmId) -> { id: { id, name, fullName, type, subType, classification, active } };
 * lines: plLines() rows ({ realmId, month, grp, accountId, account, amount }, income positive); months: the month columns.
 * Returns { months: view, companies: view }, each { buckets, types, subtotals, accountCount }.
 */
export function officePl({ companies, book, lines, months }) {
  const accounts = companies.flatMap((c) => Object.values(book(c.realmId)).filter((a) => CLASS_OF_TYPE[a.type]).map((a) => ({
    office_realm_id: c.realmId, account_id: a.id, name: a.name, fully_qualified_name: a.fullName || a.name, account_type: a.type, account_sub_type: a.subType || null,
    classification: a.classification || CLASS_OF_TYPE[a.type], parent_id: null, active: a.active !== false, current_balance: 0,
  })));
  const inRange = lines.filter((l) => l.month >= months[0] && l.month <= months.at(-1));
  const toLine = (l, period) => ({ realmId: l.realmId, accountId: l.accountId, accountName: l.account, grp: l.grp, period, amount: l.amount });
  const monthBuckets = months.map((m) => ({ key: m, label: m }));
  const companyBuckets = companies.map((c) => ({ key: c.realmId, label: c.name }));
  return {
    months: view({ accounts, lines: inRange.map((l) => toLine(l, l.month)), buckets: monthBuckets }),
    companies: view({ accounts, lines: inRange.map((l) => toLine(l, l.realmId)), buckets: companyBuckets }),
  };
}

/** Per-month revenue and net income as booked, for the trend charts. lines as above. */
export function monthlyPl(lines, months) {
  const out = Object.fromEntries(months.map((m) => [m, { revenue: 0, netIncome: 0 }]));
  for (const l of lines) {
    const o = out[l.month];
    if (!o) continue;
    if (l.grp === 'Income') { o.revenue += l.amount; o.netIncome += l.amount; } else if (l.grp === 'OtherIncome') o.netIncome += l.amount; else o.netIncome -= l.amount;
  }
  for (const o of Object.values(out)) { o.revenue = round2(o.revenue); o.netIncome = round2(o.netIncome); }
  return out;
}
