/* THE WHOLE CLASS IN ONE INSTRUMENT: does the AI vendor's name appear anywhere a client can see it?
 *
 * WHY THIS REPLACES bundle-no-admin-copy.mjs (same file, widened and renamed on 2026-10-23). Six exits for one class were found in
 * one day, by five instruments, each built to check the thing that had just been fixed: the database labels, then the key NAMES, then
 * the `/api/labels` payload, then the repo fallback file, then the server-rendered HTML, then the route paths. The class was named
 * correctly on day one - "the vendor name appears anywhere in rendered source" - and every instrument after it was narrower than the
 * class. A script that passes when its own half is clean is how a class stays open while every fix reports success.
 *
 * FOUR CONDITIONS, REPORTED SEPARATELY AND FAILED TOGETHER. Separately because they have different owners and different costs -
 * conflating them is how "we fixed the labels" became "the vendor name is gone". Together because the only honest summary of this
 * class is one number: zero or not zero.
 *
 *   A. no `OPS_*` key names in any chunk a page loads        - closed by splitting lib/labelDefaults.en.json
 *   B. no vendor or model name in any chunk                  - closed by A plus the label fixes actually deploying
 *   C. no vendor name in any page's RENDERED HTML            - mostly `data-testid` attributes; renaming them is cheap
 *   D. no vendor-named ROUTE PATH in any chunk               - NOT cheap: see the note on D below
 *
 * ON D, BECAUSE IT IS THE ONE THAT WILL BE ARGUED ABOUT. `/api/grok` and `/api/grok-chat` are URLs the browser requests, so they are
 * visible in any network tab - more visible than the labels we fixed, by a wide margin. But renaming them is not a copy edit: it
 * moves app directories, updates every client call site, and anything outside this repo that calls them (docs/INFRASTRUCTURE.md: the
 * schedulers live on cron-job.org and n8n) breaks silently the moment the old path 404s. This script's job is to report the state,
 * not to pretend the four conditions cost the same.
 *
 * WHAT IT READS. Each page's anonymous HTML, and every `/_next/static/chunks/*.js` that page references. No credentials, no browser,
 * no writes, and nothing downloaded is executed. The API payload is NOT covered here - that is labels-no-admin-copy.mjs, and the two
 * together are the class.
 *
 * usage: node qa/tools/regress/vendor-name-not-public.mjs <base-url> [path ...]
 *   default paths: / and /upgrade
 *   exit 0 = all four conditions clean
 *   exit 1 = at least one fails; every condition prints its own count either way
 *   exit 2 = could not run
 * NOTE for Git Bash: a bare `/` argument is rewritten by MSYS, so pass MSYS_NO_PATHCONV=1 if you mean one page only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE) { console.error('usage: vendor-name-not-public.mjs <base-url> [path ...]'); process.exit(2); }
const PATHS = process.argv.slice(3).filter((a) => a.startsWith('/'));
const PAGES = PATHS.length ? PATHS : ['/', '/upgrade'];

const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');

const VENDOR = /grok|xai|x\.ai/gi;
const MODEL = /grok-[0-9][0-9.]*/i;
const ROUTE = /\/api\/grok[a-z-]*/gi;
/* `grok-mode-${id}` is built by concatenation, so the literal does not appear - matching the attribute NAME and then reading its
   value is what finds those. A plain grep for the full testid finds fewer than the DOM carries, which is how these were missed. */
const TESTID = /data-testid="([^"]*)"/gi;

const get = async (url) => {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  return r.text();
};

const uniq = (s, re) => [...new Set((s.match(re) ?? []).map((m) => m.toLowerCase()))];

