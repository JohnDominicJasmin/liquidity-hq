/* EXPLORATORY REAL-USER PASS (owner order 2026-11-16: "keep finding flaws, bugs - test it like a real user: what's slow, unresponsive, showing wrong
 * details, unavailable data, wrong data"). Not a gate: it NEVER fails on a finding, it prints one `[EXPLORE] {json}` line per finding and a per-cell summary,
 * and fails only when the harness itself could not run a cell. Run it on a deployed build, one persona per dispatch (the title carries the persona):
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f "spec=--grep=explore out " -f base_url=https://liquidity-hq-staging.onrender.com -f project=desktop -f screenshots=true
 * Personas: `out` (signed out), `free` (fixture B), `pro` (fixture A). Widths: 1280 and 390 (the 390 cells run in the same desktop project at a phone viewport).
 *
 * PER PAGE, per persona and width:
 *   LOAD      time to DOM ready; slow (> 2.5 s to ready) is a finding; same-origin responses with status >= 400; request failures; console errors and page errors.
 *   TEXT      raw label keys (CAPS_WITH_UNDERSCORES), the words undefined / NaN / null / [object Object], "Unavailable"-style text (printed with its context so a human can tell if
 *             the data existed), "updated ... ago" stamps (printed), a visible price of 0 / $0.00.
 *   LAYOUT    sideways scroll (scrollWidth > viewport).
 *   CLICKS    every visible button / tab / switch / link-that-stays-on-the-page (first 14 per page; destructive and money words skipped): no visible change within 2.5 s = NO RESPONSE,
 *             a change after more than 1.2 s = SLOW, a page error or a new failed request caused by the click, a navigation (recorded, then back).
 * Nothing is saved or sent: the settings/journal/alerts WRITES are stubbed to an empty success so the shared dev database is never touched by this pass, and "Ask AI" is opened but never sent.
 * The paid-AI fence is installed, so no AI route can bill. A finding with a screenshot saves qa/.shots/explore-<persona>-<width>-<page>.png. */
import { test, type Page, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });

const PAGES = [
  '/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/correlation', '/news', '/research', '/briefing', '/hours', '/econ-calendar',
  '/calc', '/journal', '/alerts', '/settings', '/playbook', '/upgrade', '/learn', '/faq', '/help', '/about', '/changelog', '/status', '/login',
] as const;
const WIDTHS = [1280, 390] as const;
const PERSONAS = ['out', 'free', 'pro'] as const;

/** Words and shapes that mean "this could cost money, send something, delete something or leave the app". */
const SKIP_CLICK = /delete|remove|sign out|log out|logout|clear|reset|unlink|disconnect|cancel|checkout|subscribe|buy|upgrade|get pro|keep pro|start .*trial|pay|send|submit|save|confirm|connect telegram|copy|download|export|share|install|ask ai|quick|deep|analy[sz]e|run|read|refresh|retry|sign in|log in|create account|sign up|continue with/i;
const RAW_KEY = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]{2,}){1,}\b/g;
const BAD_WORD = /\b(undefined|NaN|\[object Object\])\b/;
const UNAVAILABLE = /(unavailable|not available|couldn.?t load|could not load|no data|try again)/i;

type Finding = { persona: string; width: number; page: string; kind: string; detail: string };
const out: Finding[] = [];
function found(persona: string, width: number, page: string, kind: string, detail: string) {
  const f = { persona, width, page, kind, detail: detail.slice(0, 400) };
  out.push(f);
  console.log(`[EXPLORE] ${JSON.stringify(f)}`);
}

async function open(browser: Browser, persona: (typeof PERSONAS)[number], width: number) {
  const viewport = { width, height: width < 500 ? 844 : 900 };
  if (persona === 'out') {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    return ctx;
  }
  const ctx = await signedInContext(browser, persona === 'pro' ? 'a' : 'b', { viewport });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  return ctx;
}

async function bodyHash(page: Page): Promise<string> {
  return page.evaluate(() => { const b = document.body; return `${b.innerText.length}:${b.innerHTML.length}:${document.querySelectorAll('[aria-pressed="true"],[aria-selected="true"],.on,.active,[aria-expanded="true"],dialog,[role=dialog],[role=menu],[role=listbox]').length}`; }).catch(() => 'x');
}

