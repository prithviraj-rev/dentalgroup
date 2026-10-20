// Practice KPIs imported from practice-management systems. (Everything QuickBooks-related for the newer
// tabs lives in server/raw: raw records in qbo_raw and the ledger built from them.)

export function initFinanceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS practice_kpis (
      office_realm_id TEXT NOT NULL,
      month           TEXT NOT NULL,   -- YYYY-MM
      metric          TEXT NOT NULL,
      value           REAL NOT NULL,
      source          TEXT,
      imported_at     TEXT NOT NULL,
      UNIQUE (office_realm_id, month, metric)
    );
  `);
}
