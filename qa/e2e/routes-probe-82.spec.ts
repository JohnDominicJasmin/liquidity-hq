/* QA #82, test ref only: where each swept route ends up on a runner build, signed out, plus the five pages to be added. Prints [R82] lines. */
import { test, expect } from '@playwright/test';
import { ROUTES, gotoGuarded } from './_shared';

const ADD = ['/help', '/changelog', '/security', '/status', '/accessibility'];
test.describe.configure({ timeout: 900_000, retries: 0 });
test('where every swept route ends up', async ({ page }, testInfo) => {
  for (const route of [...ROUTES, ...ADD]) {
    const r = await gotoGuarded(page, route, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000);
    const end = new URL(page.url()).pathname; const h1 = (await page.locator('h1').first().innerText({ timeout: 2_000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 40);
    console.log(`[R82] ${testInfo.project.name} ${route}: status=${r?.status()} ends=${end}${end === route ? '' : ' MOVED'} h1=${JSON.stringify(h1)}`);
    expect.soft(r?.status() ?? 0, route).toBeLessThan(400);
  }
});
