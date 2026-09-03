'use client';
import { useState, useEffect } from 'react';
import { useMarket, CoinId, fmtPrice, COIN_DEC, classifyFunding, FUNDING_TIP_KEY, fmtVol, fmtOI } from '@/lib/marketStore';
import { useDesignMode } from '@/components/DesignModeProvider';
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
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';

  const oiMeta = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;

  /* Funding countdown for the terminal band's "Next funding" cell (#631).
     nextFundingTime is unix ms of the next settlement (marketStore.ts:70), so
     both the countdown and the settlement clock are read from it rather than
     assumed from an 8h cadence - a venue that shifts its schedule would make
     a computed one silently wrong.
     Resolved after mount and re-derived each minute: this reads Date.now(),
     so computing it during render would produce a different string on the
     server than on the client for the same markup. null until then, and the
     cell shows an em dash rather than a placeholder duration. */
  const nextFundingAtMs = d?.nextFundingTime ?? null;
  const [nextFunding, setNextFunding] = useState<{ in: string; at: string } | null>(null);
  useEffect(() => {
    if (nextFundingAtMs == null) { setNextFunding(null); return; }
    const derive = () => {
      const diff = nextFundingAtMs - Date.now();
      if (diff <= 0) { setNextFunding(null); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const at = new Date(nextFundingAtMs);
      setNextFunding({
        in: h > 0 ? `${h}h ${m}m` : `${m}m`,
        at: `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`,
      });
    };
    derive();
    const id = setInterval(derive, 60_000);
    return () => clearInterval(id);
  }, [nextFundingAtMs]);
  const nextFundingIn = nextFunding?.in ?? null;
  const nextFundingAt = nextFunding?.at ?? null;

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

  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  /* TERMINAL: the canvas's five cells, not this component's three (#631).
     Arena 1a.dc.html:721-726 lists them as 24h volume / Open interest /
     Funding 8h / Next funding / 24h range, and the terminal slot is already
     `repeat(5, 1fr)` (globals.css) - so three cards were rendering across
     five columns, leaving two empty.
     Branching on design mode rather than taking a prop because this
     component has two call sites and BOTH are in app/arena/page.tsx - :1680
     inside .at-snapcells (terminal) and :2654 inside .av-rail-panel (current
     design, where .edge-grid is a single stacked column). A prop would have
     to be threaded to the right one of two lines in the same file to say
     something the design mode already knows. Same approach as
     KLineProChart.
     The current design keeps VWAP / OI / Funding exactly as it was: changing
     what a live page shows is a product decision. In terminal VWAP is not
     dropped either - arena's evidence rail already renders a VWAP row. */
  const mode = useDesignMode();

  if (mode === 'terminal') {
    const price24Pos = price != null && d?.high != null && d?.low != null && d.high > d.low
      ? ((price - d.low) / (d.high - d.low)) * 100
      : null;

    /* The canvas's note here reads "Bybit perp". Ours says just "Binance",
       and BOTH halves of that literal had to go.
       "Bybit" is an exchange this route never calls. "perp" then looked
       correct and was not: app/api/market/snapshot/route.ts:155 takes
       Binance SPOT (/api/v3/ticker/24hr) as the default and only falls back
       to futures when spot returns nothing, and the route's own comment says
       the two are not the same figure - "a degraded answer rather than an
       equal one, which is why it is a fallback and not the default". So on a
       healthy day "perp" would label spot volume.
       The route computes `source` but only hands it to reportHealth, so a
       note that tracked the actual path would need the payload to carry it.
       "Binance" is true on both paths and claims no more than it knows. */
    const cells = [
      {
        key: 'vol',
        label: t('ARENA_SNAP_VOL_LABEL'),
        value: d?.vol24 != null ? fmtVol(d.vol24) : '-',
        note: t('ARENA_SNAP_VOL_NOTE'),
        col: 'var(--txt)',
        noteCol: 'var(--txt3)',
      },
      {
        key: 'oi',
        label: t('ARENA_SNAP_OI_LABEL'),
        value: d?.oi != null ? fmtOI(d.oi) : '-',
        note: oi1h.pct != null ? t('ARENA_SNAP_OI_NOTE', { pct: oi1hPctStr }) : '',
        col: 'var(--txt)',
        noteCol: oi1hCol,
      },
      {
        key: 'funding',
        label: t('ARENA_SNAP_FUNDING_LABEL'),
        value: frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '-',
        note: frPct != null ? t(frSigKey) : '',
        col: frCol,
        noteCol: frCol,
      },
      {
        key: 'nextfunding',
        label: t('ARENA_SNAP_NEXT_FUNDING_LABEL'),
        value: nextFundingIn ?? '-',
        note: nextFundingAt ? t('ARENA_SNAP_NEXT_FUNDING_NOTE', { time: nextFundingAt }) : '',
        col: 'var(--txt)',
        noteCol: 'var(--txt3)',
      },
      {
        key: 'range',
        label: t('ARENA_SNAP_RANGE_LABEL'),
        value: d?.high != null && d?.low != null
          ? `${fmtPrice(d.low, COIN_DEC[coin])} – ${fmtPrice(d.high, COIN_DEC[coin])}`
          : '-',
        note: price24Pos != null ? t('ARENA_SNAP_RANGE_NOTE', { pct: price24Pos.toFixed(0) }) : '',
        col: 'var(--txt)',
        noteCol: 'var(--txt3)',
      },
    ];

    return (
      <div className="edge-grid" style={{ marginBottom: 10 }}>
        {cells.map(c => (
          <div className="edge-card" key={c.key}>
            <div className="edge-card-label">{c.label}</div>
            <div className="edge-card-value" style={{ color: c.col }}>{c.value}</div>
            <div className="edge-card-signal" style={{ color: c.noteCol }}>
              {c.note || <SkeletonBar width={70} height={11} radius={0} />}
            </div>
          </div>
        ))}
      </div>
    );
  }

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
            <div className="edge-card-value is-label" style={{ color: oiMeta.col }}>{t(oiMeta.txtKey)}</div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {t(oiMeta.subKey)}{!oi1h.loading && oi1h.pct != null ? t('COIN_MARKET_SNAPSHOT_OI_1H_PCT_SUFFIX', { pct: oi1hPctStr }) : ''}
            </div>
          </>
        ) : (
          <>
            <div className="edge-card-value is-label" style={{ color: oi1hCol }}>
              {!oi1h.loading && oi1h.pct != null ? oi1hPctStr : (d?.oi != null ? t('COIN_MARKET_SNAPSHOT_OI_FLAT') : '-')}
            </div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {!oi1h.loading && oi1h.pct != null ? t('COIN_MARKET_SNAPSHOT_OI_1H_TREND_SUFFIX', { txt: oi1hTxt }) : (d?.oi != null ? t('COIN_MARKET_SNAPSHOT_OI_NO_SIGNAL') : <SkeletonBar width={90} height={11} radius={4} />)}
            </div>
          </>
        )}
      </div>

      <div className="edge-card">
        {/* Tooltip follows the SIGN (#244) - see the dashboard card for why. */}
        <div className="edge-card-label"><Tip text={t(fr != null ? FUNDING_TIP_KEY[classifyFunding(fr).band] : 'COIN_MARKET_SNAPSHOT_FUNDING_TOOLTIP')}>{t('COIN_MARKET_SNAPSHOT_FUNDING_LABEL')}</Tip></div>
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
