// Builds the P&L laid out on the chart of accounts: a tree of accounts (parent -> sub-accounts) with
// per-period amounts rolled up from pl_lines, grouped by classification and account type.
//
// Single office: nodes are keyed by account id and linked by ParentRef.
// Several offices: each company has its own ids, so nodes are merged by (account type, fully qualified
// name) and linked by the "Parent:Child" path. Amounts of same-named accounts are summed.

const round2 = (n) => Math.round(n * 100) / 100;

export const PL_CLASSIFICATIONS = ['Revenue', 'Expense'];
export const BALANCE_SHEET_CLASSIFICATIONS = ['Asset', 'Liability', 'Equity'];

// QBO account types in statement order, with the pl_lines group they correspond to.
export const ACCOUNT_TYPES = [
  { type: 'Income', classification: 'Revenue', grp: 'Income' },
  { type: 'Cost of Goods Sold', classification: 'Expense', grp: 'COGS' },
  { type: 'Expense', classification: 'Expense', grp: 'Expenses' },
  { type: 'Other Income', classification: 'Revenue', grp: 'OtherIncome' },
  { type: 'Other Expense', classification: 'Expense', grp: 'OtherExpenses' },
];
const TYPE_BY_GRP = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.grp, t]));
const TYPE_ORDER = Object.fromEntries(ACCOUNT_TYPES.map((t, i) => [t.type, i]));

function zeroPeriods(buckets) {
  return Object.fromEntries(buckets.map((b) => [b.key, 0]));
}

/**
 * @param accounts rows from the `accounts` table (already filtered to the selected offices)
 * @param lines    [{ realmId, accountId, accountName, grp, period (bucket key), amount }]
 * @param buckets  [{ key, label }]
 * @param merge    true when more than one office is involved
 */
