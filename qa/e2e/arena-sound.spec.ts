/* Arena sound alerts (#2304, owner-requested, ask first). Signed in as account A; the settings read and write are STUBBED and stateful (the real dev row is never written), and the page's AudioContext is spied
 * so "nothing plays" is measured, not assumed. Expectations are the PR text:
 *   A1  arena_sound null: the prompt shows (Allow / Not now / close), and NO AudioContext is created and no oscillator is made, even after clicks elsewhere on the page
 *   A2  Allow: arena_sound true is sent; the AudioContext is created INSIDE the click (a gesture) and resumed; the prompt goes; one soft confirmation tone follows
 *   A3  Not now: arena_sound false is sent, the prompt goes and STAYS gone after a reload (the stub plays the saved row back), and no AudioContext ever exists
 *   A4  the close button behaves like Not now
 *   A5  the Settings switch follows the saved answer (off after Not now, on after Allow) and toggling it sends the opposite value; the Arena prompt does not come back
 *   A6  shots: the prompt at 390 and 1280, light and dark; the Settings row
 *   A7  (source guard) the page reads sounds only when settings are ready AND arena_sound === true, and the hook plays nothing while audio is locked
 * NOT exercised here: a new signal / big move pinging on the live chart (the rules are in __tests__/arenaSoundTriggers.test.mts; the page wiring is guarded in A7 only). */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });

