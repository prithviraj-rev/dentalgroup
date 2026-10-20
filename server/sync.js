// POST /sync implementation: for every connected company pull the chart of accounts into `accounts`
// and the monthly P&L into `pl_lines`.
import { config, appConfig } from './config.js';
import { listConnections, updateCompanyInfo } from './tokenStore.js';
import { fetchProfitAndLoss, fetchChartOfAccounts, getCompanyInfo } from './qbo.js';
import { upsertPlLines, replaceAccounts, logSync } from './db.js';
import { parseProfitAndLoss, dedupeForStorage } from './pnlParser.js';
import { syncRaw, loadRawConfig } from './raw/sync.js';

const rawConfig = loadRawConfig();

// One sync at a time: runs from the dashboard, the platform and the OAuth callback queue behind each other,
// so two runs never write the same company's rows or rotate its refresh token concurrently.
let queue = Promise.resolve();
export function syncAll(db, opts = {}) {
  const run = queue.then(() => runSync(db, opts));
  queue = run.catch(() => {});
  return run;
}

async function runSync(db, { startDate = config.syncStartDate, endDate = config.syncEndDate, realmIds = null } = {}) {
  // realmIds: sync only these companies (e.g. the one just connected); default is every connection.
  const connections = listConnections(db).filter((c) => !realmIds || realmIds.includes(c.realm_id));
  const results = [];
  const withAccounts = appConfig.sync.includeChartOfAccounts !== false;

  // Sequential on purpose: stays well under Intuit's per-app throttles.
  for (const c of connections) {
    const startedAt = new Date().toISOString();
    const base = { realmId: c.realm_id, companyName: c.company_name, startDate, endDate };
    try {
      // Also validates the connection (and refreshes tokens) before the heavier calls.
      // Name, legal name and address straight from QuickBooks (the dashboard never renames companies).
      const info = await getCompanyInfo(db, c.realm_id);
      const companyName = info.companyName;
      updateCompanyInfo(db, c.realm_id, info);

      let accounts = null;
      if (withAccounts) {
        accounts = replaceAccounts(db, c.realm_id, companyName, await fetchChartOfAccounts(db, c.realm_id));
      }

      const report = await fetchProfitAndLoss(db, c.realm_id, { startDate, endDate });
      const rows = dedupeForStorage(parseProfitAndLoss(report));
      upsertPlLines(db, c.realm_id, companyName, rows, { startDate, endDate });

      // Raw QuickBooks records for the newer tabs (config/raw-sync.json). Never fails the P&L sync.
      let raw = null;
      if (rawConfig.enabled) {
        try { raw = await syncRaw(db, c.realm_id, rawConfig); } catch (err) { raw = { errors: { all: err.message } }; }
      }
      const extraErrors = Object.keys(raw?.errors || {});

      logSync(db, {
        realm_id: c.realm_id, company_name: companyName, status: 'success', row_count: rows.length,
        message: accounts == null ? null : `${accounts} accounts`,
        start_date: startDate, end_date: endDate, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      results.push({ ...base, companyName, status: 'success', rows: rows.length, accounts, raw: raw && { mode: raw.mode, records: raw.records, ledgerLines: raw.ledgerLines, errors: raw.errors } });
      console.log(`[sync] ok   ${companyName} (${c.realm_id}): ${rows.length} P&L rows${accounts == null ? '' : `, ${accounts} accounts`}${raw?.records != null ? `, ${raw.records} raw records (${raw.mode})` : ''}${extraErrors.length ? ` (raw pull failed: ${extraErrors.join(', ')})` : ''}`);
    } catch (err) {
      logSync(db, {
        realm_id: c.realm_id, company_name: c.company_name, status: 'error', message: err.message,
        start_date: startDate, end_date: endDate, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      results.push({ ...base, status: 'error', error: err.message });
      console.error(`[sync] FAIL ${c.company_name} (${c.realm_id}): ${err.message}`);
    }
  }

  return {
    startDate,
    endDate,
    companies: results.length,
    succeeded: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'error').length,
    results,
  };
}
