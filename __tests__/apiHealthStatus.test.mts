import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHealthStatus, knownBlockedReason, KNOWN_BLOCKED, STATUS_RANK } from '../lib/apiHealthStatus.ts';

/* #176. rss:CryptoSlate has 14,234 consecutive failures and last_ok_at NULL,
 * and /ops sorts worst-first - so it held the top row permanently and anything
 * that broke today appeared underneath it. QA's framing, which is the right one:
 * a signal nobody can read stops being a signal.
 *
 * The feed itself is kept on purpose (lib/newsFeeds.ts, 2026-07-31): 403 from
 * Render's datacenter IP, 200 elsewhere, so it can recover with no deploy.
 */

const base = { source: 'rss:BBC', ok: true, consecutiveFailures: 0, stale: false, successRate: null };

test('ordinary sources are unchanged', async (t) => {
  await t.test('healthy is ok', () => {
    assert.equal(deriveHealthStatus(base), 'ok');
  });

  await t.test('three consecutive failures is down, not a blip', () => {
    assert.equal(deriveHealthStatus({ ...base, ok: false, consecutiveFailures: 3 }), 'down');
    assert.equal(deriveHealthStatus({ ...base, ok: false, consecutiveFailures: 2 }), 'warn');
  });

  await t.test('a low success rate warns even while the last call succeeded', () => {
    assert.equal(deriveHealthStatus({ ...base, successRate: 79 }), 'warn');
    assert.equal(deriveHealthStatus({ ...base, successRate: 80 }), 'ok');
  });
});

test('a known-blocked source does not bury the others', async (t) => {
  const cs = { ...base, source: 'rss:CryptoSlate', ok: false, consecutiveFailures: 14234 };

  await t.test('it is `known`, not `down`, however high the count', () => {
    assert.equal(deriveHealthStatus(cs), 'known');
    assert.equal(deriveHealthStatus({ ...cs, consecutiveFailures: 999999 }), 'known');
  });

  /* The whole point: it must sort BELOW anything that might need action. */
  await t.test('it sorts under down and warn, and above ok', () => {
    assert.ok(STATUS_RANK.down < STATUS_RANK.known);
    assert.ok(STATUS_RANK.warn < STATUS_RANK.known);
    assert.ok(STATUS_RANK.known < STATUS_RANK.ok);
  });

  /* If their WAF changes it starts succeeding, and that must read as recovered
     rather than stay flagged forever. */
  await t.test('it goes back to ok the moment it succeeds', () => {
    assert.equal(deriveHealthStatus({ ...cs, ok: true, consecutiveFailures: 0 }), 'ok');
  });

  /* 🔴 STALE OUTRANKS KNOWN. A known-blocked source that stops reporting at all
     means nothing is running the check - which is a real failure wearing the
     one label that would hide it. */
  await t.test('stale still wins over known', () => {
    assert.equal(deriveHealthStatus({ ...cs, stale: true }), 'warn');
    assert.equal(deriveHealthStatus({ ...base, stale: true }), 'warn');
  });
});

test('every known entry carries its reason', async (t) => {
  /* An entry with no reason is indistinguishable from giving up, and this list
     is the only place the decision is visible to whoever reads /ops. */
  await t.test('reasons are present and specific', () => {
    const entries = Object.entries(KNOWN_BLOCKED);
    assert.ok(entries.length > 0);
    for (const [source, reason] of entries) {
      assert.ok(reason.length > 40, `${source}'s reason is too thin to act on: "${reason}"`);
      assert.match(reason, /\d{4}-\d{2}-\d{2}|because|blocked|deliberate/i,
        `${source}'s reason should say WHY and when it was decided`);
    }
  });

  await t.test('an unlisted source has no reason', () => {
    assert.equal(knownBlockedReason('rss:BBC'), undefined);
    assert.ok(knownBlockedReason('rss:CryptoSlate'));
  });
});
