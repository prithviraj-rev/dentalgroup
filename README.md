# QuickBooks multi-company P&L dashboard (POC)

Connects several QuickBooks Online **sandbox** companies with OAuth 2.0, pulls each company's monthly
Profit & Loss report into SQLite, and shows them in a React dashboard: all offices or one, monthly /
quarterly / yearly, with a YoY comparison and a per-account breakdown.

```
QBO companies ──OAuth, one per realmId──▶ SQLite connections
             ──ProfitAndLoss report────▶ POST /sync ──▶ SQLite pl_lines (+ sync_logs)
                                                          │
                        Express API  http://localhost:3000/api ◀─┘
                                   │  CORS
                        React + Vite dashboard  http://localhost:5173
```

```
server/   Express + better-sqlite3: OAuth, /sync, /api
web/      React + Vite + Recharts + Tailwind dashboard
test/     parser + upsert tests (node --test)
scripts/  node fallback for `npm run sync`
data/     pnl.db is created here on first run (gitignored)
```

## Setup

Requires **Node.js 20.12+**. No Docker.

1. **Intuit app.** In the [Intuit developer portal](https://developer.intuit.com), open your app, go to
   **Keys & credentials (Development)** and add `http://localhost:3000/callback` to the **Redirect URIs**
   list (same place as the Postman URI). Copy the Development Client ID and Client Secret.
2. **Credentials.** Edit `.env` at the repo root (already created from `.env.example`, gitignored) and
   replace the two placeholders:
   ```
   QBO_CLIENT_ID=<PASTE_ID>
   QBO_CLIENT_SECRET=<PASTE_SECRET>
   ```
3. **Install and run.**
   ```
   npm install
   npm run dev
   ```
   This starts the API server on http://localhost:3000 and the dashboard on http://localhost:5173.

## Connecting each sandbox company

Repeat once per company:

1. Open http://localhost:3000/connect in the browser.
2. Sign in with your Intuit developer account and, on the consent screen, **pick the sandbox company**
   you want to connect, then click **Connect**.
3. Intuit redirects to `/callback`. The server exchanges the code for tokens, reads `realmId` from the
   query string, looks up the company name, and stores the connection in SQLite.
4. You land on http://localhost:3000/ which lists every connected company. Click **Connect a QuickBooks
   company** again for the next one.

Need more sandbox companies? In the developer portal use **Sandbox** → **Add a sandbox company**.
Each sandbox company gets its own realmId, so each one is a separate "office" here.

## Syncing

Any of these runs the same sync, which loops over every connected company:

- **Sync now** button in the dashboard (shows a toast with per-company results)
- `npm run sync` (curl) or `npm run sync:node` (no curl needed), with the server running
- `POST http://localhost:3000/sync`

For each company it calls
`GET /v3/company/{realmId}/reports/ProfitAndLoss?start_date=2025-01-01&end_date=2026-12-31&summarize_column_by=Month`
(the window is configurable with `SYNC_START_DATE` / `SYNC_END_DATE` in `.env`), flattens the report
tree into account × month rows and upserts them into `pl_lines`. Each company's success or failure is
written to `sync_logs`. Access tokens are refreshed automatically when within 5 minutes of expiry, and
the rotated refresh token is persisted.

## Dashboard

- **Header:** office selector (All offices, each office, or **Compare offices…**), from/to month pickers,
  Monthly / Quarterly / Yearly toggle, YoY switch, Sync now.
- **KPI cards:** total income, total expenses, net income for the range. With YoY on, each shows the %
  change vs the same range one year earlier.
- **Main chart:** income, expenses and net income per period. A picker on the card switches the form:
  *Bars + line* (default: income and expense bars, net income line), *Lines*, *Grouped bars*, or
  *Stacked* (expense groups stacked to show the composition of spend, with income and net income as
  lines). All values are money, so every form shares one y-axis.
- **Office chart:** one metric per office, shown on the All offices view (net income) and in compare
  mode (chosen metric). Forms: *Lines* (default), *Grouped bars*, *Stacked* (offices stacked to the
  combined total), *Small multiples* (one panel per office on a shared scale, best for 3+ offices) and
  *Ranked totals* (horizontal bars of each office's total over the range, largest first).
- Chart choices are remembered in the URL (`mainChart`, `officeChart`); the offered forms and the
  defaults are set in `charts` in `app.config.json`, and `charts.showPicker: false` hides the pickers.
- **Chart of accounts tab:** the P&L laid out on the QuickBooks chart of accounts. Every sync pulls the
  `Account` entities per company into the `accounts` table; the tab shows Revenue and Expense accounts
  as a tree (account type → parent account → sub-accounts, with sub-type badges), with per-period
  amounts from the P&L rolled up into each parent, subtotals per account type and classification, and
  net income. Toggles: hide accounts with no activity, hide inactive accounts, show balance-sheet
  accounts (Assets / Liabilities / Equity with their current balance), search, expand / collapse all.
  With All offices or a comparison selected, same-named accounts are merged across companies and their
  amounts summed, since QBO account ids are only unique within one company. P&L lines whose account is
  missing from the chart (deleted accounts) are shown as "not in chart".
- **Chart of accounts dashboard** (above that table): KPI tiles for revenue, expenses, net income and
  accounts with activity; a **revenue mix** and an **expense mix** by top-level account, as a donut
  (default), pie or ranked bars, capped at `maxSlices` with the rest folded into "Other" so slices stay
  readable; **top accounts over time** for revenue or expenses as lines, stacked bars or small
  multiples; and **by account sub-type** ranked bars, which uses the QuickBooks detail type set on
  each account. Each chart has its own form picker, configured under `chartOfAccounts.dashboard`.
- **Account breakdown:** every account grouped under Income / COGS / Expenses / Other income / Other
  expenses with per-period totals, collapsible groups, group subtotals and a net income row.
- **Compare offices:** choose `Compare offices…` in the office selector, then tick 2 to 4 offices
  (`compare.maxOffices`). Pick a metric (income, expenses or net income) and you get one tile per office
  with YoY, one line per office on the chart, an office × period table with a combined row, and the
  account breakdown with one column per office. Office colors are fixed per office, so they stay the
  same whichever subset you pick.
- The view is mirrored into the URL (`?office=id,id&from=…&to=…&granularity=…&metric=…&yoy=1`), so a
  comparison can be bookmarked or shared.
- Light and dark mode follow the OS setting.

Definitions: `income = Income + OtherIncome`, `expenses = COGS + Expenses + OtherExpenses`,
`netIncome = income − expenses`, which equals the report's Net Income line. Group membership is
configurable (see below).

## Configuration

Two files, by kind of setting:

| File | Holds | Read by |
|---|---|---|
| `.env` (gitignored) | secrets, ports, paths: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `PORT`, `WEB_ORIGIN`, `DB_PATH`, `APP_CONFIG_PATH`, plus optional overrides `SYNC_START_DATE`, `SYNC_END_DATE`, `SYNC_ACCOUNTING_METHOD`, `QBO_MINOR_VERSION` | server |
| `app.config.json` | behaviour: dashboard defaults, compare limits, office chart, metric labels, P&L groups, sync window, QBO client settings | server, and the dashboard via `GET /api/config` |

Every key in `app.config.json` is optional; missing keys take the built-in defaults, and invalid values
fail at startup with a message naming the key. Restart `npm run dev` after editing either file.

| Key | Meaning |
|---|---|
| `dashboard.title`, `locale`, `currency` | Page title and number formatting. |
| `dashboard.defaultOffice` | `all`, a realmId, or `id,id` to open in compare mode. |
| `dashboard.defaultRange` | `from`/`to` as `YYYY-MM` (`to: "current"` = this month); `snapToData` snaps to the synced range on load. |
| `dashboard.defaultGranularity`, `granularities` | Default and available buckets (`month`, `quarter`, `year`). |
| `dashboard.defaultYoy`, `chartHeights`, `syncToastSeconds` | YoY on by default, chart heights in px, toast durations. |
| `compare.maxOffices`, `minOffices` | Selection limits for compare mode (enforced by the API too). |
| `compare.metrics`, `defaultMetric` | Metrics offered in compare mode. |
| `officeChart.enabled`, `maxOffices`, `metric` | The per-office chart on the All offices view (max 8, one palette slot each). |
| `charts.main`, `charts.office` | `default` form and the `options` offered by each chart's picker (main: combo, lines, bars, stacked; office: lines, bars, stacked, small, ranked). |
| `charts.showPicker` | `false` hides the pickers and always uses the defaults. |
| `groups.colors` | Palette slot (1–8) per P&L group, used by the stacked main chart. |
| `chartOfAccounts.enabled` | Show the Chart of accounts tab. |
| `chartOfAccounts.hideNoActivity`, `hideInactive`, `expandDepth`, `balanceSheetToggle`, `showSubType` | Initial toggle states, how many tree levels open by default, whether the balance-sheet toggle is offered, and whether sub-type badges are shown. |
| `chartOfAccounts.dashboard.enabled` | Show the charts above the chart of accounts table. |
| `chartOfAccounts.dashboard.mix` | `default` and `options` (donut, pie, bars) for the revenue and expense mix, and `maxSlices` (2–8) before folding into Other. |
| `chartOfAccounts.dashboard.trend` | `default` and `options` (lines, stacked, small) for top accounts over time, and `topAccounts` (1–8). |
| `chartOfAccounts.dashboard.subType` | `enabled` and `maxRows` for the account sub-type ranking. |
| `sync.includeChartOfAccounts` | Pull the chart of accounts on every sync (default true). |
| `metrics.<key>` | Label, `upIsGood` (colors the YoY delta) and palette slot per metric. |
| `groups.order`, `labels`, `incomeGroups`, `expenseGroups` | P&L groups, their display names and which side of net income they sit on. |
| `sync.startDate`, `endDate`, `accountingMethod` | Report window and `Accrual` / `Cash`. `.env` values override these. |
| `qbo.minorVersion`, `refreshSkewMinutes`, `oauthStateTtlMinutes` | API minor version, how early to refresh tokens, OAuth state lifetime. |

## API

| Route | Description |
|---|---|
| `GET /connect` | Starts the OAuth flow (state is generated and checked). |
| `GET /callback` | Exchanges the code, stores `{realmId, companyName, accessToken, refreshToken, expiresAt}`. |
| `GET /` | Connections page (list, connect, disconnect). |
| `POST /sync` | Syncs every connected company. Returns `{companies, succeeded, failed, results[]}`. |
| `GET /api/config` | The merged `app.config.json` (no secrets). |
| `GET /api/offices` | Connected offices with line counts, last sync and a stable `colorIndex`. |
| `GET /api/meta` | Synced period range, line count, last sync, connection count. |
| `GET /api/pl?granularity=month\|quarter\|year&from=YYYY-MM&to=YYYY-MM&office=realmId\|all\|id,id` | `office` may be a comma list of up to `compare.maxOffices` realmIds. Per period: totals per grp, plus `income`, `expenses`, `netIncome`; `rows` as flat `(period, grp, amount)`; `offices[]` with per-office per-period figures and totals. |
| `GET /api/pl/accounts?…&by=period\|office` | Same filters; per-account totals with one column per period, or per office when `by=office`. |
| `GET /api/accounts?office=…` | Raw chart of accounts for the office(s): id, name, fully qualified name, type, sub-type, classification, parent, active, current balance. |
| `GET /api/coa?granularity=…&from=…&to=…&office=…&balanceSheet=0\|1` | The P&L on the chart of accounts: `sections[]` (classification → `types[]` → account tree with `own`, `periods`, `total`, `children`), `netIncome`, counts. |
| `GET /api/sync/logs` | Last 50 sync log entries. |

## Data model (SQLite, `data/pnl.db`)

- `connections(realm_id PK, company_name, access_token, refresh_token, expires_at, refresh_token_expires_at, connected_at, updated_at)`
- `pl_lines(office_realm_id, office_name, account_name, account_id, grp, period_start, period_end, amount)`
  with `UNIQUE (office_realm_id, account_id, period_start)`. `grp` is one of Income, COGS, Expenses,
  OtherIncome, OtherExpenses. Only account rows are stored, never report summaries, so `SUM()` never
  double counts.
- `accounts(office_realm_id, account_id, name, fully_qualified_name, account_type, account_sub_type, classification, parent_id, sub_account, active, current_balance, currency, synced_at)`
  with `PRIMARY KEY (office_realm_id, account_id)`. Replaced per company on every sync from
  `GET /v3/company/{realmId}/query?query=select * from Account` (paged 1000 at a time).
- `sync_logs(id, realm_id, company_name, status, row_count, message, start_date, end_date, started_at, finished_at)`

### How the report is parsed (`server/pnlParser.js`)

- `Columns.Column[0]` is the account column, the last column is `Total`; every column in between is a
  month whose dates come from the `StartDate` / `EndDate` MetaData entries (titles are never parsed).
- `Rows.Row[]` is recursive. `Section` rows have an optional `Header`, nested `Rows.Row[]` and a
  `Summary`; `Data` rows are account lines. One row is emitted per non-empty month cell of each `Data`
  row (empty string = no value). A `Section` whose `Header` carries an account id and amounts (a parent
  account with its own postings) also emits rows for those header amounts.
- The nearest top-level `group` is propagated down as `grp`. Computed groups (GrossProfit,
  NetOperatingIncome, NetOtherIncome, NetIncome) and all `Summary` rows are ignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server (:3000) + dashboard (:5173) together. |
| `npm run server` / `npm run web` | Either one alone. |
| `npm run sync` | `curl -X POST http://localhost:3000/sync`. |
| `npm run sync:node` | Same via Node fetch (for shells without curl). |
| `npm test` | Parser, upsert and config tests. |
| `npm run build` | Production build of the dashboard into `web/dist`. |

## Notes and limits (POC)

- Tokens are stored unencrypted in SQLite. A refresh token expires after about 100 days without use,
  after which the company must be reconnected via `/connect`.
- Account ids are only unique within one company, so the "All offices" breakdown groups accounts by
  group + account name.
- Amounts are not currency converted; all companies are assumed to share one currency. Accrual basis.
- For production switch `QBO_ENVIRONMENT=production` with production keys, and move tokens to a proper
  secret store.
