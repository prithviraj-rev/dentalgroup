import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const environment = (env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();

export const config = {
  clientId: env.QBO_CLIENT_ID || '',
  clientSecret: env.QBO_CLIENT_SECRET || '',
  redirectUri: env.QBO_REDIRECT_URI || 'http://localhost:3000/callback',
  environment,
  port: Number(env.PORT || 3000),
  tokensPath: path.resolve(ROOT, env.TOKENS_PATH || 'tokens.json'),
  dbPath: path.resolve(ROOT, env.DB_PATH || 'data/pnl.db'),
  apiBase:
    environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com',
  authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  scope: 'com.intuit.quickbooks.accounting',
  minorVersion: 75,
};

export function requireCredentials() {
  if (!config.clientId || !config.clientSecret) {
    console.error('Missing QBO_CLIENT_ID / QBO_CLIENT_SECRET. Copy .env.example to .env and fill them in.');
    process.exit(1);
  }
}
