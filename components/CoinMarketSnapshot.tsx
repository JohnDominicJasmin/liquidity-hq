'use client';
import { useState } from 'react';
import { useMarket, CoinId, fmtPrice, COIN_DEC, classifyFunding, FUNDING_TIP_KEY } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { oiTrend1h } from '@/lib/oiTrend1h';
import { currencyPrefix, arenaPriceUnit } from '@/lib/coins';
import ReadingGap from '@/components/ReadingGap';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { useBinanceOnlyPriceStale } from '@/components/StalePriceAge';
import type { LabelKey } from '@/lib/labelKeys';

/* ── Coin Market Snapshot ─────────────────────────────────────────────────
   Compact VWAP / Open Interest / Funding / OI 1h-change strip for a single
   coin. This is the single canonical home for these per-coin metrics - the
   Dashboard used to show a duplicate set of cards (formerly "EdgeSignals" in
   app/dashboard/page.tsx), which was removed since it was a direct restatement
   of this component. Pure display - reads live data already in the market
   store plus the existing useOI1h hook, no new fetches beyond what useOI1h
   itself does.

   Card frames are intentionally flat (no per-signal colored borders) - color
   lives on the data values only, matching the app's Bloomberg/Coinglass card
   convention. Each cell is a tight 3-row metric (label / value / one-line
   context) so the four align at a compact equal height instead of the old
   tall cards whose wrapping context lines left big empty gaps. */

const OI_TREND_META: Record<string, { txtKey: LabelKey; subKey: LabelKey; col: string }> = {
  strong_up:   { txtKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_UP_TXT',   subKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_UP_SUB',   col: 'var(--green)' },
  strong_down: { txtKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_TXT', subKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_SUB', col: 'var(--red)' },
  weak_up:     { txtKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_UP_TXT',     subKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_UP_SUB',     col: 'var(--amber)' },
  weak_down:   { txtKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_DOWN_TXT',   subKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_DOWN_SUB',   col: 'var(--txt3)' },
};

