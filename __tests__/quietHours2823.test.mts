/* QA: PR #2823 (#1185 owner item 44). The quiet period lists its next windows.
 *   Q1 on a weekday inside the quiet period the session rules answer: quiet, no active window, three windows ahead, London Open first at 07:00 UTC
 *   Q2 the page asks for them whenever no window is active, the quiet period included */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDead, getCurrentWindow, getUpcomingWindows } from '../lib/session';

test('Q1. quiet period: no active window, three ahead, London Open first', () => {
  for (const at of ['2026-11-25T04:00:00Z', '2026-11-25T05:00:00Z', '2026-11-25T06:59:00Z']) {
    const now = new Date(at);
    assert.equal(isDead(now), true, at);
    assert.equal(getCurrentWindow(now), null, at);
    const next = getUpcomingWindows(now, 3);
    assert.equal(next.length, 3, at);
    assert.equal(next[0].win.name, 'London Open', at);
    assert.equal(new Date(now.getTime() + next[0].diffMs).toISOString().slice(11, 16), '07:00', at);
  }
});

test('Q2. the page lists them in the quiet period', () => {
  const page = readFileSync(new URL('../app/(main)/hours/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(page.includes('const upcoming = !win ? getUpcomingWindows(now, 3) : [];'));
  assert.equal(page.includes('(!win && !dead) ? getUpcomingWindows'), false);
});
