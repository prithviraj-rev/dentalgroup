// Raw QuickBooks data: every record of the configured entities, pulled from the Accounting API (query
// endpoint for full pulls, cdc endpoint for changes) and stored unmodified in qbo_raw. After each pull the
// company's ledger is rebuilt from those records (ledger.js). Used only by the newer tabs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from '../config.js';
import { qboGet } from '../qbo.js';
import { buildLedger } from './ledger.js';

export function loadRawConfig(file = path.resolve(ROOT, appConfig.rawSync?.file || 'config/raw-sync.json')) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }
  const KNOWN = ['Account', 'Customer', 'Vendor', 'Employee', 'Item', 'Class', 'Department', 'Invoice', 'SalesReceipt', 'Payment', 'CreditMemo', 'RefundReceipt', 'Deposit', 'Bill', 'BillPayment', 'Purchase', 'VendorCredit', 'JournalEntry', 'Transfer', 'Budget', 'Estimate', 'PurchaseOrder', 'Term', 'PaymentMethod', 'TaxAgency', 'TaxRate', 'TimeActivity'];
  const entities = raw.entities || [];
  for (const e of entities) if (!KNOWN.includes(e)) throw new Error(`${name}: unknown entity "${e}" (use ${KNOWN.join(', ')})`);
  for (const req of ['Account', 'Item']) if (!entities.includes(req)) throw new Error(`${name}: entities must include ${req} (the ledger needs it)`);
  const pageSize = raw.pageSize ?? 1000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error(`${name}: pageSize must be 1..1000`);
  const fullRefreshDays = raw.fullRefreshDays ?? 7;
  if (typeof fullRefreshDays !== 'number' || fullRefreshDays < 1) throw new Error(`${name}: fullRefreshDays must be a number >= 1`);
  return { enabled: raw.enabled !== false, entities, pageSize, cdc: raw.cdc !== false, fullRefreshDays };
}

export function initRawSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qbo_raw (
      realm_id     TEXT NOT NULL,
      entity       TEXT NOT NULL,      -- Invoice | Bill | JournalEntry | Account | ...
      id           TEXT NOT NULL,
      sync_token   TEXT,
      txn_date     TEXT,               -- TxnDate for transactions
      updated_at   TEXT,               -- MetaData.LastUpdatedTime
      json         TEXT NOT NULL,      -- the record exactly as QuickBooks returned it
      fetched_at   TEXT NOT NULL,
      PRIMARY KEY (realm_id, entity, id)
    );
    CREATE INDEX IF NOT EXISTS idx_qbo_raw_txn ON qbo_raw (realm_id, entity, txn_date);
    CREATE TABLE IF NOT EXISTS qbo_raw_state (
      realm_id      TEXT NOT NULL,
      entity        TEXT NOT NULL,
      last_full_at  TEXT,              -- last complete pull (query endpoint)
      last_cdc_at   TEXT,              -- server time of the last change-data-capture pull
      records       INTEGER NOT NULL DEFAULT 0,
      status        TEXT,              -- success | error
      message       TEXT,
      PRIMARY KEY (realm_id, entity)
    );
  `);
}

const NO_CDC = new Set(['TaxRate', 'TaxAgency']); // QuickBooks' cdc endpoint rejects these ("Property Active not found"); pulled in full each sync
const meta = (rec) => ({ id: String(rec.Id), syncToken: rec.SyncToken ?? null, txnDate: rec.TxnDate || null, updatedAt: rec.MetaData?.LastUpdatedTime || null });

/** Full pull of one entity through the query endpoint, paged. Replaces every stored record of that entity. */
async function fullPull(db, realmId, entity, cfg, get) {
  const records = [];
  for (let start = 1; ; start += cfg.pageSize) {
    const json = await get('query', { query: `select * from ${entity} startposition ${start} maxresults ${cfg.pageSize}` });
    const rows = json.QueryResponse?.[entity] || [];
    records.push(...rows);
    if (rows.length < cfg.pageSize) break;
  }
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO qbo_raw (realm_id, entity, id, sync_token, txn_date, updated_at, json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare('DELETE FROM qbo_raw WHERE realm_id = ? AND entity = ?').run(realmId, entity);
    for (const r of records) { const m = meta(r); ins.run(realmId, entity, m.id, m.syncToken, m.txnDate, m.updatedAt, JSON.stringify(r), now); }
  })();
  return records.length;
}

/** Changes since `since` for several entities through the cdc endpoint (QuickBooks keeps 30 days). */
async function cdcPull(db, realmId, entities, since, get) {
  const json = await get('cdc', { entities: entities.join(','), changedSince: since });
  const now = new Date().toISOString();
  const up = db.prepare(`INSERT OR REPLACE INTO qbo_raw (realm_id, entity, id, sync_token, txn_date, updated_at, json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const del = db.prepare('DELETE FROM qbo_raw WHERE realm_id = ? AND entity = ? AND id = ?');
  const counts = {};
  db.transaction(() => {
    for (const block of json.CDCResponse || []) {
      for (const qr of block.QueryResponse || []) {
        for (const [entity, rows] of Object.entries(qr)) {
          if (!Array.isArray(rows)) continue;
          for (const r of rows) {
            if (r.status === 'Deleted') del.run(realmId, entity, String(r.Id));
            else { const m = meta(r); up.run(realmId, entity, m.id, m.syncToken, m.txnDate, m.updatedAt, JSON.stringify(r), now); }
            counts[entity] = (counts[entity] || 0) + 1;
          }
        }
      }
    }
  })();
  return { counts, serverTime: json.time || now };
}

