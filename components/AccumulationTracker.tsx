'use client';
import { useMemo } from 'react';
import { useMarket, COINS, CoinId, CoinData, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

/* ── Accumulation score ─────────────────────────────────────────────────────
   Detects coins being quietly loaded BEFORE the move: price still flat while
   smart-money footprints stack up (CVD absorption, aggressive taker buys,
   open interest building, whales positioned long, crowd not yet paying
   attention via funding). High score = stealth accumulation phase. */

interface AccumRow {
  id: CoinId;
  score: number;
  price: number;
  change: number;
  reasons: string[];
}

function scoreCoin(id: CoinId, d: CoinData | undefined): AccumRow | null {
  if (!d?.price) return null;
  const chg = Math.abs(d.change ?? 0);
  // Already moving hard - the accumulation window is over
  if (chg > 3.5) return null;

  let score = 0;
  const reasons: string[] = [];

  // 1 - Quiet price (max 20): the stealth ingredient
  if      (chg <= 1) { score += 20; reasons.push('Price flat'); }
  else if (chg <= 2) { score += 14; reasons.push('Price quiet'); }
  else               { score += 8; }

  // 2 - Smart buying (max 30): someone absorbing sells / lifting offers
  if (d.cvdDivergence === 'bullish') { score += 18; reasons.push('CVD absorption'); }
  if (d.takerBuyRatio != null) {
    if      (d.takerBuyRatio >= 0.60) { score += 12; reasons.push(`${Math.round(d.takerBuyRatio * 100)}% taker buys`); }
    else if (d.takerBuyRatio >= 0.55) { score += 8;  reasons.push(`${Math.round(d.takerBuyRatio * 100)}% taker buys`); }
  }

  // 3 - Positions building (max 20): open interest rising into flat price
  if      (d.oiTrend === 'strong_up') { score += 20; reasons.push('OI building'); }
  else if (d.oiTrend === 'weak_up')   { score += 10; reasons.push('OI drifting up'); }

  // 4 - Crowd asleep (max 15): funding neutral-to-negative = longs not crowded yet
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= -0.03 && fr <= 0.01) { score += 15; reasons.push('Funding calm'); }
    else if (fr < -0.03)           { score += 10; reasons.push('Shorts paying'); }
  }

  // 5 - Whales positioned (max 15): Binance top-trader dollar-weighted longs
  if (d.bnWhaleLongRatio != null) {
    if      (d.bnWhaleLongRatio >= 0.55) { score += 15; reasons.push(`Whales ${Math.round(d.bnWhaleLongRatio * 100)}% long`); }
    else if (d.bnWhaleLongRatio >= 0.52) { score += 8;  reasons.push(`Whales ${Math.round(d.bnWhaleLongRatio * 100)}% long`); }
  }

  // Bonus - volume waking up without a price move yet
  if (d.volRatio != null && d.volRatio >= 1.3) { score += 5; reasons.push(`Vol ${d.volRatio.toFixed(1)}x`); }

  return { id, score: Math.min(100, score), price: d.price, change: d.change ?? 0, reasons };
}

const MIN_SCORE = 45;
const MAX_ROWS  = 6;

export default function AccumulationTracker() {
  const { store, selectCoin } = useMarket();
  const { t } = useLabels();

  const rows = useMemo<AccumRow[]>(() => {
    return COINS
      .map(id => scoreCoin(id, store.coins[id]))
      .filter((r): r is AccumRow => r != null && r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS);
  }, [store.coins]);

  const scoreCol = (s: number) => s >= 75 ? 'var(--green)' : s >= 60 ? '#a3e635' : 'var(--amber)';

  return (
    <div style={{
      background: 'linear-gradient(180deg, var(--bg2) 0%, var(--bg1) 100%)',
      border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card)',
      marginBottom: 8, overflow: 'hidden', boxShadow: 'var(--nm-raise-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 14px 2px' }}>
        <span style={{
          fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--fs-micro)', fontWeight: 600,
          color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.12em',
        }}>
          <Tip width={270} text={t('ACCUMULATION_TRACKER_TOOLTIP')}>
            {t('ACCUMULATION_TRACKER_TITLE')}
          </Tip>
        </span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ACCUMULATION_TRACKER_SUBTITLE')}</span>
      </div>

      {rows.length === 0 ? (
        /* minHeight holds the space the rows will occupy.

           Without it this card was 72px while prices were still arriving and
           277px once they had, and all five cards below it moved 205px down
           the page at that moment.

           Measured rather than guessed: with the reservation the empty card
           sat at 222px against a loaded 277px, so 245 closes the remaining
           55px. Sized to the typical loaded height rather than a maximum -
           over-reserving would leave a visible gap on a genuinely empty
           result, which is a real state here (no coin scores >= 45). */
        <div style={{
          padding: '10px 14px 12px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)',
          minHeight: 245,
        }}>
          {t('ACCUMULATION_TRACKER_EMPTY')}
        </div>
      ) : (
        <div style={{ padding: '6px 8px 8px' }}>
          {rows.map(r => (
            <button
              key={r.id}
              onClick={() => selectCoin(r.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
                background: store.selectedCoin === r.id ? 'var(--accent-bg)' : 'transparent',
                border: `0.5px solid ${store.selectedCoin === r.id ? 'var(--accent-bdr)' : 'transparent'}`,
                textAlign: 'left', transition: 'background .15s',
              }}
              onMouseEnter={e => { if (store.selectedCoin !== r.id) e.currentTarget.style.background = 'rgba(26,122,255,0.05)'; }}
              onMouseLeave={e => { if (store.selectedCoin !== r.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--fs-caption)', fontWeight: 700,
                color: 'var(--txt)', width: 52, flexShrink: 0,
              }}>
                {r.id.toUpperCase()}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--fs-data)', fontWeight: 700,
                color: scoreCol(r.score), width: 34, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
              }}>
                {r.score}
              </span>
              <div style={{ width: 52, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }}>
                <div style={{ width: `${r.score}%`, height: '100%', borderRadius: 2, background: scoreCol(r.score) }} />
              </div>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                {r.reasons.slice(0, 4).map(reason => (
                  <span key={reason} style={{
                    fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt2)',
                    background: 'rgba(255,255,255,0.045)', border: '0.5px solid var(--bdr)',
                    borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
                  }}>
                    {reason}
                  </span>
                ))}
              </span>
              <span className="at-price" style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--fs-data)', color: 'var(--txt2)',
                flexShrink: 0, fontVariantNumeric: 'tabular-nums',
              }}>
                ${fmtPrice(r.price, COIN_DEC[r.id])}
              </span>
              <span className="at-change" style={{
                fontSize: 'var(--fs-caption)', fontWeight: 600, flexShrink: 0, width: 48, textAlign: 'right',
                color: r.change >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums',
              }}>
                {r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
