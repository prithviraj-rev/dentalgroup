import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      realm_id                 TEXT PRIMARY KEY,
      company_name             TEXT NOT NULL,
      access_token             TEXT NOT NULL,
      refresh_token            TEXT NOT NULL,
      expires_at               TEXT NOT NULL,   -- ISO timestamp, access token expiry
      refresh_token_expires_at TEXT,            -- ISO timestamp (~100 days)
      connected_at             TEXT NOT NULL,
      updated_at               TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pl_lines (
      office_realm_id TEXT NOT NULL,
      office_name     TEXT NOT NULL,
      account_name    TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      grp             TEXT NOT NULL,   -- Income | COGS | Expenses | OtherIncome | OtherExpenses
      period_start    TEXT NOT NULL,   -- YYYY-MM-DD from the column MetaData
      period_end      TEXT NOT NULL,
      amount          REAL NOT NULL,
      UNIQUE (office_realm_id, account_id, period_start)
    );
    CREATE INDEX IF NOT EXISTS idx_pl_lines_period ON pl_lines (period_start, office_realm_id);

    -- Chart of accounts per company (QBO Account entity), refreshed on every sync.
    CREATE TABLE IF NOT EXISTS accounts (
      office_realm_id      TEXT NOT NULL,
      office_name          TEXT NOT NULL,
      account_id           TEXT NOT NULL,
      name                 TEXT NOT NULL,
      fully_qualified_name TEXT NOT NULL,   -- Parent:Child:Grandchild
      account_type         TEXT NOT NULL,   -- Income | Cost of Goods Sold | Expense | Other Income | Other Expense | Bank | ...
      account_sub_type     TEXT,
      classification       TEXT,            -- Revenue | Expense | Asset | Liability | Equity
      parent_id            TEXT,
      sub_account          INTEGER NOT NULL DEFAULT 0,
      active               INTEGER NOT NULL DEFAULT 1,
      current_balance      REAL,
      currency             TEXT,
      synced_at            TEXT NOT NULL,
      PRIMARY KEY (office_realm_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      realm_id     TEXT NOT NULL,
      company_name TEXT,
      status       TEXT NOT NULL,     -- success | error
      row_count    INTEGER,
      message      TEXT,
      start_date   TEXT,
      end_date     TEXT,
      started_at   TEXT NOT NULL,
      finished_at  TEXT NOT NULL
    );
  `);
  return db;
}

/**
 * Upsert one company's flattened P&L rows. Rows for that company inside the synced
 * date window that no longer appear in the report are removed, so a re-sync never
 * leaves stale months behind. Unique key: (office_realm_id, account_id, period_start).
 */
export function upsertPlLines(db, realmId, officeName, rows, { startDate, endDate }) {
  const del = db.prepare(
    `DELETE FROM pl_lines WHERE office_realm_id = ? AND period_start >= ? AND period_start <= ?`
  );
  const ins = db.prepare(`
    INSERT INTO pl_lines (office_realm_id, office_name, account_name, account_id, grp, period_start, period_end, amount)
    VALUES (@office_realm_id, @office_name, @account_name, @account_id, @grp, @period_start, @period_end, @amount)
    ON CONFLICT (office_realm_id, account_id, period_start) DO UPDATE SET
      office_name  = excluded.office_name,
      account_name = excluded.account_name,
      grp          = excluded.grp,
      period_end   = excluded.period_end,
      amount       = excluded.amount
  `);
  const tx = db.transaction(() => {
    del.run(realmId, startDate, endDate);
    for (const r of rows) ins.run({ ...r, office_realm_id: realmId, office_name: officeName });
  });
  tx();
  return rows.length;
}

/** Replace one company's chart of accounts with the list from QBO (Account entities). */
export function replaceAccounts(db, realmId, officeName, qboAccounts) {
  const now = new Date().toISOString();
  const del = db.prepare('DELETE FROM accounts WHERE office_realm_id = ?');
  const ins = db.prepare(`
    INSERT INTO accounts (office_realm_id, office_name, account_id, name, fully_qualified_name, account_type, account_sub_type,
                          classification, parent_id, sub_account, active, current_balance, currency, synced_at)
    VALUES (@office_realm_id, @office_name, @account_id, @name, @fully_qualified_name, @account_type, @account_sub_type,
            @classification, @parent_id, @sub_account, @active, @current_balance, @currency, @synced_at)
  `);
  db.transaction(() => {
    del.run(realmId);
    for (const a of qboAccounts) {
      ins.run({
        office_realm_id: realmId,
        office_name: officeName,
        account_id: String(a.Id),
        name: a.Name,
        fully_qualified_name: a.FullyQualifiedName || a.Name,
        account_type: a.AccountType || '',
        account_sub_type: a.AccountSubType || null,
        classification: a.Classification || null,
        parent_id: a.ParentRef?.value != null ? String(a.ParentRef.value) : null,
        sub_account: a.SubAccount ? 1 : 0,
        active: a.Active === false ? 0 : 1,
        current_balance: a.CurrentBalance ?? null,
        currency: a.CurrencyRef?.value || null,
        synced_at: now,
      });
    }
  })();
  return qboAccounts.length;
}

export function logSync(db, entry) {
  db.prepare(`
    INSERT INTO sync_logs (realm_id, company_name, status, row_count, message, start_date, end_date, started_at, finished_at)
    VALUES (@realm_id, @company_name, @status, @row_count, @message, @start_date, @end_date, @started_at, @finished_at)
  `).run({
    row_count: null,
    message: null,
    company_name: null,
    start_date: null,
    end_date: null,
    ...entry,
  });
}
