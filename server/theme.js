// Theme configurator: the colours (and the logo) of BOTH apps, the P&L dashboard and the Ledgerview shell.
// Three layers, the later one wins per token: the stylesheet defaults (web/src/index.css, platform/src/index.css) <
// config/theme.json (file defaults) < what a platform admin saved on the Ledgerview "Theme" page (pf_meta key "theme").
// Every token is a CSS custom property; a token left unset keeps its default, and some tokens inherit another one until
// set (the side panel follows the banner, the button row and table header follow the cards, pressed buttons follow the
// accent). Served as `theme` by GET /api/config and GET /platform-api/config with the stylesheet rendered (`css`), which
// each app injects as <style id="theme-config">.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const themeConfigPath = path.resolve(ROOT, process.env.THEME_CONFIG_PATH || 'config/theme.json');

/** The configurator's groups: every token with its CSS variable, label, hint, stylesheet defaults (light / dark) and, for
 *  tokens that follow another one until set, `inherits`. The order here is the order on the Theme page. */
export const THEME_GROUPS = [
  { id: 'banner', label: 'Banner', hint: 'The tab row at the top of the dashboard.', tokens: [
    { key: 'banner', css: '--banner', label: 'Banner', hint: 'Left end of the gradient', light: '#0f2447', dark: '#0a1a36' },
    { key: 'banner2', css: '--banner-2', label: 'Banner end', hint: 'Right end of the gradient (same as Banner = flat)', light: '#1b3f74', dark: '#10284f' },
    { key: 'bannerInk', css: '--banner-ink', label: 'Banner text', hint: 'Tab names and the product name', light: '#ffffff', dark: '#ffffff' },
    { key: 'bannerMark', css: '--banner-mark', label: 'Open tab marker', hint: 'The line under the open tab', light: '#ffffff', dark: '#ffffff' },
  ] },
  { id: 'sidebar', label: 'Side panel', hint: 'The Ledgerview menu on the left (and the phone top bar). Follows the banner until set.', tokens: [
    { key: 'sidebar', css: '--sidebar', label: 'Side panel', hint: 'Top of the gradient', inherits: 'banner' },
    { key: 'sidebar2', css: '--sidebar-2', label: 'Side panel end', hint: 'Bottom of the gradient', inherits: 'banner2' },
    { key: 'sidebarInk', css: '--sidebar-ink', label: 'Side panel text', hint: 'Menu items, the user block', inherits: 'bannerInk' },
    { key: 'sidebarMark', css: '--sidebar-mark', label: 'Open item marker', hint: 'The bar beside the open menu item', inherits: 'bannerMark' },
  ] },
  { id: 'buttons', label: 'Button row', hint: 'The bars with Select companies, Accrual / Cash, the period buttons, Export CSV.', tokens: [
    { key: 'toolbar', css: '--toolbar', label: 'Bar background', hint: 'Behind the buttons', inherits: 'surface' },
    { key: 'toolbarLine', css: '--toolbar-line', label: 'Bar border', hint: 'The line around a bar', inherits: 'line' },
    { key: 'button', css: '--button', label: 'Button', hint: 'A button at rest', inherits: 'surface' },
    { key: 'buttonInk', css: '--button-ink', label: 'Button text', hint: '', inherits: 'ink' },
    { key: 'pressed', css: '--pressed', label: 'Pressed button', hint: 'The chosen period, basis, Amounts / %, Combine / Compare, Save', inherits: 'accent' },
    { key: 'pressedInk', css: '--pressed-ink', label: 'Pressed button text', hint: '', light: '#ffffff', dark: '#ffffff' },
  ] },
  { id: 'tables', label: 'Table header', hint: 'The column header row of every table, and the total rows.', tokens: [
    { key: 'tableHead', css: '--thead', label: 'Header background', hint: '', inherits: 'surface' },
    { key: 'tableHeadInk', css: '--thead-ink', label: 'Header text', hint: 'Column names', inherits: 'ink2' },
    { key: 'tableLine', css: '--table-line', label: 'Column lines', hint: 'The thin vertical lines between columns', inherits: 'line' },
    { key: 'totalRow', css: '--total-row', label: 'Total rows', hint: 'Subtotal rows, the Grand total column, group totals', inherits: 'page' },
  ] },
  { id: 'page', label: 'Page and cards', hint: 'The page behind everything, the white cards, the text.', tokens: [
    { key: 'page', css: '--page', label: 'Page', hint: 'Behind the cards', light: '#f3f5f9', dark: '#0b1220' },
    { key: 'surface', css: '--surface', label: 'Cards', hint: 'Cards and tables', light: '#ffffff', dark: '#141c2b' },
    { key: 'ink', css: '--ink', label: 'Text', hint: 'Figures and names', light: '#0f1b2d', dark: '#f3f6fb' },
    { key: 'ink2', css: '--ink-2', label: 'Secondary text', hint: 'Notes, period labels', light: '#4a5668', dark: '#b8c2d2' },
    { key: 'muted', css: '--muted', label: 'Muted text', hint: 'Hints, second header lines', light: '#8a94a6', dark: '#7f8a9c' },
    { key: 'line', css: '--line', label: 'Lines', hint: 'Borders and row lines', light: '#e2e7ef', dark: '#26314a' },
    { key: 'accent', css: '--accent', label: 'Accent', hint: 'Links, card titles, pressed buttons until set above', light: '#1f4e8c', dark: '#4d8fe0' },
    { key: 'accentBright', css: '--accent-bright', label: 'Bright accent', hint: 'Highlights on dark surfaces', light: '#5aa9ff', dark: '#7cbcff' },
  ] },
  { id: 'figures', label: 'Figures and charts', hint: '', tokens: [
    { key: 'good', css: '--good', label: 'Good', hint: 'Up, on track', light: '#1a7f37', dark: '#3cbb5a' },
    { key: 'bad', css: '--bad', label: 'Bad', hint: 'Down, attention', light: '#c93c3c', dark: '#e66767' },
    { key: 'axis', css: '--axis', label: 'Chart axes', hint: '', light: '#c3ccd9', dark: '#35425d' },
  ] },
];
export const THEME_TOKENS = Object.fromEntries(THEME_GROUPS.flatMap((g) => g.tokens.map((t) => [t.key, t.css])));
const TOKEN = Object.fromEntries(THEME_GROUPS.flatMap((g) => g.tokens.map((t) => [t.key, t])));
const COLOR = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\([^()]*\)|[a-z]{3,20})$/i;
const EMPTY = { brand: { logoUrl: null, logoText: null }, colors: {}, dark: {} };

