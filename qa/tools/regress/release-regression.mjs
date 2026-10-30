/* REGRESSION v2 for the qa promotion — the scope the owner's approval actually rests on.
 *
 * v1 measured 390 px, two themes, axe AA. The owner approved four unseen pages ON THAT MEASUREMENT,
 * so the gaps in it became mandatory steps rather than caveats:
 *
 *   1. THREE WIDTHS. These pages have never been loaded above 390 px by anyone.
 *   2. /help's ACCORDIONS OPENED, then re-measured. Never exercised, and the 18 `incomplete`
 *      contrast results are on the chevrons that control them (5.20 dark / 3.59 light, passing
 *      1.4.11's 3:1 AS DECORATION). If opening them changes those controls' role, the applicable
 *      threshold becomes 4.5 and light fails immediately.
 *   3. /status IN MORE THAN ONE STATE, by intercepting /api/health. One state has been seen and it
 *      was not Operational — which is the state everybody will see most.
 *   4. TOUCH TARGETS, WCAG 2.2 SC 2.5.8, 24x24 CSS px. One of the five product claims
 *      /accessibility makes about itself.
 *
 * Every row still asserts the FINAL URL equals the requested one before measuring anything, for the
 * reason six committed tools filed /terms results under "Refunds" for three weeks.
 */
/* Resolved from THIS FILE rather than an absolute path: the script was written in a scratchpad
 * outside the repo and had the checkout root hardcoded, which works on one machine and nowhere
 * else. A cloud runner clones from GitHub, so anything absolute here is a guaranteed failure
 * there. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
/* qa/tools/regress/<this file> -> three levels up is the checkout root. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AXE_SRC = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.env.QA_BASE_URL || 'https://liquidity-hq-qa.onrender.com';
const EXPECT_COMMIT = process.env.EXPECT_COMMIT || '';

const WIDTHS = [
  { name: 'phone', w: 390, h: 844, mobile: true },
  { name: 'tablet', w: 768, h: 1024, mobile: true },
  { name: 'desktop', w: 1440, h: 900, mobile: false },
];
const PAGES = [
  { path: '/refund', expect: ['EU customers', 'right of withdrawal'], absent: ['PLACEHOLDER', 'reviewed by a lawyer'] },
  { path: '/security', expect: ['the Philippines', 'independent developer'], absent: ['PLACEHOLDER'] },
  { path: '/upgrade', expect: ['Sold by LiquidityHQ'], absent: ['PLACEHOLDER'] },
  { path: '/status', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/help', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/accessibility', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/changelog', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/about', expect: [], absent: ['PLACEHOLDER'], control: true },
];
const log = (s) => process.stdout.write(s + '\n');

/* EXIT CODES ARE THE CONTRACT HERE, so the process must be allowed to exit rather than be killed.
 * `process.exit()` immediately after a `fetch` aborts with a libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`) instead of exiting - which reads to anything checking the
 * status as a crash rather than as a refusal. I documented that fix in
 * `qa/tools/regress/deep-verdict-monitor.mjs` this morning and reintroduced it here the same day; it
 * surfaced the first time the refusal path was actually exercised. So everything lives in `main()`
 * and the status is set with `process.exitCode`. */
