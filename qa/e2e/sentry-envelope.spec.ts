/* #2239 acceptance 4 (PRE-MERGE half): one deliberate BROWSER error through the real Sentry client of a LOCAL build, captured at a fake ingest
 * host, then judged for what it carries. Dispatch with `sentry_dsn=https://k@ingest.invalid/1` and spec=qa/e2e/sentry-envelope.spec.ts: that input
 * builds the app with monitoring ON (a non-'dev' app env, because monitoringDsn() suppresses every dev build on purpose, #57). Without it the cells
 * SKIP and say so, they do not pass.
 *
 *   E0  CONTROL: the leak checker flags a fabricated dirty envelope and passes a clean one (a checker that cannot fail proves nothing)
 *   E1  one thrown error reaches the ingest host as an envelope with an exception event that has stack frames
 *   E2  that envelope carries none of the sentinels the page was loaded with (cookie value, query-string token and email, a typed email) and
 *       no IP address, no cookie or authorization header, no request body, no query string
 *
 * WHAT THIS DOES NOT SHOW: a SERVER error (no safe unhandled route to throw from, and no seam without app code), and a READABLE stack (source maps
 * are not uploaded from CI, so frames are minified chunk names with line numbers; "readable" is judged in GlitchTip after a real release).
 * Nothing leaves the runner: the ingest host does not resolve and every request to it is fulfilled here. */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const DSN_ON = process.env.QA_SENTRY_ENVELOPE === '1';
const SENTINELS = ['COOKIE-SENTINEL-8841', 'TOKEN-SENTINEL-7730', 'qa.sentinel@example.com', 'typed.sentinel@example.com'];

/** What an envelope must NOT contain. Returns the leaks it found, empty when clean. */
function leaks(envelope: string): string[] {
  const out: string[] = [];
  for (const s of SENTINELS) if (envelope.includes(s)) out.push(`sentinel ${s}`);
  if (/"ip_address"\s*:\s*"(?!\{\{auto\}\})[^"]+"/.test(envelope)) out.push('an ip_address value');
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(envelope.replace(/"(?:version|release|sdk)[^"]*"\s*:\s*"[^"]*"/g, ''))) out.push('an IPv4-looking address');
  if (/"cookies?"\s*:\s*(?:\{[^}]|"[^"])/i.test(envelope)) out.push('a cookies object or string');
  if (/"(?:authorization|cookie|x-forwarded-for|x-real-ip)"\s*:/i.test(envelope)) out.push('a cookie, authorization or forwarding header');
  if (/"data"\s*:\s*(?:\{[^}]|"[^"])/.test(envelope) && /"request"\s*:/.test(envelope) && /"request"\s*:\s*\{[^}]*"data"/.test(envelope)) out.push('a request body');
  if (/"query_string"\s*:\s*(?:"[^"]+"|\{[^}]|\[[^\]])/.test(envelope)) out.push('a query string');
  if (/"url"\s*:\s*"[^"]*\?[^"]*"/.test(envelope)) out.push('a URL carrying a query string');
  if (/"email"\s*:\s*"[^"]+"/.test(envelope)) out.push('an email field');
  return out;
}

test.describe('#2239 monitoring envelope (browser, fake ingest host)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('E0. CONTROL: the checker flags a dirty envelope and passes a clean one', () => {
    const dirty = JSON.stringify({ user: { email: 'a@b.co', ip_address: '10.1.2.3' }, request: { url: 'https://x/y?token=TOKEN-SENTINEL-7730', cookies: { s: 'COOKIE-SENTINEL-8841' }, headers: { Cookie: 'x' }, query_string: 'a=1', data: 'body' } });
    const found = leaks(dirty);
    expect(found.length, 'the checker found nothing in a deliberately dirty envelope: it cannot fail').toBeGreaterThanOrEqual(5);
    const clean = JSON.stringify({ exception: { values: [{ type: 'Error', value: 'qa', stacktrace: { frames: [{ filename: 'app:///_next/static/chunks/a.js', lineno: 1 }] } }] }, request: { url: 'https://liquidity-hq.com/' }, user: { ip_address: '{{auto}}' } });
    expect(leaks(clean), 'the checker flagged a clean envelope').toEqual([]);
  });

  test('E1+E2. one thrown browser error arrives with stack frames and carries nothing about the person', async ({ browser }) => {
    test.skip(!DSN_ON, 'dispatched without sentry_dsn, so this build has monitoring OFF: nothing was measured (UNPROVEN)');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const bodies: string[] = [];
    await ctx.route(/ingest\.invalid/, async (route) => {
      const req = route.request();
      if (req.method() === 'POST') bodies.push(req.postData() ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    });
    await ctx.addCookies([{ name: 'qa_sentinel', value: 'COOKIE-SENTINEL-8841', url: process.env.E2E_BASE_URL || 'http://localhost:3000' }]);
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/?token=TOKEN-SENTINEL-7730&email=qa.sentinel%40example.com');
      await page.waitForTimeout(4_000);
      const marker = 'qa-sentry-envelope-' + Date.now();
      await page.evaluate((m) => { setTimeout(() => { throw new Error(m + ' typed.sentinel@example.com'); }, 0); }, marker);
      await expect.poll(() => bodies.filter(b => b.includes(marker.slice(0, 20))).length, { timeout: 30_000, message: 'no envelope with the thrown error arrived at the ingest host (monitoring on? CSP?)' }).toBeGreaterThan(0);
      const env = bodies.find(b => b.includes(marker.slice(0, 20)))!;
      mkdirSync('qa/.shots', { recursive: true });
      writeFileSync('qa/.shots/sentry-envelope.txt', env.replace(/(sentinel[^\s"]*)/gi, '<sentinel>').slice(0, 6000));

      const lines = env.split('\n').filter(Boolean);
      const payloads = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const event = payloads.find(p => p && p.exception);
      expect(event, 'the envelope has no exception event').toBeTruthy();
      const frames = event.exception.values?.[0]?.stacktrace?.frames ?? [];
      console.log(`[E1] envelope items=${payloads.length} exception frames=${frames.length} first=${JSON.stringify(frames[frames.length - 1] ?? null).slice(0, 160)} environment=${event.environment} release=${event.release ?? 'none'}`);
      expect(frames.length, 'the event has no stack frames').toBeGreaterThan(0);
      expect(frames.some((f: { filename?: string; abs_path?: string }) => !!(f.filename || f.abs_path)), 'no frame names a file').toBe(true);

      const found = leaks(env);
      console.log(`[E2] leaks=${JSON.stringify(found)} request=${JSON.stringify(event.request ?? null).slice(0, 300)} user=${JSON.stringify(event.user ?? null)} sdk=${JSON.stringify(event.sdk ?? null).slice(0, 120)}`);
      expect(found, 'the envelope carries something about the person').toEqual([]);
    } finally { await ctx.close(); }
  });
});
