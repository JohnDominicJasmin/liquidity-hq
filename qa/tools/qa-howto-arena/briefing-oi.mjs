/* #1617 cross-surface check: which coin(s) carry the Briefing's "OI ↑↑"/"OI ↓↓" chips right now, and what does the Arena's OI card say for those same coins at the same moment? Stubbed Pro viewer (said so), no sign-in. */
import { chromium, open, settle, sleep, QA } from './lib.mjs';
const B = QA; const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, new Date().toISOString());
  let ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  let page = await ctx.newPage(); await page.goto(`${B.base}/briefing`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(14000);
  const chips = await page.evaluate(() => { const out = []; for (const e of document.querySelectorAll('*')) { if (e.children.length) continue; const t = (e.textContent || '').trim(); if (/^OI [↑↓]{2}$/.test(t)) { let row = e; for (let i = 0; i < 6 && row; i++) { const txt = (row.innerText || ''); const m = txt.match(/\b([A-Z]{2,6})\b[\s\S]{0,40}/); if (/\b(BTC|ETH|SOL|XRP|BNB|HYPE|DOGE|ADA|NEAR|SUI|AVAX|LINK|DOT|ATOM|WIF|PEPE|BONK|LTC|BCH|TRX|XLM|ETC|FIL|ARB|OP|APT|SEI|INJ|TIA|AAVE|UNI|LDO|RUNE|GMX|CRV|STX|JUP|WLD|RENDER|TAO|FET|ONDO|PYTH|ENA|DYDX|SAND|MANA|GMT|XAU|SPX)\b/.test(txt) && txt.length < 400) { out.push({ chip: t, rowText: txt.replace(/\s+/g, ' ').slice(0, 160) }); break; } row = row.parentElement; } } } return out.slice(0, 8); });
  console.log('Briefing OI chips and their rows:', JSON.stringify(chips, null, 1)); await ctx.close();
  const coins = [...new Set(chips.map((c) => (c.rowText.match(/\b(BTC|ETH|SOL|XRP|BNB|HYPE|DOGE|ADA|NEAR|SUI|AVAX|LINK|DOT|ATOM|WIF|PEPE|BONK|LTC|BCH|TRX|XLM|ETC|FIL|ARB|OP|APT|SEI|INJ|TIA|AAVE|UNI|LDO|RUNE|GMX|CRV|STX|JUP|WLD|RENDER|TAO|FET|ONDO|PYTH|ENA|DYDX|SAND|MANA|GMT|XAU|SPX)\b/) || [])[1]).filter(Boolean).map((c) => c.toLowerCase()))].slice(0, 3);
  for (const coin of coins) {
    ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: coin, default_tf: '1h', strategy_selection: [], strategy_params: {} } }); page = await ctx.newPage();
    await page.goto(`${B.base}/arena?coin=${coin}&tf=1h`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(14000);
    const card = await page.evaluate(() => { const t = document.body.innerText.split('\n').map((s) => s.trim()); const i = t.findIndex((s) => /^open interest$/i.test(s)); return i >= 0 ? t.slice(i, i + 6).join(' / ') : '(no OI card)'; });
    console.log(`Arena card for ${coin}: ${card}`); await ctx.close();
  }
} finally { await browser.close(); }
