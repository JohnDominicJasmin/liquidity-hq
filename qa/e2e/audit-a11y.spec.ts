/* AUDIT, accessibility and long-session cells (parts 3 of the owner's "audit EVERY page in EVERY scenario"). Informational like the others: a [MATRIX] / [A11Y] JSON line per cell, never a verdict, fails only when a page cannot load.
 *   A:<persona>:<theme>:<path>     axe-core scan of the settled page (critical and serious only): rule id, impact, node count, the first node's selector and text
 *   K:<persona>:<path>             KEYBOARD ONLY: Tab through up to 70 stops from the top of the page: stops with no visible focus indicator (outline, ring or box-shadow), a keyboard TRAP (focus cycling inside 4 or fewer elements while Tab keeps being pressed), and whether the header menus open with Enter and close with Escape
 *   RM:<persona>:<path>            prefers-reduced-motion: reduce: the CSS / Web animations still RUNNING 3 s after load, by target (infinite ones named)
 *   S:session:<persona>:<path>     LONG SESSION: the page stays open for 20 minutes (10 on /dashboard then 10 on /arena for the S:session:pro cell): every 60 s the visible numbers are hashed (does the data keep refreshing?), the JS heap is read, console errors and "reconnecting / unavailable / loading" text are counted; the record shows the heap growth and the number of minutes the page showed no change
 * Zoom 200% at 1280 is the W:...:640 cells of audit-cells.spec.ts (640 CSS px = 1280 at 200%).
 * Paid-AI fence on, writes stubbed, nothing is saved. On production only the signed-out persona runs. */
import { test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { AUTH_READY } from './_auth';
import { PAGES, PROD, open, arm, watch, untilSettled, type Persona } from './_matrix';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const THEMES = ['light', 'dark'] as const;
const KEY_PAGES = ['/', '/dashboard', '/arena', '/settings', '/news', '/upgrade'] as const;

async function prep(browser: import('@playwright/test').Browser, persona: Persona, theme: string, width: number, path: string, o: { reducedMotion?: boolean } = {}) {
  const ctx = await open(browser, persona, theme, width); const page = await ctx.newPage(); const log = watch(page); await arm(page, 'normal', { persona });
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await untilSettled(page, 30_000); await page.waitForTimeout(1_500);
  return { ctx, page, log };
}

for (const persona of ['out', 'pro'] as const) for (const theme of THEMES) for (const path of PAGES) {
  const title = `A:${persona}:${theme}:${path}`;
  test(title, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000);
    const { ctx, page } = await prep(browser, persona, theme, 1280, path);
    try {
      await page.addScriptTag({ path: AXE });
      const res = await page.evaluate(async () => { const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: unknown[]; html: string }>; help: string }> }> } }).axe; const r = await ax.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }); return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, first: `${String(v.nodes[0]?.target?.[0] ?? '').slice(0, 80)} :: ${(v.nodes[0]?.html ?? '').replace(/\s+/g, ' ').slice(0, 90)}` })); }).catch((e) => [{ id: 'AXE-FAILED', impact: 'n/a', nodes: 0, help: String(e).slice(0, 100), first: '' }]);
      console.log(`[A11Y] ${JSON.stringify({ title, violations: res.length, list: res })}`);
    } finally { await ctx.close(); }
  });
}

for (const persona of ['out', 'pro'] as const) for (const path of KEY_PAGES) {
  const title = `K:${persona}:${path}`;
  test(title, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run'); test.setTimeout(180_000);
    const { ctx, page } = await prep(browser, persona, 'light', 1280, path);
    try {
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); window.scrollTo(0, 0); });
      const stops: Array<{ id: string; visible: boolean }> = []; const seen: string[] = [];
      for (let i = 0; i < 70; i++) {
        await page.keyboard.press('Tab');
        const st = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'); const r = e.getBoundingClientRect(); const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/)[0]; return { id: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c ? '.' + c : ''} "${(e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`, ring: !!ring, onScreen: r.width > 0 && r.height > 0 }; }).catch(() => null);
        if (!st) continue; seen.push(st.id); stops.push({ id: st.id, visible: st.ring });
      }
      const noRing = stops.filter((s) => !s.visible).map((s) => s.id); const distinct = new Set(seen).size;
      const trap = seen.length >= 40 && distinct <= 4;
      /* header menus: any element with aria-haspopup / aria-expanded in the header: Enter opens, Escape closes */
      const menu = await page.evaluate(async () => { const btn = document.querySelector('header [aria-haspopup], header button[aria-expanded], nav button[aria-expanded]') as HTMLElement | null; if (!btn) return { found: false }; btn.focus(); const before = btn.getAttribute('aria-expanded'); return { found: true, label: (btn.innerText || btn.getAttribute('aria-label') || '').trim().slice(0, 30), before }; });
      let menuResult: Record<string, unknown> = menu as Record<string, unknown>;
      if ((menu as { found: boolean }).found) { await page.keyboard.press('Enter'); await page.waitForTimeout(500); const opened = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute?.('aria-expanded') ?? document.querySelector('[role=menu]') !== null); await page.keyboard.press('Escape'); await page.waitForTimeout(500); const closed = await page.evaluate(() => document.querySelector('[role=menu]') === null); menuResult = { ...menu, openedWithEnter: opened, closedWithEscape: closed }; }
      console.log(`[A11Y] ${JSON.stringify({ title, tabStops: stops.length, distinct, trap, noVisibleFocus: noRing.length, noVisibleFocusList: noRing.slice(0, 8), menu: menuResult })}`);
    } finally { await ctx.close(); }
  });
}

