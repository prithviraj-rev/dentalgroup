// Renders the Ledgerview platform bundle in jsdom for several roles and pages, plus the invite-form typing check.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const bundle = fs.readFileSync(new URL('./.out/platform-bundle.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(email) {
  const r = await fetch(`${BASE}/platform-api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: process.env.SMOKE_PASSWORD || 'demo1234' }) });
  return r.headers.get('set-cookie')?.split(';')[0];
}

async function render(cookie, url) {
  const errors = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${BASE}${url}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (u, init = {}) => fetch(new URL(u, BASE), { ...init, headers: { ...(init.headers || {}), cookie } });
  w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ contentRect: { width: 1100, height: 400 }, target: el }]); } unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1100, height: 400, top: 0, left: 0, right: 1100, bottom: 400, x: 0, y: 0 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 1100 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 400 });
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.console.error = (...a) => errors.push(a.map(String).join(' ').slice(0, 300));
  w.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
  w.eval(bundle);
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    const h = w.document.getElementById('root').innerHTML;
    if (h.length > 600 && !h.includes('animate-pulse')) break;
  }
  await sleep(500);
  return { w, errors: errors.filter((e) => !/Warning: |width\(0\) and height\(0\)|act\(|React Router Future Flag/.test(e)) };
}

const cookies = {
  dana: await session('owner@dentalgroup.demo'),
  admin: await session('admin@ledgerview.demo'),
  priya: await session('parent.manager@dentalgroup.demo'),
};
const orgId = process.env.ORG || '1';
const SCENARIOS = [
  ['admin', '/app/admin'],
  ['admin', `/app/o/${orgId}/overview`],
  ['admin', `/app/o/${orgId}/users`],
  ['dana', `/app/o/${orgId}/overview`],
  ['dana', `/app/o/${orgId}/reports`],
  ['dana', `/app/o/${orgId}/entities`],
  ['dana', `/app/o/${orgId}/users`],
  ['dana', `/app/o/${orgId}/sync`],
  ['dana', `/app/o/${orgId}/activity`],
  ['dana', `/app/o/${orgId}/settings`],
  ['priya', `/app/o/${orgId}/overview`],
  ['priya', `/app/o/${orgId}/users`],
];
let failures = 0;
for (const [who, url] of SCENARIOS) {
  const { w, errors } = await render(cookies[who], url);
  const title = w.document.querySelector('h1')?.textContent || '(no h1)';
  const ok = errors.length === 0 && w.document.getElementById('root').textContent.length > 50;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${who.padEnd(6)} ${url.padEnd(26)} -> ${w.location.pathname.padEnd(24)} h1: ${title}`);
  for (const e of errors.slice(0, 3)) console.log(`       ${e}`);
  w.close();
}

// Invite form: focus must stay in the field while typing (it used to jump to the close button).
{
  const { w } = await render(cookies.dana, `/app/o/${orgId}/users`);
  const btn = [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Invite user');
  btn.click();
  await sleep(300);
  const input = w.document.querySelector('[data-modal-body] input');
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  input.focus();
  for (const ch of 'Sam') {
    setter.call(input, input.value + ch);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(50);
  }
  const stillFocused = w.document.activeElement === input;
  const value = w.document.querySelector('[data-modal-body] input').value;
  console.log(`${stillFocused && value === 'Sam' ? 'OK  ' : 'FAIL'} invite form keeps focus while typing (typed "${value}", focus on ${w.document.activeElement.tagName.toLowerCase()})`);
  if (!(stillFocused && value === 'Sam')) failures++;
  w.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll platform checks passed');
process.exit(failures ? 1 : 0);