async function main() {
const ver = await fetch(`${BASE}/api/version`, { cache: 'no-store' }).then((r) => r.json());
log(`build: commit=${ver.commit} branch=${ver.branch} appEnv=${ver.appEnv}`);
if (!EXPECT_COMMIT) { log('REFUSING: set EXPECT_COMMIT so results are attributable to a build.'); return 2; }
if (!String(ver.commit).startsWith(EXPECT_COMMIT)) {
  log(`REFUSING: /api/version reports ${ver.commit}, expected ${EXPECT_COMMIT}.`); return 2;
}

/* ── THIRD PARTIES BLOCKED BY ALLOWLIST ─────────────────────────────────────────────────────────
 *
 * WHY, and it is not a cloud workaround. `components/AppShell.tsx:152` wraps EVERY page in
 * `<MarketProvider>` - the light shell that drops it is scoped to `/ops*` and four auth routes and
 * nothing else - and `MarketProvider` fetches `api.bybit.com` and `api.binance` from the browser.
 * So all nine prose pages open market feeds, which is invisible from the page files: they import
 * only `lib/labels` and `EmailLinked`.
 *
 * Left alone, a cloud container's Bybit 403 and Binance 451 could surface as a banner, an error
 * state or an extra axe finding. Blocking makes the container's LOCATION incapable of influencing a
 * number - which is also better than running locally, where the feeds succeed and vary run to run.
 *
 * ALLOWLIST, NOT A DENYLIST. A name pattern once missed a store's custom domain here and a real
 * third-party checkout page loaded. **An allowlist fails closed; a denylist fails open and you find
 * out from whatever got through.**
 *
 * ONE ORIGIN IS ENOUGH, measured rather than assumed: fonts are `next/font/local` (self-hosted),
 * `app/layout.tsx` pulls no external stylesheet or script, `next.config.ts` declares no image
 * domains, and `/api/version` reports `posthog: false` on qa. So nothing outside the app origin is
 * needed for faithful rendering, and blocking cannot distort the layout being measured.
 *
 * THE LIMIT: these pages are therefore measured WITH MARKET DATA ABSENT. Nothing here tests how any
 * of them behaves when a feed errors. For seven prose pages that is the honest surface, and it is
 * reported as uncovered rather than implied by a clean run.
 */
const APP_ORIGIN = new URL(BASE).origin;

async function installAllowlist(ctx, blockedHosts) {
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(APP_ORIGIN) || /^(data|blob|about):/.test(url)) return route.continue();
    try { blockedHosts.add(new URL(url).host); } catch { blockedHosts.add('(unparseable)'); }
    return route.abort();
  });
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PROBE = `(async () => {
  const d = document.documentElement, b = document.body, txt = (b.innerText || '');
  const ax = await window.axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } });
  /* SC 2.5.8: an interactive element's rendered box under 24x24. The inline-in-a-sentence exception
     is why links inside paragraphs are excluded rather than counted. */
  const small = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); })
    .filter((e) => !(e.tagName === 'A' && e.closest('p')))
    .map((e) => e.tagName.toLowerCase() + ':' + (e.textContent || '').trim().slice(0, 14)).slice(0, 5);
  return {
    themeAttr: d.getAttribute('data-theme'),
    scrollWidth: Math.max(d.scrollWidth, b.scrollWidth),
    overflowPx: Math.max(d.scrollWidth, b.scrollWidth) - window.innerWidth,
    violations: ax.violations.map((v) => v.id + '[' + v.impact + ']x' + v.nodes.length),
    violationNodes: ax.violations.reduce((a, v) => a + v.nodes.length, 0),
    incompleteNodes: ax.incomplete.reduce((a, v) => a + v.nodes.length, 0),
    unsubstituted: ['{name}', '{country}', '{region}'].filter((t) => txt.includes(t)),
    keyLeak: (txt.match(/\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}\\b/g) || []).slice(0, 3),
    smallTargets: small, smallCount: small.length,
    textLen: txt.trim().length,
  };
})()`;

const browser = await chromium.launch();
const rows = [];
/** Every third-party host the allowlist refused, across the whole run. Empty is a FINDING. */
const BLOCKED = new Set();

for (const vp of WIDTHS) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: theme,
    });
    await installAllowlist(ctx, BLOCKED);
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    for (const p of PAGES) {
      const page = await ctx.newPage();
      const row = { w: vp.name, theme, path: p.path, control: !!p.control };
      try {
        const res = await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        row.status = res?.status() ?? null;
        row.finalPath = new URL(page.url()).pathname;
        row.urlMatches = row.finalPath === p.path || row.finalPath === `${p.path}/`;
        if (row.urlMatches) {
          await page.addScriptTag({ content: AXE_SRC });
          Object.assign(row, await page.evaluate(PROBE));
          const txt = await page.evaluate(() => document.body.innerText || '');
          row.missing = p.expect.filter((s) => !txt.includes(s));
          row.present = p.absent.filter((s) => txt.includes(s));
        }
      } catch (e) { row.error = e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e); }
      rows.push(row); await page.close();
    }
    await ctx.close();
  }
}