function checkColors(obj, key, where) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${where}: ${key} must be an object of {token: colour}`);
  for (const [k, v] of Object.entries(obj)) {
    if (!THEME_TOKENS[k]) throw new Error(`${where}: ${key}.${k} is not a theme token (use ${Object.keys(THEME_TOKENS).join(' | ')})`);
    if (typeof v !== 'string' || !COLOR.test(v.trim())) throw new Error(`${where}: ${key}.${k} must be a CSS colour (#rrggbb, rgb(...), hsl(...) or a colour name), got ${JSON.stringify(v)}`);
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.trim()]));
}

/** Validates one layer ({brand, colors, dark}; every part optional) and returns it normalised. `where` names the source in errors. */
export function validateThemeLayer(raw, where = 'theme.json') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: must be an object with brand | colors | dark`);
  for (const k of Object.keys(raw)) if (!(k in EMPTY)) throw new Error(`${where}: unknown key "${k}" (use brand | colors | dark)`);
  const brand = { ...(raw.brand || {}) };
  for (const k of Object.keys(brand)) if (!(k in EMPTY.brand)) throw new Error(`${where}: brand.${k} is not a brand key (use logoUrl | logoText)`);
  if (brand.logoUrl != null && (typeof brand.logoUrl !== 'string' || !/^(https?:\/\/|\/|data:image\/)/.test(brand.logoUrl))) throw new Error(`${where}: brand.logoUrl must be null or an image URL (https://..., /path or data:image/...)`);
  if (brand.logoText != null && (typeof brand.logoText !== 'string' || !brand.logoText.trim() || brand.logoText.length > 4)) throw new Error(`${where}: brand.logoText must be null or 1-4 characters`);
  const out = { brand: {}, colors: checkColors(raw.colors || {}, 'colors', where), dark: checkColors(raw.dark || {}, 'dark', where) };
  if (brand.logoUrl !== undefined) out.brand.logoUrl = brand.logoUrl || null;
  if (brand.logoText !== undefined) out.brand.logoText = brand.logoText ? brand.logoText.trim() : null;
  return out;
}

