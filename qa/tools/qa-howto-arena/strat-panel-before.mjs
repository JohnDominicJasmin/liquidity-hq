/* #1601 "before": the Arena Strategy panel as it is. Per viewer (signed out, Free, Pro; plan STUBBED, no sign-in), width (1280, 390) and theme (dark, light), on /arena BTC 1h:
 * the panel's text, its header micro-text (the slot count line), the preset dropdown options, every indicator chip with its computed opacity (dimmed = "not wired") and whether it looks selected,
 * and a screenshot of the panel element. Also the panel's explanatory paragraph(s) and font sizes of the limit line. Read-only: nothing is selected or saved (no clicks except none).
 * usage: node strat-panel-before.mjs <qa|prod> [out-dir]                                                                                                                      */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = process.argv[3] || `${OUT}/strat-panel/${B.tag}`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(); const rows = [];
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, v.branch, new Date().toISOString());
  for (const [viewer, w, theme] of [['signed-out', 1280, 'dark'], ['free', 1280, 'dark'], ['pro', 1280, 'dark'], ['free', 1280, 'light'], ['pro', 1280, 'light'], ['signed-out', 390, 'dark'], ['free', 390, 'dark'], ['pro', 390, 'dark'], ['free', 390, 'light'], ['pro', 390, 'light']]) {
    const tag = `${viewer}-${w === 390 ? 'mobile' : 'desktop'}${theme === 'light' ? '-light' : ''}`;
    const ctx = await open(browser, { b: B, w, theme, signedIn: viewer !== 'signed-out', plan: viewer === 'pro' ? 'pro' : 'free', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000);
      const panel = page.locator('.strat-panel').first();
      if (!(await panel.count())) { console.log(tag, 'NO .strat-panel on the page'); await ctx.close(); continue; }
      await panel.scrollIntoViewIfNeeded().catch(() => {}); await sleep(700);
      const info = await panel.evaluate((el) => {
        const cs = (e) => getComputedStyle(e); const btns = [...el.querySelectorAll('button')];
        const chips = btns.map((b) => ({ t: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), opacity: Number(cs(b).opacity), bg: cs(b).backgroundColor, on: b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true', dis: b.disabled })).filter((c) => c.t);
        const sel = el.querySelector('select'); const opts = sel ? [...sel.options].map((o) => o.textContent.trim()) : [];
        const lim = [...el.querySelectorAll('*')].find((e) => /\b(OF|of)\s+\d+\s+(USED|used)/.test(e.textContent || '') && e.children.length === 0);
        const paras = [...el.querySelectorAll('p, div')].filter((e) => e.children.length === 0 && (e.innerText || '').trim().length > 60).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220));
        return { text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 1500), chips, opts, selected: sel ? sel.options[sel.selectedIndex]?.textContent.trim() : null, limitText: lim ? lim.textContent.trim() : null, limitFont: lim ? cs(lim).fontSize : null, paras, scroll: [document.documentElement.scrollWidth, innerWidth], h: Math.round(el.getBoundingClientRect().height) };
      });
      const dimmed = info.chips.filter((c) => c.opacity < 0.9).length;
      const row = { tag, build: v.commit, chips: info.chips.length, dimmed, selectedPreset: info.selected, presets: info.opts, limitLine: info.limitText, limitFontSize: info.limitFont, paragraphs: info.paras, scrollW_innerW: info.scroll.join('/'), panelHeightPx: info.h };
      rows.push({ ...row, chipList: info.chips }); console.log(JSON.stringify(row));
      await panel.screenshot({ path: `${dir}/strategy-panel-${tag}.png` });
      await page.screenshot({ path: `${dir}/arena-page-${tag}.png` });
    } catch (e) { console.log(tag, 'ERROR', String(e.message).slice(0, 140)); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(rows, null, 1)); }
