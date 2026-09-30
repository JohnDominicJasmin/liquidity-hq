/* #1434 / #1474: the terminal nav's phone header must name a page the SAME way
 * on the server and in the browser.
 *
 * WHY THIS CAN DIFFER. The not-found page is prerendered once, under Next's
 * internal path `/_not-found`, then served at whatever unknown URL was asked
 * for. So on every 404 the server renders the nav for `/_not-found` and the
 * browser hydrates it for the real address. Any text derived from the path
 * that comes out different throws React #418 on every 404 view.
 *
 * MEASURED on qa before the fix (build 2656e4c, phone width, server HTML
 * against the text shown after load): 7 of 7 unknown URLs threw #418, all with
 * server "_not Found" - /zz-not-a-page ("Zz Not A Page"), /ar ("Ar"),
 * /arena/zz-not-a-page ("Arena"), /faq/old-page ("FAQ"), /settings/x
 * ("Settings"), /dashboard/zz ("Desk"), /ops/zz-not-a-page (no bar). The first
 * version of the fix still mismatched the middle four: a PREFIX match gave the
 * browser "Arena" for /arena/<anything> while the server found nothing.
 *
 * These tests call the real lib/navRoutes.ts. The route list is derived from
 * the page files, not typed by hand, so a new page is checked without anyone
 * remembering to add it here. They do not prove the browser shows no error -
 * that is the after reading on #1474. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  screenNameFor, isActive, rendersOwnNav,
  TERMINAL_TABS, SCREEN_NAMES, URL_NAMED_ROUTES, PRIMARY, SCANNERS, TOOLS, TAIL,
} from '../lib/navRoutes.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
const LABELS = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
/** A stand-in `t` that shows WHICH key was used, and '' for none. */
const t = (k: string) => `<${k}>`;
const NOT_FOUND = '/_not-found';

/** Every page route in app/, from the files. Dynamic segments are kept as `[x]`. */
function pageRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (rel !== 'app/api') walk(rel); }
      else if (e.name === 'page.tsx') out.push(dir.replace(/^app/, '') || '/');
    }
  };
  walk('app');
  return out.sort();
}
const ROUTES = pageRoutes();
const STATIC_ROUTES = ROUTES.filter((r) => !r.includes('['));

