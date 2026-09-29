import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export function openDb(file = config.dbPath) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pnl_rows (
      realm_id     TEXT NOT NULL,
      office_name  TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      period       TEXT NOT NULL,   -- YYYY-MM
      amount       REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pnl_realm_period ON pnl_rows (realm_id, period);

    CREATE TABLE IF NOT EXISTS sync_runs (
      realm_id    TEXT NOT NULL,
      office_name TEXT NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      row_count   INTEGER NOT NULL,
      synced_at   TEXT NOT NULL
    );
  `);
  return db;
}

/** Replace all rows for one company in a single transaction, so re-running sync is idempotent. */
export function replaceCompanyRows(db, realmId, officeName, rows, run) {
  const del = db.prepare('DELETE FROM pnl_rows WHERE realm_id = ?');
  const ins = db.prepare(
    `INSERT INTO pnl_rows (realm_id, office_name, account_name, account_type, period, amount)
     VALUES (@realm_id, @office_name, @account_name, @account_type, @period, @amount)`
  );
  const log = db.prepare(
    `INSERT INTO sync_runs (realm_id, office_name, start_date, end_date, row_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(realmId);
    for (const r of rows) ins.run({ ...r, realm_id: realmId, office_name: officeName });
    log.run(realmId, officeName, run.startDate, run.endDate, rows.length, new Date().toISOString());
  })();
}
