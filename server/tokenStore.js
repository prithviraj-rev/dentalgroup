// Connections (one per QuickBooks company / realmId) stored in the SQLite `connections` table.

export function listConnections(db) {
  return db.prepare('SELECT * FROM connections ORDER BY company_name').all();
}

export function getConnection(db, realmId) {
  return db.prepare('SELECT * FROM connections WHERE realm_id = ?').get(realmId);
}

/** Insert or replace the connection for a realm. Re-running /connect for a known company just refreshes it. */
export function saveConnection(db, c) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO connections (realm_id, company_name, access_token, refresh_token, expires_at, refresh_token_expires_at, connected_at, updated_at)
    VALUES (@realm_id, @company_name, @access_token, @refresh_token, @expires_at, @refresh_token_expires_at, @connected_at, @updated_at)
    ON CONFLICT (realm_id) DO UPDATE SET
      company_name             = excluded.company_name,
      access_token             = excluded.access_token,
      refresh_token            = excluded.refresh_token,
      expires_at               = excluded.expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      updated_at               = excluded.updated_at
  `).run({ refresh_token_expires_at: null, connected_at: now, updated_at: now, ...c });
  return getConnection(db, c.realm_id);
}

/** Persist rotated tokens after a refresh. */
export function updateTokens(db, realmId, t) {
  db.prepare(`
    UPDATE connections
    SET access_token = @access_token, refresh_token = @refresh_token, expires_at = @expires_at,
        refresh_token_expires_at = COALESCE(@refresh_token_expires_at, refresh_token_expires_at),
        updated_at = @updated_at
    WHERE realm_id = @realm_id
  `).run({ refresh_token_expires_at: null, ...t, realm_id: realmId, updated_at: new Date().toISOString() });
  return getConnection(db, realmId);
}

export function updateCompanyName(db, realmId, companyName) {
  db.prepare('UPDATE connections SET company_name = ?, updated_at = ? WHERE realm_id = ?')
    .run(companyName, new Date().toISOString(), realmId);
}

export function deleteConnection(db, realmId) {
  db.prepare('DELETE FROM connections WHERE realm_id = ?').run(realmId);
}
