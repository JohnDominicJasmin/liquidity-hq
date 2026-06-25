'use client';
import Link from 'next/link';
import { useMarket, COINS, CoinId, COIN_DEC, fmtPrice, fmtChg, classifyFunding, computeCoinHealth } from '@/lib/marketStore';

function VolRatioText({ ratio }: { ratio: number | null | undefined }) {
  if (ratio == null) return <div className="ticker-vol">Vol: loading...</div>;
  if (ratio >= 2.0) return <div className={`ticker-vol vol-spike`}>Vol: {ratio.toFixed(1)}x normal 🔥</div>;
  if (ratio >= 1.4) return <div className={`ticker-vol vol-spike`}>Vol: {ratio.toFixed(1)}x normal ↑</div>;
  if (ratio <= 0.5) return <div className={`ticker-vol vol-dry`}>Vol: {ratio.toFixed(1)}x normal ↓</div>;
  return <div className="ticker-vol">Vol: {ratio.toFixed(1)}x normal</div>;
}

export default function Ticker() {
  const { store, selectCoin } = useMarket();
  const { coins, selectedCoin, wsStatus } = store;

  return (
    <>
      <div className="ticker-wrap">
        <div className="ticker">
          {COINS.map((id, idx) => {
            const d = coins[id];
            const dec = COIN_DEC[id];
            const up = (d?.change ?? 0) >= 0;
            const fund = d?.fundingRate != null ? classifyFunding(d.fundingRate) : null;
            const sel = selectedCoin === id;
            const health = computeCoinHealth(d);

            // Priority signal — same logic as CoinSidebar
            let sig: { text: string; col: string } | null = null;
            if (d?.fundingRate != null) {
              const fr = d.fundingRate * 100;
              if (fr >= 0.04)       sig = { text: 'Longs overcrowded', col: '#f87171' };
              else if (fr <= -0.02) sig = { text: 'Shorts squeezed',   col: '#34d399' };
            }
            if (!sig && d?.cvdDivergence === 'bullish') sig = { text: 'Smart buyers active', col: '#34d399' };
            if (!sig && d?.cvdDivergence === 'bearish') sig = { text: 'Smart sellers active', col: '#f87171' };
            if (!sig && d?.oiTrend === 'strong_up')     sig = { text: 'New buyers opening',  col: '#34d399' };
            if (!sig && d?.oiTrend === 'strong_down')   sig = { text: 'New sellers opening', col: '#f87171' };
            if (!sig && d?.chartPattern) {
              const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
              const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
              const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
              if (isBull)      sig = { text: label, col: '#34d399' };
              else if (isBear) sig = { text: label, col: '#f87171' };
              else if (label)  sig = { text: label, col: 'var(--txt3)' };
            }
            if (!sig && d?.oiTrend === 'weak_up')   sig = { text: 'Shorts closing',      col: '#fbbf24' };
            if (!sig && d?.oiTrend === 'weak_down')  sig = { text: 'Buyers taking profit', col: '#94a3b8' };

            return (
              <div
                key={id}
                className={`ticker-card${sel ? ' selected' : ''}${idx >= 5 ? ' ticker-card-extra' : ''}`}
                onClick={() => selectCoin(id)}
              >
                <div className={`ticker-dot${d?.price ? '' : ' loading'}`} />

                {/* Coin name + health grade on same row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span className="ticker-coin" style={{ marginBottom: 0 }}>{id.toUpperCase()}</span>
                  {d?.price && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, lineHeight: 1,
                      padding: '2px 4px', borderRadius: 4,
                      color: health.color,
                      background: health.color + '22',
                      border: `0.5px solid ${health.color}55`,
                      letterSpacing: '.04em', flexShrink: 0,
                    }}>
                      {health.grade}
                    </span>
                  )}
                </div>

                <div className="ticker-price">
                  {d?.price ? '$' + fmtPrice(d.price, dec) : '---'}
                </div>

                {/* % change + signal text */}
                <div className="ticker-row">
                  <span className={`ticker-chg ${d ? (up ? 'chg-up' : 'chg-dn') : ''}`}>
                    {d ? fmtChg(d.change) : '--%'}
                  </span>
                </div>
                {sig && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: sig.col, marginTop: 3 }}>
                    {sig.text}
                  </div>
                )}

                {d?.high != null && (
                  <div className="ticker-hl">H: ${fmtPrice(d.high, dec)}&nbsp;&nbsp;L: ${fmtPrice(d.low!, dec)}</div>
                )}
                {fund && (
                  <div className={`ticker-fund ${fund.cls}`}>
                    Funding: {d!.fundingRate! >= 0 ? '+' : ''}{(d!.fundingRate! * 100).toFixed(4)}%
                  </div>
                )}
                {/* Absolute OI removed — OI trend text below is more informative */}
                {/* Absolute VOL removed — vol ratio below is more informative */}
                <VolRatioText ratio={d?.volRatio} />
                {d?.vwap != null && d.price != null && (
                  <div className="ticker-vol" style={{ color: d.price > d.vwap ? '#34d399' : '#f87171' }}>
                    VWAP: ${d.vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })} {d.price > d.vwap ? '▲' : '▼'}
                  </div>
                )}
                {d?.oiTrend && (
                  <div className="ticker-vol" style={{
                    color: d.oiTrend === 'strong_up' ? '#34d399' : d.oiTrend === 'strong_down' ? '#f87171' : '#fbbf24',
                  }}>
                    {d.oiTrend === 'strong_up' ? '↑↑ real longs' : d.oiTrend === 'strong_down' ? '↑↓ real shorts' : d.oiTrend === 'weak_up' ? '↓↑ short cover' : '↓↓ long exit'}
                  </div>
                )}
                {d?.takerBuyRatio != null && (() => {
                  const bp = Math.round(d.takerBuyRatio! * 100);
                  const col = bp >= 65 ? '#34d399' : bp <= 35 ? '#f87171' : '#606060';
                  const lbl = bp >= 65 ? `${bp}% buy ▲` : bp <= 35 ? `${100 - bp}% sell ▼` : `${bp}% / ${100 - bp}%`;
                  return (
                    <div className="ticker-vol" style={{ color: col }}>
                      Buy/Sell: {lbl}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* See all card — mobile only, sits at end of scroll */}
          <Link href="/prices" className="ticker-card ticker-see-all">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pointerEvents: 'none' }}>
              <span className="ticker-see-all-count">{COINS.length}</span>
              <span className="ticker-see-all-label">coins</span>
              <span className="ticker-see-all-arrow">See all →</span>
            </div>
          </Link>
        </div>
      </div>
      <div className="ticker-status">{wsStatus}</div>
    </>
  );
}