/* ── /help's accordions, opened ──────────────────────────────────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
  await installAllowlist(ctx, BLOCKED);
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/help`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({
    buttons: document.querySelectorAll('button[type="button"]').length,
    expanded: [...document.querySelectorAll('[aria-expanded]')].map((e) => e.getAttribute('aria-expanded')),
    chevronAriaHidden: [...document.querySelectorAll('button[type="button"] span')].map((s) => s.getAttribute('aria-hidden')).filter(Boolean).length,
  }));
  /* Click every accordion control, then re-measure: the opened state has never been looked at. */
  const clicked = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('button[type="button"]')];
    bs.forEach((b) => b.click());
    return bs.length;
  });
  await page.waitForTimeout(900);
  await page.addScriptTag({ content: AXE_SRC });
  const after = await page.evaluate(PROBE);
  const afterState = await page.evaluate(() => ({
    expanded: [...document.querySelectorAll('[aria-expanded]')].map((e) => e.getAttribute('aria-expanded')),
    textLen: (document.body.innerText || '').trim().length,
    namedButtons: [...document.querySelectorAll('button[type="button"]')]
      .filter((b) => ((b.getAttribute('aria-label') || b.textContent || '').replace(/[\u25be\u25b4\s]/g, '').length > 0)).length,
    totalButtons: document.querySelectorAll('button[type="button"]').length,
  }));
  log(`\n--- /help accordions (light, 390) ---`);
  log(`  buttons=${before.buttons} clicked=${clicked} chevrons aria-hidden=${before.chevronAriaHidden}`);
  log(`  aria-expanded before: ${JSON.stringify(before.expanded.slice(0, 6))}`);
  log(`  aria-expanded after:  ${JSON.stringify(afterState.expanded.slice(0, 6))}`);
  log(`  text ${before.buttons ? '' : ''}after open = ${afterState.textLen} chars`);
  log(`  buttons with an accessible name (chevron stripped): ${afterState.namedButtons}/${afterState.totalButtons}`);
  log(`  OPENED STATE: overflow=${after.overflowPx} AA=${after.violationNodes} [${after.violations.join(' ') || 'none'}] incomplete=${after.incompleteNodes} smallTargets=${after.smallCount} ${after.smallTargets.join(' ')}`);
  await page.close(); await ctx.close();
}

