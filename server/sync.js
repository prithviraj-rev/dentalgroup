// POST /sync implementation: for every connected company pull the chart of accounts into `accounts`
// and the monthly P&L into `pl_lines`.
import { config, appConfig } from './config.js';
import { listConnections, updateCompanyName } from './tokenStore.js';
import { fetchProfitAndLoss, fetchChartOfAccounts, getCompanyName } from './qbo.js';
import { upsertPlLines, replaceAccounts, logSync } from './db.js';
import { parseProfitAndLoss, dedupeForStorage } from './pnlParser.js';

export async function syncAll(db, { startDate = config.syncStartDate, endDate = config.syncEndDate } = {}) {
  const connections = listConnections(db);
  const results = [];
  const withAccounts = appConfig.sync.includeChartOfAccounts !== false;

  // Sequential on purpose: stays well under Intuit's per-app throttles.
  for (const c of connections) {
    const startedAt = new Date().toISOString();
    const base = { realmId: c.realm_id, companyName: c.company_name, startDate, endDate };
    try {
      // Also validates the connection (and refreshes tokens) before the heavier calls.
      const companyName = await getCompanyName(db, c.realm_id);
      if (companyName !== c.company_name) updateCompanyName(db, c.realm_id, companyName);

      let accounts = null;
      if (withAccounts) {
        accounts = replaceAccounts(db, c.realm_id, companyName, await fetchChartOfAccounts(db, c.realm_id));
      }

      const report = await fetchProfitAndLoss(db, c.realm_id, { startDate, endDate });
      const rows = dedupeForStorage(parseProfitAndLoss(report));
      upsertPlLines(db, c.realm_id, companyName, rows, { startDate, endDate });

      logSync(db, {
        realm_id: c.realm_id, company_name: companyName, status: 'success', row_count: rows.length,
        message: accounts == null ? null : `${accounts} accounts`,
        start_date: startDate, end_date: endDate, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      results.push({ ...base, companyName, status: 'success', rows: rows.length, accounts });
      console.log(`[sync] ok   ${companyName} (${c.realm_id}): ${rows.length} P&L rows${accounts == null ? '' : `, ${accounts} accounts`}`);
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
