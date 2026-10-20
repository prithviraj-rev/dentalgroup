// Builds a double-entry ledger from the raw QuickBooks records in qbo_raw (accrual basis).
// One row per posting: account, date, amount (debit positive, credit negative), customer / vendor, class,
// location. Every transaction is balanced; anything that cannot be balanced is posted to a visible
// "unbalanced" line and counted, so data problems show instead of silently changing totals.
//
// Postings per transaction type:
//   Invoice        Cr income per line (item income account), Dr discounts, Cr sales tax, Dr A/R total
//   SalesReceipt   as Invoice, Dr deposit account (or Undeposited Funds) instead of A/R
//   CreditMemo     reverse of Invoice          RefundReceipt  reverse of SalesReceipt
//   Payment        Dr deposit account / Undeposited Funds, Cr A/R
//   Deposit        Dr bank, Cr each line's account (Undeposited Funds for linked payments), Dr cash back
//   Bill           Dr expense per line (account or item expense/asset account), Cr A/P
//   VendorCredit   reverse of Bill
//   Purchase       Dr expense per line, Cr bank / credit card (reversed when Credit = true)
//   BillPayment    Dr A/P, Cr bank or credit card
//   JournalEntry   each line as posted        Transfer  Dr to-account, Cr from-account
// Not available from the API: QuickBooks Payroll paychecks and inventory cost postings (COGS on
// inventory items). Payroll run elsewhere (journal entries) is included.

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const ref = (r) => (r && r.value != null ? String(r.value) : null);

export const UNBALANCED = '__unbalanced';
export const UNMAPPED_INCOME = '__unmapped_income';
export const UNMAPPED_EXPENSE = '__unmapped_expense';

/** Raw records of one entity for a company, parsed. */
export function rawRecords(db, realmId, entity) {
  return db.prepare('SELECT json FROM qbo_raw WHERE realm_id = ? AND entity = ?').all(realmId, entity).map((r) => JSON.parse(r.json));
}

/** Accounts of a company from the raw Account records: id -> { id, name, fullName, type, subType, classification, active }. */
export function rawAccounts(db, realmId) {
  const out = {};
  for (const a of rawRecords(db, realmId, 'Account')) {
    out[String(a.Id)] = { id: String(a.Id), name: a.Name, fullName: a.FullyQualifiedName || a.Name, type: a.AccountType || '', subType: a.AccountSubType || null, classification: a.Classification || null, active: a.Active !== false, currentBalance: a.CurrentBalance ?? null };
  }
  return out;
}

function defaults(accounts) {
  const list = Object.values(accounts);
  const pick = (f) => list.filter(f).sort((a, b) => Number(b.active) - Number(a.active) || Number(a.id) - Number(b.id))[0]?.id || null;
  return {
    ar: pick((a) => a.type === 'Accounts Receivable'),
    ap: pick((a) => a.type === 'Accounts Payable'),
    undeposited: pick((a) => a.subType === 'UndepositedFunds') || pick((a) => /undeposited/i.test(a.name)),
    salesTax: pick((a) => ['GlobalTaxPayable', 'SalesTaxPayable'].includes(a.subType)) || pick((a) => /sales tax/i.test(a.name) && a.classification === 'Liability'),
    discounts: pick((a) => a.subType === 'DiscountsRefundsGiven') || pick((a) => /discount/i.test(a.name) && a.classification === 'Revenue'),
    income: pick((a) => /uncategori[sz]ed income/i.test(a.name)) || UNMAPPED_INCOME,
    expense: pick((a) => /uncategori[sz]ed expense/i.test(a.name)) || UNMAPPED_EXPENSE,
  };
}