/** Where AppShell draws no terminal nav at all, read from AppShell itself. */
function barless(): (p: string) => boolean {
  const src = read('components/AppShell.tsx');
  const auth = src.match(/const AUTH_ROUTES = \[([^\]]*)\]/);
  assert.ok(auth, 'CONTROL: AUTH_ROUTES is no longer declared in components/AppShell.tsx');
  const authRoutes = [...auth[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(authRoutes.includes('/login'), 'CONTROL: AUTH_ROUTES no longer lists /login');
  assert.match(src, /const isChromeless = \(pathname: string\) => pathname === '\/ops' \|\| pathname\.startsWith\('\/ops\/'\);/, 'CONTROL: the chromeless (/ops) rule changed shape - re-derive the bar-less list');
  // The two pages proxy.ts sends to /dashboard never render at all.
  const proxy = read('proxy.ts').match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(proxy, 'CONTROL: proxy.ts has no matcher');
  const redirected = [...proxy[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return (p) => rendersOwnNav(p) || authRoutes.includes(p) || p === '/ops' || p.startsWith('/ops/') || redirected.includes(p);
}

test('CONTROL: the route list is the real one', () => {
  assert.ok(STATIC_ROUTES.length > 30, `only ${STATIC_ROUTES.length} page routes found - the walk is not seeing app/`);
  for (const r of ['/', '/arena', '/calc', '/admin', '/offline', '/login', '/ops', '/[locale]']) assert.ok(ROUTES.includes(r), `${r} is missing from the derived route list`);
  assert.equal(screenNameFor('/calc', t), '<TNAV_CALC_LABEL>', 'CONTROL: a named page did not get its name - the stand-in t is not being used');
});

test('N1. every unknown URL gets the SAME header name as the prerendered not-found page - no #418 on any 404', () => {
  const serverSide = screenNameFor(NOT_FOUND, t);
  assert.equal(serverSide, '', `the not-found page's own prerender now has a header name (${JSON.stringify(serverSide)}) - it is built under ${NOT_FOUND}, so anything but '' is text the browser cannot reproduce`);
  // The seven measured on qa, plus one stale link under every named path and every tab.
  const named = [...TERMINAL_TABS.map((i) => i.href), ...Object.keys(SCREEN_NAMES), ...URL_NAMED_ROUTES];
  const unknown = ['/zz-not-a-page', '/ar', '/ru', '/xx', '/arena/zz-not-a-page', '/faq/old-page', '/settings/x', '/dashboard/zz',
    ...named.map((p) => `${p}/qa-stale-link`), '/_not-found-lookalike', '/Arena', '/arena-old'];
  for (const u of unknown) {
    assert.ok(!ROUTES.includes(u), `CONTROL: ${u} is a real page now - pick another unknown URL`);
    assert.equal(screenNameFor(u, t), serverSide, `${u} would be named ${JSON.stringify(screenNameFor(u, t))} in the browser but ${JSON.stringify(serverSide)} by the server: React #418 on this 404`);
  }
});

test('N2. no tab is marked active on a 404, on either side', () => {
  const hrefs = [...TERMINAL_TABS.map((i) => i.href), ...[...PRIMARY, ...SCANNERS, ...TOOLS, ...TAIL].map((i) => i.path), '/settings'];
  for (const u of ['/arena/zz-not-a-page', '/faq/old-page', '/settings/x', '/dashboard/zz', '/journal/x', '/zz-not-a-page']) {
    for (const h of hrefs) assert.equal(isActive(u, h), isActive(NOT_FOUND, h), `${h} is active for ${u} but not for ${NOT_FOUND} - a class the server and browser disagree on`);
  }
  assert.equal(isActive('/arena', '/arena'), true, 'CONTROL: the real page is no longer active on its own tab');
});

test('N3. every page that shows the bar has a header name - derived from the page files', () => {
  const noBar = barless();
  const unnamed = STATIC_ROUTES.filter((r) => !noBar(r) && screenNameFor(r, t) === '');
  assert.deepEqual(unnamed, [], `these pages show the terminal bar with an EMPTY header name on phones: ${unnamed.join(', ')}. Add each to SCREEN_NAMES in lib/navRoutes.ts (or TERMINAL_TABS)`);
  // The one dynamic route family outside /ops is the landing locales, which draw their own nav.
  const dynamicWithBar = ROUTES.filter((r) => r.includes('[') && !r.startsWith('/ops'));
  assert.deepEqual(dynamicWithBar, ['/[locale]'], `a new dynamic page route exists: ${dynamicWithBar.join(', ')} - decide what its header says, and whether the same name comes out on the server and in the browser`);
  assert.equal(rendersOwnNav('/ko') && rendersOwnNav('/zh'), true, 'CONTROL: /ko and /zh no longer draw their own nav');
});

test('N4. the header names are real labels, and the URL-derived ones are real pages', () => {
  for (const tab of TERMINAL_TABS) assert.ok(tab.tabLabelKey in LABELS, `${tab.href}: ${tab.tabLabelKey} has no English default - the header would show the raw key`);
  for (const [p, k] of Object.entries(SCREEN_NAMES)) {
    assert.ok(k in LABELS, `${p}: ${k} has no English default - the header would show the raw key`);
    assert.ok(ROUTES.includes(p), `${p} is named in SCREEN_NAMES but no page exists for it`);
  }
  for (const p of URL_NAMED_ROUTES) {
    assert.ok(ROUTES.includes(p), `${p} is URL-named but no page exists for it`);
    assert.equal(p in SCREEN_NAMES, false, `${p} is in both SCREEN_NAMES and URL_NAMED_ROUTES`);
  }
  assert.equal(screenNameFor('/admin', t), 'Admin');
  assert.equal(screenNameFor('/offline', t), 'Offline');
});

test('N5. every nav link points at a page that exists - a nav link to a missing page is a 404 we ship ourselves', () => {
  const links = [...TERMINAL_TABS.map((i) => i.href), ...[...PRIMARY, ...SCANNERS, ...TOOLS, ...TAIL].map((i) => i.path)];
  const missing = links.filter((l) => !ROUTES.includes(l));
  assert.deepEqual(missing, [], `nav links with no page: ${missing.join(', ')}`);
  assert.ok(existsSync(path.join(ROOT, 'app/not-found.tsx')), 'CONTROL: app/not-found.tsx is gone');
});
