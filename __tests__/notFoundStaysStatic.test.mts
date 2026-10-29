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
/* ── WHY EVERY app/ PATH HERE IS RESOLVED RATHER THAN WRITTEN ───────────────────────
 *
 * #1740 moves these files under route groups: `app/not-found.tsx` becomes
 * `app/(main)/not-found.tsx`, and `app/layout.tsx` becomes `app/(main)/layout.tsx`.
 * A parenthesised segment is invisible in the URL, so those are the SAME route - this
 * test does not care where on disk they sit, only what renders with every page.
 *
 * Hard-coding either spelling is red on one side of that merge and green on the other,
 * in both directions, so `appPath` resolves at run time instead. All four assertions
 * below failed as `ENOENT` stale lookups on the merge of this branch with dev; the
 * #1434 invariant they guard was never in question. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { appPath, appFiles, isGroupSegment, ROOT } from './_appPath.mts';
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

/** Wherever route groups put it. Resolved once; every message below names the real path. */
const NOT_FOUND = appPath('app/not-found.tsx');

test('N1. the not-found file reads nothing about the request and sets no route config - it renders inside EVERY page', () => {
  const src = code(NOT_FOUND);
  assert.equal(REQUEST_TIME.test(src), false, `${NOT_FOUND} reads the request again (headers/cookies/...). Next renders this file with every page, so the whole site goes dynamic and unknown URLs answer 200 - #1434`);
  assert.equal(ROUTE_CONFIG.test(src), false, `${NOT_FOUND} exports dynamic/revalidate/fetchCache`);
  assert.match(src, /export default function NotFound\(\)/, 'the not-found component is no longer a plain synchronous function - an async one is how a request-time read gets in');
  assert.equal(/\bawait\b|\bconsole\./.test(src), false, `${NOT_FOUND} awaits something or logs - both were part of the #1251 change that caused #1434`);
});

test('N2. nothing the not-found file imports reads the request either - moving the call one file down would do the same damage', () => {
  const seen = new Set<string>();
  const queue = localImports(NOT_FOUND);
  assert.ok(queue.length > 0, `CONTROL: ${NOT_FOUND} imports no local file - re-derive this test`);
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = code(f);
    assert.equal(REQUEST_TIME.test(src), false, `${f}, reached from ${NOT_FOUND}, reads the request`);
    // A client component cannot read the request on the server; stop there.
    if (!/^\s*['"]use client['"]/.test(read(f))) queue.push(...localImports(f));
    assert.ok(seen.size < 200, 'the import walk did not terminate');
  }
});

/**
 * EVERY root layout, DISCOVERED rather than listed - a `layout.tsx` with no other layout in a
 * strict ancestor directory.
 *
 * #1740 turns one root layout into TWO: `app/(main)/layout.tsx` for the app, and
 * `app/(intl)/[locale]/layout.tsx` so /ko and /zh can declare their own `<html lang>`. A
 * hard-coded list covers the first and SILENTLY SKIPS the second, which is the worst failure
 * available here - a `headers()` call in the intl root would make every translated page dynamic
 * and this file would still have been green. Discovery adapts to both sides of the merge and
 * cannot under-count.
 */
function rootLayouts(files: readonly string[]): string[] {
  const layouts = files.filter((f) => /\/layout\.tsx$/.test(f));
  return layouts
    .filter((f) => {
      const dir = path.posix.dirname(f);
      return !layouts.some((o) => o !== f && dir.startsWith(`${path.posix.dirname(o)}/`));
    })
    .sort();
}

test('N3. every root layout, plus loading and global-error - all rendered with every page - read nothing about the request', () => {
  const roots = rootLayouts(appFiles());

  /* CONTROL, and it holds on both sides of #1740: whatever serves the logical root layout must
     be one of the discovered roots. If discovery breaks, this fails rather than passing on an
     empty list - the vacuous-pass shape that makes a sweep worthless. */
  assert.ok(roots.length > 0, 'no root layout found at all - discovery is broken, not the app');
  assert.ok(
    roots.includes(appPath('app/layout.tsx')),
    `the resolved root layout ${appPath('app/layout.tsx')} is not among the discovered roots [${roots.join(', ')}]`,
  );

  for (const f of [...roots, appPath('app/loading.tsx'), appPath('app/global-error.tsx')]) {
    const src = code(f);
    assert.equal(REQUEST_TIME.test(src), false, `${f} reads the request - it renders with every page, so every page goes dynamic`);
    assert.equal(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src), false, `${f} forces dynamic rendering for the whole app`);
  }

  /* `await params` is NOT a request-time read and must not be mistaken for one. The Next glossary
     lists exactly cookies(), headers(), searchParams and draftMode(); `params` is absent, and the
     intl root layout awaits it deliberately so /ko and /zh stay prerendered under
     generateStaticParams + `dynamicParams = false`. REQUEST_TIME does not match it - asserted
     here so a future tightening of that pattern cannot quietly make this test wrong. */
  assert.equal(REQUEST_TIME.test('const { locale } = await params;'), false, 'REQUEST_TIME now matches `await params`, which is not a dynamic API');
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
  /* The walk itself needs no change - it recurses, so it descends into `(main)` and `(intl)`
     without knowing they exist. Only these CONTROL literals had to stop being literals, and a
     control that quietly stops matching is exactly how a sweep starts covering nothing. */
  const ADMIN = appPath('app/admin/page.tsx');
  assert.ok(
    files.length > 150 && files.includes(NOT_FOUND) && files.includes(appPath('app/arena/page.tsx')),
    `the walk is not seeing the tree (${files.length} files)`,
  );
  const NEXT_HEADERS = /from ['"]next\/headers['"]/;
  const hits = files.filter((f) => NEXT_HEADERS.test(code(f))).sort();
  assert.ok(hits.includes(ADMIN), `CONTROL: the pattern does not match ${ADMIN}, the one file known to import next/headers`);
  assert.deepEqual(hits, [ADMIN], `a file outside /api imports next/headers: ${hits.join(', ')}. If it renders with every page (layout, not-found, a shared provider) this is #1434 again; if it is a single page, add it here with the reason`);
});
