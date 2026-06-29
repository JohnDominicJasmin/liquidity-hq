'use client';
import { useMarket, COIN_DEC, fmtPrice, computeFibLevels } from '@/lib/marketStore';
import type { CoinData, CoinId } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';

type Bias = 'long' | 'short' | 'neutral';

interface Level {
  price: number;
  label: string;
  distPct: number;
}

function scoreBias(d: CoinData): { bias: Bias; score: number; total: number } {
  let bull = 0, bear = 0;
  if (d.rsi14 != null)         { if (d.rsi14  > 55) bull++; else if (d.rsi14  < 45) bear++; }
  if (d.rsi1h  != null)        { if (d.rsi1h  > 55) bull++; else if (d.rsi1h  < 45) bear++; }
  if (d.rsi4h  != null)        { if (d.rsi4h  > 55) bull++;  else if (d.rsi4h  < 45) bear++; }
  if (d.oiTrend === 'strong_up'   || d.oiTrend === 'weak_up')   bull++;
  if (d.oiTrend === 'strong_down' || d.oiTrend === 'weak_down') bear++;
  if (d.cvdDivergence === 'bullish') bull++;
  if (d.cvdDivergence === 'bearish') bear++;
  if (d.takerBuyRatio != null) { if (d.takerBuyRatio > 0.55) bull++; else if (d.takerBuyRatio < 0.45) bear++; }
  if (d.poc  != null)          { if (d.price > d.poc)  bull++; else bear++; }
  if (d.vwap != null)          { if (d.price > d.vwap) bull++; else bear++; }
  const total = bull + bear;
  if (bull > bear) return { bias: 'long',  score: bull, total };
  if (bear > bull) return { bias: 'short', score: bear, total };
  return { bias: 'neutral', score: 0, total };
}

function candidatesBelow(d: CoinData, price: number): { price: number; label: string }[] {
  const out: { price: number; label: string }[] = [];
  if (d.val  != null && d.val  < price * 0.9975) out.push({ price: d.val,  label: 'VAL'  });
  if (d.poc  != null && d.poc  < price * 0.9975) out.push({ price: d.poc,  label: 'POC'  });
  if (d.vwap != null && d.vwap < price * 0.9975) out.push({ price: d.vwap, label: 'VWAP' });
  if (d.orderBidWalls) for (const w of d.orderBidWalls)
    if (w.price < price * 0.9975 && w.price > price * 0.88) out.push({ price: w.price, label: 'Bid Wall' });
  if (d.high > d.low) for (const f of computeFibLevels(d.high, d.low, price))
    if (f.price < price * 0.9975 && f.price > price * 0.84) out.push({ price: f.price, label: 'Fib ' + f.label });
  if (d.low < price * 0.9975) out.push({ price: d.low, label: '24H Low' });
  return out;
}

function candidatesAbove(d: CoinData, price: number): { price: number; label: string }[] {
  const out: { price: number; label: string }[] = [];
  if (d.vah  != null && d.vah  > price * 1.0025) out.push({ price: d.vah,  label: 'VAH'  });
  if (d.poc  != null && d.poc  > price * 1.0025) out.push({ price: d.poc,  label: 'POC'  });
  if (d.vwap != null && d.vwap > price * 1.0025) out.push({ price: d.vwap, label: 'VWAP' });
  if (d.orderAskWalls) for (const w of d.orderAskWalls)
    if (w.price > price * 1.0025 && w.price < price * 1.12) out.push({ price: w.price, label: 'Ask Wall' });
  if (d.high > d.low) for (const f of computeFibLevels(d.high, d.low, price))
    if (f.price > price * 1.0025 && f.price < price * 1.16) out.push({ price: f.price, label: 'Fib ' + f.label });
  if (d.high > price * 1.0025) out.push({ price: d.high, label: '24H High' });
  return out;
}

function nearest(arr: { price: number; label: string }[], side: 'below' | 'above'): { price: number; label: string } | null {
  if (!arr.length) return null;
  return arr.reduce((acc, c) => side === 'below'
    ? (c.price > acc.price ? c : acc)
    : (c.price < acc.price ? c : acc));
}

