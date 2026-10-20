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
- **Compare offices:** choose `Compare offices…` in the office selector, then tick 2 to 4 offices
  (`compare.maxOffices`). Pick a metric (income, expenses or net income) and you get one tile per office
  with YoY, one line per office on the chart and an office × period table with a combined row. Office
  colors are fixed per office, so they stay the same whichever subset you pick. (The per-account
  breakdown table was removed from this tab: the Chart of accounts tab shows the accounts as a tree and
  the Offices tab shows the accounts behind each statement row. `GET /api/pl/accounts` is still served.)
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
| `npm start` | Production mode: one server on :3000 serving the API and `web/dist`, with basic auth when `APP_USER`/`APP_PASSWORD` are set. |
| `npm run preview` | `build` then `start`. |

## Executive view

The default tab of the dashboard (`dashboard.defaultTab`). One call, `GET /api/executive?from=&to=&office=`,
returns the selected range and the same range a year earlier. Sections, in order (`config/executive.json`
→ `sections`):

| Section | What it shows |
|---|---|
| KPIs | Revenue, operating expenses, net income, net margin with 12-month sparklines and YoY; key cost categories as % of revenue |
| Trend | Revenue by month vs the same month last year; net income by month (profit / loss) with a rolling average |
| Office leaderboard | Every office with revenue bar, YoY, net income, diverging margin bar and a monthly sparkline; sortable, click to open the office |
| Revenue vs net margin | Scatter of offices: size of business vs profitability, group margin as a reference line |
| Heatmap | Net margin per office per month (blue profit, red loss) |
| Payer mix | Medicaid / insurance / patient payments / financing for the group (donut) and per office (100% bars) |
| Cost structure | "Where each revenue dollar goes" bar, and each cost category as % of revenue for every office |
| Profit bridge | Waterfall from revenue through each cost category to net income |
| What changed | Accounts that moved net income the most vs last year, helped and hurt |

Cost categories and payer groups are rule lists in `config/executive.json` (regular expressions on account
names and QuickBooks detail types, first match wins). The dashboard opens on the trailing
`dashboard.defaultRange.snapMonths` (12) months of synced data, and sync history starts at
`sync.startDate` (2024-01-01) so year-over-year comparisons have a full prior year.

## Analysis, metrics and office categories

- **Analysis tab** (dashboard): the same figures as the Offices tab, over time. Pick a metric (an office
  statement row: Net collections, Provider compensation, …, Office EBITDA, Operating cash flow, or a row as
  % of net collections) and a **Group by**: office (dental practice + sub-DSO as one), an office category,
  statement row (every cost row at once) or the QuickBooks accounts behind the row. Chart as lines, grouped
  bars, stacked bars, small multiples or ranked totals (top `analysis.topN` series, the rest folded into
  "Other"), plus a full table with per-period values, totals and share. Computed from the raw QuickBooks
  records with the rules of `config/offices.json` (pairs, internal charges, payroll split); options in
  `app.config.json` `analysis.*`, metric keys validated against the statement rows at startup. Needs the
  Offices tab enabled. API: `GET /api/analysis?by=…&metric=…` with the same filters as `/api/pl`
  (`/api/breakdown`, the older P&L-report breakdown, is still served but no tab uses it).
- **Metrics** (`metrics` in `app.config.json`): sums of P&L groups with a sign (`formula`) or ratios of two
  other metrics (`ratio`, shown as %). Shipped: income, expenses, net income, revenue, COGS, gross profit,
  operating expenses, net operating income, other income, other expenses, gross / operating / net margin,
  operating expenses % of revenue. Every metric is available in compare mode (`compare.metrics`), the
  Analysis tab (`analysis.metrics`) and the second KPI row on the Dashboard (`dashboard.secondaryKpis`).
- **Office categories** (`config/dashboard-categories.json`): dimensions that assign each office to a
  category, either by rules (name pattern or explicit office list) or from the entity groups set on the
  Ledgerview Entities page. Categories appear in the office picker (combined figures for that category),
  as "Add a category" in compare mode, and as a Group by in Analysis. `GET /api/office-categories`.
- **No comparison limit:** `compare.maxOffices: null`. With more than 8 offices the office chart switches
  to small multiples or ranked totals, since the palette has 8 distinguishable colors.

## Category compare tab

Compares offices side by side on **categories of accounts** instead of single accounts. Separate from the other
tabs: its own endpoint (`GET /api/category-view`, same filters and office scoping as `/api/pl`), its own config
(`config/category-view.json`) and its own code (`server/categoryView.js`, `web/src/categoryMath.js`,
`web/src/components/CategoryCompare.jsx`). Editing it never changes the Dashboard, Executive or Analysis tabs.

