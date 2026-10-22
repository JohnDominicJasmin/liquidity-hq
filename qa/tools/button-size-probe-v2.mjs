/* The two confirm buttons of the cancel panel, measured from the DEPLOYED stylesheet, credential-free (v2: inside the real
 * card, with contrast computed from the browser's own resolved colours).
 * WHY A RECONSTRUCTION: the real panel is behind a sign-in and only renders these buttons for a live, cancellable Pro
 * subscription. This loads the served CSS of a host into a blank page, builds the markup the settings page renders INSIDE
 * `.st-page > .st-section` (the card the buttons really sit on), and measures both buttons at two widths in the default
 * light theme, plus the resolved text colour, the composited backdrop and the WCAG contrast. It measures the CSS classes as
 * deployed in this markup, not the real page's surrounding layout.
 *   node button-size-probe-v2.mjs <host> "<yes-class>" "<keep-class>" */
import { chromium } from 'playwright';

const HOST = process.argv[2] ?? 'liquidity-hq-qa.onrender.com';
const YES = process.argv[3] ?? 'st-confirm-btn st-signout-btn';
const KEEP = process.argv[4] ?? 'st-confirm-btn st-save-btn';
const html = await (await fetch(`https://${HOST}/login`, { signal: AbortSignal.timeout(60_000) })).text();
const css = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => new URL(m[1], `https://${HOST}`).href);
console.log(`${HOST}: ${css.length} stylesheet(s) linked from /login | yes="${YES}" keep="${KEEP}"`);

const browser = await chromium.launch();
for (const [label, vp, mobile] of [['desktop 1280', { width: 1280, height: 900 }, false], ['phone 390', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const links = css.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  await page.setContent(`<!doctype html><html data-theme="light"><head>${links}</head><body>
    <div class="st-page"><div class="st-section"><h2 class="st-section-title">Subscription</h2>
    <div class="st-field">
      <div class="st-field-label">Pro plan</div>
      <div style="margin-top: 8px">
        <div class="st-desc">Cancel Pro? You'll keep access until the end of your current paid period.</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="yes" class="${YES}">Yes, cancel</button>
          <button id="keep" class="${KEEP}">Keep Pro</button>
        </div>
      </div></div></div></div></body></html>`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const parse = (s) => { const n = s.match(/[\d.]+/g).map(Number); return [n[0], n[1], n[2], n[3] ?? 1]; };
    const over = (t, u) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const backdrop = (el) => {           // composite every ancestor's background from the root down to this element
      const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(getComputedStyle(e).backgroundColor);
      return chain.reduce((under, c) => over(parse(c), under), [255, 255, 255, 1]);
    };
    const one = (id) => {
      const el = document.getElementById(id); const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      const bg = backdrop(el); const fg = parse(c.color);
      return {
        w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, top: Math.round(r.top * 100) / 100,
        minHeight: c.minHeight, marginTop: c.marginTop, color: c.color, buttonBg: c.backgroundColor,
        cardBg: getComputedStyle(el.closest('.st-section')).backgroundColor, contrast: Math.round(ratio(fg, bg) * 100) / 100,
      };
    };
    return { yes: one('yes'), keep: one('keep') };
  });
  const { yes, keep } = m;
  console.log(`${label}: yes ${yes.w}x${yes.h} (top ${yes.top}, margin-top ${yes.marginTop}, min-height ${yes.minHeight}) | keep ${keep.w}x${keep.h} (top ${keep.top}, margin-top ${keep.marginTop}, min-height ${keep.minHeight})`);
  console.log(`   equal height: ${yes.h === keep.h} | equal width: ${yes.w === keep.w} | both >= 44 px: ${yes.h >= 44 && keep.h >= 44} | same top edge: ${yes.top === keep.top}`);
  console.log(`   card background: ${yes.cardBg} | yes text ${yes.color} on ${yes.buttonBg}: ${yes.contrast}:1 | keep text ${keep.color} on ${keep.buttonBg}: ${keep.contrast}:1`);
  await ctx.close();
}
await browser.close();