function computeStop(d: CoinData, bias: Bias): Level | null {
  const price = d.price;
  if (bias === 'long') {
    const best = nearest(candidatesBelow(d, price), 'below');
    if (!best) return null;
    const stop = best.price * 0.9985;
    return { price: stop, label: best.label, distPct: ((price - stop) / price) * 100 };
  }
  if (bias === 'short') {
    const best = nearest(candidatesAbove(d, price), 'above');
    if (!best) return null;
    const stop = best.price * 1.0015;
    return { price: stop, label: best.label, distPct: ((stop - price) / price) * 100 };
  }
  return null;
}

function computeTP(d: CoinData, bias: Bias, stop: Level): Level | null {
  const price = d.price;
  const minRR = 1.5;

  if (bias === 'long') {
    const all = candidatesAbove(d, price);
    if (!all.length) return null;
    const minTP = price + (price - stop.price) * minRR;
    const pool  = all.filter(c => c.price >= minTP);
    const best  = nearest(pool.length ? pool : all, 'above');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((best.price - price) / price) * 100 };
  }
  if (bias === 'short') {
    const all = candidatesBelow(d, price);
    if (!all.length) return null;
    const minTP = price - (stop.price - price) * minRR;
    const pool  = all.filter(c => c.price <= minTP);
    const best  = nearest(pool.length ? pool : all, 'below');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((price - best.price) / price) * 100 };
  }
  return null;
}

export default function StopLossZone() {
  const { store } = useMarket();
  const { settings } = useSettings();
  const coin = store.selectedCoin as CoinId;
  const d    = store.coins[coin];
  const dec  = COIN_DEC[coin] ?? 2;

  if (!d?.price) return null;

  const { bias, score, total } = scoreBias(d);
  const stop = computeStop(d, bias);
  const tp   = stop ? computeTP(d, bias, stop) : null;

  const accountSize = settings.account_size ?? 1000;
  const riskPct     = settings.risk_pct ?? 1.5;
  const maxRisk     = accountSize * (riskPct / 100);
  const rr          = stop && tp ? (tp.distPct / stop.distPct) : null;

  function unitCount(sl: Level): string {
    if (sl.distPct <= 0) return '—';
    const riskPerUnit = d!.price * (sl.distPct / 100);
    const units = maxRisk / riskPerUnit;
    return units < 0.001 ? units.toFixed(6) : units < 1 ? units.toFixed(4) : units.toFixed(2);
  }

  const biasCol = bias === 'long' ? '#34d399' : bias === 'short' ? '#f87171' : '#6b7280';
  const biasLbl = bias === 'long' ? '▲ Long' : bias === 'short' ? '▼ Short' : '— Unclear';

  return (
    <div className="sms-card">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div className="sms-title">Stop Loss Zone</div>
          <div className="sms-sub">{coin.toUpperCase()} - {score} of {total} signals {bias === 'neutral' ? 'split' : bias === 'long' ? 'bullish' : 'bearish'}</div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          color: biasCol, background: biasCol + '15', border: `0.5px solid ${biasCol}40`,
        }}>
          {biasLbl}
        </span>
      </div>

      {bias === 'neutral' || !stop ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.5 }}>
          Not enough signal agreement to suggest a stop. Wait for RSI and OI to align before entering.
        </div>
      ) : (
        <>
          {/* Entry / Stop / Target row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>

            {/* Entry */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Entry</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-.01em' }}>
                ${fmtPrice(d.price, dec)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>current</div>
            </div>

            {/* Stop Loss */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Stop Loss</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#f87171', letterSpacing: '-.01em' }}>
                ${fmtPrice(stop.price, dec)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                -{stop.distPct.toFixed(2)}% · {stop.label}
              </div>
            </div>

            {/* Take Profit */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Take Profit</div>
              {tp ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#34d399', letterSpacing: '-.01em' }}>
                    ${fmtPrice(tp.price, dec)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                    +{tp.distPct.toFixed(2)}% · {tp.label}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt3)' }}>—</div>
                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>no level found</div>
                </>
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: '0.5px', background: 'var(--bdr)', marginBottom: 10 }} />

          {/* Footer: R:R + position size */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {rr && (
              <div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>R:R</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: rr >= 2 ? '#34d399' : rr >= 1.5 ? '#f59e0b' : '#f87171' }}>
                  1:{rr.toFixed(1)}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>Size</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt2)' }}>{unitCount(stop)} {coin.toUpperCase()}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>Max Loss</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>${maxRisk.toFixed(0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>Account Risk</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt2)' }}>{riskPct}%</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
