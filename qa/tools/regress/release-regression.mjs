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

/* `mobile` IS `isMobile` + `hasTouch`, AND IT COST THE TABLET PASS ITS MEASUREMENT.
 *
 * The first run reported `sw=1387` for all 16 tablet rows and flagged no overflow. Under
 * `isMobile` Chromium honours the meta viewport and WIDENS the layout viewport to fit the
 * content instead of overflowing it - so the 768 CSS viewport did not hold, and the metric
 * (scrollWidth - innerWidth) could not have expressed a non-fit even if there was one. A
 * constant 1387 across every page is the signature: that is a shared layout element, not
 * per-page content.
 *
 * 768 is the width these pages had never been loaded at, which was the whole reason it is in
 * this list. So tablet is now a DESKTOP-style viewport at 768 - the layout question - and phone
 * keeps `isMobile`, because 390 is a phone and honouring the meta viewport is correct there.
 * Both halves are also now reported per row (`iw=`), so a repeat of this is visible rather
 * than inferable. */
const WIDTHS = [
  { name: 'phone', w: 390, h: 844, mobile: true },
  { name: 'tablet', w: 768, h: 1024, mobile: false },
  { name: 'desktop', w: 1440, h: 900, mobile: false },
];
const PAGES = [
  { path: '/refund', expect: ['EU customers', 'right of withdrawal'], absent: ['PLACEHOLDER', 'reviewed by a lawyer'] },
  { path: '/security', expect: ['the Philippines', 'independent developer'], absent: ['PLACEHOLDER'] },
  /* /upgrade CARRIES NO PAGE-LEVEL COPY EXPECTATION, AND IT TOOK ME THREE TRIES TO GET HERE.
     Both earlier versions were wrong, in the same way, and both are recorded because the
     mistake is more instructive than the fix:

       1. `Sold by LiquidityHQ` - a string that exists nowhere in the repository. #1843 and
          #1824 rewrote that block inside this very promotion, so the expectation was older
          than the page. Reported MISSING on six rows and read as a lost legal attribution.
       2. `Whop` + `All sales are final` - the right FACTS, read from the page's own governing
          comment, asserted in the WRONG PLACE. Also reported MISSING on all six rows, and
          that is correct: `methodPanel` renders only when `selectedPlan` is set, which is TWO
          clicks from a cold load - reveal the plans, then pick one.

     **Both failures looked like a payments-copy defect on a release whose point is that
     payments are live.** That is the most expensive kind of false finding available here, so
     the measurement moved to where the copy actually is: the purchase-path block below.
     Nothing is asserted about the initial page beyond what every other row asserts. */
  { path: '/upgrade', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/status', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/help', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/accessibility', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/changelog', expect: [], absent: ['PLACEHOLDER'] },
  { path: '/about', expect: [], absent: ['PLACEHOLDER'], control: true },
  /* THE NINTH PAGE, MISSING FROM THE FIRST RUN. The dispatch and the commit message both said
     nine pages with `/about` and `/` as the controls; this array held eight, so the run
     measured 48 rows and reported 48 - complete, but not what was promised. The landing page
     is the second control: it is the one page in this list that this promotion did not touch
     at all, so a finding that appears on it is pre-existing by construction. */
  { path: '/', expect: [], absent: ['PLACEHOLDER'], control: true },
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
const ver = await fetch(`${BASE}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) }).then((r) => r.json());
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

/* THE HANDLER COUNTS WHAT IT SEES, which is what makes an empty blocked-set readable.
 *
 * The first run refused ZERO hosts and the report could only say so as an either/or: the
 * handler never installed, or there was nothing to block. Those have opposite consequences and
 * the output could not tell them apart - so the whole run had to be held.
 *
 * It was the second. `components/MarketProvider.tsx` makes every market request SAME-ORIGIN -
 * `/api/proxy?type=bybit-tickers`, `/api/market/snapshot`, `/api/market/rsi` and the rest - and
 * the venue calls are made SERVER-SIDE from Render. So the browser on these pages never reaches
 * for Bybit or Binance, and `AppShell.tsx:152` wrapping them in `MarketProvider` does not imply
 * that it does. **That premise was mine and it was wrong**; it is corrected here rather than
 * deleted, because it is the reason the first run could not be read.
 *
 * ONE REAL LIMIT REMAINS: `ctx.route` does not intercept WebSockets. A page that opens
 * `wss://fstream.binance.com` is not blocked by this and never was - it does not apply to the
 * prose pages here, but it would to /arena or /dashboard. */
async function installAllowlist(ctx, blockedHosts) {
  await ctx.route('**/*', (route) => {
    SEEN.count += 1;
    const url = route.request().url();
    if (url.startsWith(APP_ORIGIN) || /^(data|blob|about):/.test(url)) { SEEN.sameOrigin += 1; return route.continue(); }
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
    /* REPORTED, NOT USED AS THE BASELINE. Subtracting innerWidth from scrollWidth is what hid
       the tablet problem: the browser had already widened the layout viewport, so content that
       does not fit 768 still 'fits' the viewport it was given. The caller subtracts the
       REQUESTED width instead, and this value is printed so the two can be seen to disagree.
       NO BACKTICKS IN THIS BLOCK - it lives inside a template literal. */
    innerWidth: window.innerWidth,
    violations: ax.violations.map((v) => v.id + '[' + v.impact + ']x' + v.nodes.length),
    violationNodes: ax.violations.reduce((a, v) => a + v.nodes.length, 0),
    incompleteNodes: ax.incomplete.reduce((a, v) => a + v.nodes.length, 0),
    unsubstituted: ['{name}', '{country}', '{region}'].filter((t) => txt.includes(t)),
    keyLeak: (txt.match(/\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,}\\b/g) || []).slice(0, 3),
    smallTargets: small, smallCount: small.length,
    textLen: txt.trim().length,
  };
})()`;

/* ── CREDENTIALS, SHARED BY THE TWO SECTIONS THAT NEED THEM ─────────────────────────────────────
 *
 * `/api/briefing`'s bound and `/upgrade`'s purchase path both need a real user token, and both
 * were reported as blocked on the owner provisioning credentials. **That was wrong, and the
 * correction is PM/DevOps's:** the secrets already exist in this repository and `ci.yml`
 * already uses them. What was missing is that a Claude cloud runner cannot see repository
 * secrets - so the run that skipped was right to skip, and the conclusion drawn from it was not.
 *
 * Read from `.env.e2e.local` / `.env.local` first and the environment second, the same order
 * `qa/e2e/_auth.ts` uses, so a local run and a dispatched one behave identically. */
function loadQaEnv() {
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
  return env;
}

/* ── WHERE A CREDENTIAL MAY BE SENT ─────────────────────────────────────────────────────────────
 *
 * `QA_BASE_URL` comes from a free-form `workflow_dispatch` input, and the credentialed sections
 * mint a REAL user access token and then send it to that host. An arbitrary value would therefore
 * hand a working bearer token to whoever chose it - repo-write only, but a credential leaving for
 * an unvalidated host is not something to leave to the dispatcher's good intentions.
 *
 * So the token never leaves for a host that is not on this list. The PUBLIC page measurements are
 * unaffected: pointing them at another deployment is a legitimate thing to do, and they carry no
 * credential. Only the two credentialed sections are gated.
 *
 * Raised by an automated security review of the commit that added the env block, and correct. */
const CREDENTIALED_ORIGINS = [
  'https://liquidity-hq-qa.onrender.com',
  'https://liquidity-hq-staging.onrender.com',
  'https://liquidity-hq-dev.onrender.com',
  'http://localhost:3000',
  'http://localhost:3100',
];
const BASE_ORIGIN = (() => { try { return new URL(BASE).origin; } catch { return '(unparseable)'; } })();
const CREDENTIALS_ALLOWED_HERE = CREDENTIALED_ORIGINS.includes(BASE_ORIGIN);

const QA_ENV = loadQaEnv();
const CREDS_NEEDED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'E2E_USER_A_EMAIL', 'E2E_USER_A_PASSWORD'];
const CREDS_MISSING = CREDS_NEEDED.filter((k) => !QA_ENV[k]);

/** One password grant for the whole run, or null with the reason already logged by the caller. */
/** Set by any section that could not complete. Makes the run exit 2 - see main()'s return. */
let NOT_MEASURED = false;

let SESSION = null;
async function signInOnce() {
  if (SESSION !== null) return SESSION;
  if (!CREDENTIALS_ALLOWED_HERE) {
    /* Refused BEFORE the password grant, so nothing is minted for a host that may not have it. */
    SESSION = { error: `${BASE_ORIGIN} is not an origin this tool will send a credential to` };
    return SESSION;
  }
  if (CREDS_MISSING.length) { SESSION = false; return SESSION; }
  try {
    const r = await fetch(`${QA_ENV.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: QA_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: QA_ENV.E2E_USER_A_EMAIL, password: QA_ENV.E2E_USER_A_PASSWORD }),
      /* A DEADLINE, because a hung auth service must not hang the run. Measured: dev Supabase
         answered 522 in seconds and then, minutes later, stopped answering at all - an unbounded
         fetch turned a 20-second refusal into an indefinite wait with no output. */
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) { SESSION = { error: `HTTP ${r.status}` }; return SESSION; }
    const b = await r.json();
    SESSION = b.access_token ? { ...b, mintedAtMs: Date.now() } : { error: 'no access_token in the response' };
  } catch (e) {
    SESSION = { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
  return SESSION;
}

/* Seeds the session the way the app reads it - supabase-js v2 keeps `sb-<projectRef>-auth-token`
 * in localStorage. Driving /login instead would mean solving a Cloudflare Turnstile widget,
 * which a test must not do. Same mechanism as `qa/e2e/_auth.ts`'s signedInContext.
 *
 * `expires_at` is derived from when the token was MINTED, not from now: a reused session is
 * already partway through its life and telling the client otherwise is how a token dies
 * mid-measurement. */
async function seedSession(ctx, session) {
  const ref = new URL(QA_ENV.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  await ctx.addInitScript(([r, sIn]) => {
    try {
      localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
        access_token: sIn.access_token,
        refresh_token: sIn.refresh_token,
        expires_in: sIn.expires_in,
        expires_at: Math.floor(sIn.mintedAtMs / 1000) + sIn.expires_in,
        token_type: 'bearer',
        user: sIn.user,
      }));
    } catch {}
  }, [ref, session]);
}

