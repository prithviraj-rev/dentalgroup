// Offices chosen on the tab ("Combine companies"): which companies make one office, with its name. Stored in
// the database (Railway volume) so they survive deploys; they take precedence over the pairs in
// config/offices.json. A saved office is a combination the user made; a company may be in several combinations.

const now = () => new Date().toISOString();

export function initOfficesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS office_groups (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT,
      city           TEXT,
      state          TEXT,
      companies_json TEXT NOT NULL,   -- ["realmId", ...]
      aliases_json   TEXT NOT NULL,   -- other spellings of these companies on payees / customers
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
  `);
}

const parse = (r) => ({ id: r.id, name: r.name || null, city: r.city || null, state: r.state || null, companies: JSON.parse(r.companies_json), aliases: JSON.parse(r.aliases_json), updatedAt: r.updated_at });

export function listSavedOffices(db) {
  return db.prepare('SELECT * FROM office_groups ORDER BY id').all().map(parse);
}

const clean = (s, max = 80) => { const v = String(s ?? '').trim().slice(0, max); return v || null; };

/**
 * Create or update a saved office. { id?, name?, city?, state?, companies: [realmId], aliases?: [] }.
 */
export function saveOffice(db, input) {
  const companies = [...new Set((input.companies || []).map(String).filter(Boolean))];
  if (!companies.length) throw Object.assign(new Error('Pick at least one company'), { status: 400 });
  if (companies.length > 20) throw Object.assign(new Error('At most 20 companies per office'), { status: 400 });
  const aliases = [...new Set((input.aliases || []).map((a) => clean(a)).filter(Boolean))].slice(0, 20);
  const row = { name: clean(input.name), city: clean(input.city, 60), state: clean(input.state, 20), companies_json: JSON.stringify(companies), aliases_json: JSON.stringify(aliases), now: now() };
  return db.transaction(() => {
    const id = input.id != null ? Number(input.id) : null;
    if (id != null && !db.prepare('SELECT 1 FROM office_groups WHERE id = ?').get(id)) throw Object.assign(new Error('Office not found'), { status: 404 });
    if (id != null) {
      db.prepare('UPDATE office_groups SET name = @name, city = @city, state = @state, companies_json = @companies_json, aliases_json = @aliases_json, updated_at = @now WHERE id = @id').run({ ...row, id });
      return parse(db.prepare('SELECT * FROM office_groups WHERE id = ?').get(id));
    }
    const r = db.prepare('INSERT INTO office_groups (name, city, state, companies_json, aliases_json, created_at, updated_at) VALUES (@name, @city, @state, @companies_json, @aliases_json, @now, @now)').run(row);
    return parse(db.prepare('SELECT * FROM office_groups WHERE id = ?').get(r.lastInsertRowid));
  })();
}

export function deleteOffice(db, id) {
  const r = db.prepare('DELETE FROM office_groups WHERE id = ?').run(Number(id));
  if (!r.changes) throw Object.assign(new Error('Office not found'), { status: 404 });
  return { ok: true };
}