/** The stylesheet for the set tokens: light values on :root, dark values under prefers-color-scheme: dark. */
export function themeCss({ colors, dark }) {
  const decl = (o) => Object.entries(o).map(([k, v]) => `${THEME_TOKENS[k]}: ${v};`).join(' ');
  const light = Object.keys(colors).length ? `:root { ${decl(colors)} }` : '';
  const d = Object.keys(dark).length ? `@media (prefers-color-scheme: dark) { :root { ${decl(dark)} } }` : '';
  return [light, d].filter(Boolean).join('\n');
}

/** Every token's value as it shows on screen for one mode: set value, else the inherited token's, else the stylesheet default. */
export function effectiveColors(colors, mode = 'light') {
  const out = {};
  const of = (k, seen = new Set()) => {
    if (colors[k]) return colors[k];
    const t = TOKEN[k];
    if (t.inherits && !seen.has(k)) { seen.add(k); return of(t.inherits, seen); }
    return t[mode];
  };
  for (const k of Object.keys(TOKEN)) out[k] = of(k);
  return out;
}

export function loadTheme(file = themeConfigPath) {
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`Could not parse ${file}: ${err.message}`); }
  }
  raw = JSON.parse(JSON.stringify(raw, (k, v) => (k === '$comment' ? undefined : v)));
  return validateThemeLayer(raw, 'theme.json');
}

/** File defaults + the saved layer = what both apps get: set tokens, the stylesheet, the effective values and the groups for the Theme page. */
export function mergeTheme(fileTheme, saved = null) {
  const s = saved || EMPTY;
  const colors = { ...fileTheme.colors, ...s.colors };
  const dark = { ...fileTheme.dark, ...s.dark };
  const brand = { ...EMPTY.brand, ...fileTheme.brand, ...s.brand };
  const t = { brand, colors, dark };
  return { ...t, css: themeCss(t), effective: { light: effectiveColors(colors, 'light'), dark: effectiveColors({ ...colors, ...dark }, 'dark') }, saved: Boolean(saved), file: fileTheme };
}

export const fileTheme = loadTheme();

// ---- the saved layer (Ledgerview Theme page), kept in pf_meta so it survives deploys (the volume holds the database)
const META_KEY = 'theme';
export function savedTheme(db) {
  try {
    const row = db.prepare('SELECT value FROM pf_meta WHERE key = ?').get(META_KEY);
    return row ? validateThemeLayer(JSON.parse(row.value), 'saved theme') : null;
  } catch { return null; } // no platform tables yet, or an old value that no longer validates: file defaults only
}
export function saveTheme(db, layer) {
  const v = validateThemeLayer(layer, 'theme');
  db.prepare('INSERT OR REPLACE INTO pf_meta (key, value) VALUES (?, ?)').run(META_KEY, JSON.stringify(v));
  return v;
}
export function clearTheme(db) { db.prepare('DELETE FROM pf_meta WHERE key = ?').run(META_KEY); }
/** What the apps receive. */
export const themeFor = (db) => mergeTheme(fileTheme, savedTheme(db));
export const themeGroups = () => THEME_GROUPS;