/* ── RUN ONE SECTION, OR ALL OF THEM ────────────────────────────────────────────────────────────
 *
 * `ONLY=briefing,upgrade` runs just those. Default is everything, so a release run is unchanged.
 *
 * WHY IT EXISTS: the two credentialed sections - the #1833 bound and /upgrade's purchase path -
 * are the ones holding this release, and both are cheap on their own. Being forced to spend the
 * full 54-row browser sweep to re-measure one of them is how a cheap check stops being run.
 * `ONLY=briefing` makes no browser call at all. */
const ONLY = (process.env.ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const RUN = (name) => ONLY.length === 0 || ONLY.includes(name);
if (ONLY.length) log(`running only: ${ONLY.join(', ')}`);


/* No browser at all when nothing that needs one is selected. `ONLY=briefing` is a handful of
   fetches, and launching Chromium for it would spend ~100 MB on a laptop that ran out of memory
   once tonight already. */
const NEEDS_BROWSER = ['pages', 'help', 'upgrade', 'status'].some((x) => RUN(x));
const browser = NEEDS_BROWSER ? await chromium.launch() : null;
const rows = [];
/** Every third-party host the allowlist refused, across the whole run. */
const BLOCKED = new Set();
/** Requests the route handler actually saw. `count === 0` is the only reading of an empty
 *  BLOCKED set that invalidates the run - it means the handler never installed. */
const SEEN = { count: 0, sameOrigin: 0 };

if (RUN('pages')) for (const vp of WIDTHS) {
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
          /* Against the width this row ASKED FOR. A page that needs 1387px is not fitting a
             768px tablet just because the browser chose to hand it 1387. */
          row.requestedW = vp.w;
          row.overflowPx = row.scrollWidth - vp.w;
          row.viewportHeld = row.innerWidth === vp.w;
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
if (RUN('help')) {
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
  /* Against the requested 390, for the same reason the row loop is: the probe stopped returning a
     pre-computed overflow when `innerWidth` turned out to be the wrong baseline. */
  log(`  OPENED STATE: overflow=${after.scrollWidth - 390} (sw=${after.scrollWidth} iw=${after.innerWidth}) AA=${after.violationNodes} [${after.violations.join(' ') || 'none'}] incomplete=${after.incompleteNodes} smallTargets=${after.smallCount} ${after.smallTargets.join(' ')}`);
  await page.close(); await ctx.close();
}

/* ── /upgrade's PURCHASE PATH, two clicks deep ───────────────────────────────────────────────────
 *
 * WHY THIS BLOCK EXISTS. The payments copy and the Whop control are not on the page a cold load
 * returns. `app/(main)/upgrade/page.tsx` gates them twice: `upgrade-reveal-plans` sets
 * `plansOpen` (disabled until `purchaseReady`, which for a signed-out visitor settles true), and
 * only choosing a plan sets `selectedPlan`, which is what renders `methodPanel` with the
 * 'Pay with Whop' control and the note that says where payment happens and that sales are final.
 *
 * **So the one surface this release is for has never been measured by anything.** Every previous
 * pass, mine included, measured the page as it loads and reported the gated copy as missing.
 *
 * THE FINAL CONTROL IS NEVER CLICKED. `checkout-method-whop` is a real checkout; this asserts it
 * EXISTS and stops. The allowlist refuses every non-app origin anyway, so a stray navigation
 * would be aborted rather than followed - but not clicking it is the actual guarantee, and the
 * URL is re-asserted after the clicks to prove nothing navigated.
 *
 * Both widths and both themes, because this is a layout surface as well as a copy one: a panel
 * that overflows a phone is the same defect class as a page that does.
 */
/* SIGNED OUT **AND** SIGNED IN. The signed-out pass is what a visitor sees; the signed-in pass is
 * the only way to reach the method panel at all, because choosing a plan while signed out
 * navigates to /login?signup=1&next=/upgrade - measured, not assumed.
 *
 * **Without the signed-in pass this release's payment surface is verified by nothing**: not the
 * copy, not the panel at 390, not its axe result, not its touch targets. */
if (RUN('upgrade')) for (const [vpName, w, h, theme, signedIn] of [
  ['phone', 390, 844, 'light', false],
  ['phone', 390, 844, 'light', true],
  ['desktop', 1440, 900, 'dark', true],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, isMobile: vpName === 'phone', hasTouch: vpName === 'phone', colorScheme: theme,
  });
  await installAllowlist(ctx, BLOCKED);
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  log(`\n--- /upgrade purchase path (${theme}, ${w}, ${signedIn ? 'SIGNED IN' : 'signed out'}) ---`);
  if (signedIn) {
    const session = await signInOnce();
    if (!session || session.error) {
      /* NOT a skip that reads as a pass. The reason is named, and a missing credential is
         reported differently from an auth service that refused - they need different actions. */
      log(`  NOT MEASURED: ${CREDS_MISSING.length
        ? `missing credentials: ${CREDS_MISSING.join(', ')}`
        : `sign-in failed - ${session.error}`}. NOT a pass.`);
      await ctx.close();
      continue;
    }
    await seedSession(ctx, session);
  }
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/upgrade`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const before = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="upgrade-reveal-plans"]');
      return {
        revealFound: Boolean(b),
        revealDisabled: b ? b.disabled === true : null,
        revealExpanded: b ? b.getAttribute('aria-expanded') : null,
        panelPresent: Boolean(document.querySelector('[data-testid="checkout-method-panel"]')),
      };
    });
    log(`  cold load: reveal button ${before.revealFound ? 'present' : 'MISSING'}, disabled=${before.revealDisabled}, aria-expanded=${before.revealExpanded}, panel=${before.panelPresent}`);

    if (!before.revealFound) {
      /* NOT a silent skip. If the control is absent the purchase path cannot be exercised at all,
         and that is a bigger finding than anything below it. */
      log('  NOT MEASURED: [data-testid="upgrade-reveal-plans"] is absent, so the purchase path cannot be opened.');
      log('  Either the page did not render its controls (purchaseReady false) or the test id changed.');
    } else if (before.revealDisabled) {
      log('  NOT MEASURED: the reveal control is DISABLED. purchaseReady is false for this visitor,');
      log('  which for a signed-out load is itself a finding - it settles true once auth resolves.');
    } else {
      await page.click('[data-testid="upgrade-reveal-plans"]');
      await page.waitForTimeout(600);
      const revealed = await page.evaluate(() => ({
        expanded: document.querySelector('[data-testid="upgrade-reveal-plans"]')?.getAttribute('aria-expanded'),
        plans: ['monthly', 'annual', 'fortnightly']
          .filter((k) => document.querySelector(`[data-testid="checkout-cta-${k}"]`)),
      }));
      log(`  after reveal: aria-expanded=${revealed.expanded}, plan controls=[${revealed.plans.join(' ') || 'NONE'}]`);

      if (revealed.plans.length === 0) {
        log('  NOT MEASURED: no plan control appeared, so the method panel cannot be reached.');
      } else {
        const chosen = revealed.plans[0];
        const urlBefore = page.url();
        await page.click(`[data-testid="checkout-cta-${chosen}"]`);
        await page.waitForTimeout(900);

        /* THE PURCHASE PATH IS BEHIND SIGN-IN, AND THIS BRANCH EXISTS SO THAT READS AS A GATE
           RATHER THAN AS MISSING COPY.
           Measured against the deployed page: choosing a plan while signed out navigates to
           `/login?signup=1&next=/upgrade`. No method panel, no Whop control, no note - so a
           signed-out sweep CANNOT reach the payments copy at all, and every "MISSING [Whop, All
           sales are final]" this tool has reported was that gate, not a defect.
           **Reported as NOT MEASURED, with the reason, because the alternative is a false finding
           on the one surface this release is for.** */
        if (new URL(page.url()).pathname !== new URL(urlBefore).pathname) {
          log(`  NOT MEASURED: choosing '${chosen}' navigated to ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
          log('  The method panel is behind SIGN-IN. The payments copy and the Whop control cannot be');
          log('  reached by a signed-out run, so this release\'s payment surface is verified by nothing');
          log('  here. It needs a credentialed check - the same gap as the /api/briefing bound.');
          await page.close(); await ctx.close();
          continue;
        }

        await page.addScriptTag({ content: AXE_SRC });
        const opened = await page.evaluate(PROBE);
        const panel = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="checkout-method-panel"]');
          const txt = (document.body.innerText || '');
          const cta = document.querySelector('[data-testid="checkout-method-whop"]');
          return {
            panelPresent: Boolean(el),
            ctaPresent: Boolean(cta),
            ctaTag: cta ? cta.tagName.toLowerCase() : null,
            ctaText: cta ? (cta.textContent || '').trim().slice(0, 40) : null,
            notePresent: Boolean(document.querySelector('[data-testid="checkout-method-whop-checkout-note"]')),
            closePresent: Boolean(document.querySelector('[data-testid="checkout-method-close"]')),
            /* THE TWO FACTS THE COPY MUST CARRY, from the page's own governing comment
               (owner's #861 / #1567): where payment happens, and that sales are final. */
            missingFacts: ['Whop', 'All sales are final'].filter((t) => !txt.includes(t)),
            /* And the three it must NOT make - the same comment forbids a cancel, refund, card or
               crypto claim, because none of those is offered today. */
            forbidden: ['cancel any time', 'cancel anytime', 'money-back', 'refund within'].filter((t) => new RegExp(t, 'i').test(txt)),
          };
        });
        log(`  chose '${chosen}': panel=${panel.panelPresent} whopCta=${panel.ctaPresent} (${panel.ctaTag} "${panel.ctaText}") note=${panel.notePresent} close=${panel.closePresent}`);
        log(`  the two required facts: ${panel.missingFacts.length === 0 ? 'both present' : `MISSING ${JSON.stringify(panel.missingFacts)}`}`);
        if (panel.forbidden.length) log(`  FORBIDDEN CLAIM ON SCREEN: ${JSON.stringify(panel.forbidden)}`);
        log(`  OPENED PANEL: overflow=${opened.scrollWidth - w} (sw=${opened.scrollWidth} iw=${opened.innerWidth}) AA=${opened.violationNodes} [${opened.violations.join(' ') || 'none'}] incomplete=${opened.incompleteNodes} smallTargets=${opened.smallCount} ${opened.smallTargets.join(' ')}`);
        /* Nothing may have navigated. The checkout control is deliberately NOT clicked, and this
           is the assertion that says so rather than the intention. */
        log(`  still on the same page: ${page.url() === urlBefore ? 'yes' : `NO - moved to ${page.url()}`}`);
      }
    }
  } catch (e) {
    log(`  ERROR ${e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : e}`);
  }
  await page.close(); await ctx.close();
}

