// Read helpers over the ledger built from raw QuickBooks records: P&L lines, month-end balances, direct
// cash flow, A/R and A/P aging from open invoices and bills, vendor spend, budgets and transactions.
import { rawAccounts, rawRecords, UNMAPPED_INCOME, UNMAPPED_EXPENSE, UNBALANCED } from './ledger.js';
import { addMonths, monthsBetween } from '../periods.js';

const round2 = (n) => Math.round(n * 100) / 100;
const list = (ids) => (ids.length ? `IN (${ids.map(() => '?').join(',')})` : "IN ('')");
const monthEnd = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

export const GRP_OF_TYPE = { Income: 'Income', 'Cost of Goods Sold': 'COGS', Expense: 'Expenses', 'Other Income': 'OtherIncome', 'Other Expense': 'OtherExpenses' };
export const SUB_OF_TYPE = {
  Bank: 'BankAccounts', 'Accounts Receivable': 'AR', 'Other Current Asset': 'OtherCurrentAssets', 'Fixed Asset': 'FixedAssets', 'Other Asset': 'OtherAssets',
  'Accounts Payable': 'AP', 'Credit Card': 'CreditCards', 'Other Current Liability': 'OtherCurrentLiabilities', 'Long Term Liability': 'LongTermLiabilities', Equity: 'Equity',
};
const SYNTHETIC = {
  [UNMAPPED_INCOME]: { id: UNMAPPED_INCOME, name: 'Income without an account', fullName: 'Income without an account', type: 'Income', subType: null },
  [UNMAPPED_EXPENSE]: { id: UNMAPPED_EXPENSE, name: 'Expense without an account', fullName: 'Expense without an account', type: 'Expense', subType: null },
};

/** Account metadata per company (raw Account records), cached for one request. */
export function accountBook(db) {
  const cache = {};
  return (realmId) => (cache[realmId] ||= { ...rawAccounts(db, realmId), ...SYNTHETIC });
}

/**
 * P&L lines from the ledger in the shape the tabs use:
 * { realmId, month, grp, accountId, account, fullName, subType, amount } with income and expenses both positive.
 */
export function ledgerPl(db, ids, from, to, book = accountBook(db)) {
  const rows = db.prepare(`SELECT realm_id AS realmId, substr(txn_date, 1, 7) AS month, account_id AS accountId, SUM(amount) AS amount
    FROM ledger WHERE realm_id ${list(ids)} AND substr(txn_date, 1, 7) BETWEEN ? AND ? GROUP BY realm_id, month, account_id`).all(...ids, from, to);
  const out = [];
  for (const r of rows) {
    const a = book(r.realmId)[r.accountId];
    const grp = a && GRP_OF_TYPE[a.type];
    if (!grp) continue;
    const amount = grp === 'Income' || grp === 'OtherIncome' ? -r.amount : r.amount;
    if (Math.abs(amount) < 0.005) continue;
    out.push({ realmId: r.realmId, month: r.month, grp, accountId: r.accountId, account: a.name, fullName: a.fullName, subType: a.subType, amount: round2(amount) });
  }
  return out;
}

/**
 * Month-end balance sheet per company and month: { realmId: { month: { subsection: amount, ... } } } plus per-account
 * detail for debt matching. Assets positive, liabilities and equity positive; equity includes retained earnings.
 */
export function ledgerBalances(db, ids, months, book = accountBook(db), isDebt = () => false) {
  if (!months.length) return {};
  const last = monthEnd(months.at(-1));
  const rows = db.prepare(`SELECT realm_id AS realmId, account_id AS accountId, substr(txn_date, 1, 7) AS month, SUM(amount) AS amount
    FROM ledger WHERE realm_id ${list(ids)} AND txn_date <= ? GROUP BY realm_id, account_id, month ORDER BY month`).all(...ids, last);
  const out = {};
  for (const id of ids) {
    const mine = rows.filter((r) => r.realmId === id);
    if (!mine.length) continue;
    const acc = book(id);
    const running = {}; // accountId -> cumulative debit balance
    let i = 0;
    out[id] = {};
    for (const m of months) {
      while (i < mine.length && mine[i].month <= m) { running[mine[i].accountId] = (running[mine[i].accountId] || 0) + mine[i].amount; i++; }
      const s = { cash: 0, ar: 0, otherCurrentAssets: 0, fixedAssets: 0, otherAssets: 0, ap: 0, creditCards: 0, otherCurrentLiabilities: 0, longTermLiabilities: 0, equity: 0, debt: 0 };
      const KEY = { BankAccounts: 'cash', AR: 'ar', OtherCurrentAssets: 'otherCurrentAssets', FixedAssets: 'fixedAssets', OtherAssets: 'otherAssets', AP: 'ap', CreditCards: 'creditCards', OtherCurrentLiabilities: 'otherCurrentLiabilities', LongTermLiabilities: 'longTermLiabilities', Equity: 'equity' };
      let any = false;
      for (const [aid, bal] of Object.entries(running)) {
        if (!bal) continue;
        const a = acc[aid];
        if (!a) continue;
        any = true;
        const sub = SUB_OF_TYPE[a.type];
        if (sub) {
          const v = sub === 'BankAccounts' || sub === 'AR' || sub === 'OtherCurrentAssets' || sub === 'FixedAssets' || sub === 'OtherAssets' ? bal : -bal;
          s[KEY[sub]] += v;
          if (!['BankAccounts', 'AR', 'OtherCurrentAssets', 'FixedAssets', 'OtherAssets', 'Equity'].includes(sub) && isDebt(sub, a.name)) s.debt += v;
        } else if (GRP_OF_TYPE[a.type]) {
          s.equity += -bal; // cumulative profit (retained earnings + current year) belongs to equity
        }
      }
      if (any) out[id][m] = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round2(v)]));
    }
  }
  return out;
}

