# CLAUDE.md

QuickBooks Online multi-company P&L platform. Client: **Sabuska** (dental group, ~36 QBO companies).
Live on Railway: https://qbo-pnl-dashboard-production.up.railway.app — `/app` = Ledgerview platform, `/` = P&L dashboard (embedded under Reports). Full docs: README.md.

## Layout
- `server/` Express + better-sqlite3 (one SQLite file, Railway volume `/data/pnl.db`)
  - `index.js` OAuth `/connect` `/callback`, `/sync`, gate + per-session scope, `/disconnected`
  - `api.js` dashboard API (`/api/pl`, `/pl/accounts`, `/breakdown`, `/executive`, `/coa`, `/office-categories`, `/meta`); every endpoint takes `req.dashboardScope`
  - `executive.js` Executive view data (like-for-like YoY), `metrics.js`, `categories.js`, `coa.js`, `pnlParser.js`, `sync.js` (serialized queue), `qbo.js`
  - `platform/` multi-tenant API `/platform-api/*`: orgs, entities (`pf_entities.external_id` = QBO realm), users/roles, sync runs, audit
  - `categoryView.js` Category compare (`/api/category-view`), `scheduler.js` daily QBO sync (`sync.schedule`)
  - `raw/` raw QuickBooks records (`qbo_raw`, full pull then CDC, called from `sync.js` after each P&L) -> double-entry `ledger` (`ledger.js`) -> read helpers (`data.js`). The newer tabs use only this; existing tabs use `pl_lines`
  - `offices/` Offices tab (`/api/office-view`, `config/offices.json`): dental practice + sub-DSO as one office, office statement rows, internal-charge elimination, flags, balance sheet tree. Also `/api/analysis` (`analysis.js`): the Analysis tab = statement rows by office / category / row / account over time, settings in `app.config.json` `analysis.*` (`/api/breakdown` in `api.js` is unused)
  - `finance/` APIs for Group overview (eliminations, EBITDA, forecast, alerts), Cash & balance sheet, Budget, Practice KPIs (import into `practice_kpis`), transactions, `/api/raw/status`
- `web/` React+Vite+Recharts+Tailwind dashboard: tabs Executive (default), Dashboard, Analysis, Category compare, Offices, Financial KPIs (same `Offices.jsx` with `base=officesSheet.apiPath`, rules in `config/offices-sheet.json` which `extends` offices.json), Group overview, Cash & balance sheet, Chart of accounts. Budget and Practice KPIs tabs removed 2026-10-20 (APIs still served). Newer tabs share `components/ui.jsx`
- `platform/` React app for Ledgerview (`/app`)
- `config/` JSON config: `platform.config.json` (roles/permissions/nav/plans), `platform.seed.json` (demo data, seeds once), `executive.json` (cost/payer bucket rules), `dashboard-categories.json` (office categories), `category-view.json`, `offices.json` (office pairs, statement rows, flags), `group-overview.json` (segments, intercompany rules, EBITDA, alerts), `raw-sync.json` (raw entities pulled), `finance.json` (cash/aging/vendor/budget settings), `practice-kpis.json`. `app.config.json` = dashboard behaviour.
- `test/` node:test; `scripts/ui-smoke/` jsdom browser smoke test

## Commands
- `npm run dev` (server :3000, web :5173, platform :5174) · `npm test` · `npm run build`
- `npm run ui-smoke` (needs a running server; `BASE=<url>` for live) — run before every UI deploy
- Deploy: `railway up --ci` (CLI in `%APPDATA%\npm`; prepend to PATH in PowerShell: `$env:Path += ";$env:APPDATA\npm"`)
- Railway vars hold secrets: QBO prod keys, `SESSION_SECRET`, `APP_USER/APP_PASSWORD`, `PUBLIC_URL`, `DB_PATH=/data/pnl.db`. Never commit `.env`.

## Rules
- Everything behavioural goes in JSON config, validated at startup with errors naming the key. No tenant names/IDs in code.
- Verify before claiming done: `npm test`, `npm run build`, `npm run ui-smoke`, then check live after `railway up`.
- Access: platform sessions are scoped to the realms of entities the user may see; `/connections`, `/disconnect`, linking by realm id = platform admin only.
- Connections without an org (plain `/connect`) auto-link to the only live-reports org; `[connect]` log line records it.
- Company names come from QBO CompanyInfo every sync (never renamed); legal name, address, industry stored in `connections.details_json`.

## Gotchas
- Windows + Git Bash: avoid `\b`/backslashes in heredocs written via bash (once turned into literal backspaces and broke SQL). Prefer Write tool or a .cjs script file for code edits.
- Safety check blocks `rm` on variable paths; use new file names instead.
- No git commits since the initial one unless the user asks.
