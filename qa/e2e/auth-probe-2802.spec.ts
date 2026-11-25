/* QA (dispatch-only, qa / staging): PR #2802 through the signed-in PAGE. On a gated host the runner's `request` fixture cannot send a user's bearer token (the site gate's own credential takes the Authorization header), so every such call answers 401: the calls are made by the page. One push subscription with a made-up endpoint is stored for the Pro fixture and removed again. Prints statuses only. */
import { test, expect, type Browser } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site');
async function calls(browser: Browser, who: 'a' | 'b', steps: Array<[string, 'POST' | 'DELETE']>) {
  const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await gotoSignedIn(page, '/settings'); await page.waitForTimeout(6_000);
    const out: string[] = [];
    for (const [label, method] of steps) {
      out.push(`${label}: ${await page.evaluate(async (m) => {
        const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)); const t = key ? (JSON.parse(localStorage.getItem(key) as string) as { access_token?: string }).access_token : '';
        const endpoint = 'https://fcm.googleapis.com/fcm/send/qa-batch-1128';
        const res = await fetch('/api/push/subscribe', { method: m, headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(m === 'POST' ? { endpoint, keys: { p256dh: 'qaKeyBatch1128', auth: 'qaAuthBatch1128' } } : { endpoint }) });
        return `${res.status} ${(await res.text()).slice(0, 90)}`;
      }, method)}`);
    }
    return out;
  } finally { await ctx.close().catch(() => {}); }
}
test('AP push subscribe from the page: Free refused, Pro stores and removes', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(240_000);
  const free = await calls(browser, 'b', [['free subscribe', 'POST']]);
  const pro = await calls(browser, 'a', [['pro subscribe', 'POST'], ['pro unsubscribe', 'DELETE']]);
  for (const l of [...free, ...pro]) console.log(`[AP] ${l}`);
  expect.soft(free[0]).toMatch(/^free subscribe: 403 .*PRO_REQUIRED/); expect.soft(pro[0]).toMatch(/: 200 /); expect.soft(pro[1]).toMatch(/: 200 /);
});
