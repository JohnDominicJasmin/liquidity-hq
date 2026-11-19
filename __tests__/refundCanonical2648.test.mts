import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

/* #2648 (#1185 PM audit 2026-11-17: "/refund has no canonical"). Written rule: /refund declares ITSELF as its canonical (a self-referencing canonical, like /terms, /about and the other public pages); it must NOT point at /terms#refunds (that would ask search engines to drop the refund page), and the root layout carries none (one per page, or none: a root canonical would make every page claim to be "/").
 *   C1 app/(main)/refund/layout.tsx declares alternates.canonical '/refund', exactly once, and keeps its title
 *   C2 every canonical a public page declares points at that page itself (no page canonicalises to another url), and the root layout declares none
 *   C3 /refund is in the sitemap and is a real page (the canonical is not on a route that does not exist)
 *   C4 DIAGNOSTIC (printed, not asserted): public sitemap routes with no canonical at all */
const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const canonicalsOf = (src: string) => [...strip(src).matchAll(/canonical\s*:\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]);

test('C1. /refund declares itself as its canonical, once, and keeps its title', () => {
  const src = strip(read('app/(main)/refund/layout.tsx'));
  assert.deepEqual(canonicalsOf(src), ['/refund'], 'the refund layout must declare exactly one canonical: /refund');
  assert.ok(/title:\s*'Refund Policy'/.test(src), 'the refund title changed');
  assert.equal(/terms#|#refund/i.test(src), false, 'the canonical must not point into /terms');
});
test('C2. every canonical a (main) page declares is that page itself, and the root layout declares none', () => {
  const dir = new URL('app/(main)/', root); let n = 0; const bad: string[] = [];
  for (const seg of readdirSync(dir, { withFileTypes: true })) {
    if (!seg.isDirectory() || /^[[(_]/.test(seg.name)) continue;
    for (const f of ['layout.tsx', 'page.tsx']) { const rel = `app/(main)/${seg.name}/${f}`; if (!existsSync(new URL(rel, root))) continue; for (const c of canonicalsOf(read(rel))) { n++; if (c !== `/${seg.name}`) bad.push(`${rel}: canonical ${c} (expected /${seg.name})`); } }
  }
  assert.ok(n >= 10, `CONTROL: only ${n} canonicals found; the scan is not seeing the pages`);
  assert.deepEqual(bad, [], 'a page canonicalises to another url');
  for (const rel of ['app/layout.tsx', 'app/(main)/layout.tsx']) if (existsSync(new URL(rel, root))) assert.deepEqual(canonicalsOf(read(rel)), [], `${rel} must not declare a canonical (every page would claim it)`);
});
test('C3. /refund is a real page and is in the sitemap', () => {
  assert.ok(existsSync(new URL('app/(main)/refund/page.tsx', root)), 'no /refund page'); assert.ok(/\/refund`/.test(read('app/sitemap.ts')), 'the sitemap no longer lists /refund');
});
test('C4. DIAGNOSTIC: sitemap routes with no canonical', () => {
  const urls = [...read('app/sitemap.ts').matchAll(/\$\{BASE\}(\/[a-z0-9-]+)`/g)].map((m) => m[1]); const missing: string[] = [];
  for (const u of urls) { const seg = u.slice(1); const has = ['layout.tsx', 'page.tsx'].some((f) => existsSync(new URL(`app/(main)/${seg}/${f}`, root)) && canonicalsOf(read(`app/(main)/${seg}/${f}`)).length > 0); if (!has) missing.push(u); }
  console.log(`[CANON] sitemap routes: ${urls.length} · without a canonical: ${missing.join(' ') || 'none'}`); assert.ok(urls.length >= 5, 'CONTROL: the sitemap scan found no routes');
});
