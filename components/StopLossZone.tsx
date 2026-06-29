'use client';
import { useMarket, COIN_DEC, fmtPrice, computeFibLevels } from '@/lib/marketStore';
import type { CoinData, CoinId } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';

type Bias = 'long' | 'short' | 'neutral';

interface StopResult {
  price: number;
  label: string;
  distPct: number;
  anchor: string; // human-readable explanation
}

function scoreBias(d: CoinData): { bias: Bias; bullScore: number; bearScore: number } {
  let bull = 0, bear = 0;
  if (d.rsi14 != null)  { if (d.rsi14  > 55) bull++; else if (d.rsi14  < 45) bear++; }
  if (d.rsi1h  != null) { if (d.rsi1h  > 55) bull++; else if (d.rsi1h  < 45) bear++; }
  if (d.rsi4h  != null) { if (d.rsi4h  > 55) bull++;  else if (d.rsi4h  < 45) bear++; }
  if (d.oiTrend === 'strong_up'   || d.oiTrend === 'weak_up')   bull++;
  if (d.oiTrend === 'strong_down' || d.oiTrend === 'weak_down') bear++;
  if (d.cvdDivergence === 'bullish') bull++;
  if (d.cvdDivergence === 'bearish') bear++;
  if (d.takerBuyRatio != null) { if (d.takerBuyRatio > 0.55) bull++; else if (d.takerBuyRatio < 0.45) bear++; }
  if (d.poc  != null) { if (d.price > d.poc)  bull++; else bear++; }
  if (d.vwap != null) { if (d.price > d.vwap) bull++; else bear++; }
  const bias: Bias = bull > bear ? 'long' : bear > bull ? 'short' : 'neutral';
  return { bias, bullScore: bull, bearScore: bear };
}

function findLongStop(d: CoinData): StopResult | null {
  const price = d.price;
  const candidates: { price: number; label: string; anchor: string; priority: number }[] = [];

  // Volume profile levels below price (highest priority - institutional S/R)
  if (d.val != null && d.val < price * 0.9975)
    candidates.push({ price: d.val, label: 'Value Area Low', anchor: 'Volume profile VAL - institutional support cluster', priority: 4 });
  if (d.poc != null && d.poc < price * 0.9975)
    candidates.push({ price: d.poc, label: 'Volume POC', anchor: 'Point of Control - highest volume node, acts as magnet', priority: 3 });

  // VWAP below price
  if (d.vwap != null && d.vwap < price * 0.9975)
    candidates.push({ price: d.vwap, label: 'VWAP', anchor: 'Volume-weighted average price - intraday trend baseline', priority: 2 });

  // Bid walls (visible liquidity)
  if (d.orderBidWalls) {
    for (const w of d.orderBidWalls) {
      if (w.price < price * 0.9975 && w.price > price * 0.88)
        candidates.push({ price: w.price, label: 'Bid Wall', anchor: 'Large limit buy order on order book', priority: 3 });
    }
  }

  // Fibonacci retracement levels below price
  if (d.high > d.low) {
    for (const f of computeFibLevels(d.high, d.low, price)) {
      if (f.price < price * 0.9975 && f.price > price * 0.85)
        candidates.push({ price: f.price, label: 'Fib ' + f.label, anchor: 'Fibonacci retracement level from 24h range', priority: 1 });
    }
  }

  // 24h low as last resort
  if (d.low < price * 0.9975)
    candidates.push({ price: d.low, label: '24-hour Low', anchor: 'Session low - break here signals range breakdown', priority: 0 });

  if (!candidates.length) return null;

  // Pick the nearest support (highest price below current) with highest priority for ties
  const best = candidates.reduce((acc, c) => {
    if (c.price > acc.price) return c;
    if (c.price === acc.price && c.priority > acc.priority) return c;
    return acc;
  });

  const stopPrice = best.price * 0.9985; // 0.15% buffer below support to avoid stop hunts
  const distPct = ((price - stopPrice) / price) * 100;
  return { price: stopPrice, label: best.label, distPct, anchor: best.anchor };
}

