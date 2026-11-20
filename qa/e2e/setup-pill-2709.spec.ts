/* #2709 (PM visual defect, 2026-11-20): the "Setup 3/4" pill (and its expanded card) sat on the Arena strategy panel's CHART layer chips at 1280, hiding two of them. The fix moves the pill left of the 352 px side rail from 1100 px up.
 * THE PILL IS NOT SHOWN TO EVERY ACCOUNT (it needs a signed-in user whose setup is not complete), so this spec does not depend on the fixture's setup state: it injects the component's OWN markup (the same classes and structure as components/SetupChecklist.tsx, collapsed pill and expanded card, 3 of 4 done) into the page, so the REAL stylesheet positions it, then measures.
 * Per width (390, 768, 1100, 1280, 1440) x (pill, expanded card) x (page scrolled to the top, middle, bottom): the fixed box is intersected with every visible interactive control on the page (button, select, input, a, [role=button], outside the injected box itself); a control is COVERED when the box is the topmost element at the middle of the overlap. Printed: [PILL] width state scroll: box rect · rail left · covered controls (text). Shots qa/.shots/pill-<width>-<state>.png.
 * Asserts: from 1100 px up, no control is covered and the box sits left of the rail (right edge <= rail left). Below 1100 the result is PRINTED (the PR leaves it untouched), 390 included. Read-only: nothing is clicked, nothing is saved. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const WIDTHS = [1440, 1280, 1100, 768, 390];

const INJECT = (kind: 'mini' | 'card') => {
  document.getElementById('qa-pill')?.remove(); document.querySelectorAll('.ob-checklist').forEach((e) => { (e as HTMLElement).style.display = 'none'; });   /* the account's real pill, if it shows one, would sit under the injected one */
  const root = document.createElement('div'); root.id = 'qa-pill';
  root.innerHTML = kind === 'mini'
    ? '<div class="ob-checklist ob-checklist-mini"><button type="button" style="display:flex;align-items:center;gap:10px;background:none;border:none;padding:0;margin:0;font:inherit;color:inherit"><span class="ob-cl-mini-text">Setup 3/4</span><span class="ob-cl-mini-track"><span class="ob-cl-mini-fill" style="display:block;width:75%"></span></span></button><button class="ob-cl-mini-close" aria-label="Dismiss">×</button></div>'
    : '<div class="ob-checklist"><div class="ob-cl-head"><span class="ob-cl-title">Setup</span><span class="ob-cl-count">3/4</span><button class="ob-cl-min" aria-label="Minimize">−</button><button class="ob-cl-min" aria-label="Dismiss">×</button></div><div class="ob-cl-list"><div class="ob-cl-row done"><span class="ob-cl-chk">✓</span><span class="ob-cl-lbl">Sign up</span></div><div class="ob-cl-row done"><span class="ob-cl-chk">✓</span><span class="ob-cl-lbl">Take the tour</span></div><div class="ob-cl-row done"><span class="ob-cl-chk">✓</span><span class="ob-cl-lbl">Run a read</span></div><div class="ob-cl-row"><span class="ob-cl-chk">○</span><span class="ob-cl-lbl">Set an alert</span><span class="ob-cl-arrow">→</span></div></div></div>';
  document.body.appendChild(root);
};
const MEASURE = () => {
  const box = document.querySelector('#qa-pill .ob-checklist') as HTMLElement | null; if (!box) return null;
  const b = box.getBoundingClientRect(); /* THE PANEL COLUMN: the nearest ancestor of the strategy select that is a column (280-430 px wide, taller than 300). `.at-rail` is NOT used: nothing renders it (the reverted terminal-Arena left only its CSS), so a rule keyed on it never matches. */
  const sel0 = document.querySelector('[data-testid="strategy-set-select"]'); let rail: HTMLElement | null = null; let railDesc = ''; for (let a = sel0 as HTMLElement | null; a && a !== document.body; a = a.parentElement) { const q = a.getBoundingClientRect(); if (q.width >= 280 && q.width <= 430 && q.height > 300) { rail = a; railDesc = `${a.tagName.toLowerCase()}.${String(a.className).split(' ').slice(0, 2).join('.')} < ${a.parentElement?.tagName.toLowerCase()}.${String(a.parentElement?.className).split(' ').slice(0, 2).join('.')}`; break; } }
  const hasAtRail = !!document.querySelector('.at-rail'); const r = rail?.getBoundingClientRect();
  const vis = (el: Element) => { const q = el.getBoundingClientRect(); const cs = getComputedStyle(el); return q.width > 0 && q.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && q.bottom > 0 && q.top < innerHeight && q.right > 0 && q.left < innerWidth; };
  const covered: string[] = [];
  for (const el of Array.from(document.querySelectorAll('button, select, input, a[href], [role="button"]'))) {
    if (box.contains(el) || !vis(el)) continue; const q = el.getBoundingClientRect();
    const x0 = Math.max(q.left, b.left), x1 = Math.min(q.right, b.right), y0 = Math.max(q.top, b.top), y1 = Math.min(q.bottom, b.bottom); if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2); if (top && box.contains(top)) covered.push(((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 30) || el.tagName);
  }
  return { box: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }, railLeft: r ? Math.round(r.left) : null, railDesc, hasAtRail, covered, vw: innerWidth };
};
async function measure(page: Page, kind: 'mini' | 'card') { await page.evaluate(INJECT, kind); await page.waitForTimeout(400); return page.evaluate(MEASURE); }

for (const width of WIDTHS) {
  test(`PILL:${width}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width >= 1000 ? 900 : 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.removeItem('lhq_setup_dismissed'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.getByTestId('strategy-set-select').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(6_000);
      const bad: string[] = [];
      for (const kind of ['mini', 'card'] as const) for (const where of ['top', 'middle', 'bottom'] as const) {
        await page.evaluate((w) => { const h = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, w === 'top' ? 0 : w === 'middle' ? h / 2 : h); }, where); await page.waitForTimeout(500);
        const m = await measure(page, kind); if (!m) { console.log(`[PILL] ${width} ${kind} ${where}: injection failed`); continue; }
        console.log(`[PILL] ${width} ${kind} ${where}: box x ${m.box.l}-${m.box.r} y ${m.box.t}-${m.box.b} · panel column left ${m.railLeft} (${m.railDesc}) · .at-rail in the DOM: ${m.hasAtRail} · viewport ${m.vw} · covered ${m.covered.length} ${JSON.stringify(m.covered)}`);
        if (where === 'top') await page.screenshot({ path: `qa/.shots/pill-${width}-${kind}.png`, timeout: 30_000 }).catch(() => {});
        if (width >= 1100) { if (m.covered.length) bad.push(`${kind} ${where}: covers ${m.covered.join(', ')}`); if (m.railLeft != null && m.box.r > m.railLeft) bad.push(`${kind} ${where}: right edge ${m.box.r} is past the rail's left ${m.railLeft}`); }
      }
      expect(bad, `from 1100 px up the Setup pill / card must sit left of the rail and cover no control (${width})`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
