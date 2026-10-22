import { chromium, open, settle, sleep, QA } from './lib.mjs';
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { b: QA, w: 1280, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  await page.goto(QA.base + '/arena', { waitUntil: 'load', timeout: 120000 }); await settle(page); await page.waitForSelector('.strat-chip', { timeout: 60000 }); await sleep(6000);
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && x.closest('.strat-panel') === null); if (!btn) return { err: 'no S/R toolbar button' };
    const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber')); if (!fk) return { err: 'no fiber on button' };
    const out = []; const seen = new Set();
    for (let n = btn[fk], d = 0; n && d < 80; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80; h = h.next, i++) { const v = h.memoizedState; for (const o of [v, v && typeof v === 'object' ? v.current : null]) { if (!o || typeof o !== 'object' || seen.has(o)) continue; seen.add(o); let names = []; try { names = Object.getOwnPropertyNames(Object.getPrototypeOf(o) || {}).concat(Object.keys(o)).filter((k) => /overlay|indicator/i.test(k)); } catch { /* */ } if (names.length) out.push({ depth: d, comp: n.type?.name, hook: i, names: names.slice(0, 12) }); } }
    }
    return { out: out.slice(0, 6) };
  });
  console.log(JSON.stringify(r));
  await ctx.close();
} finally { await browser.close(); }