/**
 * Pull one company's raw data and rebuild its ledger. Returns { mode, records, changed, ledgerLines, errors }.
 * get(path, query) defaults to the authenticated QuickBooks client.
 */
export async function syncRaw(db, realmId, cfg, { get = (p, q) => qboGet(db, realmId, p, q), now = new Date() } = {}) {
  initRawSchema(db);
  const state = Object.fromEntries(db.prepare('SELECT * FROM qbo_raw_state WHERE realm_id = ?').all(realmId).map((s) => [s.entity, s]));
  const setState = db.prepare(`INSERT OR REPLACE INTO qbo_raw_state (realm_id, entity, last_full_at, last_cdc_at, records, status, message) VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM qbo_raw WHERE realm_id = ? AND entity = ?), ?, ?)`);
  const nowIso = now.toISOString();
  const errors = {};
  const changed = {};
  // Entities that need a full pull: never pulled, failed last time, CDC off, too old for CDC, or due for the periodic refresh.
  const cdcLimit = now.getTime() - 29 * 86400_000;
  const refreshLimit = now.getTime() - cfg.fullRefreshDays * 86400_000;
  const needFull = cfg.entities.filter((e) => {
    const s = state[e];
    if (!s || s.status !== 'success' || !s.last_full_at || !cfg.cdc) return true;
    if (Date.parse(s.last_full_at) < refreshLimit) return true;
    return Date.parse(s.last_cdc_at || s.last_full_at) < cdcLimit;
  });
  // The cdc endpoint does not cover every entity; those are pulled in full each time (they are small).
  for (const e of cfg.entities) if (NO_CDC.has(e) && !needFull.includes(e)) needFull.push(e);
  const incremental = cfg.entities.filter((e) => !needFull.includes(e));

  for (const e of needFull) {
    try {
      changed[e] = await fullPull(db, realmId, e, cfg, get);
      setState.run(realmId, e, nowIso, nowIso, realmId, e, 'success', null);
    } catch (err) {
      errors[e] = err.message.slice(0, 300);
      setState.run(realmId, e, state[e]?.last_full_at || null, state[e]?.last_cdc_at || null, realmId, e, 'error', err.message.slice(0, 500));
    }
  }
  if (incremental.length) {
    const since = incremental.map((e) => state[e].last_cdc_at || state[e].last_full_at).sort()[0];
    try {
      const r = await cdcPull(db, realmId, incremental, since, get);
      Object.assign(changed, r.counts);
      for (const e of incremental) setState.run(realmId, e, state[e].last_full_at, r.serverTime, realmId, e, 'success', null);
    } catch (err) {
      for (const e of incremental) { errors[e] = err.message.slice(0, 300); setState.run(realmId, e, state[e].last_full_at, state[e].last_cdc_at, realmId, e, 'error', err.message.slice(0, 500)); }
    }
  }
  const ledgerLines = buildLedger(db, realmId);
  const records = db.prepare('SELECT COUNT(*) AS n FROM qbo_raw WHERE realm_id = ?').get(realmId).n;
  return { mode: needFull.length === cfg.entities.length ? 'full' : needFull.length ? 'mixed' : 'changes', records, changed, ledgerLines, errors };
}