for (const persona of PERSONAS) for (const width of WIDTHS) for (const path of PAGES) {
  test(`explore ${persona} ${width} ${path}`, async ({ browser }) => {
    /* ON PRODUCTION (E2E_ALLOW_PRODUCTION=1) ONLY THE SIGNED-OUT PERSONA RUNS: there is no production test account (#1259), and this pass never signs in or creates anything there. The click pass skips sign-in, sign-up, send, submit, save, subscribe and buy controls, and every write is stubbed to an empty success before it leaves the browser. */
    test.skip(persona !== 'out' && (!AUTH_READY || process.env.E2E_ALLOW_PRODUCTION === '1'), 'fixture accounts are not configured, or this is a production run (signed out only)');
    test.skip(width > 480 && test.info().project.name === 'mobile', 'the mobile project measures the phone widths only');
    test.setTimeout(300_000);
    const ctx = await open(browser, persona, width);
    const page = await ctx.newPage();
    const errs: string[] = []; const bad: string[] = []; const failed: string[] = [];
    let stage = 'load';
    page.on('pageerror', (e) => errs.push(`[${stage}] pageerror ${String(e.message).slice(0, 160)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR|third-party|captcha|turnstile|google|Cloudflare/i.test(m.text())) errs.push(`[${stage}] console ${m.text().slice(0, 160)}`); });
    page.on('response', (r) => { try { const u = new URL(r.url()); if (u.origin === new URL(page.url() || 'http://x').origin && r.status() >= 400 && !/\/_next\/|favicon/.test(u.pathname)) bad.push(`[${stage}] ${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 60)}`); } catch { /* ignore */ } });
    page.on('requestfailed', (r) => { const u = r.url(); if (/\/api\//.test(u) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) failed.push(`[${stage}] ${r.failure()?.errorText} ${u.slice(0, 100)}`); });
    await installPaidAiFence(page);
    /* WRITES ARE STUBBED: nothing this pass clicks reaches the shared database. GETs go through untouched. */
    await page.route(/\/api\/(settings|journal|alerts|labels\/write|telegram)[^?]*(\?|$)/, (route) => {
      const m = route.request().method();
      if (m === 'GET' || m === 'HEAD') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: [], settings: null }) });
    });
    let shot = false;
    const flag = (kind: string, detail: string) => { shot = true; found(persona, width, path, kind, detail); };
    try {
      const t0 = Date.now();
      let ready = -1;
      try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 }); ready = Date.now() - t0; } catch (e) { flag('LOAD-FAILED', String(e).slice(0, 160)); }
      if (ready < 0) return;
      if (ready > 2500) flag('SLOW-READY', `DOM ready in ${ready} ms`);
      await page.waitForTimeout(persona === 'out' ? 6_000 : 8_000);
      const landed = new URL(page.url()).pathname; if (landed !== path) found(persona, width, path, 'REDIRECT', `-> ${landed}`);
      if (await page.getByText(/Application error|Something went wrong|This page could not be found/i).first().isVisible().catch(() => false)) flag('ERROR-PAGE', 'an error or not-found screen is showing');

      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      const raw = Array.from(new Set((text.match(RAW_KEY) ?? []).filter((k) => !/^(BTC|ETH|SOL|USDT|USD|API|CPI|FOMC|RSI|MACD|EMA|SMA|VWAP|OHLC|HTML|JSON|UTC|NFP|PPI|PCE|GDP|ATH|ATL|OI|LONG_SHORT)$/.test(k)))).slice(0, 8);
      if (raw.length) flag('RAW-KEY', raw.join(', '));
      const bw = BAD_WORD.exec(text); if (bw) flag('BAD-TEXT', `"${bw[1]}" in: ${text.slice(Math.max(0, bw.index - 40), bw.index + 60).replace(/\s+/g, ' ')}`);
      if (/(^|\s)\$0\.00(\s|$)|\$NaN|\$undefined/.test(text)) flag('ZERO-PRICE', 'a $0.00 / $NaN price is visible');
      const un = text.split('\n').filter((l) => UNAVAILABLE.test(l) && l.length < 160).slice(0, 5);
      if (un.length) found(persona, width, path, 'UNAVAILABLE-TEXT', un.join(' | '));
      const stamps = text.split('\n').filter((l) => /(updated|as of|last|ago)\b/i.test(l) && /\d/.test(l) && l.length < 100).slice(0, 4);
      if (stamps.length) found(persona, width, path, 'STAMPS', stamps.join(' | '));
      const sc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
      if (sc.sw > sc.vw) flag('SIDEWAYS-SCROLL', `scrollWidth ${sc.sw} vs ${sc.vw}`);

      /* MOBILE MEASURE (owner, 2026-11-17: the phone view of every page): at a phone width, print for EVERY page the document width against the viewport, the non-fixed elements whose right edge is past the viewport (an element inside a horizontally clipping or scrolling ancestor that itself fits is NOT counted), the tap targets under 24 px and the text clipped by its own box (scrollWidth > clientWidth with a non-visible overflow). One [MOBILE] line per page, so the run log is the evidence. */
      if (width <= 480) {
        const mm = await page.evaluate(() => {
          const vw = window.innerWidth; const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
          const visible = (e: HTMLElement) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
          const fixedUp = (e: HTMLElement) => { for (let p: HTMLElement | null = e; p && p !== document.body; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; };
          const clippedByFittingAncestor = (e: HTMLElement) => { for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true; } return false; };
          const d = (e: HTMLElement) => { const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/)[0]; return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c ? '.' + c : ''} "${(e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`; };
          const over = all.filter((e) => visible(e) && !fixedUp(e) && e.getBoundingClientRect().right > vw + 1 && !clippedByFittingAncestor(e));
          const small = (Array.from(document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=switch],input:not([type=hidden]),select,summary')) as HTMLElement[]).filter((e) => { if (!visible(e)) return false; const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 24; });
          const clipped = all.filter((e) => visible(e) && getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1 && (e.innerText || '').trim().length > 0);
          return { vw, docW: document.documentElement.scrollWidth, over: over.length, overList: over.slice(0, 6).map((e) => `${d(e)} right=${Math.round(e.getBoundingClientRect().right)}`), small: small.length, smallList: small.slice(0, 8).map((e) => `${d(e)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), clipped: clipped.length, clippedList: clipped.slice(0, 6).map((e) => `${d(e)} scroll=${e.scrollWidth} client=${e.clientWidth}${getComputedStyle(e).textOverflow === 'ellipsis' ? ' ellipsis' : ''}`) };
        }).catch(() => null);
        if (mm) {
          console.log(`[MOBILE] ${path} docW=${mm.docW}/${mm.vw} pastViewport=${mm.over} tapUnder24=${mm.small} clippedText=${mm.clipped} :: ${JSON.stringify({ over: mm.overList, small: mm.smallList, clipped: mm.clippedList })}`);
          if (mm.over > 0) found(persona, width, path, 'ELEMENT-PAST-VIEWPORT', mm.overList.join(' | '));
          if (mm.small > 0) found(persona, width, path, 'TAP-TARGET-UNDER-24', `${mm.small}: ${mm.smallList.join(' | ')}`);
          if (mm.clipped > 0) found(persona, width, path, 'CLIPPED-TEXT', `${mm.clipped}: ${mm.clippedList.join(' | ')}`);
        }
      }

      /* CLICK PASS */
      stage = 'click';
      const handles = await page.locator('button:visible, [role=tab]:visible, [role=switch]:visible, summary:visible').elementHandles();
      let clicked = 0;
      for (const h of handles) {
        if (clicked >= 14) break;
        const label = (await h.evaluate((n) => { const e = n as HTMLElement; return (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().replace(/\s+/g, ' '); }).catch(() => '')).slice(0, 50);
        if (!label || SKIP_CLICK.test(label)) continue;
        if (await h.evaluate((n) => { const e = n as HTMLButtonElement; return e.disabled === true || e.getAttribute('aria-disabled') === 'true'; }).catch(() => true)) continue;
        const before = await bodyHash(page); const url0 = page.url(); const errs0 = errs.length + bad.length + failed.length; const t1 = Date.now();
        try { await h.click({ timeout: 3_000 }); } catch { found(persona, width, path, 'CLICK-BLOCKED', `"${label}" is visible but could not be clicked in 3 s (covered or detached)`); continue; }
        clicked++;
        let changed = false; let ms = 0;
        for (let i = 0; i < 25; i++) { await page.waitForTimeout(100); if (page.url() !== url0 || (await bodyHash(page)) !== before) { changed = true; ms = Date.now() - t1; break; } }
        if (!changed) flag('NO-RESPONSE', `"${label}" did nothing visible within 2.5 s`);
        else if (ms > 1200) flag('SLOW-RESPONSE', `"${label}" took ${ms} ms to change the page`);
        if (errs.length + bad.length + failed.length > errs0) flag('CLICK-ERROR', `after "${label}": ${[...errs, ...bad, ...failed].slice(errs0).slice(0, 2).join(' ; ')}`);
        if (new URL(page.url()).pathname !== new URL(url0).pathname) { found(persona, width, path, 'NAVIGATED', `"${label}" -> ${new URL(page.url()).pathname}`); await page.goBack({ timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(1_500); }
        else { await page.keyboard.press('Escape').catch(() => {}); }
      }
      stage = 'after';
      for (const x of Array.from(new Set(errs)).slice(0, 4)) found(persona, width, path, 'JS-ERROR', x);
      for (const x of Array.from(new Set(bad)).slice(0, 6)) found(persona, width, path, 'HTTP-ERROR', x);
      for (const x of Array.from(new Set(failed)).slice(0, 4)) found(persona, width, path, 'REQUEST-FAILED', x);
      console.log(`[EXPLORE-CELL] ${persona} ${width} ${path} ready=${ready}ms clicked=${clicked} findings=${out.filter((f) => f.persona === persona && f.width === width && f.page === path).length}`);
      if (shot) await page.screenshot({ path: `qa/.shots/explore-${persona}-${width}-${path.replace(/\//g, '_') || '_home'}.png`, fullPage: false }).catch(() => {});
    } finally { await ctx.close(); }
  });
}