async function main() {
  const perPage = [];
  let chunksRead = 0;
  const chunkFindings = [];

  for (const page of PAGES) {
    const html = await get(`${BASE}${page}`);
    if (html == null) { console.error(`${page}: could not fetch the page`); return 2; }

    /* ── C: the rendered HTML ── */
    const htmlVendorHits = (html.match(VENDOR) ?? []).length;
    const vendorTestids = [...html.matchAll(TESTID)].map((m) => m[1]).filter((v) => /grok|xai/i.test(v));
    const htmlRoutes = uniq(html, ROUTE);

    console.log(`\n=== ${page}  (${html.length} bytes of HTML)`);
    console.log(`  C. vendor-name occurrences in the HTML: ${htmlVendorHits}`);
    if (vendorTestids.length) console.log(`     of which data-testid attributes: ${[...new Set(vendorTestids)].join(', ')}`);
    if (htmlRoutes.length) console.log(`     route paths in the HTML: ${htmlRoutes.join(', ')}`);

    const chunks = [...new Set((html.match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? []))];
    console.log(`  ${chunks.length} chunk(s) referenced`);

    for (const c of chunks) {
      const js = await get(`${BASE}${c}`);
      if (js == null) { console.log(`     ${c}  (unreadable, skipped)`); continue; }
      chunksRead++;
      const ops = new Set(js.match(/OPS_[A-Z0-9_]+/g) ?? []);
      const vendorHits = (js.match(VENDOR) ?? []).length;
      const model = js.match(MODEL)?.[0] ?? null;
      const routes = uniq(js, ROUTE);
      if (ops.size || vendorHits || routes.length) {
        chunkFindings.push({ page, chunk: c, bytes: js.length, opsKeyNames: ops.size, vendorHits, model, routes });
        console.log(`     ${c}  ${js.length}B  OPS_*: ${ops.size}  vendor hits: ${vendorHits}${model ? `  model: ${model}` : ''}${routes.length ? `  routes: ${routes.join(',')}` : ''}`);
      }
    }

    perPage.push({ page, htmlBytes: html.length, htmlVendorHits, vendorTestids: [...new Set(vendorTestids)], htmlRoutes });
  }

  /* ── the four conditions ── */
  const A = chunkFindings.filter((f) => f.opsKeyNames > 0);
  const B = chunkFindings.filter((f) => f.vendorHits > 0);
  const C = perPage.filter((p) => p.htmlVendorHits > 0);
  const D = chunkFindings.filter((f) => f.routes.length > 0);

  console.log(`\n──────── THE CLASS: "the vendor name appears anywhere a client can see it" ────────`);
  console.log(`A. OPS_* key names in a chunk ........ ${A.length} chunk(s), max ${Math.max(0, ...chunkFindings.map((f) => f.opsKeyNames))} in one   ${A.length ? 'FAIL' : 'PASS'}`);
  console.log(`B. vendor or model name in a chunk ... ${B.length} chunk(s)${chunkFindings.some((f) => f.model) ? `, model id present: ${chunkFindings.find((f) => f.model).model}` : ''}   ${B.length ? 'FAIL' : 'PASS'}`);
  console.log(`C. vendor name in rendered HTML ...... ${C.map((p) => `${p.page}:${p.htmlVendorHits}`).join(' ') || 'none'}   ${C.length ? 'FAIL' : 'PASS'}`);
  console.log(`D. vendor-named route path in a chunk  ${D.length} chunk(s)${D.length ? `, paths: ${[...new Set(D.flatMap((f) => f.routes))].join(', ')}` : ''}   ${D.length ? 'FAIL' : 'PASS'}`);
  console.log(`chunks read: ${chunksRead}`);

  const dir = `${REPO}/../qa-evidence-guardrail`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/vendor-public-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ base: BASE, pages: PAGES, chunksRead, conditions: { A: A.length, B: B.length, C: C.length, D: D.length }, perPage, chunkFindings }, null, 2));
  console.log(`saved ${file}`);

  const failed = A.length || B.length || C.length || D.length;
  console.log(failed
    ? '\nFAIL: the class is open. Each condition above has its own owner and its own cost - D is a route rename, not a copy edit.'
    : '\nPASS: no admin key names, no vendor or model name, and no vendor-named route in anything these pages serve.');
  return failed ? 1 : 0;
}

process.exitCode = await main();