for (const path of ['/', '/dashboard', '/arena', '/markets', '/news', '/research']) {
  const title = `RM:out:${path}`;
  test(title, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await prep(browser, 'out', 'light', 1280, path, { reducedMotion: true });
    try {
      await page.waitForTimeout(3_000);
      const r = await page.evaluate(() => { const anims = document.getAnimations().filter((a) => a.playState === 'running'); const d = (a: Animation) => { const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null; const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'script'; const inf = a.effect?.getTiming().iterations === Infinity; return `${t?.tagName?.toLowerCase() ?? '?'}${t?.className ? '.' + String(t.className).split(' ')[0] : ''} ${name}${inf ? ' (infinite)' : ''}`; }; return { running: anims.length, infinite: anims.filter((a) => a.effect?.getTiming().iterations === Infinity).length, list: anims.slice(0, 8).map(d) }; });
      console.log(`[A11Y] ${JSON.stringify({ title, runningAfter3s: r.running, infinite: r.infinite, list: r.list })}`);
    } finally { await ctx.close(); }
  });
}

/* LONG SESSION: 20 minutes, sampled every 60 s */
for (const [persona, paths] of [['out', ['/dashboard']], ['pro', ['/dashboard', '/arena']]] as const) {
  const title = `S:session:${persona}:${paths.join('+')}`;
  test(title, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run'); test.setTimeout(30 * 60_000);
    const ctx = await open(browser, persona as Persona, 'light', 1280); const page = await ctx.newPage(); const log = watch(page); await arm(page, 'normal', { persona: persona as Persona });
    const heap = async (p: Page) => p.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null).catch(() => null);
    const hash = async (p: Page) => p.evaluate(() => { const t = (document.body.innerText || '').match(/[-+]?\$?\d[\d,]*\.?\d*%?/g) ?? []; let h = 0; const s = t.join('|'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return `${t.length}:${h}`; }).catch(() => 'n/a');
    try {
      const samples: Array<{ min: number; path: string; heapMB: number | null; changed: boolean; says: string[]; errs: number }> = []; const per = Math.floor(20 / paths.length);
      for (const path of paths) {
        await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await untilSettled(page, 30_000); let last = await hash(page);
        for (let m = 1; m <= per; m++) {
          await page.waitForTimeout(60_000); const h = await hash(page); const hp = await heap(page);
          const says = await page.evaluate(() => (document.body.innerText || '').split('\n').filter((l) => /(reconnect|connection lost|unavailable|couldn.?t load|loading)/i.test(l) && l.length < 100).slice(0, 3)).catch(() => []);
          samples.push({ min: samples.length + 1, path, heapMB: hp == null ? null : Math.round(hp / 1048576), changed: h !== last, says, errs: log.errs.length }); last = h;
        }
      }
      const heaps = samples.map((s) => s.heapMB).filter((x): x is number => x != null); const unchanged = samples.filter((s) => !s.changed).length;
      console.log(`[MATRIX] ${JSON.stringify({ title, kind: 'session', minutes: samples.length, heapStartMB: heaps[0] ?? null, heapEndMB: heaps[heaps.length - 1] ?? null, heapMaxMB: heaps.length ? Math.max(...heaps) : null, minutesWithNoDataChange: unchanged, lastChangeMinute: [...samples].reverse().find((s) => s.changed)?.min ?? null, consoleErrors: Array.from(new Set(log.errs)).slice(0, 4), failed: Array.from(new Set(log.failed)).slice(0, 3), http: Array.from(new Set(log.bad)).slice(0, 5), statusLines: Array.from(new Set(samples.flatMap((s) => s.says))).slice(0, 5) })}`);
    } finally { await ctx.close(); }
  });
}
