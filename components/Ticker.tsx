'use client';
import { useMarket } from '@/lib/marketStore';
import { COINS, CoinId, COIN_DEC, fmtPrice, fmtChg, fmtVol, classifyFunding } from '@/lib/marketStore';

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
          {COINS.map(id => {
            const d = coins[id];
            const dec = COIN_DEC[id];
            const up = (d?.change ?? 0) >= 0;
            const fund = d?.fundingRate != null ? classifyFunding(d.fundingRate) : null;
            const sel = selectedCoin === id;

            return (
              <div
                key={id}
                className={`ticker-card${sel ? ' selected' : ''}`}
                onClick={() => selectCoin(id)}
              >
                <div className={`ticker-dot${d?.price ? '' : ' loading'}`} />
                <div className="ticker-coin">{id.toUpperCase()}</div>
                <div className="ticker-price">
                  {d?.price ? '$' + fmtPrice(d.price, dec) : '---'}
                </div>
                <div className="ticker-row">
                  <span className={`ticker-chg ${d ? (up ? 'chg-up' : 'chg-dn') : ''}`}>
                    {d ? fmtChg(d.change) : '--%'}
                  </span>
                </div>
                {d?.high != null && (
                  <div className="ticker-hl">H: ${fmtPrice(d.high, dec)}&nbsp;&nbsp;L: ${fmtPrice(d.low!, dec)}</div>
                )}
                {fund && (
                  <div className={`ticker-fund ${fund.cls}`}>
                    Funding: {d!.fundingRate! >= 0 ? '+' : ''}{(d!.fundingRate! * 100).toFixed(4)}%
                  </div>
                )}
                {d?.oi != null && (
                  <div className="ticker-fund" style={{ color: '#606060' }}>
                    Open Int: {d.oi >= 1e9 ? '$' + (d.oi / 1e9).toFixed(2) + 'B' : '$' + (d.oi / 1e6).toFixed(1) + 'M'}
                  </div>
                )}
                {d?.vol24 != null && (
                  <div className="ticker-vol">VOL: <span>{fmtVol(d.vol24)}</span></div>
                )}
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
                    OI: {d.oiTrend === 'strong_up' ? '↑↑ real longs' : d.oiTrend === 'strong_down' ? '↑↓ real shorts' : d.oiTrend === 'weak_up' ? '↓↑ short cover' : '↓↓ long exit'}
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
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="ticker-status">{wsStatus}</div>
      </div>
    </>
  );
}
