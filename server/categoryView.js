// Category compare tab (config/category-view.json): QuickBooks accounts clubbed into categories and
// category groups, per office and per period, so offices (or office categories) can be benchmarked
// side by side. Separate from the Executive view and the Dashboard: nothing here feeds those tabs.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { ROOT, appConfig } from './config.js';
import { metricDefs } from './metrics.js';
import { bucketsFor, bucketKey } from './periods.js';
import { loadCategories, assignCategories } from './categories.js';
import { ledgerPl } from './raw/data.js';

const VIEWS = ['expense', 'revenue'];
const LEVELS = ['category', 'group'];
const MEASURES = ['pctRevenue', 'amount', 'monthlyAvg'];
const SHADES = ['median', 'target'];
const round2 = (n) => Math.round(n * 100) / 100;

function compileTarget(t, where, name) {
  if (t == null) return null;
  const out = {};
  for (const side of ['min', 'max']) {
    if (t[side] == null) continue;
    if (typeof t[side] !== 'number' || t[side] < 0 || t[side] > 1000) throw new Error(`${name}: ${where}.targetPct.${side} must be a percentage number (e.g. 25)`);
    out[side] = t[side] / 100;
  }
  return Object.keys(out).length ? out : null;
}

function compileRules(block, kind, name, groupLabels) {
  if (!block || !Array.isArray(block.categories)) throw new Error(`${name}: ${kind}.categories must be a list`);
  const seen = new Set();
  const colors = new Set();
  const rules = block.categories.map((r, i) => {
    const where = `${kind}.categories[${i}]`;
    if (!r.label) throw new Error(`${name}: ${where} needs a label`);
    if (seen.has(r.label)) throw new Error(`${name}: ${where} duplicate label "${r.label}"`);
    seen.add(r.label);
    let re = null;
    if (r.accounts) {
      try { re = new RegExp(r.accounts, 'i'); } catch (e) { throw new Error(`${name}: ${where}.accounts is not a valid pattern: ${e.message}`); }
    }
    if (!re && !(r.subTypes || []).length) throw new Error(`${name}: ${where} needs accounts or subTypes`);
    if (kind === 'expense' && !groupLabels.has(r.group)) throw new Error(`${name}: ${where}.group "${r.group}" is not in groups`);
    if (r.color != null) {
      if (!Number.isInteger(r.color) || r.color < 1 || r.color > 8) throw new Error(`${name}: ${where}.color must be 1-8`);
      if (colors.has(r.color)) throw new Error(`${name}: ${where}.color ${r.color} is already used by another ${kind} category`);
      colors.add(r.color);
    }
    return { label: String(r.label), group: r.group || null, color: r.color ?? null, re, subTypes: new Set(r.subTypes || []), target: compileTarget(r.targetPct, where, name) };
  });
  const other = { label: block.other?.label || 'Other', group: block.other?.group || null };
  if (seen.has(other.label)) throw new Error(`${name}: ${kind}.other.label "${other.label}" clashes with a category`);
  if (kind === 'expense' && !groupLabels.has(other.group)) throw new Error(`${name}: expense.other.group "${other.group}" is not in groups`);
  return { rules, other };
}

