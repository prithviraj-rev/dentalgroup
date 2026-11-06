import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadTheme, themeCss, mergeTheme, effectiveColors, validateThemeLayer, saveTheme, savedTheme, clearTheme, themeFor, THEME_TOKENS, THEME_GROUPS } from '../server/theme.js';

const tmp = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theme-')), 'theme.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('theme.json: the shipped file loads and renders a stylesheet for both modes', () => {
  const t = mergeTheme(loadTheme(path.resolve('config/theme.json')));
  assert.equal(t.colors.banner, '#1d4ed8');
  assert.match(t.css, /:root \{ --banner: #1d4ed8; --banner-2: #2f6fe4;/);
  assert.match(t.css, /@media \(prefers-color-scheme: dark\) \{ :root \{ --banner: #173fb0;/);
  assert.equal(t.brand.logoUrl, null);
  assert.equal(t.saved, false);
});

test('theme: a missing file means the stylesheet defaults (empty css), every token still has an effective value', () => {
  const t = mergeTheme(loadTheme(path.join(os.tmpdir(), 'no-such-theme.json')));
  assert.deepEqual(t.colors, {});
  assert.equal(t.css, '');
  for (const k of Object.keys(THEME_TOKENS)) assert.ok(t.effective.light[k] && t.effective.dark[k], k);
  assert.equal(t.effective.light.sidebar, t.effective.light.banner); // follows the banner until set
  assert.equal(t.effective.light.pressed, t.effective.light.accent);
});

test('theme: inheritance follows the set value; a dark pick applies in dark only', () => {
  const light = effectiveColors({ banner: 'navy' }, 'light');
  assert.equal(light.sidebar, 'navy');
  assert.equal(light.sidebar2, THEME_GROUPS[0].tokens[1].light);
  const t = mergeTheme({ brand: {}, colors: { surface: '#fff' }, dark: { surface: '#111' } });
  assert.equal(t.effective.light.tableHead, '#fff');
  assert.equal(t.effective.dark.tableHead, '#111');
});

test('theme: every colour token maps to a CSS variable and any CSS colour form is accepted', () => {
  const colors = Object.fromEntries(Object.keys(THEME_TOKENS).map((k, i) => [k, ['#abc', '#aabbcc', 'rgb(1, 2, 3)', 'hsl(210 50% 40%)', 'navy'][i % 5]]));
  const t = mergeTheme(loadTheme(tmp({ colors, brand: { logoUrl: 'https://example.com/logo.png', logoText: 'VJ' } })));
  for (const k of Object.keys(THEME_TOKENS)) assert.ok(t.css.includes(`${THEME_TOKENS[k]}: ${colors[k]};`), k);
  assert.equal(themeCss({ colors: { accent: 'red' }, dark: {} }), ':root { --accent: red; }');
});

test('theme: errors name the key', () => {
  assert.throws(() => loadTheme(tmp({ colors: { header: '#fff' } })), /theme\.json: colors\.header is not a theme token/);
  assert.throws(() => loadTheme(tmp({ dark: { banner: 'not a colour!' } })), /dark\.banner must be a CSS colour/);
  assert.throws(() => loadTheme(tmp({ colours: {} })), /unknown key "colours"/);
  assert.throws(() => loadTheme(tmp({ brand: { logoUrl: 'logo.png' } })), /brand\.logoUrl must be null or an image URL/);
  assert.throws(() => validateThemeLayer({ brand: { logoText: 'TOOLONG' } }, 'theme'), /theme: brand\.logoText must be null or 1-4 characters/);
});

test('theme: the saved layer (Theme page) wins over the file, lives in pf_meta and can be cleared', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE pf_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  assert.equal(savedTheme(db), null);
  assert.equal(themeFor(db).saved, false);
  saveTheme(db, { colors: { banner: '#000000', tableHead: '#eeeeee' }, brand: { logoText: 'AB' } });
  const t = themeFor(db);
  assert.equal(t.saved, true);
  assert.equal(t.colors.banner, '#000000'); // over the file's #1d4ed8
  assert.equal(t.colors.banner2, '#2f6fe4'); // the file still supplies the rest
  assert.equal(t.effective.light.sidebar, '#000000');
  assert.equal(t.brand.logoText, 'AB');
  assert.throws(() => saveTheme(db, { colors: { banner: 'nope!' } }), /theme: colors\.banner must be a CSS colour/);
  clearTheme(db);
  assert.equal(themeFor(db).saved, false);
  assert.equal(themeFor(db).colors.banner, '#1d4ed8');
});