export function buildCoaTree({ accounts, lines, buckets, merge, includeBalanceSheet = false }) {
  const nodes = new Map(); // key -> node
  const byOfficeId = new Map(); // `${realmId}|${accountId}` -> node key

  const keyOf = (a) => (merge ? `${a.account_type}|${a.fully_qualified_name}` : a.account_id);
  const parentKeyOf = (a) => {
    if (merge) {
      const i = a.fully_qualified_name.lastIndexOf(':');
      return i > 0 ? `${a.account_type}|${a.fully_qualified_name.slice(0, i)}` : null;
    }
    return a.parent_id || null;
  };

  for (const a of accounts) {
    if (!includeBalanceSheet && !PL_CLASSIFICATIONS.includes(a.classification)) continue;
    const key = keyOf(a);
    if (!nodes.has(key)) {
      nodes.set(key, {
        key,
        id: a.account_id,
        name: a.name,
        fqn: a.fully_qualified_name,
        accountType: a.account_type,
        accountSubType: a.account_sub_type,
        classification: a.classification,
        active: Boolean(a.active),
        currentBalance: a.current_balance ?? 0,
        offices: [],
        parentKey: parentKeyOf(a),
        own: zeroPeriods(buckets),
        periods: zeroPeriods(buckets),
        ownTotal: 0,
        total: 0,
        children: [],
      });
    }
    const n = nodes.get(key);
    n.offices.push(a.office_realm_id);
    if (merge) {
      n.active = n.active || Boolean(a.active);
      n.currentBalance = round2(n.currentBalance + (a.current_balance ?? 0));
    }
    byOfficeId.set(`${a.office_realm_id}|${a.account_id}`, key);
  }

  // Attach P&L amounts. Lines whose account is not in the chart (deleted account, synthetic id)
  // become "unmapped" leaves under their group's account type.
  const unmapped = new Map();
  for (const l of lines) {
    const key = byOfficeId.get(`${l.realmId}|${l.accountId}`);
    let n = key ? nodes.get(key) : null;
    if (!n) {
      const t = TYPE_BY_GRP[l.grp];
      if (!t) continue;
      const ukey = `unmapped|${t.type}|${l.accountName}`;
      if (!unmapped.has(ukey)) {
        unmapped.set(ukey, {
          key: ukey, id: null, name: l.accountName, fqn: l.accountName, accountType: t.type, accountSubType: null,
          classification: t.classification, active: true, currentBalance: 0, offices: [], parentKey: null, unmapped: true,
          own: zeroPeriods(buckets), periods: zeroPeriods(buckets), ownTotal: 0, total: 0, children: [],
        });
      }
      n = unmapped.get(ukey);
    }
    if (!(l.period in n.own)) continue;
    n.own[l.period] += l.amount;
    n.ownTotal += l.amount;
  }
  for (const u of unmapped.values()) nodes.set(u.key, u);

  // Link children; a missing parent (filtered out or absent) promotes the node to top level.
  const roots = [];
  for (const n of nodes.values()) {
    const p = n.parentKey ? nodes.get(n.parentKey) : null;
    if (p && p !== n) p.children.push(n);
    else roots.push(n);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  const rollup = (n, depth) => {
    n.depth = depth;
    n.children.sort(byName);
    for (const k of Object.keys(n.periods)) n.periods[k] = n.own[k];
    n.total = n.ownTotal;
    for (const c of n.children) {
      rollup(c, depth + 1);
      for (const k of Object.keys(n.periods)) n.periods[k] += c.periods[k];
      n.total += c.total;
    }
    n.hasActivity = n.total !== 0 || Object.values(n.periods).some((v) => v !== 0) || n.children.some((c) => c.hasActivity);
    for (const k of Object.keys(n.periods)) { n.periods[k] = round2(n.periods[k]); n.own[k] = round2(n.own[k]); }
    n.total = round2(n.total);
    n.ownTotal = round2(n.ownTotal);
    delete n.parentKey;
  };
  roots.sort(byName);
  for (const r of roots) rollup(r, 0);

  // Group roots: classification -> account type.
  const sumInto = (acc, n) => {
    for (const k of Object.keys(acc.periods)) acc.periods[k] = round2(acc.periods[k] + n.periods[k]);
    acc.total = round2(acc.total + n.total);
  };
  const sections = [];
  const sectionFor = (classification) => {
    let s = sections.find((x) => x.classification === classification);
    if (!s) {
      s = { classification, types: [], periods: zeroPeriods(buckets), total: 0, balance: 0 };
      sections.push(s);
    }
    return s;
  };
  for (const r of roots) {
    const s = sectionFor(r.classification || 'Other');
    let t = s.types.find((x) => x.accountType === r.accountType);
    if (!t) {
      t = { accountType: r.accountType, nodes: [], periods: zeroPeriods(buckets), total: 0, balance: 0 };
      s.types.push(t);
    }
    t.nodes.push(r);
    sumInto(t, r);
    sumInto(s, r);
    t.balance = round2(t.balance + r.currentBalance);
    s.balance = round2(s.balance + r.currentBalance);
  }
  const classOrder = [...PL_CLASSIFICATIONS, ...BALANCE_SHEET_CLASSIFICATIONS, 'Other'];
  sections.sort((a, b) => classOrder.indexOf(a.classification) - classOrder.indexOf(b.classification));
  for (const s of sections) {
    s.types.sort((a, b) => (TYPE_ORDER[a.accountType] ?? 99) - (TYPE_ORDER[b.accountType] ?? 99) || a.accountType.localeCompare(b.accountType));
  }

  const rev = sections.find((s) => s.classification === 'Revenue');
  const exp = sections.find((s) => s.classification === 'Expense');
  const netIncome = { periods: zeroPeriods(buckets), total: 0 };
  for (const k of Object.keys(netIncome.periods)) netIncome.periods[k] = round2((rev?.periods[k] || 0) - (exp?.periods[k] || 0));
  netIncome.total = round2((rev?.total || 0) - (exp?.total || 0));

  return {
    sections,
    netIncome,
    accountCount: nodes.size - unmapped.size,
    unmappedCount: unmapped.size,
  };
}
