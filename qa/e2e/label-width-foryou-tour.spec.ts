/* OWNER-RULES §7, before PM writes any production rows (#2203): do the two new strings fit at 390 and 768?
 *
 *   NEWS_FORYOU_EMPTY_TITLE   "No catalysts right now" in en, ko, zh, ru, ar - the For You empty-state card
 *   SPOTLIGHT_TOUR_STEP5_BODY the new English tour text                        - the tour modal, step 5
 *
 * A label row reaches the live site with no build, tests or staging, so this injects the values into the REAL
 * /api/labels payload (the mechanism label-length-390 uses) and measures the element that holds the text.
 *
 * REACHING THE STATES (Dev's seams, read from source, 2026-11-13):
 *   For You empty  stub the news table read to [] with 200 -> `alertsLoaded` true, no alerts -> `foryouEmpty`. A FAILED
 *                  read is a different state (alertsLoaded stays false), so the stub must answer 200.
 *   Tour step 5    stub the onboarding table read to `profile_complete: false` -> the wizard renders; walk it; finishing
 *                  starts the tour on /dashboard; one Next reaches step 5 (the tour has two steps, 1 and 5).
 *                  The WRITES the wizard makes (user_settings, user_onboarding) are stubbed too, so no fixture row changes.
 *
 * EVERY CELL HAS A CONTROL: the injected text must be on the page (the override took) before its geometry is read,
 * and the For You cell checks the page really is in the empty state. "No clip, no overflow" is asserted three ways:
 * the element does not overflow itself, no scroll-clipping ancestor cuts it, and the page does not scroll sideways. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots';
const WIDTHS = [390, 768] as const;
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'] as const;

/** The values from #2203's body. */
const FORYOU: Record<string, string> = {
  en: 'No catalysts right now',
  ko: '지금은 촉매 뉴스가 없습니다',
  zh: '目前没有催化事件',
  ru: 'Сейчас нет катализаторов',
  ar: 'لا توجد محفزات حالياً',
};
/** SPOTLIGHT_TOUR_STEP5_BODY, all five locales, from #2215's migration (the machine-drafted ko/zh/ru/ar the owner approved shipping). */
const TOUR5: Record<string, string> = {
  en: 'LiquidityHQ checks the major coins every few minutes, with live prices. Open Arena to see the scores, pick a coin, and let LiquidityAI analyze the setup for you.',
  ko: 'LiquidityHQ는 주요 코인을 몇 분마다 확인하며 실시간 가격을 제공합니다. Arena를 열어 점수를 확인하고 코인을 선택하면 LiquidityAI가 셋업을 분석해드립니다.',
  zh: 'LiquidityHQ 每隔几分钟检查一次主流币种，并提供实时价格。打开 Arena 查看评分，选择一个币种，让 LiquidityAI 为你分析行情设置。',
  ru: 'LiquidityHQ проверяет основные монеты каждые несколько минут и показывает цены в реальном времени. Откройте Arena, чтобы увидеть оценки, выберите монету и позвольте LiquidityAI проанализировать сетап за вас.',
  ar: 'تقوم LiquidityHQ بفحص العملات الرئيسية كل بضع دقائق مع عرض الأسعار مباشرة. افتح Arena لمشاهدة النتائج، اختر عملة، ودع LiquidityAI يحلل الإعداد نيابة عنك.',
};

async function overrideLabels(page: Page, forLocale: (loc: string) => Record<string, string>) {
  await page.route('**/api/labels*', async (route) => {
    let res;
    try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown;
    try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const payload = body as Record<string, unknown>;
    const labels = (payload.labels ?? payload) as Record<string, unknown>;
    const loc = new URL(route.request().url()).searchParams.get('locale') ?? 'en';
    for (const [k, v] of Object.entries(forLocale(loc))) labels[k] = v;
    await route.fulfill({ response: res, json: payload });
  });
}

/** Geometry of the innermost element holding `text`. */
async function measure(page: Page, text: string, width: number) {
  return page.evaluate(([t, vw]) => {
    const all = Array.from(document.querySelectorAll('*'));
    const holders = all.filter(el => el.textContent && el.textContent.includes(t as string)
      && !Array.from(el.children).some(c => c.textContent?.includes(t as string)));
    if (!holders.length) return null;
    const exact = holders.filter(el => el.textContent?.trim() === t);
    const el = (exact[0] ?? holders[0]) as HTMLElement;
    const r = el.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) {
        clippedBy.push(`${p.tagName.toLowerCase()}.${(p.className || '').toString().split(' ')[0]} overflow=${cs.overflowX}/${cs.overflowY}`);
      }
    }
    return {
      exactHandle: exact.length > 0, w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right),
      overflowsSelf: el.scrollWidth > el.clientWidth + 1, clippedBy, pageScrollWidth: document.documentElement.scrollWidth, vw: vw as number,
      outOfViewport: r.left < -1 || r.right > (vw as number) + 1,
    };
  }, [text, width] as [string, number]);
}

function assertFits(m: Awaited<ReturnType<typeof measure>>, key: string, loc: string, width: number) {
  expect(m, `${key}/${loc} at ${width}px: the injected text is not on the page - the override did not take, or the state was not reached`).not.toBeNull();
  const x = m!;
  console.log(`[label-width] ${key} ${loc} ${width}px: ${x.w}x${x.h} left=${x.left} right=${x.right} exact=${x.exactHandle} overflowsSelf=${x.overflowsSelf} clippedBy=${JSON.stringify(x.clippedBy)} pageScrollWidth=${x.pageScrollWidth}`);
  expect(x.overflowsSelf, `${key}/${loc} at ${width}px overflows its own box`).toBe(false);
  expect(x.clippedBy, `${key}/${loc} at ${width}px is clipped by an ancestor`).toEqual([]);
  expect(x.outOfViewport, `${key}/${loc} at ${width}px sits outside the viewport (left ${x.left}, right ${x.right}, width ${x.vw})`).toBe(false);
  expect(x.pageScrollWidth, `${key}/${loc} at ${width}px: the page scrolls sideways`).toBeLessThanOrEqual(x.vw);
}

