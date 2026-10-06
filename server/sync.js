// POST /sync implementation: pull the monthly P&L for every connected company into pl_lines.
import { config } from './config.js';
import { listConnections, updateCompanyName } from './tokenStore.js';
import { fetchProfitAndLoss, getCompanyName } from './qbo.js';
import { upsertPlLines, logSync } from './db.js';
import { parseProfitAndLoss, dedupeForStorage } from './pnlParser.js';

export async function syncAll(db, { startDate = config.syncStartDate, endDate = config.syncEndDate } = {}) {
  const connections = listConnections(db);
  const results = [];

  // Sequential on purpose: stays well under Intuit's per-app throttles.
  for (const c of connections) {
    const startedAt = new Date().toISOString();
    const base = { realmId: c.realm_id, companyName: c.company_name, startDate, endDate };
    try {
      // Also validates the connection (and refreshes tokens) before the heavier report call.
      const companyName = await getCompanyName(db, c.realm_id);
      if (companyName !== c.company_name) updateCompanyName(db, c.realm_id, companyName);

      const report = await fetchProfitAndLoss(db, c.realm_id, { startDate, endDate });
      const rows = dedupeForStorage(parseProfitAndLoss(report));
      upsertPlLines(db, c.realm_id, companyName, rows, { startDate, endDate });

      logSync(db, {
        realm_id: c.realm_id, company_name: companyName, status: 'success', row_count: rows.length,
        start_date: startDate, end_date: endDate, started_at: startedAt, finished_at: new Date().toISOString(),
      });
      results.push({ ...base, companyName, status: 'success', rows: rows.length });
      console.log(`[sync] ok   ${companyName} (${c.realm_id}): ${rows.length} rows`);
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