/** Postings for one transaction. ctx: { accounts, items, d (default accounts) }. */
export function postingsFor(entity, rec, ctx) {
  const { items, d } = ctx;
  const fx = num(rec.ExchangeRate) || 1;
  const out = [];
  const head = {
    txnDate: rec.TxnDate, docNum: rec.DocNumber || null, memo: rec.PrivateNote || null, department: ref(rec.DepartmentRef),
  };
  const party = (r, type) => (r && r.value != null ? { entityType: type, entityId: String(r.value), entityName: r.name || null } : {});
  const post = (account, amount, extra = {}) => {
    const a = round2(amount * fx);
    if (!a) return;
    out.push({ ...head, account: account || null, amount: a, line: out.length + 1, ...extra });
  };

  // Sales lines (with nested group lines): [{ account, amount, kind: 'sale' | 'discount', cls }]
  const salesLines = (lines) => {
    const res = [];
    for (const l of lines || []) {
      const t = l.DetailType;
      if (t === 'SalesItemLineDetail') {
        const dd = l.SalesItemLineDetail || {};
        res.push({ kind: 'sale', amount: num(l.Amount), account: ref(dd.ItemAccountRef) || items[ref(dd.ItemRef)]?.income || null, cls: ref(dd.ClassRef), memo: l.Description || null, item: items[ref(dd.ItemRef)] || null, qty: num(dd.Qty) });
      } else if (t === 'DiscountLineDetail') {
        const dd = l.DiscountLineDetail || {};
        res.push({ kind: 'discount', amount: num(l.Amount), account: ref(dd.DiscountAccountRef) || d.discounts, cls: ref(dd.ClassRef) });
      } else if (t === 'GroupLineDetail') {
        res.push(...salesLines(l.GroupLineDetail?.Line));
      } else if (t === 'SubTotalLineDetail') {
        res.push({ kind: 'subtotal', amount: num(l.Amount) });
      }
    }
    return res;
  };
  // Expense lines: [{ account, amount, cls, billable party }]
  const expenseLines = (lines) => (lines || []).flatMap((l) => {
    if (l.DetailType === 'AccountBasedExpenseLineDetail') {
      const dd = l.AccountBasedExpenseLineDetail || {};
      return [{ account: ref(dd.AccountRef), amount: num(l.Amount), cls: ref(dd.ClassRef), memo: l.Description || null }];
    }
    if (l.DetailType === 'ItemBasedExpenseLineDetail') {
      const dd = l.ItemBasedExpenseLineDetail || {};
      const it = items[ref(dd.ItemRef)] || {};
      return [{ account: it.asset || it.expense || null, amount: num(l.Amount), cls: ref(dd.ClassRef), memo: l.Description || null }];
    }
    return [];
  });

  /** sign +1 = normal sale (credit income), -1 = refund / credit memo. debitAccount: A/R or bank. */
  const sale = (sign, debitAccount, who) => {
    const lines = salesLines(rec.Line);
    const hasItems = lines.some((l) => l.kind === 'sale');
    for (const l of lines) {
      if (l.kind === 'sale') {
        post(l.account || d.income, -sign * l.amount, { cls: l.cls, memo: l.memo || head.memo, ...who });
      } else if (l.kind === 'discount') post(l.account || d.income, sign * l.amount, { cls: l.cls, ...who });
      else if (l.kind === 'subtotal' && !hasItems) post(d.income, -sign * l.amount, who); // record returned without item lines
    }
    // Sales tax to each agency's liability account when the rate is known.
    const taxLines = (rec.TxnTaxDetail?.TaxLine || []).filter((t) => t.TaxLineDetail && num(t.Amount));
    if (taxLines.length) for (const t of taxLines) post(ctx.taxAccount(ref(t.TaxLineDetail.TaxRateRef)) || d.salesTax || d.income, -sign * num(t.Amount), who);
    else if (num(rec.TxnTaxDetail?.TotalTax)) post(d.salesTax || d.income, -sign * num(rec.TxnTaxDetail.TotalTax), who);
    post(debitAccount, sign * num(rec.TotalAmt), who);
  };
  const bill = (sign, creditAccount, who) => {
    for (const l of expenseLines(rec.Line)) post(l.account || d.expense, sign * l.amount, { cls: l.cls, memo: l.memo || head.memo, ...who });
    post(creditAccount, -sign * num(rec.TotalAmt), who);
  };

  switch (entity) {
    case 'Invoice': sale(1, ref(rec.ARAccountRef) || d.ar, party(rec.CustomerRef, 'Customer')); break;
    case 'SalesReceipt': sale(1, ref(rec.DepositToAccountRef) || d.undeposited, party(rec.CustomerRef, 'Customer')); break;
    case 'CreditMemo': sale(-1, ref(rec.ARAccountRef) || d.ar, party(rec.CustomerRef, 'Customer')); break;
    case 'RefundReceipt': sale(-1, ref(rec.DepositToAccountRef) || d.undeposited, party(rec.CustomerRef, 'Customer')); break;
    case 'Payment': {
      const who = party(rec.CustomerRef, 'Customer');
      post(ref(rec.DepositToAccountRef) || d.undeposited, num(rec.TotalAmt), who);
      post(ref(rec.ARAccountRef) || d.ar, -num(rec.TotalAmt), who);
      break;
    }
    case 'Deposit': {
      post(ref(rec.DepositToAccountRef), num(rec.TotalAmt));
      for (const l of rec.Line || []) {
        const dd = l.DepositLineDetail;
        const who = dd?.Entity ? party(dd.Entity, dd.Entity.type || null) : {};
        if (dd?.AccountRef) post(ref(dd.AccountRef), -num(l.Amount), { cls: ref(dd.ClassRef), memo: l.Description || head.memo, ...who });
        else if (l.LinkedTxn?.length) post(d.undeposited, -num(l.Amount), who);
      }
      if (rec.CashBack?.AccountRef) post(ref(rec.CashBack.AccountRef), num(rec.CashBack.Amount));
      break;
    }
    case 'Bill': bill(1, ref(rec.APAccountRef) || d.ap, party(rec.VendorRef, 'Vendor')); break;
    case 'VendorCredit': bill(-1, ref(rec.APAccountRef) || d.ap, party(rec.VendorRef, 'Vendor')); break;
    case 'Purchase': bill(rec.Credit === true ? -1 : 1, ref(rec.AccountRef), party(rec.EntityRef, rec.EntityRef?.type || null)); break;
    case 'BillPayment': {
      const who = party(rec.VendorRef, 'Vendor');
      post(ref(rec.APAccountRef) || d.ap, num(rec.TotalAmt), who);
      post(ref(rec.CheckPayment?.BankAccountRef) || ref(rec.CreditCardPayment?.CCAccountRef), -num(rec.TotalAmt), who);
      break;
    }
    case 'JournalEntry':
      for (const l of rec.Line || []) {
        const dd = l.JournalEntryLineDetail;
        if (!dd) continue;
        const who = dd.Entity?.EntityRef ? party(dd.Entity.EntityRef, dd.Entity.Type || null) : {};
        post(ref(dd.AccountRef), (dd.PostingType === 'Credit' ? -1 : 1) * num(l.Amount), { cls: ref(dd.ClassRef), department: ref(dd.DepartmentRef) || head.department, memo: l.Description || head.memo, ...who });
      }
      break;
    case 'Transfer':
      post(ref(rec.ToAccountRef), num(rec.Amount));
      post(ref(rec.FromAccountRef), -num(rec.Amount));
      break;
    default:
      return [];
  }
  // Balance check: anything left over goes to a visible unbalanced line.
  const diff = round2(out.reduce((t, p) => t + p.amount, 0));
  if (Math.abs(diff) >= 0.01) out.push({ ...head, account: UNBALANCED, amount: -diff, line: out.length + 1 });
  for (const p of out) if (!p.account) p.account = UNBALANCED;
  return out;
}

