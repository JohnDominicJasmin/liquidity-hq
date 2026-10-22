/* Reproduce the Strategy-panel mismatch (#1543): BTC 1h, Free, set "Custom": the chart draws the EMA ribbon, S/R, Liq clusters and
 * the gamma flip / max pain lines, while the chips show none selected and the counter says "0 of 1 used". Also records the GEX
 * chip's gold box (selected? focused? hovered?). One context, no clicks except choosing "Custom". Read-only, same fence.
 * usage: node strategy-repro.mjs <qa|prod> [plan=free|trial|pro] [theme=dark|light] [width=1280]                              */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const plan = process.argv[3] || 'free'; const theme = process.argv[4] || 'dark'; const w = Number(process.argv[5] || 1280);
const dir = `${OUT}/strategy-repro`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { b: B, w, plan, theme, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  await page.goto(B.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForSelector('.strat-chip', { timeout: 60_000 }).catch(() => {});
  await sleep(6000);
  const sel = page.locator('select[aria-label="Strategy set"]');
  const before = await sel.inputValue().catch(() => null);
  await sel.selectOption('custom').catch(() => {}); await sleep(1500);
  const snap = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.strat-chip')].map((c) => ({ label: (c.textContent || '').trim(), on: c.classList.contains('on'), pressed: c.getAttribute('aria-pressed'), blocked: c.classList.contains('blocked'), notyet: c.classList.contains('notyet') }));
    const gex = [...document.querySelectorAll('.strat-chip')].find((c) => /^GEX$/i.test((c.textContent || '').trim()));
    const cs = gex && getComputedStyle(gex); const ae = document.activeElement;
    return { setValue: document.querySelector('select[aria-label="Strategy set"]')?.value, counter: document.querySelector('.strat-count')?.textContent?.trim() ?? null, planChip: document.querySelector('.strat-aux')?.textContent?.trim(), chipsOn: chips.filter((c) => c.on).map((c) => c.label), chipCount: chips.length, notYet: chips.filter((c) => c.notyet).length,
      gex: gex && { on: gex.classList.contains('on'), pressed: gex.getAttribute('aria-pressed'), focusedNow: ae === gex, matchesFocusVisible: gex.matches(':focus-visible'), hover: gex.matches(':hover'), border: cs.borderTopColor + ' ' + cs.borderTopWidth + ' ' + cs.borderTopStyle, outline: cs.outlineStyle + ' ' + cs.outlineColor + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow, background: cs.backgroundColor, color: cs.color },
      activeElement: ae && (ae.tagName.toLowerCase() + '.' + String(ae.className).slice(0, 40) + ' ' + (ae.textContent || '').trim().slice(0, 20)),
      chartCanvases: document.querySelectorAll('canvas').length };
  });
  const tag = `${B.tag}-${plan}-${theme}-${w}`;
  await page.screenshot({ path: `${dir}/${tag}-viewport.png` });
  await page.screenshot({ path: `${dir}/${tag}-full.png`, fullPage: true });
  const panel = page.locator('.strat-panel').first(); if (await panel.count()) await panel.screenshot({ path: `${dir}/${tag}-panel.png` }).catch(() => {});
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  console.log(JSON.stringify({ build: v.commit, plan, theme, w, setBefore: before, ...snap }, null, 1));
  await ctx.close();
} finally { await browser.close(); }