- **Club by** categories (Provider compensation, Staff payroll, Lab fees, Dental supplies, Occupancy, ...) or
  category groups (Personnel, Clinical, Facility, Sales & admin, Financing & owners). Revenue view shows payer sources.
- **Show** % of revenue (common-size P&L, the standard way to compare offices of different size), amount, or monthly average.
- **Compare** offices, or office categories combined (Brand, Company type from `config/dashboard-categories.json`);
  **Group rows by** adds subtotal rows.
- Benchmark matrix shaded against the **peer median** or the **target** per category (`targetPct` in the config;
  the defaults are commonly cited dental ranges, replace them with your own). Categories an office does not book
  show as blank and stay out of the median.
- Click a column to sort and chart it (ranked bars with median + target, trend for the ticked rows); click a cell
  for the QuickBooks accounts behind it; Export CSV.

### Daily QuickBooks pull

`sync.schedule` in `app.config.json` runs the same sync as **Sync now** every day at `time` in `timezone`
(default 03:00 America/Chicago) and catches up on start if the last successful sync is older than `maxAgeHours`.
Turn it off with `enabled: false` or env `SYNC_SCHEDULE=off`. It runs inside the server process, so the host must
keep the service running (Railway does by default; do not enable app sleeping).

## Group overview, Cash & balance sheet, Offices (client sheet)

More tabs, each with its own config file and endpoint (`server/finance/`, `server/offices/`), separate from the P&L tabs.

**Group overview** (`GET /api/group-overview`, `config/group-overview.json`)
- P&L by segment (the Company type groups from the Entities page), **consolidated** or as reported.
- **Intercompany eliminations**: each rule names the receiving accounts (income side) and the paying accounts
  (expense side), optionally limited to segments. Only the amount found on both sides is eliminated, month by month,
  so consolidated net income never moves; the unmatched rest is listed in the reconciliation table with the accounts
  behind it. QuickBooks P&L lines do not carry the counterparty, so the rules are account-name based: check the
  reconciliation and narrow the rules if a side matches outside payments (e.g. rent to outside landlords).
- **EBITDA** (net income + D&A, interest and taxes matched by `ebitda.addBack`), trailing twelve months,
  **full-year outlook** (last year's seasonality scaled by this year's trend, else recent run rate).
- **Office scorecard** (revenue, like-for-like growth, margins, EBITDA, cost targets met) and **alerts** (cost spikes
  vs an office's own recent months, revenue drops vs last year, loss streaks, costs over target).

**Cash & balance sheet** (`GET /api/finance/cash`, `config/finance.json`)
- Cash, working capital, current ratio, debt, A/R and A/P, runway; cash and debt trend; cash by company; monthly
  cash flow (operating / investing / financing); profit vs cash conversion; A/R and A/P aging with the most overdue
  parties; top vendors across companies; balance sheet by company.

**Budget** and **Practice KPIs** are no longer tabs in the dashboard (removed 2026-10-20: no QuickBooks budgets
and no practice-system import for this client). Their APIs still exist: `GET /api/finance/budget` (budget vs actual
from QuickBooks budgets) and `GET/POST /api/practice-kpis` (`config/practice-kpis.json`, CSV / JSON import of
production, collections, visits, new patients, combined with the P&L).

**Offices (client sheet)** (`GET /api/office-sheet…`, `config/offices-sheet.json`, `app.config.json` `officesSheet`)
- The same page as the Offices tab, served by the same code with another row config: every statement row holds
  exactly the account numbers of column E of the client's Financial KPI sheet, matched at the start of the account
  name or of any level of its path (402, 503.1 / 504 / 506.3 / 576 / 506.2, 503, 505 / 517, 521, 536, 559, 507,
  540.1 for Small Equipment Lease, 650), no payroll-tax split, loan payments added to operating cash flow. Accounts
  the sheet does not assign (500, 501, 502, 586, 560, …) land in Other Expenses; income accounts outside 402 go to
  the memo line "Income not assigned to a row". The config `extends` `config/offices.json` for everything else
  (pairing, internal charges, flags, periods). Combined offices are shared between the two tabs.

**Offices** (`GET /api/office-view`, `GET /api/office-view/:key`, `config/offices.json`, `server/offices/`)
- Each dental practice and its sub-DSO are read as **one office** (income lands in the dental company, expenses in
  the sub-DSO). Pairs are listed explicitly (QuickBooks realm ids, with city/state/name overrides) or found
  automatically: every company in the configured office categories becomes an office, and a company whose name
  matches `autoPair.subDsoPattern` joins the office at the same QuickBooks city and state. Names follow
  `naming.pattern` (`Dental Office - {city}`).
- **Internal charges** between the two companies (management charge, staffing, profit sent across) are removed from
  both sides month by month, only as far as the two sides match. The rest follows `internal.<side>.unmatched`:
  `memo` (default for income) takes it out of the statement and lists it under "Not in the rows above", since
  a sub-DSO's management or staffing income is not patient collections; `rows` (default for expense) leaves it in
  the rows as booked. A line counts when its payee / customer is the partner company (names compared
  loosely, plus per-office `aliases`) or its account matches `internal.expense` / `internal.income`.
- **Portfolio**: period (month, last full quarter, YTD, TTM) ending at the *To* month, totals, needs-attention
  flags (net loss, collections down, uncategorized, low cash, AR high, books behind, stale pull, internal charges
  unmatched, pull failed; thresholds in `flags`), sortable office table, CSV export.
- **Combined profit and loss** (one office, below the statement): the companies' full P&L as booked in QuickBooks,
  accounts merged by section, type and account path (sub-accounts merge only under the same parent), with Gross
  profit, Net operating income, Net other income and Net income, one column per month or per company (toggle),
  CSV export. No internal-charge removal and no payroll split, so every line ties to QuickBooks. The trends add
  revenue and net income by month as booked. Combining companies opens the combined office straight away.
- **One office**: the office statement by month with Period and Prior-year columns, rows from `rows.list` in
  order (Net collections, Provider compensation, Staff payroll, Provider training & hiring, Dental supplies incl.
  dental equipment maintenance, Laboratory, Rent / occupancy, Marketing, Other expenses, Office EBITDA before
  management fees, DSO management fees, Office EBITDA, Operating cash flow), each expandable to the main QuickBooks
  accounts behind it, shown at the level the row's rule matched (504 Hygienist, 503.1 Dental Contract Labor;
  deeper sub-accounts roll up into it; `statement.rollUpSubAccounts`: "matched" | true = main account | false). Payroll taxes,
  benefits and bonuses are split across the rows in `payrollTaxes.allocateTo` in proportion. Depreciation /
  amortization / interest, other (non-operating) income and profit transfers (`profitTransfers`, the "fake"
  management fees) are memo lines, never in EBITDA. Balance sheet at the as-of month end and a year earlier (both
  companies merged by account path, cumulative net income in equity) and 24-month trends of collections, EBITDA and
  cash. Picking a single company in the header opens its office.
