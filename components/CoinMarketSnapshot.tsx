'use client';
import { useMarket, CoinId, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
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
  strong_up:   { txtKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_UP_TXT',   subKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_UP_SUB',   col: '#34d399' },
  strong_down: { txtKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_TXT', subKey: 'COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_SUB', col: '#f87171' },
  weak_up:     { txtKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_UP_TXT',     subKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_UP_SUB',     col: '#fbbf24' },
  weak_down:   { txtKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_DOWN_TXT',   subKey: 'COIN_MARKET_SNAPSHOT_OI_WEAK_DOWN_SUB',   col: '#94a3b8' },
};

export default function CoinMarketSnapshot({ coin }: { coin: CoinId }) {
  const { t } = useLabels();
  const { store } = useMarket();
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);

  const price = d?.price;
  const vwap  = d?.vwap;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';

  const oiMeta = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;

  const fr     = d?.fundingRate;
  const frPct  = fr != null ? fr * 100 : null;
  const frCol  = frPct == null ? 'var(--txt3)'
    : frPct >= 0.05  ? '#f87171'
    : frPct >= 0.01  ? '#fca5a5'
    : frPct <= -0.03 ? '#34d399'
    : frPct <= -0.005? '#86efac'
    : 'var(--txt2)';
  const frSigKey: LabelKey = frPct == null ? 'COIN_MARKET_SNAPSHOT_FR_LOADING'
    : frPct >= 0.05  ? 'COIN_MARKET_SNAPSHOT_FR_LONGS_OVERCROWDED'
    : frPct >= 0.01  ? 'COIN_MARKET_SNAPSHOT_FR_MILD_LONG_BIAS'
    : frPct <= -0.03 ? 'COIN_MARKET_SNAPSHOT_FR_SHORTS_OVERCROWDED'
    : frPct <= -0.005? 'COIN_MARKET_SNAPSHOT_FR_MILD_SHORT_BIAS'
    : 'COIN_MARKET_SNAPSHOT_FR_NEUTRAL';

  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  return (
    <div className="edge-grid" style={{ marginBottom: 10 }}>
      <div className="edge-card">
        <div className="edge-card-label"><Tip text={t('COIN_MARKET_SNAPSHOT_VWAP_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_VWAP_LABEL')}</Tip></div>
        <div className="edge-card-value" style={{ color: vwapCol }}>
          {price != null ? '$' + fmtPrice(price, COIN_DEC[coin]) : '-'}
        </div>
        <div className="edge-card-signal" style={{ color: vwapCol }}>
          {vwapAbove === null
            ? <SkeletonBar width={100} height={11} radius={4} />
            : t('COIN_MARKET_SNAPSHOT_VWAP_SIGNAL', { arrow: vwapAbove ? '▲' : '▼', pct: vwapPct != null ? (vwapPct >= 0 ? '+' : '') + vwapPct.toFixed(2) + '%' : '' })}
        </div>
      </div>

      <div className="edge-card">
        <div className="edge-card-label">
          <Tip width={260} text={t('COIN_MARKET_SNAPSHOT_OI_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_OI_LABEL')}</Tip>
        </div>
        {oiMeta ? (
          <>
            <div className="edge-card-value" style={{ color: oiMeta.col, fontSize: 'var(--fs-label)' }}>{t(oiMeta.txtKey)}</div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {t(oiMeta.subKey)}{!oi1h.loading && oi1h.pct != null ? t('COIN_MARKET_SNAPSHOT_OI_1H_PCT_SUFFIX', { pct: oi1hPctStr }) : ''}
            </div>
          </>
        ) : (
          <>
            <div className="edge-card-value" style={{ color: oi1hCol, fontSize: 'var(--fs-label)' }}>
              {!oi1h.loading && oi1h.pct != null ? oi1hPctStr : (d?.oi != null ? t('COIN_MARKET_SNAPSHOT_OI_FLAT') : '-')}
            </div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {!oi1h.loading && oi1h.pct != null ? t('COIN_MARKET_SNAPSHOT_OI_1H_TREND_SUFFIX', { txt: oi1hTxt }) : (d?.oi != null ? t('COIN_MARKET_SNAPSHOT_OI_NO_SIGNAL') : <SkeletonBar width={90} height={11} radius={4} />)}
            </div>
          </>
        )}
      </div>

      <div className="edge-card">
        <div className="edge-card-label"><Tip text={t('COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_FUNDING_LABEL')}</Tip></div>
        <div className="edge-card-value" style={{ color: frCol }}>
          {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '-'}
        </div>
        <div className="edge-card-signal" style={{ color: frCol }}>
          {frPct == null ? <SkeletonBar width={70} height={11} radius={4} /> : t(frSigKey)}
        </div>
      </div>
    </div>
  );
}