/* ── /status in four states, by intercepting /api/health ─────────────────────────────────────── */
if (RUN('status')) {
  const STATES = [
    { name: 'all ok', body: { ok: true, checked_at: new Date().toISOString(), db_age_ms: 10, exchanges: { binance: { degraded: false }, bybit: { degraded: false }, okx: { degraded: false }, hyperliquid: { degraded: false } } } },
    { name: 'db slow', body: { ok: false, reason: 'db_slow', checked_at: new Date().toISOString(), db_age_ms: 0, exchanges: { binance: { degraded: false } } } },
    { name: 'exchange degraded', body: { ok: true, checked_at: new Date().toISOString(), db_age_ms: 10, exchanges: { binance: { degraded: true }, bybit: { degraded: false } } } },
    { name: 'malformed (ok as a string)', body: { ok: 'true', checked_at: 'not-a-date' } },
    { name: 'route fails (500)', status: 500, body: { error: 'boom' } },
    /* THE STATE #1821 ITEM 3 ACTUALLY DESCRIBES, and it was missing. Its wording is "with
       /api/health BLOCKED ENTIRELY ... every row should go to Unknown" - a blocked request is a
       rejected fetch, not a 500 with a JSON body. The page handles the two differently on
       purpose (`.catch(() => setReading(UNREACHABLE))` versus `read(body)`), so testing one and
       quoting the criterion for the other is how a pass and a failure get swapped. */
    { name: 'blocked entirely (fetch fails)', abort: true },
  ];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await installAllowlist(ctx, BLOCKED);
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch {} });
  /* `page.route` is consulted before `context.route`, so the /api/health stub below wins over the
     allowlist - and /api/health is same-origin anyway, so the allowlist would have passed it. */
  log(`\n--- /status states (dark, 390), /api/health intercepted ---`);
  for (const s of STATES) {
    const page = await ctx.newPage();
    await page.route('**/api/health*', (route) => (s.abort
      ? route.abort('failed')
      : route.fulfill({ status: s.status ?? 200, contentType: 'application/json', body: JSON.stringify(s.body) })));
    try {
      await page.goto(`${BASE}/status`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1600);
      /* A PER-ROW MAP, BECAUSE A LIST OF WORDS CANNOT ANSWER THE QUESTION THAT MATTERS.
         The first run reported `route fails (500) -> Operational, Unknown` and that is as far as
         it could go: it collected the distinct state words on the page with no idea which row
         each belonged to. #1821 item 3 is a per-row criterion - "every row should go to
         Unknown" - so a bag of words can neither confirm nor refute it, and PM could not ship
         on "candidate failure, not scored".

         The rows are read structurally rather than by text matching: each is a flex row inside
         the aria-live block, label on the left and state on the right. That is read from
         app/(main)/status/page.tsx's markup, not guessed, and the row count is asserted - if the
         markup changes shape this reports a parse failure instead of an empty pass. */
      const r = await page.evaluate(() => {
        const live = document.querySelector('[aria-live]');
        /* SPAN + SPAN, not "two children". The last block inside the aria-live region is also a
           two-child flex row - the last-checked time plus the Check again BUTTON - so a count
           alone picks it up as a fifth row whose label is a timestamp and whose state reads
           "Check again". Both halves of a real row are spans; the button is what tells them
           apart. */
        const rows = live ? [...live.children].filter((e) => e.children.length === 2
          && e.children[0].tagName === 'SPAN' && e.children[1].tagName === 'SPAN') : [];
        const map = rows.map((e) => [
          (e.children[0].textContent || '').trim(),
          (e.children[1].textContent || '').trim(),
        ]);
        const txt = (document.body.innerText || '');
        const words = ['Operational', 'Degraded', 'Unknown', 'Unreachable', 'Down', 'Offline', 'Slow', 'Checking'];
        return {
          map,
          rowCount: rows.length,
          foundLive: Boolean(live),
          shown: words.filter((w) => new RegExp(w, 'i').test(txt)),
          textLen: txt.trim().length,
        };
      });
      if (!r.foundLive || r.rowCount === 0) {
        log(`  ${s.name.padEnd(28)} -> PARSE FAILED (aria-live block ${r.foundLive ? 'found' : 'MISSING'}, ${r.rowCount} rows). NOT MEASURED.`);
      } else {
        log(`  ${s.name.padEnd(28)} -> ${r.map.map(([k, v]) => `${k}=${v}`).join('  ')}`);
        /* The judgement, stated per state rather than left to the reader. The site row is
           ALLOWED to stay Operational when the endpoint answers at all - the page's own comment
           argues that a served request IS the website being up - but it must NOT when the fetch
           itself failed, which is the blocked case. */
        /* THE SITE ROW IS THE FIRST ONE, BY POSITION, AND ITS LABEL IS NOT "Site".
           Measured against the deployed page rather than assumed: the four labels are `Website`,
           `Accounts and saved data`, `Bybit market data`, `Binance market data` - they are label
           keys, so they are editable copy and a name match would break the moment one is reworded.
           `rows[]` in app/(main)/status/page.tsx is declared SITE, DATABASE, BYBIT, BINANCE in that
           order, so index 0 is the site row. The label is printed so a reader can check the
           assumption instead of taking it. */
        const siteRow = r.map[0];
        const live = r.map.slice(1);
        const liveOperational = live.filter(([, v]) => /operational/i.test(v)).map(([k]) => k);
        if (s.abort) {
          const anyOperational = r.map.filter(([, v]) => /operational/i.test(v)).map(([k]) => k);
          log(`     #1821 item 3: ${anyOperational.length === 0
            ? 'every row is non-Operational - PASSES'
            : `BLOCKER - these rows still read Operational while the fetch FAILED: ${anyOperational.join(', ')}`}`);
        } else if ((s.status ?? 200) >= 500 || s.name.startsWith('malformed')) {
          log(`     health answered but is unusable: ${liveOperational.length === 0
            ? `no live-check row reads Operational (site row "${siteRow?.[0]}"=${siteRow?.[1]} may, by design)`
            : `CANDIDATE BLOCKER - live-check rows reading Operational: ${liveOperational.join(', ')}`}`);
        }
      }
    } catch (e) {
      log(`  ${s.name.padEnd(28)} -> ERROR ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
    await page.close();
  }
  await ctx.close();
}

if (browser) await browser.close();

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */
if (RUN('pages')) log('\n--- pages x widths x themes ---');
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
  const held = r.viewportHeld ? '' : ` [VIEWPORT NOT HELD: asked ${r.requestedW}, got ${r.innerWidth}]`;
  log(`${tag} sw=${String(r.scrollWidth).padEnd(5)} iw=${String(r.innerWidth).padEnd(5)}${held} ${p.length ? 'FAIL  ' + p.join(' | ') : 'ok'}`);
}
if (RUN('pages')) log(`\n${rows.length} page measurements, ${fails} with findings.`);
/* THE CONTROL LINE SAYS WHAT IT MEASURES, because the first run's did not and was misquotable.
   It read `CONTROL /about across all widths: clean` while /about was failing SC 2.5.8 on all six
   of its rows - the expression only covered overflow and axe. Naming the two dimensions in the
   line itself is the fix; a reader cannot take `clean` for `passed` if the line says which
   question it answered. */
for (const c of rows.filter((r) => r.control && !r.error && r.urlMatches).reduce((m, r) => m.set(r.path, [...(m.get(r.path) ?? []), r]), new Map())) {
  const [path, got] = c;
  const overflowAndAxe = got.every((r) => r.overflowPx <= 0 && r.violationNodes === 0);
  const targets = got.every((r) => r.smallCount === 0);
  log(`CONTROL ${path} (${got.length} rows): overflow+axe ${overflowAndAxe ? 'clean' : 'FAILING'}, SC 2.5.8 ${targets ? 'clean' : 'FAILING'}`);
}
if (RUN('pages')) log('  A control that fails is not a release regression - it is pre-existing on a page this promotion did not change.');

/* THE BLOCKING MUST BE SHOWN TO HAVE FIRED. An allowlist that refused nothing is indistinguishable
   from one that was never installed - and in that case every number above was taken with the market
   feeds LIVE, which is the opposite of what this run claims about itself. */
log(`\n--- third parties refused by the allowlist (app origin ${APP_ORIGIN}) ---`);
log(`  the handler saw ${SEEN.count} request(s), ${SEEN.sameOrigin} of them same-origin.`);
if (!NEEDS_BROWSER) {
  /* A FALSE ALARM HERE WOULD BE WORSE THAN NO CHECK. With ONLY=briefing nothing opens a page, so
     zero requests is the correct and only possible result - and the "never installed, the run is
     invalid" line below would be a loud, confident lie about a run that was fine. Ask what a WRONG
     firing would prompt: here it would discard a good measurement. */
  log('  (no browser section ran, so there was nothing to intercept - not a finding)');
} else if (SEEN.count === 0) {
  log('  THE HANDLER NEVER FIRED, so it never installed. Nothing above was measured behind it and');
  log('  the interception claim does not hold. This invalidates the run rather than the pages.');
} else if (BLOCKED.size === 0) {
  log('  Nothing was refused, and the handler demonstrably ran - so these pages made NO third-party');
  log('  request. That is the expected result here: MarketProvider fetches /api/proxy and');
  log('  /api/market/* on the APP ORIGIN and the venue calls happen server-side.');
  log('  NOTE: ctx.route does not intercept WebSockets, so a wss:// feed would not appear here.');
} else {
  log(`  ${BLOCKED.size} distinct host(s): ${[...BLOCKED].sort().join(', ')}`);
  log('  So the pages DID reach for third parties and were prevented.');
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
  /* ONE loader and ONE sign-in for the whole run, shared with the /upgrade pass above. This had its
     own copy of both, and two copies of a credential-reading rule is how one of them quietly stops
     matching the other. */
  const env = QA_ENV;

  log('\n--- #1833: /api/briefing input bound (nothing billed - the bound precedes the reservation) ---');
  if (!CREDENTIALS_ALLOWED_HERE) {
    log(`  REFUSED - ${BASE_ORIGIN} is not an origin this tool will send a user token to. NOT a pass.`);
    log(`  Allowed: ${CREDENTIALED_ORIGINS.join(', ')}`);
    NOT_MEASURED = true;
    return;
  }
  if (CREDS_MISSING.length) { log(`  SKIPPED - missing credentials: ${CREDS_MISSING.join(', ')}. NOT a pass.`); return; }

  const post = (body, token) => fetch(`${BASE}/api/briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  /* Unauthenticated first: free, and it proves the route is reachable and that the token below is
     what carries us past :58 - otherwise a 400 later could just be a coincidence. */
  const anon = await post({ context: 'x' });
  const anonBody = await anon.json().catch(() => ({}));
  log(`  unauthenticated            -> ${anon.status} ${JSON.stringify(anonBody.error ?? anonBody.code ?? '')}  ${anon.status === 401 ? 'ok' : 'UNEXPECTED'}`);

  /* ONE sign-in for the whole run, shared with the /upgrade pass, and it CANNOT THROW.
   *
   * This block used to mint its own token with a bare `fetch` and no deadline. On 2026-10-31 dev
   * Supabase stopped answering mid-request and the run hung for five minutes, then died on undici's
   * `UND_ERR_HEADERS_TIMEOUT` - **and exited 0.** A crash that reports success is the single worst
   * outcome available to a release tool: the output ends mid-sentence and the status says fine.
   *
   * So: a 25-second deadline inside `signInOnce`, the error returned rather than thrown, and the
   * reason printed. An outage is reported as an outage, in seconds, and never as a pass. */
  const session = await signInOnce();
  if (!session || session.error) {
    log(`  SKIPPED - sign-in failed: ${session ? session.error : 'no credentials'}. NOT a pass.`);
    return;
  }
  const token = session.access_token;

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
/* AN OUTAGE MUST NEVER LOOK LIKE A CRASH, and this section had both failure modes tonight: a
 * five-minute hang that exited 0, then a clean 25-second abort that still ended in an uncaught
 * DOMException with the output stopping mid-section. Both read as "the tool is broken" to anyone
 * who did not watch it happen, and neither says what it actually learned: the service did not
 * answer.
 *
 * So every throw from this section is caught here, named, and reported as NOT MEASURED - which is
 * neither a pass nor a product finding. The run's status still reflects it; what changes is that
 * the output says which. */
if (RUN('briefing')) {
  try {
    await briefingBound();
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e);
    log(`  NOT MEASURED - the request did not complete: ${msg}`);
    log('  This is the ENVIRONMENT, not the bound: a timeout here means dev Supabase or the app did');
    log('  not answer. NOT a pass, and not a finding about #1833 either.');
    NOT_MEASURED = true;
  }
}

/* 2 OUTRANKS BOTH, and that ordering is the point. A section that could not run is not a pass
   and not a finding - reporting it as either is how a release gets signed off on an outage.
   The first version set `process.exitCode = 2` inside the catch and it was OVERWRITTEN by
   this line a moment later, so a NOT MEASURED run exited 0. That is my own documented trap:
   a skip that exits 0 cannot gate anything. */
if (NOT_MEASURED) return 2;
return fails > 0 ? 1 : 0;
}

/* exitCode, not exit(): see the note on main(). 0 = clean, 1 = findings, 2 = refused to run. */
process.exitCode = await main();