- **Combine companies** (button on the tab, roles that may manage data): tick the companies that are one practice, give the
  office a name, save. Saved offices live in the database (table office_groups, POST/DELETE /api/office-view/setup), override
  the config pairs, and a company can be in one saved office only. Remove one to fall back to the automatic pairing.

**Raw QuickBooks data** (`server/raw/`, `config/raw-sync.json`): the newer tabs (Category compare, Offices, Group overview,
Cash & balance sheet, Budget, Practice KPIs) are built only from raw records pulled through the QuickBooks Accounting
API: Accounts, Customers, Vendors, Items, Classes, Locations, Invoices, Sales receipts, Payments, Credit memos,
Refunds, Deposits, Bills, Bill payments, Purchases, Vendor credits, Journal entries, Transfers, Budgets, tax rates
and agencies. Each record is stored unmodified in `qbo_raw`. The first sync of a company pulls its full history; later
syncs pull only what changed (`cdc` endpoint), with a full re-pull every `fullRefreshDays`. After each pull the
company's double-entry **ledger** (`ledger` table, debit positive) is rebuilt from the records; P&L, balances, cash
flow (direct method), aging (open invoices / bills by due date), vendor spend, budgets and the transaction drill-down
all sum from it. Every tab shows how many raw records it is built from and how many balance sheet account balances
match the CurrentBalance QuickBooks returns on each Account (`GET /api/raw/status` per company). Not available from
the API, so not in these tabs: QuickBooks Payroll paychecks (payroll booked by journal entry is included), inventory
cost-of-goods postings and US sales tax payments. The existing tabs keep using the P&L report sync and are unaffected.

## Multi-client platform (`/app`)

A multi-tenant shell around the P&L dashboard: organizations (clients), their entities and entity groups,
users with roles and per-entity access, sync history, activity log and settings, plus a platform-admin
view across all organizations. The existing dashboard is embedded unchanged under **Reports**.

- **URLs:** `/app` (sign in), `/platform-api/*` (JSON API). The dashboard stays at `/`.
- **Code:** `server/platform/` (API, sessions, storage in `pf_*` tables of the same SQLite file) and
  `platform/` (React + Vite + Tailwind web app). `npm run dev` now also starts it on http://localhost:5174/app.
- **Sign-in:** email and password, signed session cookie (`SESSION_SECRET` env var). In demo mode the
  login page lists every sample account; the password is `auth.demoPassword`.
