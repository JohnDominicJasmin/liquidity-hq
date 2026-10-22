/* The two confirm buttons of the cancel panel, measured from the DEPLOYED stylesheet, credential-free.
 * WHY A RECONSTRUCTION: the real panel is behind a sign-in AND only renders these buttons for a live, cancellable Pro
 * subscription; the owner's test subscription is already cancelled, so nobody can open them today. This loads the served CSS
 * of a host into a blank page, builds the same markup the settings page renders, and measures both buttons at two widths.
 * It measures the CSS classes as deployed, in this markup - NOT the real page's surrounding layout.
 *   node button-size-probe.mjs <host> "<yes-class>" "<keep-class>" */
import { chromium } from 'playwright';

const HOST = process.argv[2] ?? 'liquidity-hq-qa.onrender.com';
const YES = process.argv[3] ?? 'st-signout-btn';
const KEEP = process.argv[4] ?? 'st-save-btn';
const html = await (await fetch(`https://${HOST}/login`, { signal: AbortSignal.timeout(60_000) })).text();
const css = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => new URL(m[1], `https://${HOST}`).href);
console.log(`${HOST}: ${css.length} stylesheet(s) linked from /login`);

const browser = await chromium.launch();
for (const [label, vp, mobile] of [['desktop 1280', { width: 1280, height: 900 }, false], ['phone 390', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const links = css.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  await page.setContent(`<!doctype html><html data-theme="light"><head>${links}</head><body>
    <div class="st-field" style="max-width:640px;margin:16px">
      <div class="st-field-label">Pro plan</div>
      <div style="margin-top: 8px">
        <div class="st-desc">Cancel Pro? You'll keep access until the end of your current paid period.</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="yes" class="${YES}">Yes, cancel</button>
          <button id="keep" class="${KEEP}">Keep Pro</button>
        </div>
      </div></div></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const one = (id) => {
      const el = document.getElementById(id); const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, top: Math.round(r.top * 100) / 100, minHeight: c.minHeight, padding: `${c.paddingTop} ${c.paddingRight}`, marginTop: c.marginTop, fontSize: c.fontSize };
    };
    return { yes: one('yes'), keep: one('keep') };
  });
  const { yes, keep } = m;
  console.log(`${label}: yes ${yes.w}x${yes.h} (top ${yes.top}, margin-top ${yes.marginTop}, min-height ${yes.minHeight}) | keep ${keep.w}x${keep.h} (top ${keep.top}, margin-top ${keep.marginTop}, min-height ${keep.minHeight})`);
  console.log(`   equal height: ${yes.h === keep.h} | equal width: ${yes.w === keep.w} | both >= 44 px: ${yes.h >= 44 && keep.h >= 44} | same top edge: ${yes.top === keep.top}`);
  await ctx.close();
}
await browser.close();
