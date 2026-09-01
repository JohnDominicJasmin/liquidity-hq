'use client';
/* Terminal shell price ticker (#413 canvas mirror). Absent from the app
 * entirely until now - QA's landing audit found its absence explained four
 * separate criteria at once (hero sitting 34px too high, no ticker class in
 * the DOM anywhere). Curated 8-symbol list matches Dashboard 2a.dc.html's
 * canvas fixture exactly (BTC/ETH/SOL/BNB/HYPE/LINK/DOGE/ARB), not "all
 * COINS" - the canvas draws one static row, not a scrolling market list. */
import { useMarket, COIN_DEC, fmtPrice } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';

const TICKER_COINS: CoinId[] = ['btc', 'eth', 'sol', 'bnb', 'hype', 'link', 'doge', 'arb'];

export default function PriceTickerStrip() {
  const { store } = useMarket();

  return (
    <div style={{
      height: 34, flexShrink: 0, borderBottom: '1px solid var(--bdr)',
      display: 'flex', alignItems: 'stretch', overflowX: 'auto',
      fontFamily: 'var(--font-mono), monospace', fontSize: 11,
    }}>
      {TICKER_COINS.map(id => {
        const d = store.coins[id];
        const chg = d?.change ?? null;
        const up = chg != null && chg >= 0;
        return (
          <div key={id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px',
            borderRight: '1px solid var(--bdr3, var(--bdr))', flexShrink: 0,
          }}>
            <span style={{ color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em' }}>
              {id.toUpperCase()}
            </span>
            <span style={{ color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
              {d?.price ? fmtPrice(d.price, COIN_DEC[id]) : '-'}
            </span>
            {chg != null && (
              <span style={{ color: up ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
                {up ? '+' : '−'}{Math.abs(chg).toFixed(2)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
