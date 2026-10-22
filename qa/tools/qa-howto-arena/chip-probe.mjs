/* #1609 positive control: count the chart toolbar's setup chip ("Setup Forming" / "Prime Setup") for a coin and plan, on one base. Plans are STUBBED (no sign-in). Run it on prod (old guard: the chip shows
 * whenever its condition holds, even on a locked coin for Free) to find a coin where the chip exists RIGHT NOW, then on qa for the same coin and plan: the chip must be gone for Free/trial on a locked coin.
 * usage: node chip-probe.mjs <qa|prod> <plan free|pro|trial|signed_out> <coins csv> [tf=1h]                                                                                                          */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const [, , bArg = 'prod', plan = 'free', coinsArg = 'xrp', tf = '1h'] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/chip-probe/${B.tag}-${plan}`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, '| plan', plan, new Date().toISOString());
  for (const coin of coinsArg.split(',')) {
    const signedIn = plan !== 'signed_out'; const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn, plan: plan === 'signed_out' ? 'free' : plan, liveWs: true, settings: { default_coin: coin, default_tf: tf, strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + `/arena?coin=${coin}&tf=${tf}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
      const r = await page.evaluate(() => { const chips = [...document.querySelectorAll('.klc-toolbar *')].filter((e) => e.children.length === 0 && /^(setup forming|prime setup)$/i.test((e.textContent || '').trim())).map((e) => e.textContent.trim()); const line = !!document.querySelector('[data-testid="arena-coin-lock-line"]'); return { chips, lockLine: line }; });
      console.log(JSON.stringify({ coin, plan, chips: r.chips, lockLine: r.lockLine }));
      if (r.chips.length) await page.screenshot({ path: `${dir}/${coin}.png` });
    } catch (e) { console.log(coin, 'ERROR', String(e.message).slice(0, 100)); }
    await ctx.close();
  }
} finally { await browser.close(); }