function findShortStop(d: CoinData): StopResult | null {
  const price = d.price;
  const candidates: { price: number; label: string; anchor: string; priority: number }[] = [];

  // Volume profile levels above price
  if (d.vah != null && d.vah > price * 1.0025)
    candidates.push({ price: d.vah, label: 'Value Area High', anchor: 'Volume profile VAH - institutional resistance cluster', priority: 4 });
  if (d.poc != null && d.poc > price * 1.0025)
    candidates.push({ price: d.poc, label: 'Volume POC', anchor: 'Point of Control - highest volume node, acts as magnet', priority: 3 });

  // VWAP above price
  if (d.vwap != null && d.vwap > price * 1.0025)
    candidates.push({ price: d.vwap, label: 'VWAP', anchor: 'Volume-weighted average price - intraday trend baseline', priority: 2 });

  // Ask walls
  if (d.orderAskWalls) {
    for (const w of d.orderAskWalls) {
      if (w.price > price * 1.0025 && w.price < price * 1.12)
        candidates.push({ price: w.price, label: 'Ask Wall', anchor: 'Large limit sell order on order book', priority: 3 });
    }
  }

  // Fibonacci levels above price
  if (d.high > d.low) {
    for (const f of computeFibLevels(d.high, d.low, price)) {
      if (f.price > price * 1.0025 && f.price < price * 1.15)
        candidates.push({ price: f.price, label: 'Fib ' + f.label, anchor: 'Fibonacci retracement level from 24h range', priority: 1 });
    }
  }

  // 24h high as last resort
  if (d.high > price * 1.0025)
    candidates.push({ price: d.high, label: '24-hour High', anchor: 'Session high - break here signals range breakout', priority: 0 });

  if (!candidates.length) return null;

  // Pick nearest resistance (lowest price above current) with highest priority for ties
  const best = candidates.reduce((acc, c) => {
    if (c.price < acc.price) return c;
    if (c.price === acc.price && c.priority > acc.priority) return c;
    return acc;
  });

  const stopPrice = best.price * 1.0015; // 0.15% buffer above resistance
  const distPct = ((stopPrice - price) / price) * 100;
  return { price: stopPrice, label: best.label, distPct, anchor: best.anchor };
}

