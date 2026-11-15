/* A PROBE: WHAT MAKES /arena SCROLL SIDEWAYS AT 320 PX (usage-meter-height read the page 348 wide in a 320 viewport for every account and language, Pro without the pill included, so it is not the meter).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/overflow-320-probe.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 * Signed in as fixture A at 320 and 360 (English) and signed out at 320: logs the page's scrollWidth and every element whose right edge is past the viewport (tag.classes[testid] "text", left, right, width), widest overflow first. Reads only. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { gotoGuarded } from './_shared';

for (const [who, width] of [['a', 320], ['a', 360], ['out', 320]] as const) test(`overflow at ${width} (${who})`, async ({ browser }) => {
  test.skip(who === 'a' && !AUTH_READY, AUTH_SKIP_REASON); test.setTimeout(120_000);
  const ctx = who === 'a' ? await signedInContext(browser, 'a') : await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width, height: 844 });
  try {
    if (who === 'a') await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); else await gotoGuarded(page, '/arena');
    await page.waitForTimeout(10_000);
    const r = await page.evaluate(() => {
      const vw = innerWidth; const sw = document.documentElement.scrollWidth;
      const off = Array.from(document.querySelectorAll('body *')).map((e) => { const b = (e as HTMLElement).getBoundingClientRect(); return { e: e as HTMLElement, right: Math.round(b.right), left: Math.round(b.left), w: Math.round(b.width) }; }).filter((x) => x.right > vw + 1 && x.w > 0).sort((a, b) => b.right - a.right).slice(0, 14);
      return { vw, sw, off: off.map((x) => `${x.e.tagName.toLowerCase()}.${String(x.e.className).split(/\s+/).slice(0, 2).join('.')}${x.e.getAttribute('data-testid') ? '[' + x.e.getAttribute('data-testid') + ']' : ''} "${(x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)}" left ${x.left} right ${x.right} w ${x.w} pos ${getComputedStyle(x.e).position}`) };
    });
    console.log(`[OVF] ${who} ${width}: page ${r.sw}/${r.vw}`);
    /* Dev's probe: only elements that really widen the page (right edge past the viewport AND no clipping ancestor), fewest children first */
    const real = await page.evaluate("(()=>{const vw=document.documentElement.clientWidth;const clips=(el)=>{for(let p=el.parentElement;p&&p!==document.documentElement;p=p.parentElement){const o=getComputedStyle(p);if(/(hidden|clip|auto|scroll)/.test(o.overflowX))return true;}return false;};const out=[];for(const el of document.body.querySelectorAll('*')){const r=el.getBoundingClientRect();const cs=getComputedStyle(el);if(r.width===0||cs.position==='fixed'||cs.visibility==='hidden')continue;if(r.right>vw+0.5&&!clips(el))out.push({n:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/s+/).slice(0,3).join('.'):'')+(el.dataset.testid?'[testid='+el.dataset.testid+']':''),right:Math.round(r.right),w:Math.round(r.width),pos:cs.position,disp:cs.display,ws:cs.whiteSpace,text:(el.textContent||'').trim().slice(0,30),kids:el.children.length});}out.sort((a,b)=>a.kids-b.kids);return JSON.stringify({vw,sw:document.documentElement.scrollWidth,nodes:out.slice(0,15)});})()" as unknown as string).catch(() => 'eval failed');
    console.log(`[OVF] ${who} ${width} REAL ${typeof real === 'string' ? real : JSON.stringify(real)}`); for (const l of r.off) console.log(`[OVF] ${who} ${width}   ${l}`);
  } finally { await ctx.close(); }
});