export function loadCategoryViewConfig(file = path.resolve(ROOT, appConfig.categoryView?.file || 'config/category-view.json')) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not parse ${file}: ${e.message}`); }

  const groups = (raw.groups || []).map((g, i) => {
    if (!g.label) throw new Error(`${name}: groups[${i}] needs a label`);
    if (g.color != null && (!Number.isInteger(g.color) || g.color < 1 || g.color > 8)) throw new Error(`${name}: groups[${i}].color must be 1-8 or null`);
    return { label: g.label, color: g.color ?? null, target: compileTarget(raw.groupTargets?.[g.label]?.targetPct, `groupTargets.${g.label}`, name) };
  });
  const groupLabels = new Set(groups.map((g) => g.label));
  if (groupLabels.size !== groups.length) throw new Error(`${name}: group labels must be unique`);
  for (const k of Object.keys(raw.groupTargets || {})) if (!k.startsWith('$') && !groupLabels.has(k)) throw new Error(`${name}: groupTargets "${k}" is not in groups`);

  const expense = compileRules(raw.expense, 'expense', name, groupLabels);
  const revenue = compileRules(raw.revenue, 'revenue', name, groupLabels);
  revenue.otherIncome = raw.revenue?.otherIncome || 'Other income';

  const d = { view: 'expense', level: 'category', measure: 'pctRevenue', compareBy: 'office', groupRowsBy: 'none', shade: 'median', trendSeries: 5, ...raw.defaults };
  if (!VIEWS.includes(d.view)) throw new Error(`${name}: defaults.view must be ${VIEWS.join(' | ')}`);
  if (!LEVELS.includes(d.level)) throw new Error(`${name}: defaults.level must be ${LEVELS.join(' | ')}`);
  if (!MEASURES.includes(d.measure)) throw new Error(`${name}: defaults.measure must be ${MEASURES.join(' | ')}`);
  if (!SHADES.includes(d.shade)) throw new Error(`${name}: defaults.shade must be ${SHADES.join(' | ')}`);
  if (!Number.isInteger(d.trendSeries) || d.trendSeries < 1 || d.trendSeries > 8) throw new Error(`${name}: defaults.trendSeries must be 1..8`);
  delete d.$comment;

  const denominator = raw.denominator || 'revenue';
  const def = metricDefs()[denominator];
  if (!def || def.kind !== 'sum') throw new Error(`${name}: denominator "${denominator}" must be a sum metric in app.config.json metrics`);
  const clampRelative = raw.shading?.clampRelative ?? 0.5;
  if (typeof clampRelative !== 'number' || clampRelative <= 0) throw new Error(`${name}: shading.clampRelative must be a positive number`);

  return { groups, expense, revenue, defaults: d, denominator, clampRelative };
}

/** Category for one P&L line. Name and detail type first, then the full QuickBooks path (Parent:Child). */
export function classifyLine(cv, grp, account, subType, fullName) {
  if (grp === 'OtherIncome') return { kind: 'revenue', label: cv.revenue.otherIncome };
  const expense = appConfig.groups.expenseGroups.includes(grp);
  if (!expense && grp !== 'Income') return null;
  const set = expense ? cv.expense : cv.revenue;
  const hit = set.rules.find((r) => (r.re && r.re.test(account)) || (subType && r.subTypes.has(subType)))
    || (fullName && fullName !== account ? set.rules.find((r) => r.re && r.re.test(fullName)) : null);
  return { kind: expense ? 'expense' : 'revenue', label: hit ? hit.label : set.other.label };
}

/** Public config for the browser (no compiled regexes). */
export function publicCategoryViewConfig(cv) {
  const strip = (set, kind) => {
    const cats = set.rules.map((r) => ({ label: r.label, group: r.group, color: r.color, target: r.target }));
    cats.push({ label: set.other.label, group: set.other.group, color: null, target: null });
    if (kind === 'revenue') {
      // Revenue categories without an explicit color take the free palette slots in file order.
      const used = new Set(cats.map((c) => c.color).filter(Boolean));
      const free = [1, 2, 3, 4, 5, 6, 7, 8].filter((s) => !used.has(s));
      for (const c of cats) if (c.color == null && c.label !== set.other.label && free.length) c.color = free.shift();
      cats.push({ label: set.otherIncome, group: null, color: null, target: null, otherIncome: true });
    }
    return cats;
  };
  return {
    groups: cv.groups, expense: strip(cv.expense, 'expense'), revenue: strip(cv.revenue, 'revenue'),
    defaults: cv.defaults, denominator: cv.denominator, clampRelative: cv.clampRelative,
  };
}

/**
 * Per-office, per-period category amounts for the filters (same shape as api.js parseFilters output).
 * Grouping offices into office categories, ratios and medians happen in the browser.
 */
export function categoryViewData(db, cv, f, officeList) {
  // Built from the ledger of raw QuickBooks records (server/raw), not from the P&L report lines.
  const names = Object.fromEntries(officeList.map((o) => [o.realmId, o.officeName]));
  const ids = f.offices ? f.offices.filter((id) => names[id]) : officeList.map((o) => o.realmId);
  const rows = ledgerPl(db, ids, f.from, f.to).map((r) => ({ ...r, officeName: names[r.realmId] || r.realmId, accountIds: r.accountId }));

  const buckets = bucketsFor(f.from, f.to, f.granularity);
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const offices = new Map();
  const accounts = {}; // realm|kind|category|grp|account -> amount
  const accountIds = {}; // same key -> Set of QuickBooks account ids (for the live transaction drill-down)
  for (const r of rows) {
    const bk = bucketKey(r.month, f.granularity);
    if (!offices.has(r.realmId)) {
      offices.set(r.realmId, { realmId: r.realmId, officeName: r.officeName, groups: {}, cats: {}, months: new Set(), periods: Object.fromEntries(buckets.map((b) => [b.key, { groups: {}, cats: {} }])) });
    }
    const o = offices.get(r.realmId);
    const p = o.periods[bk];
    if (!p) continue;
    o.months.add(r.month);
    add(o.groups, r.grp, r.amount);
    add(p.groups, r.grp, r.amount);
    const c = classifyLine(cv, r.grp, r.account, r.subType, r.fullName);
    if (!c) continue;
    // Keyed by kind and label: a revenue and an expense category may share a name (e.g. Insurance).
    const key = `${c.kind === 'expense' ? 'e' : 'r'}:${c.label}`;
    add(o.cats, key, r.amount);
    add(p.cats, key, r.amount);
    const ak = `${r.realmId}\u0000${c.kind}\u0000${c.label}\u0000${r.grp}\u0000${r.account}`;
    add(accounts, ak, r.amount);
    for (const id of String(r.accountIds || '').split(',')) if (/^\d+$/.test(id)) (accountIds[ak] ||= new Set()).add(id);
  }

  const roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));
  return {
    from: f.from, to: f.to, granularity: f.granularity,
    periods: buckets.map((b) => ({ key: b.key, label: b.label, months: b.months.length })),
    offices: [...offices.values()].map((o) => ({
      realmId: o.realmId, officeName: names[o.realmId] || o.officeName, months: o.months.size,
      groups: roundObj(o.groups), cats: roundObj(o.cats),
      periods: Object.fromEntries(Object.entries(o.periods).map(([k, v]) => [k, { groups: roundObj(v.groups), cats: roundObj(v.cats) }])),
    })).sort((a, b) => a.officeName.localeCompare(b.officeName)),
    accounts: Object.entries(accounts).filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => {
      const [realmId, kind, category, grp, account] = k.split('\u0000');
      return { realmId, kind, category, grp, account, amount: round2(v), accountIds: [...(accountIds[k] || [])] };
    }),
    hasData: rows.length > 0,
  };
}

/**
 * GET /api/category-view: data + config for the Category compare tab.
 * parseFilters comes from api.js so office scoping and filters behave exactly like the other tabs.
 */
export function createCategoryViewRouter(db, { parseFilters, scheduleStatus = () => null }) {
  const router = Router();
  const cv = loadCategoryViewConfig();
  const officeCategories = loadCategories();
  const publicCfg = publicCategoryViewConfig(cv);

  const allOffices = (scope) => db.prepare(`
    SELECT realm_id AS realmId, company_name AS officeName FROM connections
    UNION SELECT DISTINCT office_realm_id, office_name FROM pl_lines WHERE office_realm_id NOT IN (SELECT realm_id FROM connections)`).all()
    .filter((o) => !scope || scope.realms.includes(o.realmId));

  router.get('/category-view', (req, res) => {
    let f;
    try { f = parseFilters(req.query, req.dashboardScope); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const list = allOffices(req.dashboardScope);
    const data = categoryViewData(db, cv, f, list);
    const dims = officeCategories.dimensions.map((d) => ({ id: d.id, label: d.label, otherLabel: d.otherLabel, map: assignCategories(db, d, list) }));
    const scopeIds = req.dashboardScope ? req.dashboardScope.realms : null;
    const lastSync = db.prepare(`SELECT MAX(finished_at) AS at FROM sync_logs WHERE status = 'success'${scopeIds ? ` AND realm_id IN (${scopeIds.map(() => '?').join(',') || "''"})` : ''}`).get(...(scopeIds || []))?.at || null;
    res.json({
      ...data,
      offices: data.offices.map((o) => ({ ...o, dims: Object.fromEntries(dims.map((d) => [d.id, d.map[o.realmId] || d.otherLabel])) })),
      dimensions: dims.map((d) => ({ id: d.id, label: d.label })),
      config: publicCfg,
      sync: { lastSync, schedule: scheduleStatus() },
    });
  });

  return router;
}