async function open(browser: Browser, o: { width?: number; theme?: 'dark' | 'light'; saved?: boolean | null } = {}) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
    /* spy on audio: count contexts, oscillators and resumes; the real API still runs */
    const w = window as unknown as { __snd: { ctx: number; osc: number; resume: number; created: string[]; lastGesture: number } };
    w.__snd = { ctx: 0, osc: 0, resume: 0, created: [], lastGesture: 0 };
    addEventListener('pointerdown', () => { w.__snd.lastGesture = performance.now(); }, true);
    const Real = window.AudioContext;
    if (Real) {
      class Spy extends Real {
        constructor(...a: unknown[]) { super(...(a as [])); w.__snd.ctx++; w.__snd.created.push(`gesture-age-ms=${Math.round(performance.now() - w.__snd.lastGesture)}`); }
        createOscillator() { w.__snd.osc++; return super.createOscillator(); }
        resume() { w.__snd.resume++; return super.resume(); }
      }
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = Spy as unknown as typeof AudioContext;
    }
  }, o.theme ?? 'dark');
  const page = await ctx.newPage(); await page.setViewportSize({ width: o.width ?? 1280, height: 900 });
  await installPaidAiFence(page);
  const state = { saved: o.saved === undefined ? null : o.saved, writes: [] as unknown[] };
  await page.route(/\/api\/settings(\?|$)/, async route => {
    const req = route.request();
    if (req.method() === 'GET') { const res = await route.fetch(); const body = await res.json().catch(() => ({})); return route.fulfill({ response: res, json: { ...(body as Record<string, unknown>), arena_sound: state.saved } }); }
    const b = req.postDataJSON() as { arena_sound?: boolean }; state.writes.push(b); if (typeof b?.arena_sound === 'boolean') state.saved = b.arena_sound;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return { ctx, page, state };
}
const snd = (page: Page) => page.evaluate(() => (window as unknown as { __snd: { ctx: number; osc: number; resume: number; created: string[] } }).__snd);
const arena = async (page: Page) => { await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(10_000); };
const prompt = (page: Page) => page.getByTestId('arena-sound-prompt');

test.describe('Arena sound alerts (#2304)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });

  test('A1. no answer yet: the prompt shows and NOTHING plays or even exists on the audio side', async ({ browser }) => {
    const { ctx, page } = await open(browser);
    try {
      await arena(page); await expect(prompt(page), 'the first-visit prompt is not shown').toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('arena-sound-allow')).toBeVisible(); await expect(page.getByTestId('arena-sound-notnow')).toBeVisible(); await expect(page.getByTestId('arena-sound-dismiss')).toBeVisible();
      await page.mouse.click(5, 300); await page.waitForTimeout(1500);                  // a click on the page that is not an answer
      const s = await snd(page); console.log(`[A1] audio spy ${JSON.stringify(s)}`);
      expect(s.ctx, 'an AudioContext was created before any answer').toBe(0); expect(s.osc, 'an oscillator was created before any answer').toBe(0);
    } finally { await ctx.close(); }
  });

  test('A2. Allow: arena_sound true is saved, audio is unlocked inside the click, the prompt goes, one confirmation tone', async ({ browser }) => {
    const { ctx, page, state } = await open(browser);
    try {
      await arena(page); await expect(prompt(page)).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('arena-sound-allow').click(); await page.waitForTimeout(2500);
      const s = await snd(page); console.log(`[A2] audio spy ${JSON.stringify(s)} writes ${JSON.stringify(state.writes)}`);
      expect(state.writes.some(w => (w as { arena_sound?: boolean }).arena_sound === true), `no arena_sound:true write: ${JSON.stringify(state.writes)}`).toBe(true);
      expect(s.ctx, 'no AudioContext after Allow').toBe(1);
      const age = Number(/gesture-age-ms=(\d+)/.exec(s.created[0] ?? '')?.[1] ?? 99999); expect(age, `the context was created ${age} ms after the gesture (must be inside the click)`).toBeLessThan(500);
      expect(s.osc, 'the soft confirmation tone (one oscillator) did not play').toBeGreaterThanOrEqual(1);
      await expect(prompt(page)).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  test('A3. Not now: false is saved, the prompt goes and stays gone after a reload, and no audio ever exists', async ({ browser }) => {
    const { ctx, page, state } = await open(browser);
    try {
      await arena(page); await expect(prompt(page)).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('arena-sound-notnow').click(); await page.waitForTimeout(1500);
      expect(state.writes.some(w => (w as { arena_sound?: boolean }).arena_sound === false), JSON.stringify(state.writes)).toBe(true);
      await expect(prompt(page)).toHaveCount(0);
      await page.reload(); await page.waitForTimeout(10_000); await expect(prompt(page), 'the prompt came back after a reload').toHaveCount(0);
      const s = await snd(page); console.log(`[A3] audio spy after reload ${JSON.stringify(s)}`); expect(s.ctx).toBe(0); expect(s.osc).toBe(0);
    } finally { await ctx.close(); }
  });

  test('A4. the close button is a Not now: false saved, prompt gone', async ({ browser }) => {
    const { ctx, page, state } = await open(browser);
    try {
      await arena(page); await expect(prompt(page)).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('arena-sound-dismiss').click(); await page.waitForTimeout(1500);
      expect(state.writes.some(w => (w as { arena_sound?: boolean }).arena_sound === false), JSON.stringify(state.writes)).toBe(true); await expect(prompt(page)).toHaveCount(0);
      expect((await snd(page)).ctx).toBe(0);
    } finally { await ctx.close(); }
  });

  test('A5. the Settings switch follows the saved answer and writes the opposite when toggled; the Arena prompt does not return', async ({ browser }) => {
    const { ctx, page, state } = await open(browser, { saved: false });
    try {
      await gotoSignedIn(page, '/settings'); await page.waitForTimeout(8_000);
      const sw = page.getByTestId('arena-sound-toggle'); await expect(sw, 'no Arena sound switch on /settings').toBeVisible({ timeout: 30_000 });
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await sw.scrollIntoViewIfNeeded(); await sw.locator('xpath=../..').screenshot({ path: 'qa/.shots/sound-settings-row-off.png' });
      await sw.click(); await page.waitForTimeout(1500);
      expect(state.writes.some(w => (w as { arena_sound?: boolean }).arena_sound === true), JSON.stringify(state.writes)).toBe(true);
      await expect(sw).toHaveAttribute('aria-checked', 'true'); await sw.locator('xpath=../..').screenshot({ path: 'qa/.shots/sound-settings-row-on.png' });
      await sw.click(); await page.waitForTimeout(1500); expect(state.writes.some(w => (w as { arena_sound?: boolean }).arena_sound === false)).toBe(true);
      await arena(page); await expect(prompt(page)).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  for (const [width, theme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']] as Array<[number, 'dark' | 'light']>) {
    test(`A6. shot: the prompt at ${width} ${theme}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, { width, theme });
      try {
        await arena(page); await expect(prompt(page)).toBeVisible({ timeout: 30_000 });
        const r = await page.evaluate(() => { const p = document.querySelector('[data-testid="arena-sound-prompt"]') as HTMLElement; const b = p.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height), vw: window.innerWidth, docSw: document.documentElement.scrollWidth }; });
        console.log(`[A6] ${width} ${theme} ${JSON.stringify(r)}`);
        await prompt(page).screenshot({ path: `qa/.shots/sound-prompt-${width}-${theme}.png` }); await page.screenshot({ path: `qa/.shots/sound-prompt-page-${width}-${theme}.png` });
        expect(r.r, 'the prompt runs past the viewport').toBeLessThanOrEqual(r.vw); expect(r.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(r.vw);
      } finally { await ctx.close(); }
    });
  }

  test('A7. (source guard) the page enables sounds only when settings are ready AND arena_sound is exactly true; audio is created only from unlockAudio and playPing refuses while locked', () => {
    const page = readFileSync('app/(main)/arena/page.tsx', 'utf8'); const snd = readFileSync('lib/arenaSound.ts', 'utf8'); const hook = readFileSync('lib/useArenaSounds.ts', 'utf8');
    expect(page).toMatch(/enabled: settingsLoadStatus === 'ready' && settings\.arena_sound === true/);
    expect(snd).toMatch(/if \(!ctx \|\| ctx\.state !== 'running'\) return false;/);
    expect((snd.match(/new AC\(\)/g) || []).length, 'AudioContext constructed in more than one place').toBe(1);
    expect(hook).toMatch(/if \(kind && enabled\) playPing\(kind\)/);
  });
});
