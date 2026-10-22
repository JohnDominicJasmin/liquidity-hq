/* #1606 / #1623 on qa: the embedded Whop checkout at phone widths (and 1280), as a REAL seeded Free test account (dev project; env files; not printed). LOOK ONLY: nothing is typed into the card form, Join is never pressed, no payment.
 * The qa Whop links are LIVE. For each width x theme (Monthly plan) it measures, inside Whop's own frame: the card-number field (width, whether its WHOLE placeholder "1234 1234 1234 1234" fits before the card logos, the gap),
 * that the card logos do not overlap the placeholder, that Name / Address / MM-YY / CVC fields exist and sit inside the viewport, that the email field is disabled and equals the account email; and on the page: the box's left/right gutter,
 * that the sentence carries the email in bold, no sideways scroll. Then (hosts blocked) the fallback: text, hosted-link button, and the sentence above it. A viewport photo of each.
 * usage: node embed-phone.mjs [out-dir] [widths=390,360,1280]                                                                                                                                      */
import { chromium, open, settle, sleep, QA, OUT } from './lib.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const [, , outArg, widthsArg = '390,360,1280'] = process.argv; const B = QA; const dir = outArg || `${OUT}/embed-phone`; mkdirSync(dir, { recursive: true });
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq'; const env = {};
for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const email = env.E2E_USER_B_EMAIL;
const mint = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.E2E_USER_B_PASSWORD }) });
if (!mint.ok) { console.log('sign-in failed', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const ALLOW = /(^|\.)(whop\.com|whop\.io|stripe\.com|stripe\.network|hcaptcha\.com|basistheory\.com|sardine\.ai)$/;
const browser = await chromium.launch(); const rows = []; const say = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const FRAME_MEASURE = (accountEmail) => {
  const q = (sel) => [...document.querySelectorAll(sel)];
  const card = q('input').find((i) => /1234/.test(i.placeholder || '')); if (!card) return { card: null, inputs: q('input').length };
  const cs = getComputedStyle(card); const r = card.getBoundingClientRect(); const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const textW = c.measureText(card.placeholder).width; const textEnd = r.left + parseFloat(cs.paddingLeft) + textW;
  const cy = r.top + r.height / 2; const logos = q('img, svg').map((e) => e.getBoundingClientRect()).filter((b) => b.width > 6 && b.height > 6 && b.left > r.left + r.width * 0.3 && b.right <= r.right + 2 && cy > b.top - 4 && cy < b.bottom + 4);
  const logoLeft = logos.length ? Math.min(...logos.map((b) => b.left)) : null;
  const byPh = (re) => q('input').find((i) => re.test(i.placeholder || '') || re.test(i.name || '') || re.test(i.getAttribute('aria-label') || ''));
  const inView = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.left >= -1 && b.right <= innerWidth + 1 && b.width > 20; };
  const mail = q('input').find((i) => /@/.test(i.value) || i.type === 'email');
  return { card: { width: Math.round(r.width), placeholder: card.placeholder, textWidth: Math.round(textW), logoCount: logos.length, gapBetweenTextAndLogos: logoLeft === null ? null : Math.round(logoLeft - textEnd), placeholderWhole: logoLeft === null ? textEnd <= r.right - 4 : textEnd <= logoLeft - 2 }, fields: { mmyy: inView(byPh(/mm\s*\/?\s*yy/i)), cvc: inView(byPh(/cvc|cvv/i)), name: inView(byPh(/full name|name/i)), address: inView(byPh(/address/i)) }, email: mail ? { disabled: mail.disabled || mail.readOnly, equalsAccount: (mail.value || '').toLowerCase() === accountEmail.toLowerCase() } : null, frameInnerWidth: innerWidth };
};
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, new Date().toISOString());
  for (const w of widthsArg.split(',').map(Number)) for (const theme of ['dark', 'light']) {
    const tag = `${theme}-${w}`;
    // 1. embed loaded
    let ctx = await open(browser, { b: B, w, theme, signedIn: true, realSession: session, allowHosts: ALLOW, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); let page = await ctx.newPage();
    try {
      await page.goto(`${B.base}/upgrade`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); { const rv = page.getByTestId('upgrade-reveal-plans'); await rv.waitFor({ timeout: 25_000 }).catch(() => {}); await rv.click({ timeout: 5000 }).catch(() => {}); } await sleep(900);
      const FAB = () => { const f = document.querySelector('.gchat-fab'); if (!f) return { present: false }; const cs = getComputedStyle(f); const r = f.getBoundingClientRect(); return { present: true, count: document.querySelectorAll('.gchat-fab').length, display: cs.display, onScreen: cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1 && r.width > 0, box: [r.left, r.top, r.width, r.height].map(Math.round) }; };
      const fabBefore = await page.evaluate(FAB); // #1636: the button is there BEFORE a plan is chosen
      await page.getByTestId('checkout-cta-monthly').click({ timeout: 25_000 }); await page.getByTestId('whop-checkout-embed').waitFor({ state: 'attached', timeout: 25_000 }).catch(() => {}); await sleep(15_000);
      const fabWithEmbed = await page.evaluate(FAB); // and gone while the embedded checkout is open
      const embedLoaded = await page.evaluate(() => ({ embedEl: !!document.querySelector('[data-testid="whop-checkout-embed"]'), fallback: !!document.querySelector('[data-testid="checkout-method-whop-embed-fallback"]'), iframes: [...document.querySelectorAll('iframe')].map((f) => { try { return new URL(f.src).host; } catch { return f.src.slice(0, 40); } }) }));
      say({ tag, mode: 'fab', fabBefore, fabWithEmbed, embedLoaded });
      const pageInfo = await page.evaluate((acct) => { const box = document.querySelector('[data-testid="checkout-method-panel"]'); const b = box ? box.getBoundingClientRect() : null; const el = document.querySelector('[data-testid="whop-checkout-embed"]'); const e = el ? el.getBoundingClientRect() : null; const strong = document.querySelector('[data-testid="checkout-method-whop-email-line"]'); const sent = document.querySelector('[data-testid="checkout-method-whop-email-note"]'); return { boxLeft: b ? Math.round(b.left) : null, boxRight: b ? Math.round(innerWidth - b.right) : null, embedWidth: e ? Math.round(e.width) : null, sentence: sent ? (sent.textContent || '').trim() : null, emailBold: strong ? { tag: strong.tagName, weight: getComputedStyle(strong).fontWeight, equalsAccount: (strong.textContent || '').toLowerCase() === acct.toLowerCase() } : null, scroll: [document.documentElement.scrollWidth, innerWidth] }; }, email);
      let frameInfo = null; for (const f of page.frames()) { if (f === page.mainFrame()) continue; try { const r = await f.evaluate(FRAME_MEASURE, email); if (r && r.card) { frameInfo = r; break; } } catch { /* frame not readable */ } }
      say({ tag, mode: 'embed', ...pageInfo, frame: frameInfo });
      await page.getByTestId('whop-checkout-embed').scrollIntoViewIfNeeded().catch(() => {}); await sleep(700); await page.screenshot({ path: `${dir}/embed-${tag}.png` });
    } catch (e) { say({ tag, mode: 'embed', error: String(e.message).slice(0, 120) }); }
    await ctx.close();
    // 2. fallback (Whop hosts blocked)
    if (w !== 1280) {
      ctx = await open(browser, { b: B, w, theme, signedIn: true, realSession: session, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); page = await ctx.newPage();
      try {
        await page.goto(`${B.base}/upgrade`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); { const rv = page.getByTestId('upgrade-reveal-plans'); await rv.waitFor({ timeout: 25_000 }).catch(() => {}); await rv.click({ timeout: 5000 }).catch(() => {}); } await sleep(900);
        await page.getByTestId('checkout-cta-monthly').click({ timeout: 25_000 }); await sleep(19_000);
        const fb = await page.evaluate(() => ({ fallbackText: (document.querySelector('[data-testid="checkout-method-whop-embed-fallback"]')?.textContent || '').trim(), button: !!document.querySelector('[data-testid="checkout-method-whop"]'), sentence: !!document.querySelector('[data-testid="checkout-method-whop-email-note"]'), scroll: [document.documentElement.scrollWidth, innerWidth] }));
        say({ tag, mode: 'fallback', ...fb }); await page.getByTestId('checkout-method-panel').scrollIntoViewIfNeeded().catch(() => {}); await sleep(600); await page.screenshot({ path: `${dir}/fallback-${tag}.png` });
      } catch (e) { say({ tag, mode: 'fallback', error: String(e.message).slice(0, 120) }); }
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(rows, null, 1)); }
