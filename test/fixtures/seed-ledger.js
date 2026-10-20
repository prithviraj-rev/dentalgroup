// Test helper: seeds raw QuickBooks Account records and ledger lines for a company, so the newer tabs'
// code (which reads the raw ledger) can be tested without pulling from QuickBooks.
import { initRawSchema } from '../../server/raw/sync.js';
import { initLedgerSchema } from '../../server/raw/ledger.js';

const TYPE_OF_GRP = { Income: 'Income', COGS: 'Cost of Goods Sold', Expenses: 'Expense', OtherIncome: 'Other Income', OtherExpenses: 'Other Expense' };
const CREDIT = new Set(['Income', 'Other Income']);

/**
 * lines: [accountId, accountName, grp (Income | COGS | Expenses | OtherIncome | OtherExpenses), month, amount (income and expenses positive), subType?]
 */
export function seedLedger(db, realmId, lines) {
  initRawSchema(db);
  initLedgerSchema(db);
  const accounts = new Map();
  for (const [id, name, grp, , , subType] of lines) accounts.set(id, { Id: id, Name: name, FullyQualifiedName: name, AccountType: TYPE_OF_GRP[grp], AccountSubType: subType || null, Active: true });
  const insRaw = db.prepare(`INSERT OR REPLACE INTO qbo_raw (realm_id, entity, id, json, fetched_at) VALUES (?, 'Account', ?, ?, ?)`);
  for (const a of accounts.values()) insRaw.run(realmId, a.Id, JSON.stringify(a), new Date().toISOString());
  const ins = db.prepare(`INSERT INTO ledger (realm_id, txn_type, txn_id, line, txn_date, account_id, amount) VALUES (?, 'JournalEntry', ?, 1, ?, ?, ?)`);
  lines.forEach(([id, , grp, month, amount], i) => ins.run(realmId, `t${i}`, `${month}-15`, id, CREDIT.has(TYPE_OF_GRP[grp]) ? -amount : amount));
}
