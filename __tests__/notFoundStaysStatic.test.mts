/* #1434: unknown URLs answered 200 again, and every page was rendered per request.
 *
 * THE CAUSE WAS ONE CALL IN A FILE THAT LOOKS HARMLESS. app/not-found.tsx called
 * `headers()` (added 2026-09-13 for #1251, to log which path had 404'd). Next
 * builds the root not-found element for EVERY page render, so that one call ran
 * inside every page: the whole site opted out of static rendering, every page
 * was sent `Cache-Control: private, no-cache, no-store`, app/[locale]/page.tsx
 * stopped being prerendered, its `dynamicParams = false` had nothing to compare
 * against, and every made-up URL answered 200 - the soft 404 #157 reported and
 * #163 fixed. The log line it existed for fired on every page view.
 *
 * WHAT THESE TESTS ARE, AND ARE NOT. They are SOURCE PINS: they fail when the
 * cause comes back. They do not prove a 404. Whether a made-up URL answers 404
 * is a property of a production BUILD, and only a request to a deployed site
 * shows it (qa/e2e/i18n.spec.ts "/ar returns a real 404", seo.spec.ts, and the
 * readings on #1434). A green run here with a red reading there means Next
 * found another reason to render per request that these pins do not know about
 * - add it here when it is found.
 *
 * `dynamicParams = false` itself is already pinned in localeOffering.test.mts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Anything that reads the request, and so makes whatever renders it dynamic. */
const REQUEST_TIME = /from ['"]next\/headers['"]|\bheaders\(\)|\bcookies\(\)|\bdraftMode\(\)|\bconnection\(\)|\bunstable_noStore\b|\bnoStore\(\)/;
const ROUTE_CONFIG = /export\s+const\s+(dynamic|revalidate|fetchCache)\b/;

/** The files a module imports from this repo (`@/x` and relative), resolved to repo paths. */
function localImports(rel: string): string[] {
  const out: string[] = [];
  for (const m of code(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('@/') && !spec.startsWith('.')) continue;
    const base = spec.startsWith('@/') ? spec.slice(2) : path.posix.join(path.posix.dirname(rel), spec);
    const hit = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => /\.(tsx?|mts)$/.test(c) && existsSync(path.join(ROOT, c)));
    if (hit) out.push(hit);
  }
  return out;
}

test('N1. app/not-found.tsx reads nothing about the request and sets no route config - it renders inside EVERY page', () => {
  const src = code('app/not-found.tsx');
  assert.equal(REQUEST_TIME.test(src), false, 'app/not-found.tsx reads the request again (headers/cookies/...). Next renders this file with every page, so the whole site goes dynamic and unknown URLs answer 200 - #1434');
  assert.equal(ROUTE_CONFIG.test(src), false, 'app/not-found.tsx exports dynamic/revalidate/fetchCache');
  assert.match(src, /export default function NotFound\(\)/, 'the not-found component is no longer a plain synchronous function - an async one is how a request-time read gets in');
  assert.equal(/\bawait\b|\bconsole\./.test(src), false, 'app/not-found.tsx awaits something or logs - both were part of the #1251 change that caused #1434');
});

test('N2. nothing app/not-found.tsx imports reads the request either - moving the call one file down would do the same damage', () => {
  const seen = new Set<string>();
  const queue = localImports('app/not-found.tsx');
  assert.ok(queue.length > 0, 'CONTROL: app/not-found.tsx imports no local file - re-derive this test');
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = code(f);
    assert.equal(REQUEST_TIME.test(src), false, `${f}, reached from app/not-found.tsx, reads the request`);
    // A client component cannot read the request on the server; stop there.
    if (!/^\s*['"]use client['"]/.test(read(f))) queue.push(...localImports(f));
    assert.ok(seen.size < 200, 'the import walk did not terminate');
  }
});

test('N3. the root layout, loading and error files - also rendered with every page - read nothing about the request', () => {
  for (const f of ['app/layout.tsx', 'app/loading.tsx', 'app/global-error.tsx']) {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} is gone - re-derive this list`);
    const src = code(f);
    assert.equal(REQUEST_TIME.test(src), false, `${f} reads the request - it renders with every page, so every page goes dynamic`);
    assert.equal(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src), false, `${f} forces dynamic rendering for the whole app`);
  }
});

test('N4. proxy.ts runs only for the two blocked paths and rewrites no request header', () => {
  const src = code('proxy.ts');
  const matcher = src.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(matcher, 'proxy.ts has no matcher - without one it runs on every request');
  assert.deepEqual([...matcher[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), ['/backtest', '/live-tracking'], 'the proxy matcher widened - it ran on every page from #1251 to #1434 only to feed the header not-found.tsx read');
  const blocked = src.match(/new Set\(\[([^\]]*)\]\)/);
  assert.ok(blocked);
  assert.deepEqual([...blocked[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), ['/backtest', '/live-tracking'], 'the blocked list and the matcher disagree');
  assert.equal(/new Headers\(|headers\.set\(|request:\s*\{\s*headers|x-lhq-pathname/.test(src), false, 'proxy.ts tags or rewrites request headers again');
  assert.match(src, /return NextResponse\.redirect\(new URL\('\/dashboard', request\.url\)\);/, 'the two hidden pages no longer redirect to /dashboard');
});

test('N5. SWEEP: outside /api, exactly one file reads the request - a new one is a decision, not an accident', () => {
  /* A page that calls headers() only makes ITSELF dynamic, which can be right
     (app/admin/page.tsx does it deliberately). The list is pinned so the next one
     is looked at: is it a page, or a file that renders with every page? */
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (rel !== 'app/api') walk(rel); }
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.ok(files.length > 150 && files.includes('app/not-found.tsx') && files.includes('app/arena/page.tsx'), `the walk is not seeing the tree (${files.length} files)`);
  const NEXT_HEADERS = /from ['"]next\/headers['"]/;
  const hits = files.filter((f) => NEXT_HEADERS.test(code(f))).sort();
  assert.ok(hits.includes('app/admin/page.tsx'), 'CONTROL: the pattern does not match the one file known to import next/headers');
  assert.deepEqual(hits, ['app/admin/page.tsx'], `a file outside /api imports next/headers: ${hits.join(', ')}. If it renders with every page (layout, not-found, a shared provider) this is #1434 again; if it is a single page, add it here with the reason`);
});
