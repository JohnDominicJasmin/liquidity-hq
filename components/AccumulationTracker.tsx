'use client';
import { useMemo } from 'react';
import { useMarket, COINS, CoinId, CoinData, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import Tip from '@/components/Tip';

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
  // Already moving hard — the accumulation window is over
  if (chg > 3.5) return null;

  let score = 0;
  const reasons: string[] = [];

  // 1 — Quiet price (max 20): the stealth ingredient
  if      (chg <= 1) { score += 20; reasons.push('Price flat'); }
  else if (chg <= 2) { score += 14; reasons.push('Price quiet'); }
  else               { score += 8; }

  // 2 — Smart buying (max 30): someone absorbing sells / lifting offers
  if (d.cvdDivergence === 'bullish') { score += 18; reasons.push('CVD absorption'); }
  if (d.takerBuyRatio != null) {
    if      (d.takerBuyRatio >= 0.60) { score += 12; reasons.push(`${Math.round(d.takerBuyRatio * 100)}% taker buys`); }
    else if (d.takerBuyRatio >= 0.55) { score += 8;  reasons.push(`${Math.round(d.takerBuyRatio * 100)}% taker buys`); }
  }

  // 3 — Positions building (max 20): open interest rising into flat price
  if      (d.oiTrend === 'strong_up') { score += 20; reasons.push('OI building'); }
  else if (d.oiTrend === 'weak_up')   { score += 10; reasons.push('OI drifting up'); }

  // 4 — Crowd asleep (max 15): funding neutral-to-negative = longs not crowded yet
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= -0.03 && fr <= 0.01) { score += 15; reasons.push('Funding calm'); }
    else if (fr < -0.03)           { score += 10; reasons.push('Shorts paying'); }
  }

  // 5 — Whales positioned (max 15): Binance top-trader dollar-weighted longs
  if (d.bnWhaleLongRatio != null) {
    if      (d.bnWhaleLongRatio >= 0.55) { score += 15; reasons.push(`Whales ${Math.round(d.bnWhaleLongRatio * 100)}% long`); }
    else if (d.bnWhaleLongRatio >= 0.52) { score += 8;  reasons.push(`Whales ${Math.round(d.bnWhaleLongRatio * 100)}% long`); }
  }

  // Bonus — volume waking up without a price move yet
  if (d.volRatio != null && d.volRatio >= 1.3) { score += 5; reasons.push(`Vol ${d.volRatio.toFixed(1)}x`); }

  return { id, score: Math.min(100, score), price: d.price, change: d.change ?? 0, reasons };
}

const MIN_SCORE = 45;
const MAX_ROWS  = 6;

export default function AccumulationTracker() {
  const { store, selectCoin } = useMarket();

  const rows = useMemo<AccumRow[]>(() => {
    return COINS
      .map(id => scoreCoin(id, store.coins[id]))
      .filter((r): r is AccumRow => r != null && r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS);
  }, [store.coins]);

  const scoreCol = (s: number) => s >= 75 ? '#4ade80' : s >= 60 ? '#a3e635' : '#fbbf24';

  return (
    <div style={{
      background: 'linear-gradient(180deg, var(--bg2) 0%, var(--bg1) 100%)',
      border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card)',
      marginBottom: 8, overflow: 'hidden', boxShadow: 'var(--nm-raise-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 14px 2px' }}>
        <span style={{
          fontFamily: 'var(--font-mono), monospace', fontSize: 9, fontWeight: 600,
          color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.12em',
        }}>
          <Tip width={270} text="Scores every coin for stealth accumulation: price still flat while CVD shows absorption, taker buys dominate, open interest builds, whale positioning leans long, and funding stays calm (crowd not in yet). High score = smart money loading before the move.">
            Accumulation Tracker
          </Tip>
        </span>
        <span style={{ fontSize: 10, color: 'var(--txt3)' }}>quiet coins being loaded — before the pump</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '10px 14px 12px', fontSize: 11, color: 'var(--txt3)' }}>
          No stealth accumulation detected right now. Signals appear when a flat-priced coin shows CVD absorption, rising open interest, or heavy taker buying.
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
              onMouseEnter={e => { if (store.selectedCoin !== r.id) e.currentTarget.style.background = 'rgba(140,150,255,0.05)'; }}
              onMouseLeave={e => { if (store.selectedCoin !== r.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700,
                color: 'var(--txt)', width: 52, flexShrink: 0,
              }}>
                {r.id.toUpperCase()}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 14, fontWeight: 700,
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
                    fontSize: 10, fontWeight: 600, color: 'var(--txt2)',
                    background: 'rgba(255,255,255,0.045)', border: '0.5px solid var(--bdr)',
                    borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
                  }}>
                    {reason}
                  </span>
                ))}
              </span>
              <span className="at-price" style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--txt2)',
                flexShrink: 0, fontVariantNumeric: 'tabular-nums',
              }}>
                ${fmtPrice(r.price, COIN_DEC[r.id])}
              </span>
              <span className="at-change" style={{
                fontSize: 10, fontWeight: 600, flexShrink: 0, width: 48, textAlign: 'right',
                color: r.change >= 0 ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums',
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
