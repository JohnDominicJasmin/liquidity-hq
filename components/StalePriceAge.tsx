'use client';
import { useMarket } from '@/lib/marketStore';
import { UNIVERSE_BINANCE_ONLY } from '@/lib/coins';
import { useNow } from '@/lib/useNow';
import { ageLabel } from '@/lib/ageLabel';
import { useLabels } from '@/lib/labels';

/* THE AGE OF A PRICE THE ROUTE SERVED FROM ITS LAST GOOD BODY (#2783; owner's data-integrity rule: every number shows its age or an unknown state).
 * The Binance-only coins (pre-IPO references, commodities, Hong Kong shares) are priced by one read of /api/proxy?type=binance-futures-24hr. When Binance
 * refuses, the route answers with its last good body, up to 10 minutes old, flagged `x-data-stale`; MarketProvider keeps that body's moment in
 * `binanceOnlyStaleAt`. While it is set, every place that prints one of these prices carries this line under it. The same label as every other age in the app
 * (ARENA_FRESHNESS_*), no new copy. It keys on the route's flag, not on age: the read repeats every 8 minutes, so a live price can be that old and is not marked.
 * One test id on every surface (Markets, Dashboard, Arena scanner) so one pin covers them all. */
const BINANCE_ONLY_IDS = new Set<string>(Object.values(UNIVERSE_BINANCE_ONLY));

function AgeLine({ at }: { at: number }) {
  const { t } = useLabels();
  const now = useNow(60_000);   // the clock lives here, so a row with no mark runs no timer
  return (
    <span data-testid="price-age" style={{ display: 'block', fontSize: 'var(--fs-micro)', fontWeight: 500, color: 'var(--txt3)' }}>
      {ageLabel(Math.max(0, now - at), t)}
    </span>
  );
}

export default function StalePriceAge({ coin }: { coin: string }) {
  const { store } = useMarket();
  const at = store.binanceOnlyStaleAt;
  if (at == null || !BINANCE_ONLY_IDS.has(coin)) return null;
  return <AgeLine at={at} />;
}
