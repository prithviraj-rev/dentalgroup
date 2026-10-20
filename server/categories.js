// Office categories (config/dashboard-categories.json): assigns each office (QuickBooks realm) to a
// category per dimension, by name rules or by the entity groups set in the platform.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, appConfig } from './config.js';

export function loadCategories(file = path.resolve(ROOT, appConfig.officeCategories?.file || 'config/dashboard-categories.json')) {
  if (!fs.existsSync(file)) return { dimensions: [] };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
  const ids = new Set();
  const dimensions = (raw.dimensions || []).map((d) => {
    if (!d.id || !/^[a-z0-9_-]+$/i.test(d.id)) throw new Error(`${path.basename(file)}: every dimension needs an id (letters, digits, - or _)`);
    if (ids.has(d.id)) throw new Error(`${path.basename(file)}: duplicate dimension id "${d.id}"`);
    ids.add(d.id);
    if (!['rules', 'platformGroups'].includes(d.type)) throw new Error(`${path.basename(file)}: dimension "${d.id}" type must be rules or platformGroups`);
    const rules = (d.rules || []).map((r, i) => {
      if (!r.category) throw new Error(`${path.basename(file)}: ${d.id}.rules[${i}] needs a category`);
      let re = null;
      if (r.match) {
        try { re = new RegExp(r.match, 'i'); } catch (e) { throw new Error(`${path.basename(file)}: ${d.id}.rules[${i}].match is not a valid pattern: ${e.message}`); }
      }
      return { category: String(r.category), re, offices: new Set((r.offices || []).map(String)) };
    });
    return { id: d.id, label: d.label || d.id, type: d.type, rules, otherLabel: d.otherLabel || 'Other' };
  });
  return { dimensions };
}

/** Map realmId -> category label for one dimension. offices: [{ realmId, officeName }]. */
export function assignCategories(db, dim, offices) {
  const out = {};
  if (dim.type === 'platformGroups') {
    let rows = [];
    try {
      rows = db.prepare(`SELECT e.external_id AS realmId, g.name AS grp FROM pf_entities e LEFT JOIN pf_entity_groups g ON g.id = e.group_id WHERE e.external_id IS NOT NULL`).all();
    } catch { /* platform tables not present */ }
    const byRealm = Object.fromEntries(rows.map((r) => [r.realmId, r.grp]));
    for (const o of offices) out[o.realmId] = byRealm[o.realmId] || dim.otherLabel;
    return out;
  }
  for (const o of offices) {
    const hit = dim.rules.find((r) => r.offices.has(o.realmId) || r.offices.has(o.officeName) || (r.re && r.re.test(o.officeName)));
    out[o.realmId] = hit ? hit.category : dim.otherLabel;
  }
  return out;
}
