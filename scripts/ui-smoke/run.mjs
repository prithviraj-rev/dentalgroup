// Browser smoke test: bundles both front-ends and renders every tab / page in jsdom against a running
// server, failing on any render crash, console error or API error shown on screen.
//   npm run ui-smoke                          (server on http://localhost:3000)
//   BASE=https://<host> npm run ui-smoke      (live site; demo accounts must exist)
//   ONLY=executive npm run ui-smoke           (subset of dashboard scenarios)
//   SMOKE_USER / SMOKE_PASSWORD               (org-admin login used for the dashboard checks)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const options = {
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.css': 'empty' },
  logLevel: 'error',
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_API_URL': 'undefined',
    'process.env.NODE_ENV': '"development"',
  },
};
await build({ ...options, entryPoints: [path.join(root, 'web/src/main.jsx')], outfile: path.join(here, '.out/bundle.js') });
await build({ ...options, entryPoints: [path.join(root, 'platform/src/main.jsx')], outfile: path.join(here, '.out/platform-bundle.js') });

let failed = false;
for (const f of ['dashboard.mjs', 'platform.mjs']) {
  try {
    execFileSync(process.execPath, [path.join(here, f)], { stdio: 'inherit', env: process.env });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
