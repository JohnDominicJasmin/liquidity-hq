'use client';
import { useMarket, CoinId, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import Tip from '@/components/Tip';

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

const OI_TREND_META: Record<string, { txt: string; sub: string; col: string }> = {
  strong_up:   { txt: '▲ New buyers',    sub: 'OI + price up · real trend',   col: '#34d399' },
  strong_down: { txt: '▼ New sellers',   sub: 'OI up, price down · real dump', col: '#f87171' },
  weak_up:     { txt: '△ Short covering', sub: 'OI down, price up · weak',      col: '#fbbf24' },
  weak_down:   { txt: '▽ Long exits',     sub: 'OI + price down · no panic',    col: '#94a3b8' },
};

export default function CoinMarketSnapshot({ coin }: { coin: CoinId }) {
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
  const frSig = frPct == null ? 'Loading…'
    : frPct >= 0.05  ? 'Longs overcrowded ↓'
    : frPct >= 0.01  ? 'Mild long bias'
    : frPct <= -0.03 ? 'Shorts overcrowded ↑'
    : frPct <= -0.005? 'Mild short bias'
    : 'Neutral';

  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  return (
    <div className="edge-grid" style={{ marginBottom: 10 }}>
      <div className="edge-card">
        <div className="edge-card-label"><Tip text="Volume Weighted Average Price - the average price across the day, weighted by how much was traded at each level. Price above VWAP signals buy-side control; below signals sellers are in charge.">VWAP</Tip></div>
        <div className="edge-card-value" style={{ color: vwapCol }}>
          {price != null ? '$' + fmtPrice(price, COIN_DEC[coin]) : '-'}
        </div>
        <div className="edge-card-signal" style={{ color: vwapCol }}>
          {vwapAbove === null
            ? 'Calculating…'
            : `${vwapAbove ? '▲' : '▼'} ${vwapPct != null ? (vwapPct >= 0 ? '+' : '') + vwapPct.toFixed(2) + '%' : ''} vs VWAP`}
        </div>
      </div>

      <div className="edge-card">
        <div className="edge-card-label">
          <Tip width={260} text="Open Interest is the total number of live futures contracts, with its 1-hour change. Rising OI + rising price = new longs entering (real conviction). Falling OI + rising price = shorts covering (weaker signal). The 1h change shows how fast money is entering or leaving right now.">Open Interest</Tip>
        </div>
        {oiMeta ? (
          <>
            <div className="edge-card-value" style={{ color: oiMeta.col, fontSize: 'var(--fs-label)' }}>{oiMeta.txt}</div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {oiMeta.sub}{!oi1h.loading && oi1h.pct != null ? ` · ${oi1hPctStr} 1h` : ''}
            </div>
          </>
        ) : (
          <>
            <div className="edge-card-value" style={{ color: oi1hCol, fontSize: 'var(--fs-label)' }}>
              {!oi1h.loading && oi1h.pct != null ? oi1hPctStr : (d?.oi != null ? 'Flat' : '-')}
            </div>
            <div className="edge-card-signal" style={{ color: 'var(--txt3)' }}>
              {!oi1h.loading && oi1h.pct != null ? `${oi1hTxt} · 1h` : (d?.oi != null ? 'No strong signal' : 'Warming up…')}
            </div>
          </>
        )}
      </div>

      <div className="edge-card">
        <div className="edge-card-label"><Tip text="The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many people are leveraged long - whales often dump price to liquidate them and pocket the fee.">Funding Rate</Tip></div>
        <div className="edge-card-value" style={{ color: frCol }}>
          {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '-'}
        </div>
        <div className="edge-card-signal" style={{ color: frCol }}>{frSig}</div>
      </div>
    </div>
  );
}
