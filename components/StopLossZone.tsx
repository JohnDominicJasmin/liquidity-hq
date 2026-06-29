'use client';
import { useMarket, COIN_DEC, fmtPrice, computeFibLevels } from '@/lib/marketStore';
import type { CoinData, CoinId } from '@/lib/marketStore';

type Bias = 'long' | 'short' | 'neutral';

interface Level {
  price: number;
  label: string;
  distPct: number;
}

function scoreBias(d: CoinData): { bias: Bias; score: number; total: number } {
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
  const total = bull + bear;
  if (bull > bear) return { bias: 'long',  score: bull, total };
  if (bear > bull) return { bias: 'short', score: bear, total };
  return { bias: 'neutral', score: 0, total };
}

function candidatesBelow(d: CoinData, price: number) {
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

function candidatesAbove(d: CoinData, price: number) {
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

function nearest(arr: { price: number; label: string }[], side: 'below' | 'above') {
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
  if (bias === 'long') {
    const all = candidatesAbove(d, price);
    if (!all.length) return null;
    const minTP = price + (price - stop.price) * 1.5;
    const pool  = all.filter(c => c.price >= minTP);
    const best  = nearest(pool.length ? pool : all, 'above');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((best.price - price) / price) * 100 };
  }
  if (bias === 'short') {
    const all = candidatesBelow(d, price);
    if (!all.length) return null;
    const minTP = price - (stop.price - price) * 1.5;
    const pool  = all.filter(c => c.price <= minTP);
    const best  = nearest(pool.length ? pool : all, 'below');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((price - best.price) / price) * 100 };
  }
  return null;
}

export default function StopLossZone() {
  const { store } = useMarket();
  const coin = store.selectedCoin as CoinId;
  const d    = store.coins[coin];
  const dec  = COIN_DEC[coin] ?? 2;

  if (!d?.price) return null;

  const { bias, score, total } = scoreBias(d);
  const stop = computeStop(d, bias);
  const tp   = stop ? computeTP(d, bias, stop) : null;
  const rr   = stop && tp ? (tp.distPct / stop.distPct) : null;

  const biasCol = bias === 'long' ? '#34d399' : bias === 'short' ? '#f87171' : '#6b7280';
  const biasLbl = bias === 'long' ? '▲ Long' : bias === 'short' ? '▼ Short' : '— Unclear';

  // Range bar: left = lower price, right = higher price
  // For long:  SL (left, red) — Entry — TP (right, green)
  // For short: TP (left, green) — Entry — SL (right, red)
  const barLeft  = stop && tp ? Math.min(stop.price, tp.price, d.price) : 0;
  const barRight = stop && tp ? Math.max(stop.price, tp.price, d.price) : 0;
  const barRange = barRight - barLeft;
  const entryBarPct = barRange > 0 ? ((d.price - barLeft) / barRange) * 100 : 50;
  const slBarPct    = stop && barRange > 0 ? ((stop.price - barLeft) / barRange) * 100 : 0;
  const tpBarPct    = tp   && barRange > 0 ? ((tp.price   - barLeft) / barRange) * 100 : 100;

  // For the bar coloring: red segment = entry to SL, green = entry to TP
  const redLeft    = Math.min(entryBarPct, slBarPct);
  const redWidth   = Math.abs(entryBarPct - slBarPct);
  const greenLeft  = Math.min(entryBarPct, tpBarPct);
  const greenWidth = Math.abs(entryBarPct - tpBarPct);

  // Sign prefix based on actual price direction vs entry
  const slSign = stop ? (stop.price > d.price ? '+' : '-') : '';
  const tpSign = tp   ? (tp.price   > d.price ? '+' : '-') : '';

  return (
    <div className="sms-card">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="sms-title">Stop Loss Zone</div>
          <div className="sms-sub">
            {coin.toUpperCase()} · {score} of {total} signals {bias === 'neutral' ? 'split' : bias === 'long' ? 'bullish' : 'bearish'}
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          color: biasCol, background: biasCol + '15', border: `0.5px solid ${biasCol}40`,
        }}>
          {biasLbl}
        </span>
      </div>

      {bias === 'neutral' || !stop ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>
          Signals are split. Wait for RSI and OI to agree on direction before entering.
        </div>
      ) : (
        <>
          {/* Range bar */}
          {tp && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)', marginBottom: 8 }}>
                {/* Green zone */}
                <div style={{
                  position: 'absolute', top: 0, height: '100%', borderRadius: 3,
                  left: greenLeft + '%', width: greenWidth + '%',
                  background: 'rgba(52,211,153,0.35)',
                }} />
                {/* Red zone */}
                <div style={{
                  position: 'absolute', top: 0, height: '100%', borderRadius: 3,
                  left: redLeft + '%', width: redWidth + '%',
                  background: 'rgba(248,113,113,0.35)',
                }} />
                {/* SL dot */}
                <div style={{
                  position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                  left: slBarPct + '%', width: 8, height: 8, borderRadius: '50%',
                  background: '#f87171', border: '1.5px solid var(--bg)',
                }} />
                {/* Entry dot */}
                <div style={{
                  position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                  left: entryBarPct + '%', width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--txt)', border: '1.5px solid var(--bg)',
                }} />
                {/* TP dot */}
                <div style={{
                  position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                  left: tpBarPct + '%', width: 8, height: 8, borderRadius: '50%',
                  background: '#34d399', border: '1.5px solid var(--bg)',
                }} />
              </div>

              {/* Bar labels */}
              <div style={{ position: 'relative', height: 14 }}>
                {[
                  { pct: slBarPct,    label: 'SL',    col: '#f87171' },
                  { pct: entryBarPct, label: 'Entry', col: 'var(--txt3)' },
                  { pct: tpBarPct,    label: 'TP',    col: '#34d399' },
                ].map(({ pct, label, col }) => (
                  <div key={label} style={{
                    position: 'absolute',
                    left: pct + '%',
                    transform: pct < 15 ? 'none' : pct > 85 ? 'translateX(-100%)' : 'translateX(-50%)',
                    fontSize: 9, fontWeight: 700,
                    color: col, letterSpacing: '.04em', whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3-column price grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>

            {/* Entry */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Entry</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt)' }}>
                ${fmtPrice(d.price, dec)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>current</div>
            </div>

            {/* Stop Loss */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Stop Loss</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#f87171' }}>
                ${fmtPrice(stop.price, dec)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                {slSign}{stop.distPct.toFixed(2)}% · {stop.label}
              </div>
            </div>

            {/* Take Profit */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Take Profit</div>
              {tp ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#34d399' }}>
                    ${fmtPrice(tp.price, dec)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                    {tpSign}{tp.distPct.toFixed(2)}% · {tp.label}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt3)' }}>—</div>
              )}
            </div>
          </div>

          {/* R:R footer */}
          {rr && (
            <>
              <div style={{ height: '0.5px', background: 'var(--bdr)', marginBottom: 10 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Risk/Reward</span>
                <span style={{
                  fontSize: 13, fontWeight: 800,
                  color: rr >= 2 ? '#34d399' : rr >= 1.5 ? '#f59e0b' : '#f87171',
                }}>
                  1:{rr.toFixed(1)}
                </span>
                {rr < 1.5 && (
                  <span style={{ fontSize: 10, color: '#f87171' }}>below 1:1.5 minimum</span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
