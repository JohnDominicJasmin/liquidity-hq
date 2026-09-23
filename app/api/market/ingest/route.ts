import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { recordApiHealth } from '@/lib/apiHealth';
import { MARKET_FEEDS } from '@/lib/marketFeeds';
import { writeSnapshot } from '@/lib/marketSnapshot';

/* The only thing in this app that calls an exchange for the snapshot feeds (#1404).
 *
 * Every five minutes, from cron-job.org - see docs/INFRASTRUCTURE.md §2 for the
 * entry, and note the header: `x-cron-secret`, POST, fail-CLOSED. With no
 * CRON_SECRET configured `checkCronAuth` denies, so an unscheduled or
 * misconfigured caller gets 401 rather than silently driving exchange traffic.
 *
 * Page requests read `lhq_market_snapshot`; only this route writes it, and the
 * table has no insert or update policy for anon or authenticated, so that
 * division is enforced by the database rather than by everyone remembering it.
 *
 * ── THE BAN RISK GOVERNS THE DESIGN, NOT JUST THE CADENCE ───────────────────
 *
 * Moving exchange calls server-side concentrates onto ONE egress IP what used
 * to be spread over every visitor's. That is not hypothetical here:
 * app/api/market/klines' header records Binance already banning the qa and
 * staging IPs for /v3/klines - `binance:klines ok=false detail="418/429 after
 * 0/45"`. A scheduled job is the same concentration with a metronome. So:
 *
 *   - Only the registered feeds, which is the closed set in lib/marketFeeds -
 *     never a symbol or interval taken from a request.
 *   - Feeds run SEQUENTIALLY, not Promise.all. Two 49-symbol fan-outs fired
 *     together is a 98-request burst from one address every five minutes, which
 *     is what a rate limiter is built to notice. The job has 300 seconds and
 *     needs about two, so there is nothing to win by hurrying.
 *   - A rate-limited or banned run WRITES NOTHING and keeps the previous row.
 *   - And it says so: `stopped` is recorded to api_health as a FAILURE with the
 *     partial count, so a ban is visible in the data instead of looking like a
 *     quiet market. #228's lesson - an empty 200 for hours while the health
 *     table knew - is the one being avoided.
 */

type FeedOutcome = {
  key: string;
  written: boolean;
  ok: number;
  total: number;
  stopped?: true;
  error?: string;
};

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const outcomes: FeedOutcome[] = [];
  const health: Parameters<typeof recordApiHealth>[0] = [];

  for (const feed of MARKET_FEEDS) {
    try {
      const { payload, source, ok, total, stopped } = await feed.fetchLive();

      /* A run cut short by a rate limit is not a success with fewer rows (#665),
         and a fan-out that produced nothing is an outage, not an empty market.
         Either way the previous row stands: overwriting good data with a partial
         or empty payload would degrade the page for everyone on the strength of
         one bad minute, which is the rule app/api/econ-calendar/ingest already
         follows for the calendar snapshot. */
      if (stopped || ok === 0) {
        outcomes.push({ key: feed.key, written: false, ok, total, ...(stopped ? { stopped: true } : {}) });
        health.push({
          source: feed.health,
          category: 'market',
          ok: false,
          detail: stopped ? `${ok}/${total} then rate-limited - kept previous snapshot` : `${ok}/${total} - kept previous snapshot`,
          items: ok,
        });
        continue;
      }

      await writeSnapshot(feed.key, payload, source);
      outcomes.push({ key: feed.key, written: true, ok, total });
      health.push({ source: feed.health, category: 'market', ok: true, detail: `${ok}/${total}`, items: ok });
    } catch (e) {
      /* One feed failing must not abandon the others - they are independent
         upstreams and a Bybit outage is not a reason to leave every row stale.
         The message only; no URL, which would carry parameters. */
      const message = e instanceof Error ? e.message : String(e);
      outcomes.push({ key: feed.key, written: false, ok: 0, total: 0, error: message.slice(0, 200) });
      health.push({ source: feed.health, category: 'market', ok: false, detail: message.slice(0, 200), items: 0 });
    }
  }

  await recordApiHealth(health);

  const written = outcomes.filter(o => o.written).length;
  /* 200 even when nothing was written: the job ran, and the scheduler's own
     success/failure should reflect whether the JOB is alive, not whether an
     exchange was answering. The per-feed detail is in the body and in
     api_health, which is where a failing upstream belongs. */
  return NextResponse.json({ ok: true, written, feeds: outcomes });
}