/* ── /status in four states, by intercepting /api/health ─────────────────────────────────────── */
{
  const STATES = [
    { name: 'all ok', body: { ok: true, checked_at: new Date().toISOString(), db_age_ms: 10, exchanges: { binance: { degraded: false }, bybit: { degraded: false }, okx: { degraded: false }, hyperliquid: { degraded: false } } } },
    { name: 'db slow', body: { ok: false, reason: 'db_slow', checked_at: new Date().toISOString(), db_age_ms: 0, exchanges: { binance: { degraded: false } } } },
    { name: 'exchange degraded', body: { ok: true, checked_at: new Date().toISOString(), db_age_ms: 10, exchanges: { binance: { degraded: true }, bybit: { degraded: false } } } },
    { name: 'malformed (ok as a string)', body: { ok: 'true', checked_at: 'not-a-date' } },
    { name: 'route fails (500)', status: 500, body: { error: 'boom' } },
  ];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await installAllowlist(ctx, BLOCKED);
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
  /* `page.route` is consulted before `context.route`, so the /api/health stub below wins over the
     allowlist - and /api/health is same-origin anyway, so the allowlist would have passed it. */
  log(`\n--- /status states (dark, 390), /api/health intercepted ---`);
  for (const s of STATES) {
    const page = await ctx.newPage();
    await page.route('**/api/health*', (route) => route.fulfill({
      status: s.status ?? 200, contentType: 'application/json', body: JSON.stringify(s.body),
    }));
    try {
      await page.goto(`${BASE}/status`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1600);
      const r = await page.evaluate(() => {
        const txt = (document.body.innerText || '');
        const words = ['Operational', 'Degraded', 'Unknown', 'Unreachable', 'Down', 'Offline'];
        return { shown: words.filter((w) => new RegExp(w, 'i').test(txt)), textLen: txt.trim().length };
      });
      log(`  ${s.name.padEnd(28)} -> ${r.shown.join(', ') || '(no state word found)'}`);
    } catch (e) {
      log(`  ${s.name.padEnd(28)} -> ERROR ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
    await page.close();
  }
  await ctx.close();
}

await browser.close();

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */
log('\n--- pages x widths x themes ---');
let fails = 0;
for (const r of rows) {
  const tag = `${r.w.padEnd(7)} ${r.theme.padEnd(5)} ${r.path.padEnd(15)}`;
  if (r.error) { log(`${tag} ERROR ${r.error}`); fails++; continue; }
  if (!r.urlMatches) { log(`${tag} REDIRECTED -> ${r.finalPath}  NOT MEASURED`); fails++; continue; }
  const p = [];
  if (r.overflowPx > 0) p.push(`OVERFLOW +${r.overflowPx}px`);
  if (r.violationNodes > 0) p.push(`AA ${r.violations.join(' ')}`);
  if (r.unsubstituted.length) p.push(`UNSUBSTITUTED ${r.unsubstituted.join(' ')}`);
  if (r.keyLeak.length) p.push(`KEY ON SCREEN ${r.keyLeak.join(' ')}`);
  if (r.missing?.length) p.push(`MISSING ${JSON.stringify(r.missing)}`);
  if (r.present?.length) p.push(`MUST NOT APPEAR ${JSON.stringify(r.present)}`);
  if (r.smallCount > 0) p.push(`SC2.5.8 ${r.smallCount} under 24px: ${r.smallTargets.join(' ')}`);
  if (p.length) fails++;
  log(`${tag} sw=${String(r.scrollWidth).padEnd(5)} ${p.length ? 'FAIL  ' + p.join(' | ') : 'ok'}`);
}
log(`\n${rows.length} page measurements, ${fails} with findings.`);
const ctl = rows.filter((r) => r.control && !r.error && r.urlMatches);
log(`CONTROL /about across all widths: ${ctl.every((c) => c.overflowPx <= 0 && c.violationNodes === 0) ? 'clean' : 'ALSO FAILING - findings above may not be specific to this release'}`);

/* THE BLOCKING MUST BE SHOWN TO HAVE FIRED. An allowlist that refused nothing is indistinguishable
   from one that was never installed - and in that case every number above was taken with the market
   feeds LIVE, which is the opposite of what this run claims about itself. */
log(`\n--- third parties refused by the allowlist (app origin ${APP_ORIGIN}) ---`);
if (BLOCKED.size === 0) {
  log('  NOTHING WAS BLOCKED. Either the route handler never installed, or these pages made no');
  log('  third-party request at all. Both are findings: the first means every measurement above was');
  log('  taken with live feeds, the second contradicts AppShell.tsx:152 wrapping them in');
  log('  MarketProvider. DO NOT report this run as "measured with market data absent" until resolved.');
} else {
  log(`  ${BLOCKED.size} distinct host(s): ${[...BLOCKED].sort().join(', ')}`);
  log('  So the pages DID reach for third parties and were prevented - the market-data-absent claim holds.');
}


/* ── #1833: /api/briefing's NEW INPUT BOUND ──────────────────────────────────────────────────────
 *
 * WHY THIS IS IN A PAGE REGRESSION AT ALL. My scope came from `git diff` - nine pages. #1833 changes
 * four API routes, which is behaviour with no page to measure, and I would have missed it entirely
 * had I not read #1845, the handoff whose whole job is telling QA what to exercise.
 * **The diff tells you what moved; the handoff tells you what it was for.**
 *
 * WHY IT COSTS NOTHING, established from the route's ORDER rather than hoped:
 *
 *     :54/:58  auth                     -> 401
 *     :67      empty context            -> 400 "context required"
 *     :82      context.length > 64_000  -> 400 "Invalid request."      <- the new bound
 *     :86-:96  rate limit, incrementUsageColumn
 *     :109     xaiFetch                                               <- the billed call
 *
 * The bound sits AFTER auth and BEFORE the reservation and the xAI call, so an authenticated
 * oversized POST is refused having spent nothing: no usage increment, no AI call, no daily counter.
 *
 * THE ERROR STRING IS THE CONTROL. Both rejections are 400, so a status code alone cannot tell the
 * size gate from the empty-context gate - and sending an empty body would "pass" a test that only
 * checked for 400. Asserting "Invalid request." is what proves the request reached :82.
 *
 * NOT TESTED, DELIBERATELY: the accept side. It proceeds to `xaiFetch` and bills. So "a legitimate
 * briefing still works" is unmeasured by me - and that is the half where the ~6,800-character
 * worst case is derived from the builder's structure rather than from logged payloads.
 */
async function briefingBound() {
  const env = {};
  for (const f of ['.env.e2e.local', '.env.local']) {
    const path = `${REPO_ROOT}${f}`;
    let raw; try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, ''));
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (!(k in env) && v) env[k] = v;

  log('\n--- #1833: /api/briefing input bound (nothing billed - the bound precedes the reservation) ---');
  const need = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'E2E_USER_A_EMAIL', 'E2E_USER_A_PASSWORD'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) { log(`  SKIPPED - missing credentials: ${missing.join(', ')}. NOT a pass.`); return; }

  const post = (body, token) => fetch(`${BASE}/api/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  /* Unauthenticated first: free, and it proves the route is reachable and that the token below is
     what carries us past :58 - otherwise a 400 later could just be a coincidence. */
  const anon = await post({ context: 'x' });
  const anonBody = await anon.json().catch(() => ({}));
  log(`  unauthenticated            -> ${anon.status} ${JSON.stringify(anonBody.error ?? anonBody.code ?? '')}  ${anon.status === 401 ? 'ok' : 'UNEXPECTED'}`);

  const auth = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD }),
  });
  if (!auth.ok) { log(`  SKIPPED - sign-in failed HTTP ${auth.status}. NOT a pass.`); return; }
  const token = (await auth.json()).access_token;
  if (!token) { log('  SKIPPED - sign-in returned no access_token. NOT a pass.'); return; }

  /* The empty-context gate, as the discriminator: also a 400, different string. */
  const empty = await post({ context: '' }, token);
  const emptyBody = await empty.json().catch(() => ({}));
  log(`  authed, empty context      -> ${empty.status} ${JSON.stringify(emptyBody.error)}`);

  /* THE BOUND. 64,001 characters: one past the limit, so nothing but the length can explain it. */
  const over = await post({ context: 'x'.repeat(64_001) }, token);
  const overBody = await over.json().catch(() => ({}));
  const correct = over.status === 400 && overBody.error === 'Invalid request.';
  log(`  authed, 64,001 chars       -> ${over.status} ${JSON.stringify(overBody.error)}  ${correct ? 'ok - rejected at :82' : 'FAIL'}`);
  if (!correct) {
    log('    Expected 400 "Invalid request." If this is 400 "context required" the request never');
    log('    reached the bound; if it is 429 the reservation ran BEFORE the bound, which would mean');
    log('    an oversized call can consume quota - the opposite of what #1833 claims.');
  }
  if (emptyBody.error === overBody.error) {
    log('    CONTROL FAILED: both rejections return the same string, so this cannot tell the size');
    log('    gate from the empty-context gate and the result above means nothing.');
  }
}
await briefingBound();

return fails > 0 ? 1 : 0;
}

/* exitCode, not exit(): see the note on main(). 0 = clean, 1 = findings, 2 = refused to run. */
process.exitCode = await main();
