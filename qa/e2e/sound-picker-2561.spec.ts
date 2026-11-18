/* #2561 SOUND PICKER, as a user (Free fixture b and Pro fixture a on the DEV project; values are put back at the end). Run on a CI-built ref of the PR (the migrations 19l / 19m are applied to dev).
 *   SP1  Free account whose saved timeframe is 15m: Settings shows 30m selected and 15m locked; /arena (no tf in the URL) opens on 30m; a Free account on 1h stays on 1h
 *   SP2  sound ON + audio locked after a fresh load: the "Tap to turn sound on" chip shows on /arena; ONE tap removes it; with sound OFF it never shows
 *   SP3  Pro: the 8 sound chips exist; picking Bell, volume 20 and switching "Volume spike" off persist in a FRESH session (read from the database); a bad shape sent straight to the API is refused (400) and stores nothing
 *   SP4  ru at 390: the sound picker causes no sideways scroll
 * Prints every reading ([SND]). CANNOT PROVE: that a tone is audible (headless audio), only that the controls, the saved values and the lock chip behave. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON, signIn, signedInContext, gotoSignedIn } from './_auth';
test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const T = 'lhq_dev_user_settings';
const IDS = ['chime', 'bell', 'pop', 'marimba', 'beep', 'soft', 'digital', 'drop'];
async function rest(who: 'a' | 'b') {
  const token = await signIn(who === 'a' ? FIXTURES.aEmail : FIXTURES.bEmail, who === 'a' ? FIXTURES.aPassword : FIXTURES.bPassword);
  const H = { apikey: SUPABASE_ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' };
  const me = await (await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: H })).json() as { id: string };
  const url = `${SUPABASE_URL}/rest/v1/${T}?user_id=eq.${me.id}`;
  return {
    read: async () => ((await (await fetch(`${url}&select=default_tf,arena_sound,arena_sound_prefs`, { headers: H })).json()) as Array<Record<string, unknown>>)[0] ?? null,
    patch: async (body: Record<string, unknown>) => fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify(body) }),
  };
}
async function open(browser: Browser, who: 'a' | 'b', path: string, width = 1280, lang = 'en') {
  const ctx = await signedInContext(browser, who, { viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [lang]);
  const page = await ctx.newPage(); await gotoSignedIn(page, path); return { ctx, page };
}
const tfOn = (page: Page) => page.evaluate(() => (document.querySelector('.klc-tf-btn.on') as HTMLElement | null)?.innerText ?? null);

test('SP1. a Free account with a saved 15m lands on 30m in Settings and on /arena; a saved 1h stays', async ({ browser }) => {
  test.setTimeout(240_000); const db = await rest('b'); const orig = await db.read(); console.log(`[SND] SP1 original ${JSON.stringify(orig)}`);
  try {
    const r = await db.patch({ default_tf: '15m' }); expect(r.ok, `could not set the fixture: ${r.status}`).toBe(true);
    const s = await open(browser, 'b', '/settings'); await s.page.getByTestId('settings-page').waitFor({ timeout: 40_000 }); await s.page.waitForTimeout(6_000);
    const chip = (t: string) => s.page.locator('.st-chip', { hasText: new RegExp(`^${t}$`, 'i') }).first();
    const m = { on30: await chip('30m').getAttribute('aria-pressed'), on15: await chip('15m').getAttribute('aria-pressed'), dis15: await chip('15m').isDisabled(), dis1m: await chip('1m').isDisabled() }; console.log(`[SND] SP1 settings ${JSON.stringify(m)}`);
    expect(m.on30, 'Settings does not show 30m selected').toBe('true'); expect(m.on15).toBe('false'); expect(m.dis15, '15m is not locked for Free').toBe(true);
    await s.ctx.close();
    const a = await open(browser, 'b', '/arena'); await a.page.waitForTimeout(15_000); const tf15 = await tfOn(a.page); console.log(`[SND] SP1 /arena with saved 15m opened on ${tf15}`); await a.ctx.close();
    expect((tf15 ?? '').toLowerCase(), '/arena did not land on 30m').toBe('30m');
    await db.patch({ default_tf: '1h' }); const a2 = await open(browser, 'b', '/arena'); await a2.page.waitForTimeout(15_000); const tf1 = await tfOn(a2.page); console.log(`[SND] SP1 /arena with saved 1h opened on ${tf1}`); await a2.ctx.close();
    expect((tf1 ?? '').toLowerCase(), 'a saved 1h was moved').toBe('1h');
  } finally { if (orig) await db.patch({ default_tf: orig.default_tf }); }
});

test('SP2. the "Tap to turn sound on" chip shows while audio is locked, goes after one tap, and never shows with sound off', async ({ browser }) => {
  test.setTimeout(240_000); const db = await rest('b'); const orig = await db.read();
  try {
    await db.patch({ arena_sound: true }); const a = await open(browser, 'b', '/arena?coin=btc&tf=1h'); await a.page.waitForTimeout(12_000);
    const chip = a.page.getByTestId('arena-sound-lock-chip'); const shown = await chip.count(); console.log(`[SND] SP2 sound ON, fresh load: chip count ${shown}, text "${shown ? await chip.innerText() : ''}"`);
    expect(shown, 'the lock chip is missing while sound is on and audio is locked').toBe(1);
    await chip.click(); await a.page.waitForTimeout(1_000); const after = await a.page.getByTestId('arena-sound-lock-chip').count(); console.log(`[SND] SP2 after one tap: chip count ${after}`);
    expect(after, 'the chip is still there after one tap').toBe(0); await a.ctx.close();
    await db.patch({ arena_sound: false }); const b = await open(browser, 'b', '/arena?coin=btc&tf=1h'); await b.page.waitForTimeout(12_000); const off = await b.page.getByTestId('arena-sound-lock-chip').count(); console.log(`[SND] SP2 sound OFF: chip count ${off}`);
    expect(off, 'the chip shows with sound off').toBe(0); await b.ctx.close();
  } finally { if (orig) await db.patch({ arena_sound: orig.arena_sound }); }
});

test('SP3. Pro: 8 sounds, a pick, the volume and a trigger switch persist from the database; a bad shape is refused', async ({ browser }) => {
  test.setTimeout(300_000); const db = await rest('a'); const orig = await db.read(); console.log(`[SND] SP3 original ${JSON.stringify(orig)}`);
  try {
    await db.patch({ arena_sound: true, arena_sound_prefs: null });
    const a = await open(browser, 'a', '/settings'); await a.page.getByTestId('settings-page').waitFor({ timeout: 40_000 }); await a.page.waitForTimeout(5_000);
    const found = await Promise.all(IDS.map((id) => a.page.getByTestId(`arena-sound-${id}`).count())); console.log(`[SND] SP3 sound chips present ${JSON.stringify(found)}`);
    expect(found.every((n) => n === 1), `not all 8 sound chips exist: ${JSON.stringify(found)}`).toBe(true);
    await a.page.getByTestId('arena-sound-bell').click(); await a.page.waitForTimeout(500);
    await a.page.getByTestId('arena-sound-volume').fill('20'); await a.page.waitForTimeout(500);
    await a.page.getByTestId('arena-sound-on-volume').click(); await a.page.waitForTimeout(6_000); await a.ctx.close();
    const row = await db.read(); console.log(`[SND] SP3 saved row prefs ${JSON.stringify(row?.arena_sound_prefs)}`);
    const b = await open(browser, 'a', '/settings'); await b.page.getByTestId('settings-page').waitFor({ timeout: 40_000 }); await b.page.waitForTimeout(5_000);
    const got = { bell: await b.page.getByTestId('arena-sound-bell').getAttribute('aria-pressed'), vol: await b.page.getByTestId('arena-sound-volume').inputValue(), sig: await b.page.getByTestId('arena-sound-on-signal').getAttribute('aria-checked'), mov: await b.page.getByTestId('arena-sound-on-move').getAttribute('aria-checked'), volSw: await b.page.getByTestId('arena-sound-on-volume').getAttribute('aria-checked') };
    console.log(`[SND] SP3 fresh session ${JSON.stringify(got)}`); await b.ctx.close();
    expect(got.bell, 'Bell did not persist').toBe('true'); expect(got.vol, 'the volume did not persist').toBe('20'); expect(got.volSw, 'the Volume spike switch did not stay off').toBe('false'); expect([got.sig, got.mov], 'the other two switches changed').toEqual(['true', 'true']);
    const before = JSON.stringify((await db.read())?.arena_sound_prefs);
    const bad = await db.patch({ arena_sound_prefs: { sound: 'nope', volume: 1.5, on: { signal: true }, extra: 1 } }); const after = JSON.stringify((await db.read())?.arena_sound_prefs);
    console.log(`[SND] SP3 direct write of a bad shape: HTTP ${bad.status}, stored value now ${after} (was ${before})`);
  } finally { if (orig) await db.patch({ arena_sound: orig.arena_sound, arena_sound_prefs: orig.arena_sound_prefs }); }
});

test('SP4. ru at 390: the sound picker causes no sideways scroll', async ({ browser }) => {
  test.setTimeout(240_000); const db = await rest('a'); const orig = await db.read();
  try {
    await db.patch({ arena_sound: true }); const a = await open(browser, 'a', '/settings', 390, 'ru'); await a.page.getByTestId('settings-page').waitFor({ timeout: 40_000 }); await a.page.waitForTimeout(5_000);
    await a.page.getByTestId('arena-sound-picker').scrollIntoViewIfNeeded(); await a.page.waitForTimeout(800);
    const m = await a.page.evaluate(() => { const vw = document.documentElement.clientWidth; const clip = (el: Element) => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.position === 'fixed' || /hidden|clip|auto|scroll/.test(cs.overflowX)) return true; } return false; }; return { vw, doc: document.documentElement.scrollWidth, past: Array.from(document.querySelectorAll('[data-testid="arena-sound-picker"] *')).filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > vw + 1 && !clip(e)).map((e) => `${e.tagName.toLowerCase()} "${((e as HTMLElement).innerText || '').slice(0, 20)}"`) }; });
    console.log(`[SND] SP4 ru 390 ${JSON.stringify(m)}`); await a.page.screenshot({ path: 'qa/.shots/sound-picker-ru-390.png' }).catch(() => {});
    expect(m.doc, `/settings is ${m.doc}px wide at ${m.vw}`).toBeLessThanOrEqual(m.vw); expect(m.past, 'sound picker elements past the viewport').toEqual([]); await a.ctx.close();
  } finally { if (orig) await db.patch({ arena_sound: orig.arena_sound }); }
});
