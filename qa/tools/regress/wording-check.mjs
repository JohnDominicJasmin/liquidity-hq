/* #1640 / PM's five wordings (+ R12): does the PAGE show each new label in ko, zh and ru, exactly as the migration file writes it? The expected text comes
 * from the migration FILES (the uncommented prod rows), never from the page. For each case the page is loaded as the account that sees that text (Free on a
 * locked coin for the lock line, the trial account for its banner, Pro for the calculators, Free on /upgrade with the Whop button clicked for the payment
 * panel), with the locale under test; a key counts as FOUND when every fragment of its value between {placeholders} is in the page text or an aria-label /
 * title. NOT FOUND is reported as such: some texts only show in a state this check does not create (a failed payment return, an open tooltip).
 * Writes off. usage: node wording-check.mjs [langs=ko,zh,ru]                                                                                        */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REPO = process.env.QA_REPO || fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\/]$/, ''); // #1690: was an absolute path
const langs = (process.argv[2] || 'ko,zh,ru').split(',');
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : null; // a case-name filter, e.g. 'Whop|no-profit'
const DIR = `${ROOT}/language/wordings`; mkdirSync(DIR, { recursive: true });
const LOG = `${ROOT}/_sweep/i18n.jsonl`;
const expected = {};
for (const m of ['20261017b_labels_privacy_payments_provider_whop', '20261017c_labels_upgrade_whop_checkout_copy', '20261020a_labels_arena_coin_lock', '20261021a_labels_upgrade_whop_embed', '20261021b_labels_trial_banner_dismiss', '20261021c_labels_earnings_claim_wording']) {
  for (const line of readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8').split('\n')) {
    const t = line.trim(); if (!t.startsWith("('")) continue;
    const p = t.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','"); if (p.length !== 3) continue;
    (expected[p[0]] ??= {})[p[1]] = p[2].split("''").join("'");
  }
}
const CASES = [
  { name: 'lock line (20261020a)', acct: 'B', path: '/arena?coin=xrp&tf=1h', keys: ['ARENA_COIN_LOCK_LINE', 'ARENA_COIN_LOCK_PANEL'] },
  { name: 'trial banner (20261021b)', acct: 'T', path: '/dashboard', keys: ['TRIAL_BANNER_DISMISS'] },
  { name: 'no-profit wording (20261021c)', acct: 'A', path: '/calc', keys: ['CALC_SIZER_RESULT_POTENTIAL_PROFIT', 'CALC_PNL_BANNER_PROFIT', 'CALC_PNL_BANNER_LOSS', 'CALC_SIZER_RR_TIP', 'CALC_RR_RATIO_TIP'] },
  { name: 'journal hint (20261021c)', acct: 'A', path: '/journal', keys: ['JOURNAL_HINT_BODY'] },
  /* The panel opens the way the embed check opens it (qa-howto-arena/embed-phone.mjs): reveal the plans, then the monthly checkout button. The
     Whop frames themselves are fenced (any non-app host is blocked), so the embed falls back - the wordings under test are our own text around it. */
  { name: 'Whop panel (20261017c R12 + 20261021a)', acct: 'B', path: '/upgrade', open: async (page) => {
      const rv = page.getByTestId('upgrade-reveal-plans'); if (await rv.count()) { await rv.click({ timeout: 8000 }).catch(() => {}); await sleep(1500); }
      const cta = page.getByTestId('checkout-cta-monthly'); const n = await cta.count(); if (n) { await cta.first().click({ timeout: 15_000 }).catch(() => {}); await sleep(12_000); }
      return n > 0;
    }, keys: ['UPGRADE_WHOP_CTA', 'UPGRADE_WHOP_PANEL_TITLE', 'UPGRADE_WHOP_EMAIL_NOTE', 'UPGRADE_WHOP_CHECKOUT_NOTE', 'UPGRADE_WHOP_EMAIL_SENTENCE', 'UPGRADE_WHOP_FINAL_NOTE', 'UPGRADE_WHOP_EMBED_LOADING', 'UPGRADE_WHOP_EMBED_FALLBACK'] },
  { name: 'privacy, Whop named (20261017b)', acct: 'anon', path: '/privacy', keys: ['PRIVACY_SECTION_THIRD_PARTY_BODY'] },
];
const fragments = (v) => v.split(/\{[a-zA-Z]+\}/).map((s) => s.trim()).filter((s) => s.length >= 2);
const browser = await chromium.launch();
try {
  const build = (await (await fetch(BASE + '/api/version')).json()).commit; console.log('build', build, new Date().toISOString());
  for (const c of CASES.filter((x) => !only || only.test(x.name))) for (const lang of langs) {
    const sbStub = c.acct !== 'anon' ? async (r, req, u) => { if (req.method() === 'GET' && /user_settings/.test(u.pathname)) { const resp = await r.fetch(); let body; try { body = await resp.json(); } catch { return false; } const patch = (x) => (x && typeof x === 'object' ? { ...x, language: lang } : x); body = Array.isArray(body) ? body.map(patch) : patch(body); await r.fulfill({ response: resp, json: body }); return true; } return false; } : undefined;
    const ctx = await open(browser, { acct: c.acct, w: 1280, theme: 'dark', lang, sbStub, rec: [] }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    await page.goto(BASE + c.path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(2500);
    const collect = () => page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`)].join('\n').replace(/\s+/g, ' '));
    let clicked = null; let before = '';
    if (c.open) { before = await collect(); clicked = await c.open(page); }
    const text = before + ' ' + (await collect());
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    const keys = c.keys.map((k) => { const v = expected[k]?.[lang]; if (!v) return { key: k, expected: null, found: false }; const fr = fragments(v); return { key: k, found: fr.every((f) => text.includes(f)), expected: v.slice(0, 60) }; });
    await page.screenshot({ path: `${DIR}/${c.acct}-${c.path.replace(/\W+/g, '_')}-${lang}.jpg`, type: 'jpeg', quality: 70, fullPage: false });
    const row = { at: new Date().toISOString(), part: 'wording', build, case: c.name, acct: c.acct, path: c.path, lang, htmlLang, clicked, found: keys.filter((k) => k.found).map((k) => k.key), notFound: keys.filter((k) => !k.found).map((k) => k.key) };
    console.log(JSON.stringify(row)); appendFileSync(LOG, JSON.stringify(row) + '\n');
    await ctx.close();
  }
} finally { await browser.close(); }
