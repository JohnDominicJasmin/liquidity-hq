/* The #1495 Russian TRIAL cut-off: which widths overflow, and by how much. One context, resized between widths
 * (same page, as t-1495.mjs does), on PRODUCTION (read-only) and on qa. TRIAL stub = free role + trial_ends_at +7 days.
 * Reports .tnav scrollWidth vs clientWidth, the plan-badge text and width, and whether the day count is shown.
 * usage: node nav-ru-trial-sweep.mjs <prod|qa>                                                                    */
import { chromium, open, settle, sleep, QA, PROD } from './lib.mjs';
const B = process.argv[2] === 'qa' ? QA : PROD;
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { b: B, w: 1000, h: 900, lang: 'ru', signedIn: true, plan: 'trial' }); const page = await ctx.newPage();
  await page.goto(B.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(7000);
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  console.log(JSON.stringify({ build: v.commit }));
  for (const w of [930, 940, 944, 945, 946, 948, 950, 952, 953, 954, 956, 960, 980]) {
    await page.setViewportSize({ width: w, height: 900 }); await sleep(700);
    const m = await page.evaluate(() => {
      const n = document.querySelector('.tnav'); if (!n) return null;
      const badge = document.querySelector('.tnav-right .plan-badge'); const days = document.querySelector('.tnav-right .plan-badge-trial-days');
      const bb = badge && badge.getBoundingClientRect(); const av = n.querySelector('.tnav-avatar, .tnav-user, .tnav-right > button:last-child');
      const ab = av && av.getBoundingClientRect();
      return { scrollW: n.scrollWidth, clientW: n.clientWidth, over: n.scrollWidth - n.clientWidth, badge: badge && badge.textContent.trim(), badgeW: bb && Math.round(bb.width), daysShown: !!days && getComputedStyle(days).display !== 'none', session: !!document.querySelector('.tnav-session') && getComputedStyle(document.querySelector('.tnav-session')).display !== 'none', lastRight: ab && Math.round(ab.right), vw: innerWidth };
    });
    console.log(JSON.stringify({ w, ...m }));
  }
  await ctx.close();
} finally { await browser.close(); }