export default function CoinMarketSnapshot({ coin }: { coin: CoinId }) {
  const { t } = useLabels();
  const { store } = useMarket();
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);

  const price = d?.price;
  const vwap  = d?.vwap;
  const liveAbove = vwap != null && price != null ? price > vwap : null;
  const livePct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  /* NO NEW ABOVE/BELOW ON A STALE PRICE (PM, #2783): while this coin's price is the route's last good body (up to 60 minutes old), the VWAP relation keeps the last one worked out from a live price, and shows nothing if there was none. An hour-old price must not flip the arrow. */
  const priceStale = useBinanceOnlyPriceStale(coin);
  const [held, setHeld] = useState<{ coin: string; above: boolean | null; pct: number | null } | null>(null);
  if (!priceStale && (held?.coin !== coin || held.above !== liveAbove || held.pct !== livePct)) setHeld({ coin, above: liveAbove, pct: livePct });
  const vwapAbove = priceStale ? (held?.coin === coin ? held.above : null) : liveAbove;
  const vwapPct   = priceStale ? (held?.coin === coin ? held.pct : null) : livePct;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';
  /* THE CARD SHOWS THE VWAP, under a heading that says VWAP (#1263, owner report).
   *
   * `edge-card-value` printed `price`, so the card showed the live PRICE under a "VWAP" label whose
   * tooltip defines VWAP as "the average price across the day, weighted by how much was traded at
   * each level". That was true for EVERY coin, the core 50 included - which is why it went
   * unnoticed for so long: price and VWAP are normally close enough that the number looks right.
   * The owner spotted it on CYBER, where $0.2637 under VWAP was simply the live price.
   *
   * The real VWAP survived only as the direction and percentage underneath, which is where the
   * design intent plainly was. Now the value is the VWAP and that line is its relation to price.
   *
   * A DASH AND A WORD, NEVER AN ENDLESS SKELETON. `vwap` is written only by the core-50 snapshot
   * pass, so on a universe coin the skeleton below spun for ever and the card settled into reading
   * as a finished value - the same unknown-shown-as-pending defect as #2119 and #2125. */
  /* currencyPrefix, not a literal $ (#2196): an HKD coin's VWAP read HK$ everywhere else on the page and $ here. */
  /* IN THE ARENA'S PRICE UNIT (PM, 2026-11-20, QA on qa 378cf39: pepe showed $0.00000383 beside a $0.0038 chart): the store's VWAP is per-token; this card is on the Arena only, whose prices for a 1000x contract are in the chart's unit (arenaPriceUnit, lib/coins.ts; 1 for every other coin). The percent beside it is scale-free. */
  /* DECIMALS OF THE CHART'S UNIT (PM, 2026-11-20): COIN_DEC is the per-token precision (pepe 8), so the 1000x value printed "$0.00383500". A 1000x coin drops the decimals the multiplier gave up (log10 of it: 3 for 1000x) and trims trailing zeros (at least two decimals stay): "$0.00384", the chart axis's precision. Ordinary coins unchanged. */
  const unit = arenaPriceUnit(coin);
  const vwapStr = vwap != null
    ? currencyPrefix(coin) + (unit === 1
      ? fmtPrice(vwap, COIN_DEC[coin])
      : (vwap * unit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, (COIN_DEC[coin] ?? 2) - Math.round(Math.log10(unit))) }))
    : null;

  /* #1613: the label and the number beside it come from the SAME hour. `store.oiTrend` is a different window (~3h at first load, ~25 min once the
     poll has filled its history) and made the label contradict the 1h figure and flip as its source changed, so this card no longer reads it.
     No label until the hour has loaded (a skeleton), and none when the price change over the hour is unknown or both moves are small. */
  const trend1h = !oi1h.loading ? oiTrend1h(oi1h.pct, oi1h.pricePct) : null;
  const oiMeta = trend1h ? OI_TREND_META[trend1h] : null;

  const fr     = d?.fundingRate;
  const frPct  = fr != null ? fr * 100 : null;
  const frCol  = frPct == null ? 'var(--txt3)'
    : frPct >= 0.05  ? 'var(--red)'
    : frPct >= 0.01  ? 'var(--red-soft)'
    : frPct <= -0.03 ? 'var(--green)'
    : frPct <= -0.005? 'var(--green-soft)'
    : 'var(--txt2)';
  const frSigKey: LabelKey = frPct == null ? 'COIN_MARKET_SNAPSHOT_FR_LOADING'
    : frPct >= 0.05  ? 'COIN_MARKET_SNAPSHOT_FR_LONGS_OVERCROWDED'
    : frPct >= 0.01  ? 'COIN_MARKET_SNAPSHOT_FR_MILD_LONG_BIAS'
    : frPct <= -0.03 ? 'COIN_MARKET_SNAPSHOT_FR_SHORTS_OVERCROWDED'
    : frPct <= -0.005? 'COIN_MARKET_SNAPSHOT_FR_MILD_SHORT_BIAS'
    : 'COIN_MARKET_SNAPSHOT_FR_NEUTRAL';

  const { key: oi1hKey, col: oi1hCol } = oi1hSignal(oi1h.pct, null);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  return (
    <div className="edge-grid" style={{ marginBottom: 10 }}>
      <div className="edge-card">
        <div className="edge-card-label"><Tip text={t('COIN_MARKET_SNAPSHOT_VWAP_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_VWAP_LABEL')}</Tip></div>
        <div className="edge-card-value" style={{ color: vwapCol }}>
          {/* NO BARE DASH ON THE RAIL EITHER (#1651, PM, QA's HYPE live check): an ellipsis while the snapshot is loading, "Unavailable" once it is not (vwap is written only by the core-50 snapshot pass, so a universe coin never gets one). */}
          {vwapStr ?? <ReadingGap loading={store.snapshotStatus === 'loading'} />}
        </div>
        <div className="edge-card-signal" style={{ color: vwapCol }}>
          {vwapAbove === null
            ? (vwap == null ? null : t('STATE_UNAVAILABLE'))
            : t('COIN_MARKET_SNAPSHOT_VWAP_SIGNAL', { arrow: vwapAbove ? '▲' : '▼', pct: vwapPct != null ? (vwapPct >= 0 ? '+' : '') + vwapPct.toFixed(2) + '%' : '' })}
        </div>
      </div>

      <div className="edge-card">
        <div className="edge-card-label">
          <Tip width={260} text={t('COIN_MARKET_SNAPSHOT_OI_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_OI_LABEL')}</Tip>
        </div>
        {oiMeta ? (
          <>
            <div className="edge-card-value is-label" title={t(oiMeta.txtKey)} style={{ color: oiMeta.col }}>{t(oiMeta.txtKey)}</div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {t(oiMeta.subKey)}{!oi1h.loading && oi1h.pct != null ? t('COIN_MARKET_SNAPSHOT_OI_1H_PCT_SUFFIX', { pct: oi1hPctStr }) : ''}
            </div>
          </>
        ) : (
          <>
            <div className="edge-card-value is-label" style={{ color: oi1hCol }}>
              {!oi1h.loading && oi1h.pct != null ? oi1hPctStr : <ReadingGap loading={oi1h.loading} />}
            </div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {/* THREE ABSENCES, THREE STRINGS (#1651, QA's finding). Loading was already its own
                  state - the skeleton - but "the venue did not answer" and "there is not enough
                  history yet" both printed "Unavailable", which sends a reader looking for an
                  outage that is not there. A newly listed coin, or the first minutes after a cache
                  flush, is the second case and is entirely normal. */}
              {oi1h.loading
                ? <SkeletonBar width={90} height={11} radius={4} />
                : oi1h.pct != null
                ? t('COIN_MARKET_SNAPSHOT_OI_1H_TREND_SUFFIX', { txt: oi1hKey ? t(oi1hKey) : '' })
                : oi1h.reason === 'short-window'
                ? t('COIN_MARKET_SNAPSHOT_OI_1H_SHORT_WINDOW')
                : t('GLOBAL_MACRO_CONTEXT_ROW_UNAVAILABLE')}
            </div>
          </>
        )}
      </div>

      <div className="edge-card">
        {/* Tooltip follows the SIGN (#244) - see the dashboard card for why. */}
        <div className="edge-card-label"><Tip text={t(fr != null ? FUNDING_TIP_KEY[classifyFunding(fr).band] : 'COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_FUNDING_LABEL')}</Tip></div>
        <div className="edge-card-value" style={{ color: frCol }}>
          {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : <ReadingGap loading={store.scannerFeed.universe === 'pending'} />}
        </div>
        <div className="edge-card-signal" style={{ color: frCol }}>
          {frPct == null ? (store.scannerFeed.universe === 'pending' ? <SkeletonBar width={70} height={11} radius={4} /> : null) : t(frSigKey)}
        </div>
      </div>
    </div>
  );
}
