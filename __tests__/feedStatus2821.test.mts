/* QA: PR #2821 (#1651 owner item 32), a chip says when prices are not live. The REAL feedState runs; the component and provider wiring are read from source.
 *   F1 nothing while live or on a page with no feed
 *   F2 "backup" while the backup answers
 *   F3 "delayed" after exactly 10 s of connecting (not at 9.999 s), or whenever the price read failed
 *   F4 the chip draws only with a state, keeps its live region mounted, and leaves "as of" out when no price was seen
 *   F5 a dropped live socket stops reading "Live"; it is mounted once, in the app shell */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedState, CONNECTING_GRACE_MS } from '../lib/feedStatus.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('F1. live and no-feed pages say nothing', () => {
  for (const ms of [0, CONNECTING_GRACE_MS, 10 * 60_000]) assert.equal(feedState('Live', false, ms), null);
  for (const failed of [false, true]) assert.equal(feedState('Idle', failed, 10 * 60_000), null, 'a page with no market feed');
});

test('F2. the backup is named', () => { assert.equal(feedState('Live · backup feed', false, 0), 'backup'); });

test('F3. delayed after ten seconds of connecting, or on a failed read', () => {
  assert.equal(CONNECTING_GRACE_MS, 10_000);
  assert.equal(feedState('Connecting...', false, 0), null); assert.equal(feedState('Connecting...', false, 9_999), null); assert.equal(feedState('Connecting...', false, 10_000), 'delayed');
  for (const status of ['Connecting...', 'Live', 'Live · backup feed']) assert.equal(feedState(status, true, 0), 'delayed', status);
});

test('F4. the chip', () => {
  const s = read('components/FeedStatusChip.tsx');
  assert.match(s, /<div role="status" className="feed-status-region" data-testid="feed-status-region">\s*\{state && \(/, 'the live region must stay mounted with the chip inside it');
  assert.match(s, /\{priceAt != null && <> · \{t\('FEED_STATUS_AS_OF'/);
  assert.ok(s.includes("const state = feedState(store.wsStatus, store.pricesFailed, connecting && waited ? CONNECTING_GRACE_MS : 0);"));
  assert.ok(s.includes('setTimeout(() => setWaited(true), CONNECTING_GRACE_MS)') && s.includes('return () => clearTimeout(timer);'));
});

test('F5. wiring', () => {
  assert.ok(read('components/MarketProvider.tsx').includes("setStore(s => (s.wsStatus === 'Live' ? { ...s, wsStatus: 'Connecting...' } : s));"));
  const shell = read('components/AppShell.tsx');
  assert.equal((shell.match(/<FeedStatusChip \/>/g) ?? []).length, 1);
  const d = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.ok(d.FEED_STATUS_BACKUP && d.FEED_STATUS_DELAYED && d.FEED_STATUS_AS_OF.includes('{time}'));
});
