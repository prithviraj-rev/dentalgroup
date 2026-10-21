# CLAUDE.md

QuickBooks Online multi-company P&L platform. Client: **Sabuska** (dental group, ~36 QBO companies).
Live on Railway: https://qbo-pnl-dashboard-production.up.railway.app — `/app` = Ledgerview platform, `/` = P&L dashboard (embedded under Reports). Full docs: README.md.
Client requirements: `docs/Sabuska DashBoard.xlsx` (Financial KPI tab column E = the account numbers the client assigned to each row; the sheet contradicts itself in places, see README "Financial KPIs").

## Layout
- `server/` Express + better-sqlite3 (one SQLite file, Railway volume `/data/pnl.db`)
  - `index.js` OAuth `/connect` `/callback`, `/sync`, gate + per-session scope, `/disconnected`; mounts the routers below
  - `api.js` older dashboard API on the P&L-report data `pl_lines` (`/api/pl`, `/pl/accounts`, `/breakdown`, `/executive`, `/coa`, `/office-categories`, `/meta`); every endpoint takes `req.dashboardScope`. `/breakdown` and `/pl/accounts` are no longer called by any tab (regression tests keep them)
  - `executive.js` Executive view data (like-for-like YoY), `metrics.js`, `categories.js`, `coa.js` (account tree builder, also used by `offices/pl.js`), `pnlParser.js`, `sync.js` (serialized queue), `qbo.js`
  - `platform/` multi-tenant API `/platform-api/*`: orgs, entities (`pf_entities.external_id` = QBO realm), users/roles, sync runs, audit
  - `categoryView.js` Category compare (`/api/category-view`, reads the ledger), `scheduler.js` daily QBO sync (`sync.schedule`)
  - `raw/` raw QuickBooks records (`qbo_raw`, full pull then CDC, called from `sync.js` after each P&L) -> double-entry `ledger` (`ledger.js`) -> read helpers (`data.js`; `ledgerCashFlow` returns operating / investing / financing / loans). All ledger data is ACCRUAL (invoices and bills post when issued); so is the report sync (`sync.accountingMethod`)
  - `offices/` the Offices machinery, used by three tabs:
    - `offices.js` pure functions: `resolveOffices` (config pairs + auto-pairing by city; dental practice + sub-DSO = one office), `combinedOffices` (user-saved combinations = extra views, key `combined-<id>`, never replace offices), `canonicalBook` (one spelling per account across an office's companies: name match ignoring case/punctuation/plural/word order, or same account number when unambiguous), `classifyLine` / `buildStatement` (statement rows, payroll-tax split, internal-charge elimination, memo lines incl. `unassignedIncome` / `unassigned` / `internalIncome`), `matchedAccount` (`statement.rollUpSubAccounts: "matched"`), flags, balance sheet tree
    - `pl.js` combined profit and loss as booked (accounts merged by type + path, by month and by company) + `monthlyPl` for the trend charts
    - `analysis.js` the Analysis tab: a statement row (or `pct:<row>` = % of collections) by office / category / row / account over time
    - `api.js` `createOfficesRouter(db, { parseFilters, file, base, analysis })`: `/api/<base>` portfolio (`offices` + `combined`), `/api/<base>/:key` (statement, combined P&L, balance sheet, trend, `page`), `/api/<base>/setup` GET/POST/DELETE (combinations), `/api/analysis` (primary instance only). Mounted twice: `office-view` with `config/offices.json` and `officesSheet.apiPath` (`office-sheet`) with `config/offices-sheet.json`
    - `config.js` loader: `extends` (one level), rows (any row may carry `accounts`; `other` with `accounts` sends the rest to memo), `payrollTaxes`, `internal.<side>.unmatched` memo|rows, `statement.rollUpSubAccounts` true|false|"matched", `page.sections` (tiles|statement|pl|balanceSheet|trends) and `page.memo`, `cashFlow.includeLoanPayments`, flags, periods
  - `finance/` APIs for Group overview (eliminations, EBITDA, forecast, alerts), Cash & balance sheet, Budget, Practice KPIs (import into `practice_kpis`), transactions, `/api/raw/status`
- `web/` React+Vite+Recharts+Tailwind dashboard: tabs Executive (default), Dashboard, Analysis, Category compare, Offices, Financial KPIs, Group overview, Cash & balance sheet, Chart of accounts. Budget and Practice KPIs tabs removed 2026-10-20 (APIs still served); the Dashboard's account-breakdown table removed the same day. Newer tabs share `components/ui.jsx`
  - `components/Offices.jsx` serves both Offices tabs (`base` prop). Office page: tiles, office statement, combined P&L, balance sheet, trends, gated by `page.sections`; "Columns" control Monthly | Quarterly | Yearly (none = period total only; statement and P&L side by side at `lg` when none); Expand all / Collapse all toggles live in the sticky "Account" header of each table (P&L: everything folds except the Income section); combinations list in a "Combined offices" section; Combine opens the new combined view straight away
  - `components/Analysis.jsx` reads `/api/analysis`; metric/dimension options come from the API, defaults from `app.config.json` `analysis.*`
- `platform/` React app for Ledgerview (`/app`)
- `config/` JSON config: `platform.config.json` (roles/permissions/nav/plans), `platform.seed.json` (demo data, seeds once), `executive.json` (cost/payer bucket rules), `dashboard-categories.json` (office categories), `category-view.json`, `offices.json` (office pairs, statement rows, flags; rows order = statement order: ... Training, Marketing, Dental Supplies, Laboratory, Rent ...), `offices-sheet.json` (Financial KPIs tab: `extends` offices.json, rows hold the client sheet's column-E account numbers literally, 14 rows incl. Small Equipment Lease = 540.1 assumption, no payroll split, loan payments in operating cash flow, statement + P&L only, no memo lines), `group-overview.json` (segments, intercompany rules, EBITDA, alerts), `raw-sync.json` (raw entities pulled), `finance.json` (cash/aging/vendor/budget settings), `practice-kpis.json`. `app.config.json` = dashboard behaviour (`analysis.*`, `offices`, `officesSheet` {file, apiPath, label})
- `test/` node:test (56 tests; `offices.test.js` covers pairing, combinations, statement, sheet mapping, canonical names, combined P&L; `analysis.test.js`); `scripts/ui-smoke/` jsdom browser smoke test

## Commands
- `npm run dev` (server :3000, web :5173, platform :5174) · `npm test` · `npm run build`
- `npm run ui-smoke` (needs a running server; `BASE=<url>` for live; `ONLY=<substring>` subset) — run before every UI deploy. `npm run ui-smoke` rebuilds the jsdom bundle; running `node scripts/ui-smoke/dashboard.mjs` directly reuses the LAST bundle, so after a web change always go through `npm run ui-smoke` at least once
- Deploy: `railway up --ci` (CLI in `%APPDATA%\npm`; prepend to PATH in PowerShell: `$env:Path += ";$env:APPDATA\npm"`). A rolling deploy briefly serves old and new containers: wait ~90 s before checking live
- Railway vars hold secrets: QBO prod keys, `SESSION_SECRET`, `APP_USER/APP_PASSWORD`, `PUBLIC_URL`, `DB_PATH=/data/pnl.db`. Never commit `.env`. Live API checks: `railway variables --json` for APP_USER/APP_PASSWORD, basic auth, read-only GETs only

## Rules
- Everything behavioural goes in JSON config, validated at startup with errors naming the key. No tenant names/IDs in code.
- Verify before claiming done: `npm test`, `npm run build`, `npm run ui-smoke`, then check live after `railway up`.
- Access: platform sessions are scoped to the realms of entities the user may see; `/connections`, `/disconnect`, linking by realm id = platform admin only.
- Connections without an org (plain `/connect`) auto-link to the only live-reports org; `[connect]` log line records it.
- Company names come from QBO CompanyInfo every sync (never renamed); legal name, address, industry stored in `connections.details_json`.
- NEVER create, edit or delete saved combinations (office_groups) on the live site unless the user asks. Combining offices is the user's choice. Read-only checks against live are fine.
- The Offices tab keeps top-level account heads (client asked for no sub-categories); the Financial KPIs tab follows the client sheet literally, including its gaps (500/501/502 payroll, utilities, repairs are left out there and totalled in a footnote).

## Known data issues (2026-10-20 audit, still open)
- Cash tab bank/credit-card balances wrong for Sabuska, Gmak Builders, Fall River: `CreditCardPayment` records are not pulled (`config/raw-sync.json`).
- Group overview rent elimination rule matches equipment leases ("lease expense" in the path) and misses "559 Rent & NNN".
- Executive (account name only) and Category compare (full path) bucket the same rules differently.
- Fall River 2026 books: income not posted, 200k uncategorized expense. Greeley / Pueblo / Fort Collins: only the sub-DSO is connected. South Main Dental dropped to ~0 after 2024.
- Open questions for Akash (bookkeeper): payroll-tax split vs whole to providers, 503.1 contract staff, Small Equipment Lease account, which accounts carry the dental -> sub-DSO internal charge, 5002 Guaranteed Collection Remanent Payments.

## Gotchas
- Windows + Git Bash: avoid `\b`/backslashes in heredocs written via bash (once turned into literal backspaces and broke SQL). Prefer the Write tool or a script file for code edits; a backtick inside a double-quoted bash argument starts a command substitution and silently aborts the whole command.
- Safety check blocks `rm` on variable paths; use new file names instead.
- React: declare every hook before the early `return`s in a component (a late `useState` in `OfficeDetail` broke the live office page once).
- The local `data/pnl.db` holds two Intuit sandbox companies that are not in the Dental Companies group, so the Offices tabs are empty locally; office pages can only be exercised against live.
- No git commits since the initial one unless the user asks.
