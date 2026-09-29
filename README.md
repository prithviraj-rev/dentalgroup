# dentalgroup: QBO P&L multi-company POC

Connects to several QuickBooks Online (sandbox) companies with OAuth 2.0, pulls a monthly Profit & Loss report from each into SQLite, and shows it in a React + Recharts dashboard: per-office or consolidated, monthly / quarterly / YOY, with an adjustable timeline.

```
QBO companies ──OAuth (one per realmId)──▶ tokens.json
             ──ProfitAndLoss report──▶ npm run sync ──▶ data/pnl.db (SQLite)
                                                        │
                        Express API (:3000/api) ◀───────┘
                                   │
                        React dashboard (Vite :5173)
```

## Setup

Requires Node 20.12+.

1. In the Intuit developer portal, open your app, go to **Keys & credentials (Development)** and add the redirect URI `http://localhost:3000/callback`.
2. `copy .env.example .env`, then fill in `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`.
3. `npm install`

## Scripts

| Command | What it does |
|---|---|
| `npm run connect` | Starts the server on http://localhost:3000. Click **Connect a QuickBooks company** once per sandbox company, choosing a different company on Intuit's consent screen each time. Tokens are saved per `realmId` in `tokens.json`. |
| `npm run sync` | For every company in `tokens.json`, fetches `ProfitAndLoss` with `summarize_column_by=Month` for the last 24 months (including the current month to date) and replaces that company's rows in `data/pnl.db`. Options: `-- --months 36`, `-- --method Cash`, `-- --realm <id>`. |
| `npm run dashboard` | Starts the API server (:3000) and the Vite dev server (:5173) together. Stop `npm run connect` first, since both use port 3000. |
| `npm test` | Unit tests for the P&L report parser. |

To create extra sandbox companies, use **Sandbox** in the developer portal (you can have several per account).

## Data

`pnl_rows` table in SQLite:

| column | notes |
|---|---|
| realm_id | QBO company id |
| office_name | QBO company name by default. To rename an office, set `office_name` in `tokens.json` and re-run sync. |
| account_name | Sub-accounts are written as `Parent:Child`, the same convention QBO uses for fully qualified names. |
| account_type | Income, Cost of Goods Sold, Expense, Other Income, Other Expense (taken from the report section) |
| period | `YYYY-MM` |
| amount | As reported. Expenses are positive. Only leaf account rows are stored, so `SUM()` never double counts subtotals. |

Net income = Income − COGS − Expense + Other Income − Other Expense. This matches the report's Net Income line, and a test checks it.

`sync_runs` records each company's last sync.

## Dashboard

- **Office:** all offices (consolidated) or a single office.
- **View:** Monthly or Quarterly (revenue and costs as columns, net income as a line), or YOY (one line per calendar year across Jan–Dec for a chosen metric, plus a table with like-for-like % change).
- **Timeline:** all synced months, last 24/12/6/3 months, year to date, or a custom from/to month.
- KPI tiles compare against the prior period of equal length when that period has been synced.
- The consolidated view adds an office ranking. Every view includes the largest cost accounts and a full P&L statement table.
- You can set the initial state in the URL: `?office=all&view=yoy&timeline=12&metric=netIncome`.
- Supports light and dark mode.

## Notes and limits (POC)

- Tokens are stored in plain JSON. Access tokens last 1 hour and are refreshed automatically. Refresh tokens rotate on use, and the sync saves the new one. A refresh token expires after about 100 days without use, after which the company must be reconnected. The sync warns 14 days before this happens.
- Amounts are not currency-converted. All companies are assumed to share one currency.
- Uses the accrual basis by default.
- For production, switch `QBO_ENVIRONMENT=production`, use production keys, and move tokens and data to a real database or secret store.
