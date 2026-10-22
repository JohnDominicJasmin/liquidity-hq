const fs = require('fs');
let s = fs.readFileSync('upgrade-shots.mjs', 'utf8');
const rep = (from, to) => { if (s.split(from).length !== 2) throw new Error('anchor: ' + from.slice(0, 50)); s = s.replace(from, () => to); };
rep("    await page.waitForTimeout(1500);\n",
`    await page.waitForTimeout(1500);
    // the cookie banner is fixed to the bottom of the viewport and would cover the plan buttons: decline it (fresh context, no effect on anyone)
    const decline = page.getByRole('button', { name: 'Decline' });
    if (await decline.count()) { await decline.first().click(); await page.waitForTimeout(600); }
    // phone: what a visitor really sees while scrolling, fixed bars included
    if (v.isMobile) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let n = 0, y = 0; y < h && n < 4; n++, y += v.viewport.height - 60) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(400);
        await page.screenshot({ path: OUT + '/upgrade-qa-' + theme + '-phone-scroll-' + (n + 1) + '.png' });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // full-page capture: fixed bars (bottom nav, Ask AI, banner) would land in the MIDDLE of a stitched image, so hide them for the layout view
    await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'; } });
`);
rep("const file = `${OUT}/upgrade-qa-${theme}-${v.name}.png`;", "const file = `${OUT}/upgrade-qa-${theme}-${v.name}-fullpage.png`;");
fs.writeFileSync('upgrade-shots.mjs', s);
console.log('patched');
