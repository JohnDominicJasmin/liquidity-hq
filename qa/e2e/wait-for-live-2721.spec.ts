/* #2721 LIVE WAIT_FOR LENGTH (SIX BILLED QUICK READS, approved by PM 2026-11-20 as option A: qa only, one coin and timeframe, the Pro fixture, about $0.08 in all): six real Quick reads of BTC 1h, each in a FRESH browser context so the page's own cache cannot answer the next one.
 * Expectation (from #2721): the WAIT_FOR field is ONE line of at most 15 words, required when SIGNAL is FLAT, LEAN BULLISH or LEAN BEARISH and N/A when it is BULLISH or BEARISH.
 *   W1 every read answers 200   W2 every read that has a WAIT_FOR other than N/A: one line, at most 15 words   W3 N/A only on BULLISH / BEARISH, and a FLAT / LEAN read never answers N/A
 * Only /api/grok is let through (one POST per read), every other paid route stays fenced. Skipped unless E2E_ALLOW_BILLED_CALLS=1 (set on the test ref only). Prints each read's SIGNAL, its WAIT_FOR text and word count; the paid text is printed BEFORE any assertion so a failure never loses it. */
import { test, expect, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
test.skip(!BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON);

const READS = 6;
async function oneRead(browser: Browser, n: number): Promise<{ body: string; status: number }> {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 1000 });
  await installPaidAiFence(page);
  await page.route('**/api/grok', (route) => route.continue());   // registered after the fence: wins for this one path
  try {
    await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
    await expect(page.locator('.plan-badge-pro').first(), 'the Pro plan never resolved').toBeVisible({ timeout: 60_000 }); await page.waitForTimeout(3_000);
    const resp = page.waitForResponse((r) => /\/api\/grok(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 120_000 });
    await page.locator('button.arena-quick-btn').first().click();
    const r = await resp; const body = await r.text().catch(() => ''); await page.waitForTimeout(3_000);
    await page.screenshot({ path: `qa/.shots/waitfor-live-${n}.png` }).catch(() => {});
    return { body, status: r.status() };
  } finally { await ctx.close().catch(() => {}); }
}
const unescape = (s: string) => s.replace(/\\n/g, String.fromCharCode(10)).replace(/\\"/g, '"');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

test('WF six live Quick reads: the WAIT_FOR line is one line of at most 15 words', async ({ browser }) => {
  test.setTimeout(1_200_000);
  const reads: Array<{ n: number; status: number; signal: string; waitFor: string | null; words: number; lines: number }> = [];
  for (let n = 1; n <= READS; n++) {
    const { body, status } = await oneRead(browser, n);
    const text = unescape(body);
    const signal = (/SIGNAL:\s*([A-Z ]+?)\s*(?:\n|CONFIDENCE|$)/.exec(text) || [, ''])[1].trim();
    const m = /WAIT_FOR:\s*([\s\S]*?)(?:\n[A-Z_]{3,}:|"\s*[,}]|$)/.exec(text);
    const waitFor = m ? m[1].trim() : null;
    reads.push({ n, status, signal, waitFor, words: waitFor ? words(waitFor) : 0, lines: waitFor ? waitFor.split(String.fromCharCode(10)).filter((l) => l.trim()).length : 0 });
    console.log(`[WF] read ${n}: HTTP ${status} · SIGNAL "${signal}" · WAIT_FOR (${waitFor ? words(waitFor) : 0} words, ${waitFor ? waitFor.split(String.fromCharCode(10)).filter((l) => l.trim()).length : 0} lines): ${waitFor === null ? '(none found)' : waitFor.slice(0, 220)} · body ${body.length} chars`);
    if (n < READS) await new Promise((r) => setTimeout(r, 15_000));
  }
  const bad: string[] = [];
  for (const r of reads) {
    if (r.status !== 200) { bad.push(`read ${r.n}: HTTP ${r.status}`); continue; }
    const na = r.waitFor !== null && /^N\/A\b/i.test(r.waitFor);
    const directional = /^(BULLISH|BEARISH)$/.test(r.signal);
    if (r.waitFor === null) { bad.push(`read ${r.n}: no WAIT_FOR field found (signal "${r.signal}")`); continue; }
    if (!na && r.words > 15) bad.push(`read ${r.n}: WAIT_FOR is ${r.words} words`);
    if (!na && r.lines > 1) bad.push(`read ${r.n}: WAIT_FOR spans ${r.lines} lines`);
    if (na && !directional) bad.push(`read ${r.n}: N/A on a ${r.signal} read (required there)`);
  }
  const over = reads.filter((r) => r.words > 15 && !(r.waitFor && /^N\/A\b/i.test(r.waitFor))).length;
  console.log(`[WF] SUMMARY: ${reads.length} reads · signals ${JSON.stringify(reads.map((r) => r.signal))} · word counts ${JSON.stringify(reads.map((r) => r.words))} · over 15 words: ${over}`);
  expect(bad, 'WAIT_FOR rule violations (#2721)').toEqual([]);
});