- **Live vs sample:** entities with an `externalId` (a connected QuickBooks realm) use real synced data and
  the real sync; all others show generated figures marked "Sample data". Only organizations with
  `liveDashboard: true` get the embedded dashboard, since it shows that client's real books, and a
  platform session opens it without the basic-auth prompt.

### Configuration files (`config/`)

| File | Holds |
|---|---|
| `platform.config.json` | Branding, auth/demo settings, the permission list, roles and the permissions each grants, sidebar navigation (enable/disable modules, permission per item), entity and organization statuses, connectors, plans and their limits, industries, currencies, time zones, sync schedules, brand colors, org defaults, overview window, sync simulation, reports embed, sample-data settings. |
| `platform.seed.json` | Sample platform admins, organizations, groups, entities (live or sample with revenue and margin) and users with roles and entity access. Loaded into an empty database on startup. |

Both are validated at startup with errors that name the bad key (unknown permission on a role, a default
plan that does not exist, a seed user pointing at a missing entity, …). Add a role by adding it to `roles`
with a permission list; hide a module by setting its navigation item to `enabled: false`. To reload the
seed, delete the `pf_*` tables (or point `DB_PATH` at a new file). `PLATFORM_CONFIG_DIR` and
`PLATFORM_NAME` env vars override the folder and product name.

## Hosting it online

In production one Node process serves both the API and the built dashboard on one origin, behind a
basic-auth login. SQLite must live on a persistent disk. `npm start` runs that mode locally
(`npm run preview` builds first). Routes: `/` dashboard, `/connections` connections page, `/connect`,
`/callback`, `/sync`, `/api/*`, `/health` (no auth).

Environment variables for any host:

| Variable | Value |
|---|---|
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | Intuit keys (Development keys for sandbox companies). |
| `PUBLIC_URL` | The deployment's HTTPS URL, e.g. `https://qbo-pnl.up.railway.app`. `QBO_REDIRECT_URI` defaults to `<PUBLIC_URL>/callback`, so leave `QBO_REDIRECT_URI` unset on the host (the local `.env` is not uploaded). |
| `APP_USER`, `APP_PASSWORD` | Login for the whole app. Set both. |
| `DB_PATH` | SQLite file on the persistent disk, e.g. `/data/pnl.db`. |
| `NODE_ENV=production`, `SERVE_WEB=1` | Set by `npm start`; set explicitly if the host runs `node server/index.js`. |
| `QBO_ENVIRONMENT` | `sandbox` (default) or `production`. |

Then add `<PUBLIC_URL>/callback` to the Redirect URIs of the Intuit app (Development tab for sandbox).
Intuit requires HTTPS for any non-localhost redirect URI, which every host below provides.

### Railway (recommended)

1. Create an account at https://railway.com and install the CLI: `npm i -g @railway/cli`, then `railway login`.
2. In this folder: `railway init` (new project), then `railway up` to build and deploy. `railway.json`
   sets the build (`npm ci && npm run build`), start (`npm start`) and the `/health` check.
3. In the Railway dashboard open the service → **Settings → Volumes → Add volume**, mount path `/data`.
4. **Settings → Networking → Generate domain**, copy the URL.
5. **Variables**: add the table above (`DB_PATH=/data/pnl.db`, `PUBLIC_URL=https://<your domain>`,
   keys, `APP_USER`, `APP_PASSWORD`). Railway redeploys.
6. Register `https://<your domain>/callback` on the Intuit app, open `https://<your domain>/connect`,
   connect each company, then **Sync now** in the dashboard.

### Fly.io

`fly.toml` and the `Dockerfile` are included: `fly launch --no-deploy --copy-config`,
`fly volumes create data --size 1`, `fly secrets set …` (see the comment in `fly.toml`), `fly deploy`.

### Render / other container hosts

Use the `Dockerfile`, attach a persistent disk at `/data`, and set the variables above. Render's
persistent disks need a paid instance.

### Quick demo from your own PC

`npm run preview` then expose port 3000 with a tunnel such as `cloudflared tunnel --url http://localhost:3000`
or ngrok. Register the tunnel's `https://…/callback` on the Intuit app and set `PUBLIC_URL` to the
tunnel URL. The link works only while your machine and the tunnel are up.

## Notes and limits (POC)

- Tokens are stored unencrypted in SQLite. A refresh token expires after about 100 days without use,
  after which the company must be reconnected via `/connect`.
- Account ids are only unique within one company, so the "All offices" breakdown groups accounts by
  group + account name.
- Amounts are not currency converted; all companies are assumed to share one currency. Accrual basis.
- For production switch `QBO_ENVIRONMENT=production` with production keys, and move tokens to a proper
  secret store.
