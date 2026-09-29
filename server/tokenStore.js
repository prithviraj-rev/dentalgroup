import fs from 'node:fs';
import { config } from './config.js';

// tokens.json shape: { "<realmId>": { realm_id, company_name, office_name, access_token, refresh_token, ... } }
// office_name defaults to the QBO company name; edit it in tokens.json to relabel an office.

export function loadTokens() {
  if (!fs.existsSync(config.tokensPath)) return {};
  return JSON.parse(fs.readFileSync(config.tokensPath, 'utf8'));
}

export function saveTokens(all) {
  // Write-then-rename so a crash mid-write can't corrupt the file (refresh tokens rotate; losing one means reconnecting).
  const tmp = `${config.tokensPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, config.tokensPath);
}

export function upsertToken(realmId, patch) {
  const all = loadTokens();
  all[realmId] = { ...(all[realmId] || {}), ...patch, realm_id: realmId };
  saveTokens(all);
  return all[realmId];
}

export function removeToken(realmId) {
  const all = loadTokens();
  delete all[realmId];
  saveTokens(all);
}
