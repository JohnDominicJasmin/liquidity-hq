/* #1606 (#1610) on qa with a REAL seeded Free test account (dev project): LOOK at the embedded Whop checkout. NOTHING IS SUBMITTED, NO CARD DETAIL IS TYPED, "Join" is never pressed. The Whop links on qa are the
 * LIVE links, so the element is a live checkout for the real plans; it is only displayed.
 * Modes (second argument):
 *   open     the Whop hosts (and the card form's own hosts) are reachable: pick each plan, wait for the embed, read the four lines, the plan id and environment on the wrapper, the frames, and whether the email input
 *            in Whop's frame is disabled and equals the account email (reported as booleans: the address itself is not printed), screenshots; then the ?status= return banners.
 *   blocked  the default fence (Whop hosts aborted): pick a plan and wait for the 15 s watchdog; read the fallback text; press the hosted-link button once and record the (aborted, never loaded) address with its
 *            query keys; Whop is never contacted.
 * Credentials come from the gitignored env files and are not printed.
 * usage: node upgrade-embed.mjs <open|blocked> [qa|prod] [out-dir]                                                                                                                              */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const [, , mode = 'open', bArg = 'qa', outArg] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = outArg || `${OUT}/upgrade-embed/${mode}`; mkdirSync(dir, { recursive: true });
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const env = {}; for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const email = env.E2E_USER_B_EMAIL; const password = env.E2E_USER_B_PASSWORD; const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!email || !password || !SB_URL || !ANON || new URL(SB_URL).hostname.split('.')[0] !== B.ref) { console.log('missing fixture settings, or the fixture project is not this base\'s dev project'); process.exit(1); }
const mint = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!mint.ok) { console.log('sign-in failed with HTTP', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const ALLOW = mode === 'open' ? /(^|\.)(whop\.com|whop\.io|stripe\.com|stripe\.network|hcaptcha\.com|basistheory\.com|sardine\.ai)$/ : undefined;
const browser = await chromium.launch(); const rows = [];
const say = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, v.branch, '| mode', mode, new Date().toISOString());
  let views = mode === 'open' ? [[1280, 'dark'], [1280, 'light'], [390, 'dark'], [390, 'light']] : [[1280, 'dark'], [390, 'light']];
  if (process.env.ONLY) views = process.env.ONLY.split(';').map((x) => { const [w, t] = x.split('/'); return [Number(w), t]; });
  const PLANS = process.env.PLANS ? process.env.PLANS.split(',') : (mode === 'open' ? ['monthly', 'annual', 'fortnightly'] : ['monthly']);
  const SKIP_RETURN = !!process.env.SKIP_RETURN;
  for (const [w, theme] of views) {
    for (const plan of PLANS) {
      const rec = []; const aborted = [];
      const ctx = await open(browser, { b: B, w, theme, signedIn: true, realSession: session, rec, allowHosts: ALLOW, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
      const page = await ctx.newPage(); const tag = `${mode}-${plan}-${theme}-${w}`;
      page.on('requestfailed', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) aborted.push(r.url()); });
      try {
        await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3000);
        const reveal = page.getByTestId('upgrade-reveal-plans'); if (await reveal.count()) { await reveal.click(); await sleep(900); }
        await page.getByTestId(`checkout-cta-${plan}`).click({ timeout: 8000 });
        if (mode === 'open') {
          await page.getByTestId('whop-checkout-embed').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {}); await sleep(14_000);
          const lines = await page.evaluate(() => { const n = document.querySelector('[data-testid="checkout-method-whop-email-note"]'); const e = document.querySelector('[data-testid="whop-checkout-embed"]'); return { prefilled: n?.getAttribute('data-prefilled'), lines: n ? [...n.querySelectorAll('p')].map((p) => (p.textContent || '').trim()) : [], embed: e ? { planId: e.getAttribute('data-plan-id'), env: e.getAttribute('data-environment') } : null, finalNote: (document.querySelector('[data-testid="checkout-method-whop-final-note"]')?.textContent || '').trim(), fallback: !!document.querySelector('[data-testid="checkout-method-whop-embed-fallback"]'), scroll: [document.documentElement.scrollWidth, innerWidth] }; });
          const frames = page.frames().filter((f) => f !== page.mainFrame()).map((f) => { try { return new URL(f.url()).host; } catch { return f.url().slice(0, 40); } });
          let emailInput = null;
          for (const f of page.frames()) { if (f === page.mainFrame()) continue; try { const inputs = await f.locator('input').evaluateAll((els) => els.map((e) => ({ type: e.type, name: e.name || e.id || '', disabled: e.disabled, readOnly: e.readOnly, hasValue: !!e.value, v: /@/.test(e.value) ? e.value : null }))); const mail = inputs.find((i) => i.v !== null || /mail/i.test(i.name) || i.type === 'email'); if (mail) { emailInput = { disabled: mail.disabled || mail.readOnly, equalsAccountEmail: mail.v !== null && mail.v.toLowerCase() === email.toLowerCase(), inputsInFrame: inputs.length }; break; } } catch { /* a frame that cannot be read */ } }
          say({ tag, ...lines, frames: [...new Set(frames)], emailInput, rec: undefined });
          await page.screenshot({ path: `${dir}/${tag}.png`, fullPage: true });
          /* A full-page capture of a cross-origin frame can come out blank; the viewport capture after scrolling the element into view is the one to trust. */
          await page.getByTestId('whop-checkout-embed').scrollIntoViewIfNeeded().catch(() => {}); await sleep(800); await page.screenshot({ path: `${dir}/${tag}-view.png` });
        } else {
          await sleep(19_000);
          const fb = await page.evaluate(() => ({ fallbackText: (document.querySelector('[data-testid="checkout-method-whop-embed-fallback"]')?.textContent || '').trim(), button: !!document.querySelector('[data-testid="checkout-method-whop"]'), embedStillThere: !!document.querySelector('[data-testid="whop-checkout-embed"]') }));
          await page.screenshot({ path: `${dir}/${tag}-fallback.png`, fullPage: true });
          if (fb.button) { await page.getByTestId('checkout-method-whop').click({ timeout: 5000 }).catch(() => {}); await sleep(1500); }
          const u = aborted.map((a) => { try { const x = new URL(a); return { origin: x.origin + x.pathname, keys: [...x.searchParams.keys()], emailDisabled: x.searchParams.get('email.disabled'), emailIsAccount: (x.searchParams.get('email') || '').toLowerCase() === email.toLowerCase() }; } catch { return a.slice(0, 60); } });
          say({ tag, ...fb, hostedLinkTried: u });
        }
      } catch (e) { say({ tag, error: String(e.message).slice(0, 140) }); }
      await ctx.close();
    }
  }
  if (mode === 'open' && !SKIP_RETURN) {
    for (const q of ['status=succeeded&payment=pay_qa', 'status=failed&payment=pay_qa', 'status=canceled', 'status=anything', 'payment=pay_qa']) {
      const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, realSession: session, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
      const page = await ctx.newPage();
      try { await page.goto(`${B.base}/upgrade?${q}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3500); const b = await page.evaluate(() => { const e = document.querySelector('[data-testid="upgrade-return-banner"]'); return e ? { status: e.getAttribute('data-status'), text: (e.textContent || '').trim().slice(0, 120) } : null; }); say({ tag: `return ?${q}`, banner: b }); if (q.startsWith('status=succeeded')) await page.screenshot({ path: `${dir}/return-succeeded.png`, fullPage: true }); } catch (e) { say({ tag: `return ?${q}`, error: String(e.message).slice(0, 100) }); }
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(rows, null, 1)); }