export const POSTING_ENTITIES = ['Invoice', 'SalesReceipt', 'CreditMemo', 'RefundReceipt', 'Payment', 'Deposit', 'Bill', 'VendorCredit', 'Purchase', 'BillPayment', 'JournalEntry', 'Transfer'];

export function initLedgerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      realm_id      TEXT NOT NULL,
      txn_type      TEXT NOT NULL,
      txn_id        TEXT NOT NULL,
      line          INTEGER NOT NULL,
      txn_date      TEXT NOT NULL,     -- YYYY-MM-DD
      account_id    TEXT NOT NULL,
      amount        REAL NOT NULL,     -- debit positive, credit negative
      entity_type   TEXT,              -- Customer | Vendor | Employee
      entity_id     TEXT,
      entity_name   TEXT,
      class_id      TEXT,
      department_id TEXT,
      doc_num       TEXT,
      memo          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger (realm_id, txn_date);
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger (realm_id, account_id, txn_date);
    CREATE TABLE IF NOT EXISTS ledger_status (
      realm_id    TEXT PRIMARY KEY,
      built_at    TEXT NOT NULL,
      txns        INTEGER NOT NULL,
      lines       INTEGER NOT NULL,
      unbalanced  INTEGER NOT NULL,    -- transactions that needed a balancing line
      unmapped    INTEGER NOT NULL     -- lines whose account could not be resolved
    );
  `);
}

/** Rebuild one company's ledger from its raw records. Returns the number of ledger lines. */
export function buildLedger(db, realmId) {
  initLedgerSchema(db);
  const accounts = rawAccounts(db, realmId);
  const items = {};
  for (const it of rawRecords(db, realmId, 'Item')) {
    const inventory = it.Type === 'Inventory';
    items[String(it.Id)] = { income: ref(it.IncomeAccountRef), expense: ref(it.ExpenseAccountRef), asset: inventory ? ref(it.AssetAccountRef) : null, inventory, cost: num(it.PurchaseCost), cogs: inventory ? ref(it.ExpenseAccountRef) : null };
  }
  // Tax rate -> agency -> the agency's liability account ("<Agency> Payable").
  const agencies = Object.fromEntries(rawRecords(db, realmId, 'TaxAgency').map((a) => [String(a.Id), a.DisplayName || '']));
  const byName = Object.fromEntries(Object.values(accounts).map((a) => [a.name.toLowerCase(), a.id]));
  const rateAccount = {};
  for (const r of rawRecords(db, realmId, 'TaxRate')) {
    const agency = agencies[ref(r.AgencyRef)];
    if (agency) rateAccount[String(r.Id)] = byName[`${agency.toLowerCase()} payable`] || null;
  }
  const ctx = { accounts, items, d: defaults(accounts), taxAccount: (id) => rateAccount[id] || null };
  const ins = db.prepare(`INSERT INTO ledger (realm_id, txn_type, txn_id, line, txn_date, account_id, amount, entity_type, entity_id, entity_name, class_id, department_id, doc_num, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let lines = 0; let txns = 0; let unbalanced = 0; let unmapped = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM ledger WHERE realm_id = ?').run(realmId);
    for (const entity of POSTING_ENTITIES) {
      for (const row of db.prepare('SELECT id, json FROM qbo_raw WHERE realm_id = ? AND entity = ?').all(realmId, entity)) {
        const rec = JSON.parse(row.json);
        if (!rec.TxnDate) continue;
        const ps = postingsFor(entity, rec, ctx);
        if (!ps.length) continue;
        txns++;
        if (ps.some((p) => p.account === UNBALANCED)) unbalanced++;
        for (const p of ps) {
          if (p.account === UNMAPPED_INCOME || p.account === UNMAPPED_EXPENSE) unmapped++;
          ins.run(realmId, entity, row.id, p.line, p.txnDate, p.account, p.amount, p.entityType || null, p.entityId || null, p.entityName || null, p.cls || null, p.department || null, p.docNum, p.memo);
          lines++;
        }
      }
    }
    db.prepare('INSERT OR REPLACE INTO ledger_status (realm_id, built_at, txns, lines, unbalanced, unmapped) VALUES (?, ?, ?, ?, ?, ?)').run(realmId, new Date().toISOString(), txns, lines, unbalanced, unmapped);
  })();
  return lines;
}