test.describe('§7 phone-width: the two new label keys (#2203)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  for (const width of WIDTHS) for (const loc of LOCALES) {
    test(`NEWS_FORYOU_EMPTY_TITLE ${loc} at ${width}px`, async ({ browser }) => {
      test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 844 } });
      const page = await ctx.newPage();
      try {
        await page.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
        await installPaidAiFence(page);
        await overrideLabels(page, () => ({ NEWS_FORYOU_EMPTY_TITLE: FORYOU[loc] }));
        let served = 0;
        await page.route(/\/rest\/v1\/lhq_(dev_)?news\?/, (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          served += 1;
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await gotoSignedIn(page, '/news');
        const tab = page.getByRole('button', { name: /for you|你的|для вас|맞춤|لك/i }).or(page.getByRole('tab', { name: /for you/i })).first();
        await expect(tab, 'no For You tab found').toBeVisible({ timeout: 30_000 });
        await tab.click();
        await page.waitForTimeout(8_000);
        expect(served, 'the news table read was never stubbed, so the empty state was not forced').toBeGreaterThan(0);
        mkdirSync(DIR, { recursive: true });
        await page.screenshot({ path: `${DIR}/label-width-foryou-${loc}-${width}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
        assertFits(await measure(page, FORYOU[loc], width), 'NEWS_FORYOU_EMPTY_TITLE', loc, width);
      } finally { await ctx.close(); }
    });
  }

  for (const width of WIDTHS) for (const loc of LOCALES) {
    test(`SPOTLIGHT_TOUR_STEP5_BODY ${loc} at ${width}px`, async ({ browser }) => {
      test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 844 } });
      const page = await ctx.newPage();
      try {
        await installPaidAiFence(page);
        await page.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
        await overrideLabels(page, () => ({ SPOTLIGHT_TOUR_STEP5_BODY: TOUR5[loc] }));
        /* The wizard shows when profile_complete is false. Reads are answered with that row; the wizard's WRITES are
           swallowed so no fixture row changes. */
        const row = { user_id: '00000000-0000-4000-8000-000000000000', profile_complete: false, tour_seen: false,
          checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false, updated_at: new Date().toISOString() };
        let reads = 0; let swallowed = 0;
        await page.route(/\/rest\/v1\/lhq_(dev_)?user_(onboarding|settings)/, (route) => {
          const m = route.request().method();
          if (m === 'GET') {
            if (!/user_onboarding/.test(route.request().url())) return route.fallback();
            reads += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) });
          }
          swallowed += 1;
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.obw-headline').first(), 'the wizard did not render, so the onboarding read stub did not take').toBeVisible({ timeout: 60_000 });
        /* EVERY ACTION IS TIME-BOUNDED AND NUMBERED: playwright's actionTimeout is 0 on a local build, so run 43290244973's tour cell sat
           out the whole 180s test timeout with nothing saying which step it was on. A step that cannot act now fails by name in 15s. */
        const T = { timeout: 15_000 };
        const log = (m: string) => console.log(`[label-width] tour ${loc} ${width}px: ${m}`);
        const next = () => page.locator('button.obw-btn-next');
        /* LOCALE-AGNOSTIC HANDLES: the placeholders, the country names and the labels are all translated, so the wizard is driven by
           its own classes (.obw-input, .obw-select, .obw-menu-opt), and the account ranges are matched by their figures. */
        log('wizard step 1: name'); await page.locator('.obw-root input.obw-input').first().fill('QA Width', T);
        log('country picker'); await page.locator('.obw-root button[aria-expanded]').first().click(T);
        await page.locator('.obw-menu-opt').first().click(T);
        log('account range'); await page.locator('.obw-root button').filter({ hasText: '$1k - $5k' }).first().click(T);
        log('next'); await next().click(T);
        for (let i = 0; i < 4; i += 1) {
          log(`wizard step ${i + 2}`);
          const opts = () => page.locator(i === 3 ? 'button.obw-chip' : 'button.obw-row');   /* step 5 (Source) renders chips, not rows: the same trap the onboarding spec records */
          await expect(opts().first(), `wizard step ${i + 2} showed no options`).toBeVisible({ timeout: 30_000 });
          await opts().first().click(T);
          await page.waitForTimeout(400);
          await next().click(T);
          await page.waitForTimeout(1_200);
        }
        log('wizard done, waiting for the tour');
        /* The tour mounts on /dashboard and has two steps; one Next reaches step 5. Wait for its Next control by role. */
        const dialog = page.getByRole('dialog').first();
        await expect(dialog, 'the tour did not open after the wizard finished').toBeVisible({ timeout: 30_000 });
        await dialog.getByRole('button', { name: /next|continue/i }).first().click(T);
        await page.waitForTimeout(1_500);
        console.log(`[label-width] tour: onboarding reads=${reads} writes swallowed=${swallowed}`);
        mkdirSync(DIR, { recursive: true });
        await page.screenshot({ path: `${DIR}/label-width-tour5-${width}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
        assertFits(await measure(page, TOUR5[loc], width), 'SPOTLIGHT_TOUR_STEP5_BODY', loc, width);
      } finally { await ctx.close(); }
    });
  }
});