/**
 * Direct-method cash flow by month: for every transaction that moves a bank account, the cash change is split by
 * what the other side of the transaction was (operating: income, expenses, receivables, payables, cards, other
 * current items; investing: fixed and other assets; financing: long-term liabilities, equity, loans).
 */
export function ledgerCashFlow(db, ids, from, to, book = accountBook(db), isDebt = () => false) {
  const rows = db.prepare(`SELECT realm_id AS realmId, txn_type AS t, txn_id AS id, substr(txn_date, 1, 7) AS month, account_id AS accountId, amount
    FROM ledger WHERE realm_id ${list(ids)} AND substr(txn_date, 1, 7) BETWEEN ? AND ?`).all(...ids, from, to);
  const txns = new Map();
  for (const r of rows) {
    const k = `${r.realmId}|${r.t}|${r.id}`;
    if (!txns.has(k)) txns.set(k, []);
    txns.get(k).push(r);
  }
  const out = {}; // realm -> month -> { operating, investing, financing }
  for (const lines of txns.values()) {
    const acc = book(lines[0].realmId);
    const bank = lines.filter((l) => acc[l.accountId]?.type === 'Bank');
    const change = bank.reduce((t, l) => t + l.amount, 0);
    if (Math.abs(change) < 0.005) continue; // no cash moved (or a transfer between banks)
    const slot = ((out[lines[0].realmId] ||= {})[lines[0].month] ||= { operating: 0, investing: 0, financing: 0, loans: 0 });
    for (const l of lines) {
      const a = acc[l.accountId];
      if (a?.type === 'Bank') continue;
      const sub = a ? SUB_OF_TYPE[a.type] : null;
      const cat = sub === 'FixedAssets' || sub === 'OtherAssets' ? 'investing'
        : sub === 'LongTermLiabilities' || sub === 'Equity' || (sub === 'OtherCurrentLiabilities' && isDebt(sub, a.name)) ? 'financing' : 'operating';
      slot[cat] += -l.amount;
      if (cat === 'financing' && sub !== 'Equity') slot.loans += -l.amount; // the loan part of financing (borrowings and repayments), without owner money
    }
  }
  for (const r of Object.values(out)) for (const m of Object.values(r)) for (const k of Object.keys(m)) m[k] = round2(m[k]);
  return out;
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '91+'];
const bucketFor = (days) => (days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '91+');

/** Open balances by customer (ar) or vendor (ap), aged by days past due as of `asOf` (YYYY-MM-DD). */
export function rawAging(db, ids, kind, asOf) {
  const [docs, credits, partyKey] = kind === 'ar' ? [['Invoice'], ['CreditMemo', 'Payment'], 'CustomerRef'] : [['Bill'], ['VendorCredit'], 'VendorRef'];
  const out = [];
  const t0 = Date.parse(asOf);
  for (const id of ids) {
    for (const e of docs) {
      for (const r of rawRecords(db, id, e)) {
        const bal = Number(r.Balance) || 0;
        if (Math.abs(bal) < 0.005) continue;
        const due = r.DueDate || r.TxnDate;
        const days = Math.floor((t0 - Date.parse(due)) / 86400_000);
        out.push({ realmId: id, party: r[partyKey]?.name || 'No name recorded', bucket: bucketFor(days), amount: round2(bal), docNum: r.DocNumber || null, due });
      }
    }
    // Unapplied credits reduce what is owed (shown as current).
    for (const e of credits) {
      for (const r of rawRecords(db, id, e)) {
        const open = e === 'Payment' ? Number(r.UnappliedAmt) || 0 : Number(r.Balance ?? r.RemainingCredit) || 0;
        if (Math.abs(open) < 0.005) continue;
        out.push({ realmId: id, party: r[partyKey]?.name || 'No name recorded', bucket: 'current', amount: -round2(open), docNum: r.DocNumber || null, due: r.TxnDate });
      }
    }
  }
  return out;
}

