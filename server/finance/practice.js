// Practice KPIs: operational numbers imported from practice-management systems (CSV or JSON), stored per
// office and month, and combined with the QuickBooks P&L (expenses, EBITDA) into ratios.
import { deriveAll } from '../metrics.js';
import { monthsBetween } from '../periods.js';
import { ledgerPl } from '../raw/data.js';

const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** Minimal RFC 4180 CSV parser -> array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row');
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** YYYY-MM from 2026-03, 2026-03-15, 03/2026, 3/15/2026, Mar 2026, March 2026. */
export function toMonth(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  return null;
}
const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[$,%\s()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

/** Import rows ({ header: value }); returns { imported, offices, months, skipped: [{ row, reason }] }. */
export function importPracticeRows(db, pk, rows, { offices, source = 'import' }) {
  if (!rows.length) throw new Error('Nothing to import');
  const headers = Object.keys(rows[0]);
  const find = (cands) => headers.find((h) => cands.includes(norm(h)));
  const officeCol = find(pk.officeColumn);
  const monthCol = find(pk.monthColumn);
  if (!officeCol) throw new Error(`No office column (looked for: ${pk.officeColumn.join(', ')})`);
  if (!monthCol) throw new Error(`No month column (looked for: ${pk.monthColumn.join(', ')})`);
  const metricCols = {};
  for (const h of headers) {
    const n = norm(h);
    const m = pk.metrics.find((x) => norm(x.key) === n || norm(x.label) === n || x.aliases.includes(n) || x.key.toLowerCase() === h.toLowerCase());
    if (m) metricCols[h] = m.key;
  }
  if (!Object.keys(metricCols).length) throw new Error(`No metric columns recognised (expected any of: ${pk.metrics.map((m) => m.label).join(', ')})`);

  const byName = new Map(offices.map((o) => [o.officeName.trim().toLowerCase(), o.realmId]));
  const ids = new Set(offices.map((o) => o.realmId));
  const resolve = (v) => {
    const s = String(v ?? '').trim();
    if (ids.has(s)) return s;
    const alias = pk.officeAliases[s.toLowerCase()];
    if (alias) return ids.has(alias) ? alias : byName.get(alias.toLowerCase()) || null;
    return byName.get(s.toLowerCase()) || null;
  };
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT OR REPLACE INTO practice_kpis (office_realm_id, month, metric, value, source, imported_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const skipped = [];
  let imported = 0;
  const seenOffices = new Set(); const seenMonths = new Set();
  db.transaction(() => {
    rows.forEach((r, i) => {
      const realm = resolve(r[officeCol]);
      if (!realm) { skipped.push({ row: i + 2, reason: `Unknown office "${r[officeCol]}" (add it to officeAliases in config/practice-kpis.json)` }); return; }
      const month = toMonth(r[monthCol]);
      if (!month) { skipped.push({ row: i + 2, reason: `Unreadable month "${r[monthCol]}"` }); return; }
      let any = false;
      for (const [h, key] of Object.entries(metricCols)) {
        const v = toNumber(r[h]);
        if (v == null) continue;
        ins.run(realm, month, key, v, source, now);
        imported++; any = true;
      }
      if (any) { seenOffices.add(realm); seenMonths.add(month); } else skipped.push({ row: i + 2, reason: 'No numeric values' });
    });
  })();
  return { imported, offices: seenOffices.size, months: [...seenMonths].sort(), columns: metricCols, skipped: skipped.slice(0, 50), skippedCount: skipped.length };
}

export function practiceTemplate(pk, offices) {
  const head = ['office', 'month', ...pk.metrics.map((m) => m.key)];
  const lines = [head.join(',')];
  for (const o of offices.slice(0, 3)) lines.push([`"${o.officeName.replace(/"/g, '""')}"`, '2026-09', ...pk.metrics.map(() => '')].join(','));
  return lines.join('\r\n');
}

/** Totals and ratios per office, per month and overall, with P&L figures for the same office-months. */
export function practiceKpis(db, pk, g, { from, to, offices }) {
  const ids = offices.map((o) => o.realmId);
  const list = ids.length ? `IN (${ids.map(() => '?').join(',')})` : "IN ('')";
  const rows = db.prepare(`SELECT office_realm_id AS realmId, month, metric, value, imported_at AS importedAt FROM practice_kpis WHERE office_realm_id ${list} AND month BETWEEN ? AND ?`).all(...ids, from, to);
  const pl = ledgerPl(db, ids, from, to); // P&L from the raw QuickBooks ledger
  const kpiMonths = new Set(rows.map((r) => `${r.realmId}|${r.month}`));
  const expenseGroups = new Set(['COGS', 'Expenses', 'OtherExpenses']);
  const aggOf = Object.fromEntries(pk.metrics.map((m) => [m.key, m.aggregate || 'sum']));

  // Raw sums per office-month, then per office, per month and overall.
  const cell = {}; // realm|month -> { metric: value, pl: groups, addBack }
  const at = (id, m) => (cell[`${id}|${m}`] ||= { v: {}, groups: {}, addBack: 0 });
  for (const r of rows) at(r.realmId, r.month).v[r.metric] = r.value;
  for (const r of pl) {
    if (!kpiMonths.has(`${r.realmId}|${r.month}`)) continue; // like-for-like: P&L only where KPIs exist
    const c = at(r.realmId, r.month);
    c.groups[r.grp] = (c.groups[r.grp] || 0) + r.amount;
    if (expenseGroups.has(r.grp) && g.ebitdaAddBack && (g.ebitdaAddBack.test(r.account) || (r.fullName && g.ebitdaAddBack.test(r.fullName)))) c.addBack += r.amount;
  }
  const combine = (cells) => {
    // sum metrics add up; "last" metrics (stocks like active patients) take each office's latest month, summed over offices.
    const v = {};
    const latest = {}; // metric -> realm -> { month, value }
    for (const { realmId, month, c } of cells) {
      for (const [k, x] of Object.entries(c.v)) {
        if (aggOf[k] === 'last') {
          const cur = (latest[k] ||= {})[realmId];
          if (!cur || month > cur.month) latest[k][realmId] = { month, value: x };
        } else v[k] = (v[k] || 0) + x;
      }
    }
    for (const [k, byRealm] of Object.entries(latest)) v[k] = Object.values(byRealm).reduce((t, x) => t + x.value, 0);
    const groups = {}; let addBack = 0;
    for (const { c } of cells) { for (const [k, x] of Object.entries(c.groups)) groups[k] = (groups[k] || 0) + x; addBack += c.addBack; }
    const d = deriveAll(groups);
    const plv = { 'pl:revenue': d.revenue, 'pl:income': d.income, 'pl:expenses': d.expenses, 'pl:netIncome': d.netIncome, 'pl:ebitda': d.netIncome + addBack };
    const all = { ...v, ...plv };
    for (const dm of pk.derived) {
      if (dm.ratio) {
        const [n, den] = dm.ratio;
        all[dm.key] = all[n] != null && all[den] ? all[n] / all[den] : null;
      } else {
        const parts = Object.entries(dm.formula);
        all[dm.key] = parts.some(([k]) => all[k] != null) ? parts.reduce((t, [k, c]) => t + c * (all[k] || 0), 0) : null;
      }
    }
    const out = {};
    for (const m of pk.metrics) out[m.key] = v[m.key] == null ? null : round2(v[m.key]);
    for (const dm of pk.derived) out[dm.key] = all[dm.key] == null || !Number.isFinite(all[dm.key]) ? null : dm.format === 'percent' ? Math.round(all[dm.key] * 10000) / 10000 : round2(all[dm.key]);
    out.pl = { revenue: round2(plv['pl:revenue']), expenses: round2(plv['pl:expenses']), netIncome: round2(plv['pl:netIncome']), ebitda: round2(plv['pl:ebitda']) };
    return out;
  };
  const entries = Object.entries(cell).map(([k, c]) => { const [realmId, month] = k.split('|'); return { realmId, month, c }; }).filter((e) => Object.keys(e.c.v).length);
  const months = monthsBetween(from, to);
  const names = Object.fromEntries(offices.map((o) => [o.realmId, o.officeName]));
  const perOffice = ids.map((id) => {
    const mine = entries.filter((e) => e.realmId === id);
    if (!mine.length) return null;
    return { realmId: id, officeName: names[id], months: mine.length, values: combine(mine), monthly: Object.fromEntries(months.map((m) => { const x = mine.filter((e) => e.month === m); return [m, x.length ? combine(x) : null]; })) };
  }).filter(Boolean);
  const lastImport = rows.map((r) => r.importedAt).sort().at(-1) || null;
  return {
    from, to, months,
    config: {
      metrics: pk.metrics.map(({ key, label, format }) => ({ key, label, format })),
      derived: pk.derived.map(({ key, label, format, target }) => ({ key, label, format, target })),
      tiles: pk.tiles, table: pk.table,
    },
    totals: entries.length ? combine(entries) : null,
    monthly: months.map((m) => { const x = entries.filter((e) => e.month === m); return { month: m, values: x.length ? combine(x) : null }; }),
    offices: perOffice,
    officesWithData: perOffice.length, officesTotal: ids.length, lastImport,
    hasData: entries.length > 0,
  };
}
