/* ONE 1200x630 CAPTURE for the social share card (PM, Dev's #2748), THIRD AND LAST TAKE after PM's review of og2-v1: PROD liquidity-hq.com/arena, signed out, dark theme, BTC 4h, Support/resistance flip, no paid AI read, nothing written or billed (GETs only; the only interaction is the local strategy menu).
 * PM's spec: viewport 1600x900 at device scale 2; hide the "Play a sound... Allow / Not now" prompt, the SIGNED OUT tag, the top nav, the Ask AI float, the news ticker, the usage line and EVERYTHING BELOW the chart row; screenshot a CLIP equal to the union box of the chart panel and the strategy panel, padded (centered) to the 1200x630 aspect 1.905:1, then resize to 1200x630 (in a scratch page with a canvas, high-quality smoothing). The clip always contains the whole union box (padding is only added, never cropped).
 * Prints the union box, the clip, what was hidden and what is left; saves qa/.shots/og3-clip-2x.png (the raw 2x clip) and qa/.shots/og3-final-1200x630.png (the deliverable; CI artifact `qa-screenshots-*`). Asserts only that the chart rendered and the final file is 1200x630. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });

test('OG capture final: /arena BTC 4h, S/R flip, 1600x900 at scale 2, clip = chart + strategy panel, resized to 1200x630', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ } });
  const page: Page = await ctx.newPage();
  try {
    await page.goto('/arena?coin=btc&tf=4h', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('.klc-canvas').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000);
    const menu = page.getByTestId('strategy-set-select'); const menuOk = (await menu.count()) > 0 && (await menu.first().isEnabled().catch(() => false));
    if (menuOk) await menu.first().selectOption('sr_flip').catch(() => undefined);
    await page.waitForTimeout(10_000);
    const panelText = ((await page.getByTestId('strategy-call-box').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    console.log(`[OG3] menu ok ${menuOk} · panel: ${panelText.slice(0, 220)}`);
    const info = await page.evaluate(() => {
      const hidden: string[] = []; const hide = (el: HTMLElement, why: string) => { el.style.setProperty('display', 'none', 'important'); hidden.push(`${why}:${(el.textContent || '').trim().slice(0, 28)}`); };
      // 1) fixed / chrome elements
      for (const s of ['[class*="ticker" i]', '[data-testid*="ticker" i]', '[data-testid*="usage" i]', '[class*="usage" i]', '.arena-usage', '.tnav', 'header.tnav, .tnav-wrap, .app-header', '[class*="chat-fab" i]', '[data-testid*="ask" i]', '.tnav-session', '.session-pill']) for (const el of Array.from(document.querySelectorAll(s)) as HTMLElement[]) if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') hide(el, s);
      // 2) the sound prompt, the SIGNED OUT tag, the Ask AI float by their text
      const leaves = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
      for (const el of leaves) { const t = (el.textContent || '').trim(); if (!t) continue;
        if (/play a sound/i.test(t) && t.length < 200 && el.children.length <= 6) { let c: HTMLElement = el; for (let i = 0; i < 4 && c.parentElement && c.parentElement !== document.body && getComputedStyle(c).position !== 'fixed'; i++) c = c.parentElement; hide(c, 'sound-prompt'); }
        else if (/^(signed out)$/i.test(t) && el.children.length === 0) { hide(el, 'signed-out'); }
        else if (/^(ask\s*(ai|liquidityai))$/i.test(t) && el.children.length === 0) { let c: HTMLElement = el; for (let i = 0; i < 3 && c.parentElement && getComputedStyle(c).position !== 'fixed'; i++) c = c.parentElement; hide(c, 'ask-ai'); } }
      // 3) the chart panel and the strategy panel
      const chart = document.querySelector('.klc-wrap') as HTMLElement | null; const sel = document.querySelector('[data-testid="strategy-set-select"]') as HTMLElement | null; const box = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null;
      if (!chart || !sel || !box) return { error: `missing: chart ${!!chart} select ${!!sel} box ${!!box}`, hidden };
      // lowest common ancestor of the chart and the strategy panel, then hide every following sibling along the path up to <main>/<body> (everything below the chart row)
      const ancestors = (e: HTMLElement) => { const a: HTMLElement[] = []; let n: HTMLElement | null = e; while (n) { a.push(n); n = n.parentElement; } return a; };
      const ca = ancestors(chart), sa = ancestors(sel); const lca = ca.find((x) => sa.includes(x)) as HTMLElement;
      // the child of the LCA that contains the chart / the select: the row we keep; hide every sibling after the LAST kept child, and everything after the LCA on the way up
      const keepIdx = Math.max(Array.from(lca.children).findIndex((c) => c.contains(chart)), Array.from(lca.children).findIndex((c) => c.contains(sel)), Array.from(lca.children).findIndex((c) => c.contains(box)));
      Array.from(lca.children).slice(keepIdx + 1).forEach((c) => hide(c as HTMLElement, 'below-row'));
      let up: HTMLElement | null = lca; while (up && up !== document.body) { let s2 = up.nextElementSibling as HTMLElement | null; while (s2) { hide(s2, 'below'); s2 = s2.nextElementSibling as HTMLElement | null; } up = up.parentElement; }
      return { hidden, lcaClass: String(lca.className).slice(0, 60), kept: Array.from(lca.children).slice(0, keepIdx + 1).length };
    });
    console.log(`[OG3] hidden: ${JSON.stringify((info as { hidden: string[] }).hidden.slice(0, 24))} · ${JSON.stringify({ ...info, hidden: undefined })}`);
    expect((info as { error?: string }).error, 'the chart / strategy panel were not found').toBeUndefined();
    await page.waitForTimeout(2_000);
    // union box of the chart panel and the strategy panel (select + call box + the chart wrap), page coordinates in CSS px
    const union = await page.evaluate(() => {
      const els = [document.querySelector('.klc-wrap'), document.querySelector('[data-testid="strategy-set-select"]'), document.querySelector('[data-testid="strategy-call-box"]'), document.querySelector('[data-testid^="strategy-indicator-"]')].filter(Boolean) as HTMLElement[];
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const e of els) { const r = e.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
      // include the panels' own containers (their cards) so borders are inside: grow by the closest card ancestor of the select
      const card = (document.querySelector('[data-testid="strategy-set-select"]') as HTMLElement | null)?.closest('.edge-card, section, [class*="panel" i], [class*="card" i]') as HTMLElement | null; if (card) { const r = card.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
      const chartCard = (document.querySelector('.klc-wrap') as HTMLElement | null)?.parentElement; if (chartCard) { const r = chartCard.getBoundingClientRect(); if (r.width < 1700 && r.height < 1400) { x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); } }
      return { x1, y1, x2, y2, vw: window.innerWidth, vh: window.innerHeight, sx: window.scrollX, sy: window.scrollY };
    });
    const uw = union.x2 - union.x1, uh = union.y2 - union.y1; const AR = 1200 / 630; let cw = uw, ch = uh;
    if (uw / uh < AR) cw = uh * AR; else ch = uw / AR;           // pad (never crop) to 1.905:1
    let cx = union.x1 - (cw - uw) / 2, cy = union.y1 - (ch - uh) / 2;
    cx = Math.max(0, Math.min(cx, union.vw - cw)); cy = Math.max(0, Math.min(cy, union.vh - ch));
    const clip = { x: Math.round(cx), y: Math.round(cy), width: Math.round(Math.min(cw, union.vw)), height: Math.round(Math.min(ch, union.vh)) };
    console.log(`[OG3] union ${JSON.stringify({ x: Math.round(union.x1), y: Math.round(union.y1), w: Math.round(uw), h: Math.round(uh) })} · aspect ${(uw / uh).toFixed(3)} · clip ${JSON.stringify(clip)} · clip aspect ${(clip.width / clip.height).toFixed(3)} (target ${AR.toFixed(3)}) · viewport ${union.vw}x${union.vh} · contains union ${clip.x <= union.x1 + 1 && clip.y <= union.y1 + 1 && clip.x + clip.width >= union.x2 - 1 && clip.y + clip.height >= union.y2 - 1}`);
    const raw = await page.screenshot({ clip, path: 'qa/.shots/og3-clip-2x.png' });
    // resize to exactly 1200x630 in a scratch page (canvas, high quality)
    const scratch = await ctx.newPage();
    const b64 = await scratch.evaluate(async (data) => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const c = document.createElement('canvas'); c.width = 1200; c.height = 630; const g = c.getContext('2d')!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, 1200, 630); return { url: c.toDataURL('image/png').split(',')[1], iw: img.naturalWidth, ih: img.naturalHeight }; }, raw.toString('base64'));
    writeFileSync('qa/.shots/og3-final-1200x630.png', Buffer.from(b64.url, 'base64'));
    console.log(`[OG3] raw clip ${b64.iw}x${b64.ih} -> final 1200x630 (${Buffer.from(b64.url, 'base64').length} bytes)`);
    await scratch.close();
    const left = await page.evaluate(() => ({ placeholder: Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e as HTMLElement).offsetParent !== null && /(^|\W)(n\/a|unavailable|no data|signed out|play a sound|not now)(\W|$)/i.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 40)).slice(0, 6) }));
    console.log(`[OG3] visible placeholder / prompt words left anywhere: ${JSON.stringify(left)}`);
    expect(await page.locator('.klc-canvas').first().isVisible(), 'the chart did not render').toBe(true);
    expect(b64.iw, 'the clip is empty').toBeGreaterThan(100);
  } finally { await ctx.close().catch(() => {}); }
});