/** Spend by vendor and month: P&L postings (debit side) on vendor transactions, by payee; no payee = "No vendor recorded". Matches QuickBooks' Expenses by Vendor. */
export function ledgerVendorSpend(db, ids, from, to, book = accountBook(db)) {
  const rows = db.prepare(`SELECT realm_id AS realmId, substr(txn_date, 1, 7) AS month, account_id AS accountId, entity_type AS et, entity_name AS name, SUM(amount) AS amount
    FROM ledger WHERE realm_id ${list(ids)} AND substr(txn_date, 1, 7) BETWEEN ? AND ? GROUP BY realm_id, month, account_id, entity_type, entity_name`).all(...ids, from, to);
  const out = [];
  for (const r of rows) {
    const a = book(r.realmId)[r.accountId];
    const grp = a && GRP_OF_TYPE[a.type];
    if (!grp) continue;
    if (r.et && r.et !== 'Vendor') continue;
    if ((grp === 'Income' || grp === 'OtherIncome') && !r.et) continue; // customer income without a payee is not spend // customers / employees are not vendors
    out.push({ realmId: r.realmId, month: r.month, vendor: r.name || 'No vendor recorded', amount: r.amount });
  }
  return out;
}

/** Active P&L budget lines from raw Budget records: { realmId, budgetId, budgetName, accountId, month, amount }. */
export function rawBudgets(db, ids, from, to) {
  const out = [];
  for (const id of ids) {
    for (const b of rawRecords(db, id, 'Budget')) {
      if (b.Active === false || (b.BudgetType && b.BudgetType !== 'ProfitAndLoss')) continue;
      const acc = {};
      for (const d of b.BudgetDetail || []) {
        const month = String(d.BudgetDate || '').slice(0, 7);
        if (!d.AccountRef?.value || month < from || month > to) continue;
        const k = `${d.AccountRef.value}|${month}`;
        acc[k] = (acc[k] || 0) + (Number(d.Amount) || 0); // class / customer / location splits summed
      }
      for (const [k, amount] of Object.entries(acc)) {
        const [accountId, month] = k.split('|');
        if (amount) out.push({ realmId: id, budgetId: String(b.Id), budgetName: b.Name || `Budget ${b.Id}`, accountId, month, amount: round2(amount) });
      }
    }
  }
  return out;
}

/** Ledger lines of some accounts (P&L sign for income accounts), newest first. */
export function ledgerTransactions(db, realmId, accountIds, from, to, book = accountBook(db)) {
  const acc = book(realmId);
  return db.prepare(`SELECT txn_date AS date, txn_type AS type, txn_id AS txnId, doc_num AS num, entity_name AS name, memo, account_id AS accountId, amount
    FROM ledger WHERE realm_id = ? AND account_id ${list(accountIds)} AND substr(txn_date, 1, 7) BETWEEN ? AND ? ORDER BY txn_date DESC, txn_id`).all(realmId, ...accountIds, from, to)
    .map((r) => {
      const grp = GRP_OF_TYPE[acc[r.accountId]?.type];
      return { ...r, type: r.type.replace(/([a-z])([A-Z])/g, '$1 $2'), amount: round2(grp === 'Income' || grp === 'OtherIncome' ? -r.amount : r.amount) };
    });
}

/**
 * Data check per company, from raw data only: ledger balance of every balance sheet account vs the CurrentBalance
 * QuickBooks returns on the Account record, plus pull status.
 */
export function rawStatus(db, ids, book = accountBook(db)) {
  return ids.map((id) => {
    const st = db.prepare('SELECT MIN(last_full_at) AS full, MAX(last_cdc_at) AS cdc, SUM(records) AS records, SUM(status = \'error\') AS errors, GROUP_CONCAT(CASE WHEN status = \'error\' THEN entity || \': \' || message END, \' | \') AS messages FROM qbo_raw_state WHERE realm_id = ?').get(id);
    const ls = db.prepare('SELECT * FROM ledger_status WHERE realm_id = ?').get(id);
    if (!st?.records && !ls) return { realmId: id, pulled: false };
    const acc = book(id);
    const bal = Object.fromEntries(db.prepare('SELECT account_id AS a, SUM(amount) AS s FROM ledger WHERE realm_id = ? GROUP BY account_id').all(id).map((r) => [r.a, r.s]));
    let match = 0; let differ = 0;
    const diffs = [];
    for (const a of Object.values(acc)) {
      if (!SUB_OF_TYPE[a.type] || a.currentBalance == null || a.id.startsWith('__')) continue;
      const ours = bal[a.id] || 0;
      if (Math.abs(ours - Number(a.currentBalance)) < 0.02) match++;
      else { differ++; diffs.push({ account: a.fullName, ledger: round2(ours), quickbooks: Number(a.currentBalance) }); }
    }
    return {
      realmId: id, pulled: true, records: st.records || 0, lastFull: st.full, lastChange: st.cdc, errors: st.errors || 0, errorMessages: st.messages || null,
      ledger: ls ? { builtAt: ls.built_at, txns: ls.txns, lines: ls.lines, unbalanced: ls.unbalanced, unmapped: ls.unmapped } : null,
      balances: { match, differ, diffs: diffs.slice(0, 10) },
    };
  });
}

export { monthEnd, UNBALANCED };
export const prevMonth = (m) => addMonths(m, -1);
export const monthsIn = monthsBetween;
