/* PR #1541: for each coin/timeframe, what does the EMA ribbon panel say (verdict, 200 SMA row, phase text) and what does Quick Research SEND as its
 * strategy context line? The context is read from the request the page makes to /api/grok (the request is answered locally; no AI call is made).
 * Pro stub. Output per combo: panel verdict badge, phase line, 200 SMA condition text, and the emaStrategy line from the request body.
 * usage: node ctx-probe.mjs <qa|prod> <coins csv> <tfs csv> [shots=0|1]                                                                      */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const [, , bArg = 'qa', coinsArg = 'btc', tfsArg = '1h', shotsArg = '0'] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/ctx-probe/${B.tag}`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit);
  for (const coin of coinsArg.split(',')) for (const tf of tfsArg.split(',')) {
    const posts = []; const otherPosts = [];
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: coin, default_tf: tf, strategy_selection: [], strategy_params: {} },
      appStub: async (r, req, u) => { if (req.method() !== 'GET' && req.method() !== 'HEAD') otherPosts.push(`${req.method()} ${u.pathname}`); if (req.method() === 'POST' && /^\/api\/(grok|arena|analy|ai|research)/.test(u.pathname)) { posts.push(req.postData() || ''); await r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'qa-stub', code: 'RATE_LIMITED' }) }); return true; } return false; } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${B.base}/arena?coin=${coin}&tf=${tf}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
      const panel = await page.evaluate(() => { const t = document.body.innerText.replace(/\s+/g, ' '); const v = (t.match(/EMA RIBBON STRATEGY[\s\S]{0,260}/) || [''])[0]; const sma = (t.match(/Price \$[\d,.]+ (?:above|below) Daily 200 SMA[^✓✗]{0,70}/) || [''])[0]; const badge = [...document.querySelectorAll('span, div')].map((e) => (e.innerText || '').trim()).find((x) => /^(TRENDING (LONG|SHORT)|MIXED|FREEZE|\S*\s?(TRENDING LONG|TRENDING SHORT))$/i.test(x)) || null; let sig = null; try { const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel')); const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber')); for (let n = fk ? btn[fk] : null, d = 0; n && d < 300 && !sig; n = n.return, d++) { for (let h = n.memoizedState, i = 0; h && i < 200 && !sig; h = h.next, i++) { const x = h.memoizedState; if (x && typeof x === 'object' && 'signalDir' in x && 'signalTimestamp' in x) sig = { signalDir: x.signalDir, signalAt: x.signalTimestamp ? new Date(x.signalTimestamp).toISOString().slice(5, 16) : null, verdict: x.verdict ?? null, phase: (x.phase || '').slice(0, 90) }; } } } catch { /* leave null */ } return { head: v.slice(0, 230), sma200: sma, badge, sig }; });
      const q = page.locator('button', { hasText: /^quick$/i }).first(); if (await q.count()) await q.click({ timeout: 4000 }).catch(() => {}); await sleep(5000);
      const body = posts.join(' ').replace(/\\u00b7/g, '·'); const m = body.match(/"emaStrategy":"((?:[^"\\]|\\.)*)"/); const ix = body.search(/emaStrategy/); const line = m ? m[1].replace(/\\u00b7/g, '·') : (ix >= 0 ? 'RAW: ' + body.slice(ix, ix + 330) : (posts.length ? 'PROMPT LINES: ' + (body.split('\\n').filter((l) => /TRENDING|counter-trend|Daily 200 SMA/i.test(l)).slice(0, 4).map((l) => l.slice(0, 200)).join(' // ') || '(no strategy line found in prompt)') : null));
      console.log('   app non-GET requests seen after load+click:', JSON.stringify([...new Set(otherPosts)]));
      console.log(`   hook state: ${JSON.stringify(panel.sig)}`);
      console.log(`${coin} ${tf}: badge=${panel.badge} | 200SMA row: ${panel.sma200 || '(none)'} | phase: ${panel.head.slice(26, 150)}`); console.log(`   context line: ${line === null ? '(no /api/grok request captured)' : line.slice(0, 260)}`);
      if (shotsArg === '1') await page.screenshot({ path: `${dir}/${coin}-${tf}.png`, fullPage: true }).catch(() => {});
    } catch (e) { console.log(coin, tf, 'ERROR', String(e.message).slice(0, 100)); }
    await ctx.close();
  }
} finally { await browser.close(); }