export default function StopLossZone() {
  const { store } = useMarket();
  const { settings } = useSettings();
  const coin = store.selectedCoin as CoinId;
  const d = store.coins[coin];
  const dec = COIN_DEC[coin] ?? 2;

  if (!d?.price) return null;

  const { bias, bullScore, bearScore } = scoreBias(d);
  const longStop  = findLongStop(d);
  const shortStop = findShortStop(d);
  const stop = bias === 'long' ? longStop : bias === 'short' ? shortStop : null;

  // Risk calculation from account settings
  const accountSize = settings.account_size ?? 1000;
  const riskPct     = settings.risk_pct ?? 1.5;
  const maxRiskUsd  = accountSize * (riskPct / 100);

  function positionSize(stopResult: StopResult): { units: string; notional: string } {
    if (stopResult.distPct <= 0) return { units: '—', notional: '—' };
    const riskPerUnit = d!.price * (stopResult.distPct / 100);
    const units = maxRiskUsd / riskPerUnit;
    const notional = units * d!.price;
    return {
      units: units < 0.001 ? units.toFixed(6) : units < 1 ? units.toFixed(4) : units.toFixed(2),
      notional: notional >= 1000 ? '$' + (notional / 1000).toFixed(1) + 'K' : '$' + notional.toFixed(0),
    };
  }

  const BIAS_LABEL: Record<Bias, string> = { long: 'Long Bias', short: 'Short Bias', neutral: 'No Clear Bias' };
  const BIAS_COL:   Record<Bias, string> = { long: '#34d399', short: '#f87171', neutral: '#6b7280' };
  const biasCol = BIAS_COL[bias];

  const hasData = d.poc != null || d.vah != null || d.val != null || d.vwap != null || d.high > 0;

  return (
    <div className="sms-card">
      {/* Header */}
      <div className="sms-header">
        <div>
          <div className="sms-title">Stop Loss Zone</div>
          <div className="sms-sub">{coin.toUpperCase()} - S/R anchored stop suggestion</div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          color: biasCol, background: biasCol + '18', border: `0.5px solid ${biasCol}44`,
          letterSpacing: '.02em',
        }}>
          {bias === 'long' ? '▲ ' : bias === 'short' ? '▼ ' : '→ '}{BIAS_LABEL[bias]}
        </div>
      </div>

      {!hasData ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', padding: '10px 0' }}>Warming up price levels...</div>
      ) : !stop ? (
        /* Neutral or no levels found - show both sides */
        <div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10, lineHeight: 1.5 }}>
            {bias === 'neutral'
              ? 'Signals conflict across timeframes. Showing both sides of the range as a bracket.'
              : 'No clear S/R level found near price. Showing raw range boundaries.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {longStop && <StopCard label="Long Stop" stop={longStop} price={d.price} dec={dec} col="#f87171" side="below" posSize={positionSize(longStop)} maxRiskUsd={maxRiskUsd} riskPct={riskPct} />}
            {shortStop && <StopCard label="Short Stop" stop={shortStop} price={d.price} dec={dec} col="#f87171" side="above" posSize={positionSize(shortStop)} maxRiskUsd={maxRiskUsd} riskPct={riskPct} />}
          </div>
          {bullScore > 0 || bearScore > 0 ? (
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8 }}>
              Signal score: {bullScore} bullish vs {bearScore} bearish - too close to call direction
            </div>
          ) : null}
        </div>
      ) : (
        /* Clear direction */
        <div>
          <StopCard
            label={bias === 'long' ? 'Stop for Long' : 'Stop for Short'}
            stop={stop}
            price={d.price}
            dec={dec}
            col="#f87171"
            side={bias === 'long' ? 'below' : 'above'}
            posSize={positionSize(stop)}
            maxRiskUsd={maxRiskUsd}
            riskPct={riskPct}
          />

          {/* Invalidation rule */}
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 7,
            background: 'rgba(248,113,113,0.06)', border: '0.5px solid rgba(248,113,113,0.2)',
            fontSize: 11, color: '#fca5a5', lineHeight: 1.5,
          }}>
            <span style={{ fontWeight: 700 }}>Invalidation: </span>
            {bias === 'long'
              ? `Trade fails if price closes below ${stop.label} ($${fmtPrice(stop.price, dec)}). Exit immediately on a close below.`
              : `Trade fails if price closes above ${stop.label} ($${fmtPrice(stop.price, dec)}). Exit immediately on a close above.`}
          </div>

          {/* Signal breakdown */}
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8 }}>
            Bias from {Math.max(bullScore, bearScore)} of {bullScore + bearScore} signals aligned {bias === 'long' ? 'bullish' : 'bearish'}
          </div>
        </div>
      )}
    </div>
  );
}

function StopCard({ label, stop, price, dec, col, side, posSize, maxRiskUsd, riskPct }: {
  label: string;
  stop: StopResult;
  price: number;
  dec: number;
  col: string;
  side: 'above' | 'below';
  posSize: { units: string; notional: string };
  maxRiskUsd: number;
  riskPct: number;
}) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--card)', border: '0.5px solid var(--bdr)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>

      {/* Stop price */}
      <div style={{ fontSize: 18, fontWeight: 800, color: col, marginBottom: 2, letterSpacing: '-.01em' }}>
        ${fmtPrice(stop.price, dec)}
      </div>

      {/* Distance */}
      <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 8 }}>
        {side === 'below' ? '▼ ' : '▲ '}{stop.distPct.toFixed(2)}% from entry - {stop.label}
      </div>

      {/* Anchor reason */}
      <div style={{
        fontSize: 10, color: 'var(--txt3)', lineHeight: 1.4,
        padding: '5px 8px', borderRadius: 5,
        background: 'rgba(255,255,255,0.03)',
        marginBottom: 8,
      }}>
        {stop.anchor}
      </div>

      {/* Position sizing */}
      <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 3 }}>
          Position size ({riskPct}% risk, ${maxRiskUsd.toFixed(0)} max loss)
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{posSize.units}</div>
            <div style={{ fontSize: 9, color: 'var(--txt3)' }}>units</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{posSize.notional}</div>
            <div style={{ fontSize: 9, color: 'var(--txt3)' }}>notional</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>${maxRiskUsd.toFixed(0)}</div>
            <div style={{ fontSize: 9, color: 'var(--txt3)' }}>max loss</div>
          </div>
        </div>
      </div>
    </div>
  );
}
