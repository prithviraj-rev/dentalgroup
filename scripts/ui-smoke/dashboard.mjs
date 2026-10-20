// Renders the real dashboard bundle in jsdom against the live API (as a Sabuska admin) and walks
// through every tab / view, reporting any render crash.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const login = await fetch(`${BASE}/platform-api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.SMOKE_USER || 'owner@dentalgroup.demo', password: process.env.SMOKE_PASSWORD || 'demo1234' }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];
const offices = await (await fetch(`${BASE}/api/offices`, { headers: { cookie } })).json();
const ids = offices.map((o) => o.realmId);
const bundle = fs.readFileSync(new URL('./.out/bundle.js', import.meta.url), 'utf8');

const ALL = [
  ['executive, all offices', '?tab=executive'],
  ['executive, default tab', ''],
  ['executive, single office', `?tab=executive&office=${ids[0]}`],
  ['executive, category', '?tab=executive&cat=brand:Admire%20Dental'],
  ['executive, compare 2', `?tab=executive&office=${ids.slice(0, 2).join(',')}`],
  ['executive, one year', '?tab=executive&from=2026-01&to=2026-10'],
  ['dashboard, all offices, monthly', '?tab=dashboard'],
  ['dashboard, all offices, yearly + YoY', '?tab=dashboard&granularity=year&yoy=1'],
  ['dashboard, office chart ranked', '?tab=dashboard&officeChart=ranked'],
  ['dashboard, main chart stacked', '?tab=dashboard&mainChart=stacked'],
  ['dashboard, single office', `?tab=dashboard&office=${ids[0]}`],
  ['dashboard, category Admire Dental', '?tab=dashboard&cat=brand:Admire%20Dental'],
  ['dashboard, compare 3 offices', `?tab=dashboard&office=${ids.slice(0, 3).join(',')}`],
  ['dashboard, compare all 25 (net margin)', `?tab=dashboard&office=${ids.join(',')}&metric=netMargin`],
  ['dashboard, compare all 25 + YoY', `?tab=dashboard&office=${ids.join(',')}&yoy=1`],
  ['analysis, collections by office, lines', '?tab=analysis&by=office&ametric=netCollections&achart=lines'],
  ['analysis, by office, small multiples', '?tab=analysis&by=office&achart=small'],
  ['analysis, EBITDA by office, ranked', '?tab=analysis&by=office&ametric=officeEbitda&achart=ranked'],
  ['analysis, by entity group, stacked', '?tab=analysis&by=category:group&ametric=netCollections&achart=stacked'],
  ['analysis, by brand', '?tab=analysis&by=category:brand'],
  ['analysis, costs by statement row, stacked', '?tab=analysis&by=row&achart=stacked'],
  ['analysis, costs by row as % of collections', '?tab=analysis&by=row&ametric=pct:providerComp'],
  ['analysis, provider comp by account, bars', '?tab=analysis&by=account&ametric=providerComp&achart=bars'],
  ['analysis, EBITDA margin by office', '?tab=analysis&by=office&ametric=pct:officeEbitda'],
  ['analysis, EBITDA asked by account (falls back)', '?tab=analysis&by=account&ametric=officeEbitda'],
  ['analysis, single office', `?tab=analysis&by=account&office=${ids[0]}`],
  ['analysis, category', '?tab=analysis&by=office&cat=brand:Admire%20Dental'],
  ['analysis, quarterly, compare 3', `?tab=analysis&by=office&granularity=quarter&office=${ids.slice(0, 3).join(',')}`],
  ['category compare, all offices', '?tab=categories'],
  ['category compare, quarterly', '?tab=categories&granularity=quarter'],
  ['category compare, single office', `?tab=categories&office=${ids[0]}`],
  ['category compare, category', '?tab=categories&cat=brand:Admire%20Dental'],
  ['category compare, compare 3', `?tab=categories&office=${ids.slice(0, 3).join(',')}`],
  ['offices, portfolio', '?tab=offices'],
  ['offices, portfolio TTM', '?tab=offices&granularity=month'],
  ['offices, single company opens its office', `?tab=offices&office=${ids[0]}`],
  ['group overview, all offices', '?tab=group'],
  ['group overview, single office', `?tab=group&office=${ids[0]}`],
  ['cash & balance sheet, all offices', '?tab=cash'],
  ['cash & balance sheet, single office', `?tab=cash&office=${ids[0]}`],
  ['financial kpis, portfolio', '?tab=officesSheet'],
  ['financial kpis, single company opens its office', `?tab=officesSheet&office=${ids[0]}`],
  ['chart of accounts, all offices', '?tab=coa'],
  ['chart of accounts, single office', `?tab=coa&office=${ids[1]}`],
  ['chart of accounts, compare 5', `?tab=coa&office=${ids.slice(0, 5).join(',')}`],
];
const SCENARIOS = process.env.ONLY ? ALL.filter(([n]) => n.startsWith(process.env.ONLY)) : ALL;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

for (const [name, query] of SCENARIOS) {
  const errors = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `${BASE}/${query}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = (u, init = {}) => fetch(new URL(u, BASE), { ...init, headers: { ...(init.headers || {}), cookie } });
  w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ contentRect: { width: 1100, height: 400 }, target: el }]); } unobserve() {} disconnect() {} };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 1100 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 400 });
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1100, height: 400, top: 0, left: 0, right: 1100, bottom: 400, x: 0, y: 0 });
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.console.error = (...a) => errors.push(a.map(String).join(' ').slice(0, 300));
  w.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
  try {
    w.eval(bundle);
  } catch (e) {
    errors.push(`eval: ${e.message}`);
  }
  // Wait for data to load and render.
  let html = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    html = w.document.getElementById('root').innerHTML;
    if (html.includes('animate-pulse') || html.length < 500) continue;
    await sleep(800);
    html = w.document.getElementById('root').innerHTML;
    break;
  }
  const blank = html.trim().length === 0;
  const realErrors = errors.filter((e) => !/Warning: |width\(0\) and height\(0\)|act\(/.test(e));
  const apiError = /Could not load|Internal server error/.test(w.document.getElementById('root').textContent);
  const ok = !blank && realErrors.length === 0 && !apiError;
  if (apiError) realErrors.push('page shows an API error');
  if (!ok) failures++;
  const text = w.document.getElementById('root').textContent;
  const headings = [...w.document.querySelectorAll('h2')].map((h) => h.textContent).slice(0, process.env.ALLH ? 20 : 4).join(' | ') + (process.env.ALLH ? '  [range ' + ([...w.document.querySelectorAll('input[type=month]')].map((i) => i.value).join(' to ')) + ']' : '');
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(48)} ${blank ? 'BLANK SCREEN' : `${text.length} chars`}  ${headings}`);
  for (const e of realErrors.slice(0, 3)) console.log(`       ${e}`);
  w.close();
}
console.log(failures ? `\n${failures} scenario(s) failed` : '\nAll scenarios rendered without errors');
process.exit(failures ? 1 : 0);
