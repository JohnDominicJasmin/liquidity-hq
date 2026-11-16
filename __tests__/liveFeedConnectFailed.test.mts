/* #2420, source anchors (the components have no DOM harness here; the rendered proof is qa/e2e/live-feed-connect-failed.spec.ts):
 *   the 8 s timer runs only while NO socket is live and is cleared when one goes live (the line goes away); a connected quiet market keeps its "Watching" line; the failure line replaces the skeletons at the same
 *   106 px height (no layout shift); both new keys have English text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const LIQ = read('components/LiqFeed.tsx'), WHALE = read('components/WhaleTradesFeed.tsx');
const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;

test('C1. LiqFeed: the 8 s timer runs only while neither socket is live, is cleared on cleanup, and resets when one goes live', () => {
  assert.ok(LIQ.includes("const noneLive = bnStatus !== 'live' && bbStatus !== 'live';"), 'CONTROL: noneLive moved');
  assert.ok(LIQ.includes('if (!noneLive) { setConnectWaited(false); return; }'), 'the failure line does not go away when a socket goes live');
  assert.ok(LIQ.includes('const id = setTimeout(() => setConnectWaited(true), 8_000);') && LIQ.includes('return () => clearTimeout(id);'), 'the 8 s wait or its cleanup changed');
  assert.ok(LIQ.includes('}, [noneLive]);'), 'the effect does not re-run when liveness changes');
});
test('C2. WhaleTradesFeed: the same rule on its own status, and the failure line replaces the skeletons only after the wait', () => {
  assert.ok(WHALE.includes("if (status === 'live') { setConnectWaited(false); return; }"), 'the line does not go away when the socket is live');
  assert.ok(WHALE.includes('const id = setTimeout(() => setConnectWaited(true), 8_000);'), 'the 8 s wait changed');
  assert.ok(WHALE.includes("feed.length === 0 && status !== 'live' && connectWaited"), 'the failure line is not tied to a feed that is still empty and not live');
  assert.ok(WHALE.includes("feed.length === 0 && status === 'connecting' && !connectWaited"), 'the skeletons are no longer limited to the first 8 s');
});
test('C3. no layout shift (same 106 px height), the test ids exist, and both keys have English text that says it is retrying', () => {
  assert.equal((LIQ.match(/data-testid="liq-feed-connect-failed" style=\{\{ minHeight: 106/g) ?? []).length, 1); assert.equal((WHALE.match(/data-testid="whale-feed-connect-failed" style=\{\{ minHeight: 106/g) ?? []).length, 1);
  for (const k of ['LIQ_FEED_CONNECT_FAILED', 'WHALE_TRADES_FEED_CONNECT_FAILED']) { assert.match(en[k] ?? '', /could not connect/i, `${k}: no English text`); assert.match(en[k], /retry/i, `${k} does not say it is retrying`); }
});
test('C4. a connected, quiet market keeps the existing "Watching" copy (the connect-failed line is only after the wait AND while not live)', () => {
  assert.ok(LIQ.includes("anyLive ? t('LIQ_FEED_SR_WATCHING'"), 'the Watching line was lost');
  assert.ok(LIQ.indexOf("anyLive ? t('LIQ_FEED_SR_WATCHING'") < LIQ.indexOf("connectWaited ? t('LIQ_FEED_CONNECT_FAILED')"), 'a live feed can read as failed');
});
