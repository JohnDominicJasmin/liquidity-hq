/* Payments-OFF configuration (staging and prod have proBuyable=false): what a visitor sees where Pro cannot be bought yet. For signed-out and Free viewers,
 * dark 1280 and light 390: /upgrade (everything about prices and paying: the Pro price line, any "Pay in ..." / crypto / BoomFi / USDT wording, the plan
 * buttons and what they are, the reveal control, what a plan click opens), and the landing pricing card's button (text, target). Keyword hits come with context.
 * Run on staging (QA_BASE=<url> QA_TAG=stg node payments-off.mjs qa) and on prod (node payments-off.mjs prod) as the control; compare.
 * usage: node payments-off.mjs <qa|prod> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = `${OUT}/payments-off/${B.tag}`; mkdirSync(dir, { recursive: true });
const WORDS = /(usdt|usdc|crypto|boomfi|on-chain|pay in|pay with|network fees|same email|checkout|subscribe|billing|coming soon|waitlist|not (yet )?available)/gi;
const hits = (t) => { const out = []; let m; const re = new RegExp(WORDS.source, 'gi'); while ((m = re.exec(t))) out.push(`${m[0]}: "${t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40).replace(/\s+/g, ' ')}"`); return out; };
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, 'proBuyable', v.configured?.proBuyable, 'crypto', v.configured?.cryptoCheckout, 'checkout', v.configured?.checkout);
  for (const [viewer, theme, w] of [['signed_out', 'dark', 1280], ['free', 'dark', 1280], ['free', 'light', 390]]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: viewer !== 'signed_out', plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); const page = await ctx.newPage();
    console.log(`\n=== ${viewer} ${theme} ${w}`);
    await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3500);
    const reveal = await page.locator('[data-testid="upgrade-reveal-plans"]').count(); const info = await page.evaluate(() => ({ ctas: [...document.querySelectorAll('[data-testid^="checkout-cta"], [data-testid*="upgrade"] button, main button, main a')].map((e) => ({ id: e.getAttribute('data-testid'), t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), dis: e.disabled || e.getAttribute('aria-disabled') === 'true', href: e.getAttribute('href') })).filter((e) => e.t).slice(0, 14), body: document.body.innerText, path: location.pathname }));
    console.log('path', info.path, '| reveal control:', reveal, '| buttons:', JSON.stringify(info.ctas.map((c) => `${c.t}${c.dis ? ' [disabled]' : ''}${c.href ? ' -> ' + c.href : ''}${c.id ? ' (' + c.id + ')' : ''}`)).slice(0, 700));
    console.log('wording hits on /upgrade:', JSON.stringify(hits(info.body)).slice(0, 900));
    await page.screenshot({ path: `${dir}/upgrade-${viewer}-${theme}-${w}.png`, fullPage: true }).catch(() => {});
    if (reveal) { await page.locator('[data-testid="upgrade-reveal-plans"]').click().catch(() => {}); await sleep(1200); const c = await page.locator('[data-testid^="checkout-cta"]').count(); console.log('after reveal: plan buttons', c); if (c) { await page.locator('[data-testid="checkout-cta-monthly"]').click({ timeout: 4000 }).catch(() => {}); await sleep(1000); const pt = await page.evaluate(() => (document.querySelector('[data-testid="checkout-method-panel"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)); console.log('monthly click panel:', JSON.stringify(pt)); await page.screenshot({ path: `${dir}/upgrade-panel-${viewer}-${theme}-${w}.png`, fullPage: true }).catch(() => {}); } }
    if (viewer === 'signed_out') { await page.goto(B.base + '/', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(2500); const l = await page.evaluate(() => { const b = [...document.querySelectorAll('a, button')].find((e) => /get pro/i.test(e.innerText || '')); return b ? { t: (b.innerText || '').trim(), href: b.getAttribute('href'), dis: b.disabled || false } : null; }); console.log('landing Get Pro button:', JSON.stringify(l)); }
    await ctx.close();
  }
} finally { await browser.close(); }
