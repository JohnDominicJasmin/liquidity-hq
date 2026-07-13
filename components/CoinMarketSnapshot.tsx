'use client';
import { useMarket, CoinId, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import Tip from '@/components/Tip';

/* ── Coin Market Snapshot ─────────────────────────────────────────────────
   Compact VWAP / Open Interest / Funding / OI 1h-change strip for a single
   coin. This is the single canonical home for these per-coin metrics — the
   Dashboard used to show a duplicate set of cards (formerly "EdgeSignals" in
   app/dashboard/page.tsx), which was removed since it was a direct restatement
   of this component. Pure display — reads live data already in the market
   store plus the existing useOI1h hook, no new fetches beyond what useOI1h
   itself does. */

const OI_TREND_META: Record<string, { txt: string; sub: string; col: string }> = {
  strong_up:   { txt: '▲ New buyers opening', sub: 'Open interest rising with price — real trend', col: '#34d399' },
  strong_down: { txt: '▼ New sellers opening', sub: 'Open interest rising as price falls — real dump', col: '#f87171' },
  weak_up:     { txt: '△ Short covering',      sub: 'Open interest falling as price rises — weak pump', col: '#fbbf24' },
  weak_down:   { txt: '▽ Long exits',           sub: 'Open interest falling with price — no panic',      col: '#94a3b8' },
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
  const vwapBdr   = vwapAbove === null ? 'var(--bdr)' : vwapAbove ? 'var(--green-bdr)' : 'var(--red-bdr)';

  const oiMeta = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;
  const oiBdr  = oiMeta ? oiMeta.col + '44' : 'var(--bdr)';

  const fr     = d?.fundingRate;
  const frPct  = fr != null ? fr * 100 : null;
  const frCol  = frPct == null ? 'var(--txt3)'
    : frPct >= 0.05  ? '#f87171'
    : frPct >= 0.01  ? '#fca5a5'
    : frPct <= -0.03 ? '#34d399'
    : frPct <= -0.005? '#86efac'
    : 'var(--txt2)';
  const frBdr = frPct == null ? 'var(--bdr)'
    : frPct >= 0.05  ? 'rgba(248,113,113,0.3)'
    : frPct <= -0.03 ? 'rgba(52,211,153,0.3)'
    : 'var(--bdr)';
  const frSig = frPct == null ? 'Loading…'
    : frPct >= 0.05  ? 'Longs overcrowded ↓'
    : frPct >= 0.01  ? 'Mild long bias'
    : frPct <= -0.03 ? 'Shorts overcrowded ↑'
    : frPct <= -0.005? 'Mild short bias'
    : 'Neutral';

  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '—';
  const oi1hBdr = oi1h.pct == null ? 'var(--bdr)'
    : oi1h.pct >= 10  ? 'var(--green-bdr)'
    : oi1h.pct <= -10 ? 'var(--red-bdr)'
    : 'var(--bdr)';

  return (
    <div className="edge-grid" style={{ marginBottom: 10 }}>
      <div className="edge-card" style={{ borderColor: vwapBdr }}>
        <div className="edge-card-label"><Tip text="Volume Weighted Average Price — the average price across the day, weighted by how much was traded at each level. Price above VWAP signals buy-side control; below signals sellers are in charge.">VWAP</Tip></div>
        <div className="edge-card-value" style={{ color: vwapCol }}>
          {price != null ? '$' + fmtPrice(price, COIN_DEC[coin]) : '—'}
        </div>
        {vwap != null && (
          <div className="edge-card-sub">
            <span style={{ color: 'var(--txt3)' }}>VWAP </span>
            <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>${vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            {vwapPct != null && <span style={{ color: vwapCol }}> ({vwapPct >= 0 ? '+' : ''}{vwapPct.toFixed(2)}%)</span>}
          </div>
        )}
        <div className="edge-card-signal" style={{ color: vwapCol }}>
          {vwapAbove === null ? 'Calculating…' : vwapAbove ? '▲ Above VWAP — bullish' : '▼ Below VWAP — bearish'}
        </div>
      </div>

      <div className="edge-card" style={{ borderColor: oiBdr }}>
        <div className="edge-card-label">
          <Tip width={260} text="Open Interest is the total number of live futures contracts. Rising OI + rising price = new longs entering (real conviction). Falling OI + rising price = shorts covering (weaker signal).">Open Interest</Tip>
        </div>
        {oiMeta ? (
          <>
            <div className="edge-card-value" style={{ color: oiMeta.col }}>{oiMeta.txt}</div>
            <div className="edge-card-signal" style={{ color: oiMeta.col }}>{oiMeta.sub}</div>
          </>
        ) : (
          <div className="edge-card-signal" style={{ color: 'var(--txt3)', marginTop: 4 }}>
            {d?.oi != null ? 'Flat — no strong signal' : 'Warming up…'}
          </div>
        )}
      </div>

      <div className="edge-card" style={{ borderColor: frBdr }}>
        <div className="edge-card-label"><Tip text="The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many people are leveraged long — whales often dump price to liquidate them and pocket the fee.">Funding Rate</Tip></div>
        <div className="edge-card-value" style={{ color: frCol }}>
          {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '—'}
        </div>
        <div className="edge-card-signal" style={{ color: frCol }}>{frSig}</div>
      </div>

      <div className="edge-card" style={{ borderColor: oi1hBdr }}>
        <div className="edge-card-label"><Tip text="How much the total value of open futures positions changed in the last hour. A sharp rise means new money is entering aggressively; a sharp drop means mass liquidations or traders closing positions.">Open Interest (1h)</Tip></div>
        <div className="edge-card-value" style={{ color: oi1hCol }}>
          {oi1h.loading ? '—' : oi1hPctStr}
        </div>
        <div className="edge-card-signal" style={{ color: oi1hCol }}>
          {oi1h.loading ? 'Loading…' : oi1hTxt}
        </div>
      </div>
    </div>
  );
}
