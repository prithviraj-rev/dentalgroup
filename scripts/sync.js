// Pulls a monthly ProfitAndLoss report for every connected company in tokens.json and stores the rows in SQLite.
//
//   npm run sync                              # all companies, last 24 months, accrual basis
//   npm run sync -- --months 36 --method Cash
//   npm run sync -- --realm 9341452xxxxxxx     # one company
import { parseArgs } from 'node:util';
import { config, requireCredentials } from '../server/config.js';
import { loadTokens, upsertToken } from '../server/tokenStore.js';
import { qboGet, getCompanyName } from '../server/qbo.js';
import { openDb, replaceCompanyRows } from '../server/db.js';
import { parseProfitAndLoss } from '../server/pnlParser.js';

const { values: args } = parseArgs({
  options: {
    months: { type: 'string', default: '24' },
    method: { type: 'string', default: 'Accrual' },
    realm: { type: 'string' },
  },
});

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dateRange(months, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  return { startDate: ymd(start), endDate: ymd(today) };
}

async function syncCompany(db, realmId, token, range) {
  // Refresh the company name each run (also validates the connection before the heavier report call).
  const companyName = await getCompanyName(realmId);
  const officeName = token.office_name || companyName;
  upsertToken(realmId, { company_name: companyName, office_name: officeName });

  const report = await qboGet(realmId, 'reports/ProfitAndLoss', {
    start_date: range.startDate,
    end_date: range.endDate,
    summarize_column_by: 'Month',
    accounting_method: args.method,
  });

  const rows = parseProfitAndLoss(report);
  replaceCompanyRows(db, realmId, officeName, rows, range);
  return { officeName, rows: rows.length, currency: report.Header?.Currency };
}

async function main() {
  requireCredentials();
  const months = Number(args.months);
  if (!Number.isInteger(months) || months < 1) throw new Error('--months must be a positive integer');

  const tokens = loadTokens();
  const realmIds = args.realm ? [args.realm] : Object.keys(tokens);
  if (realmIds.length === 0) {
    console.log('No connected companies. Run `npm run connect` and connect at least one QuickBooks company first.');
    return;
  }

  const range = dateRange(months);
  console.log(`Syncing ${realmIds.length} compan${realmIds.length === 1 ? 'y' : 'ies'} (${config.environment}), ` +
    `${range.startDate} -> ${range.endDate}, ${args.method} basis`);

  const db = openDb();
  let failures = 0;
  // Sequential on purpose: keeps us well under Intuit's per-app throttles as the company count grows.
  for (const realmId of realmIds) {
    const token = tokens[realmId];
    if (!token) {
      console.error(`  x ${realmId}: not in tokens.json`);
      failures++;
      continue;
    }
    const refreshExpiry = Date.parse(token.refresh_token_expires_at || 0);
    if (refreshExpiry && refreshExpiry - Date.now() < 14 * 864e5) {
      console.warn(`  ! ${realmId}: refresh token expires ${token.refresh_token_expires_at} - reconnect soon`);
    }
    try {
      const r = await syncCompany(db, realmId, token, range);
      console.log(`  ok ${r.officeName} (${realmId}): ${r.rows} rows${r.currency ? `, ${r.currency}` : ''}`);
    } catch (err) {
      failures++;
      console.error(`  x ${token.office_name || realmId} (${realmId}): ${err.message}`);
    }
  }
  db.close();

  console.log(failures ? `Done with ${failures} failure(s).` : 'Done.');
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
