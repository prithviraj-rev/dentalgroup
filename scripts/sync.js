// Cross-platform fallback for `npm run sync` (which uses curl): POST /sync against the running server.
//   npm run sync:node
const base = process.env.SERVER_URL || 'http://localhost:3000';

try {
  const res = await fetch(`${base}/sync`, { method: 'POST' });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  if (!res.ok) process.exitCode = 1;
} catch (err) {
  console.error(`Could not reach ${base}: ${err.message}. Is the server running (npm run dev)?`);
  process.exit(1);
}
