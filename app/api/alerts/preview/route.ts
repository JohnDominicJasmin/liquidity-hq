import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { COINS, COIN_LABELS } from '@/lib/coins';
import { hasProFeatures } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rateLimit';
import { EMA_SIGNAL_TFS, type EMASignalTF, fetchRibbonCandles } from '@/lib/ribbonCandles';
import { detectEMASignals, DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS } from '@/lib/strategyCore';
import { detectStructureSignals } from '@/lib/priceAction';
import { STRUCTURE_TFS, isStructureEnabled } from '@/lib/structurePrefs';

export const dynamic = 'force-dynamic';

/* /alerts "Check Alerts Now" - answers "what would my alerts say right now"
   for the SIGNED-IN USER ONLY.
 *
 * Why this is not just a call to the alert cron. That route is
 * cron-authenticated, and deliberately so: it broadcasts to every connected
 * chat and burns external API budget, so exposing it to a browser hands any
 * visitor a button that messages every recipient on demand. That is exactly
 * what making the cron routes fail-closed (commit 7cfbb18) shut off - which is
 * also, silently, what broke this button. It had been returning 401 to every
 * user ever since, showing nothing but its own failure state.
 *
 * So the button gets its own route with the opposite properties:
 *
 *   - Reads the caller's Supabase JWT and answers only for that user.
 *   - Sends NOTHING. No Telegram, no push. Not "sends less" - there is no send
 *     path in this file at all, so it cannot regress into one.
 *   - Mutates NOTHING. In particular it never touches the cron's dedup maps.
 *     That matters more than it looks: those maps are what stop an already
 *     announced signal being announced again, so a preview that consumed a
 *     dedup slot would SUPPRESS the real alert that followed and the user
 *     would silently never receive it.
 *   - Rate-limited per user, because each press can fan out to a few dozen
 *     kline fetches.
 *
 * Scope: the EMA buy/sell rule and market-structure breaks. Those are the two
 * the user picks coins and timeframes for on this page, and both are pure
 * functions over candles, so the answer is exact. The cron's other rules (RSI,
 * whales, OI, news, funding) run off bulk market data gathered once per tick
 * for all coins at once; re-gathering it per button press would cost far more
 * than the question is worth. The UI says which rules this covers - it must
 * keep saying so, or "no conditions active" reads as a claim about everything.
 */

// Same freshness rule the structure alert uses: a signal is only "active right
// now" while it is still on one of the last few bars. Without this the answer
// would list a stale call on every coin - technically the latest signal, but
// possibly days old and useless as a "right now" readout.
const MAX_AGE_BARS = 3;

// Each press fans out to (coins x timeframes) kline fetches, capped by the
// page's own ALERT_COIN_CAP/ALERT_TF_CAP at 10 x 3 plus 10 x 2 structure.
const RATE_LIMIT = 4;
const RATE_WINDOW_MS = 60_000;

async function authedUserId(req: NextRequest): Promise<{ userId: string; token: string } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await sb.auth.getUser();
  return data.user?.id ? { userId: data.user.id, token } : null;
}

export async function POST(req: NextRequest) {
  const auth = await authedUserId(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { userId, token } = auth;

  // Alerts are a Pro feature - same gate the delivery paths apply, so a free
  // account cannot use this to get the signal stream the alerts would carry.
  if (!(await hasProFeatures(token, userId))) {
    return NextResponse.json({ error: 'Pro required' }, { status: 403 });
  }

  if (!rateLimit(`alerts-preview:${userId}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many checks. Wait a minute.' }, { status: 429 });
  }

  const admin = getSupabaseAdmin();
  const [prefsRes, settingsRes] = await Promise.all([
    admin.from(T.muted_alerts).select('key').eq('user_id', userId),
    admin.from(T.user_settings).select('anti_chop_enabled').eq('user_id', userId).maybeSingle(),
  ]);
  const keys = new Set<string>((prefsRes.data ?? []).map(r => String(r.key)));
  const antiChop = settingsRes.data?.anti_chop_enabled === true;

  // Opt-out for coins and EMA timeframes (a row means muted), opt-IN for
  // structure (a row means enabled) - see lib/structurePrefs.ts.
  const coins = COINS.filter(c => !keys.has(`coin:${c}`));
  const emaTfs = EMA_SIGNAL_TFS.filter(tf => !keys.has(`ema_signal_${tf}`));
  const structTfs = STRUCTURE_TFS.filter(tf => isStructureEnabled(keys, tf));

  if (coins.length === 0) {
    return NextResponse.json({ fired: [], note: 'no coins selected' });
  }

  const fired: string[] = [];

  // One fetch per (coin, timeframe), shared by both rules where the timeframe
  // overlaps, so enabling structure on a timeframe the EMA rule already covers
  // costs nothing extra.
  const tfs = Array.from(new Set<string>([...emaTfs, ...structTfs])) as EMASignalTF[];

  await Promise.all(coins.flatMap(coin => tfs.map(async tf => {
    try {
      const candles = await fetchRibbonCandles(coin, tf);
      if (candles.length < 55) return;   // same runway the chart's own hook needs
      const lastTs = candles[candles.length - 1].time;
      const barMs = candles.length > 1 ? lastTs - candles[candles.length - 2].time : 0;
      const tooOld = (ts: number) => barMs > 0 && lastTs - ts > barMs * MAX_AGE_BARS;
      const label = COIN_LABELS[coin] ?? coin.toUpperCase();
      const tfLabel = tf.toUpperCase();

      if ((emaTfs as readonly string[]).includes(tf)) {
        // Only the variant matching this user's own Anti-Chop setting, so the
        // answer matches the markers their Arena chart draws.
        const { signalLongs, signalShorts } = detectEMASignals(
          candles, tf, antiChop ? STRICT_FILTER_PARAMS : DEFAULT_FILTER_PARAMS,
        );
        const all = [...signalLongs, ...signalShorts].sort((a, b) => b.timestamp - a.timestamp);
        const latest = all[0];
        // `pending` is the live edge - the cron does not treat it as a
        // confirmed call, so neither does this.
        if (latest && !latest.pending && !tooOld(latest.timestamp)) {
          fired.push(`${label} ${latest.dir === 'long' ? 'BUY' : 'SELL'} signal (${tfLabel})`);
        }
      }

      if ((structTfs as readonly string[]).includes(tf)) {
        const sigs = detectStructureSignals(candles.map(c => ({
          timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })));
        const latest = sigs[sigs.length - 1];
        if (latest && !tooOld(latest.timestamp)) {
          const kind = latest.kind === 'CHOCH' ? 'CHoCH' : 'BOS';
          fired.push(`${label} ${kind} ${latest.dir === 'bull' ? 'up' : 'down'} (${tfLabel})`);
        }
      }
    } catch { /* one coin/timeframe failing must not blank the whole answer */ }
  })));

  fired.sort();
  return NextResponse.json({
    fired,
    note: structTfs.length === 0
      ? 'buy/sell rule only - market structure is off'
      : undefined,
  });
}
