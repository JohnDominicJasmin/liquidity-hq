'use client';
import { useMarket, COIN_DEC, fmtPrice, computeFibLevels } from '@/lib/marketStore';
import type { CoinData, CoinId } from '@/lib/marketStore';

type Bias = 'long' | 'short' | 'neutral';

interface Level { price: number; label: string; distPct: number; }

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
  return arr.reduce((acc, c) => side === 'below' ? (c.price > acc.price ? c : acc) : (c.price < acc.price ? c : acc));
}

function computeStop(d: CoinData, bias: Bias): Level | null {
  const p = d.price;
  if (bias === 'long') {
    const best = nearest(candidatesBelow(d, p), 'below');
    if (!best) return null;
    const s = best.price * 0.9985;
    return { price: s, label: best.label, distPct: ((p - s) / p) * 100 };
  }
  if (bias === 'short') {
    const best = nearest(candidatesAbove(d, p), 'above');
    if (!best) return null;
    const s = best.price * 1.0015;
    return { price: s, label: best.label, distPct: ((s - p) / p) * 100 };
  }
  return null;
}

function computeTP(d: CoinData, bias: Bias, stop: Level): Level | null {
  const p = d.price;
  if (bias === 'long') {
    const all  = candidatesAbove(d, p);
    if (!all.length) return null;
    const minTP = p + (p - stop.price) * 1.5;
    const pool  = all.filter(c => c.price >= minTP);
    const best  = nearest(pool.length ? pool : all, 'above');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((best.price - p) / p) * 100 };
  }
  if (bias === 'short') {
    const all  = candidatesBelow(d, p);
    if (!all.length) return null;
    const minTP = p - (stop.price - p) * 1.5;
    const pool  = all.filter(c => c.price <= minTP);
    const best  = nearest(pool.length ? pool : all, 'below');
    if (!best) return null;
    return { price: best.price, label: best.label, distPct: ((p - best.price) / p) * 100 };
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

  // Price ladder rows ordered high → low (top of card = highest price)
  // For long:  TP (top, green) → Entry → SL (bottom, red)
  // For short: SL (top, red)   → Entry → TP (bottom, green)
  type Row = { role: 'sl' | 'entry' | 'tp'; price: number; distPct: number; levelLabel: string };
  const rows: Row[] = [];

  if (bias !== 'neutral' && stop) {
    const slRow:    Row = { role: 'sl',    price: stop.price, distPct: stop.distPct, levelLabel: stop.label };
    const entryRow: Row = { role: 'entry', price: d.price,    distPct: 0,            levelLabel: '' };
    const tpRow:    Row | null = tp ? { role: 'tp', price: tp.price, distPct: tp.distPct, levelLabel: tp.label } : null;

    const all: Row[] = tpRow ? [slRow, entryRow, tpRow] : [slRow, entryRow];
    rows.push(...all.sort((a, b) => b.price - a.price)); // high → low
  }

  const roleCol   = (role: Row['role']) => role === 'sl' ? '#f87171' : role === 'tp' ? '#34d399' : 'var(--txt)';
  const roleLabel = (role: Row['role']) => role === 'sl' ? 'STOP' : role === 'tp' ? 'TARGET' : 'ENTRY';

  return (
    <div className="sms-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="sms-title">Stop Loss Zone</span>
        <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
          {coin.toUpperCase()} · {score}/{total} signals {bias === 'neutral' ? 'split' : bias === 'long' ? 'bullish' : 'bearish'}
        </span>
      </div>

      {bias === 'neutral' || !stop || rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>
          Signals are split — wait for RSI and OI to agree on direction before entering.
        </div>
      ) : (
        <>
          {/* Direction pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              color: biasCol, background: biasCol + '18', border: `0.5px solid ${biasCol}40`,
              letterSpacing: '.03em',
            }}>
              {bias === 'long' ? '▲ Long' : '▼ Short'}
            </span>
            {rr && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                color: rr >= 2 ? '#34d399' : rr >= 1.5 ? '#f59e0b' : '#6b7280',
                background: 'rgba(255,255,255,0.04)',
                border: '0.5px solid var(--bdr)',
              }}>
                R:R 1:{rr.toFixed(1)}
              </span>
            )}
          </div>

          {/* Price ladder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {rows.map((row, i) => {
              const col = roleCol(row.role);
              const isEntry = row.role === 'entry';
              const aboveEntry = rows.slice(0, i).some(r => r.role === 'entry');
              const sign = row.price > d.price ? '+' : row.price < d.price ? '-' : '';

              return (
                <div key={row.role} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  {/* Left track line + dot */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0, alignSelf: 'stretch' }}>
                    {/* Top segment */}
                    <div style={{
                      width: 1.5, flex: '0 0 12px',
                      background: i === 0 ? 'transparent' : 'var(--bdr)',
                    }} />
                    {/* Dot */}
                    <div style={{
                      width: isEntry ? 6 : 8, height: isEntry ? 6 : 8,
                      borderRadius: '50%', flexShrink: 0,
                      background: isEntry ? 'var(--txt2)' : col,
                      border: isEntry ? '1.5px solid var(--bdr)' : 'none',
                    }} />
                    {/* Bottom segment */}
                    <div style={{
                      width: 1.5, flex: 1,
                      background: i === rows.length - 1 ? 'transparent' : 'var(--bdr)',
                    }} />
                  </div>

                  {/* Row content */}
                  <div style={{
                    flex: 1, paddingLeft: 10,
                    paddingTop: i === 0 ? 0 : 8,
                    paddingBottom: i === rows.length - 1 ? 0 : 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {/* Role label */}
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.07em',
                        color: isEntry ? 'var(--txt3)' : col,
                        textTransform: 'uppercase', minWidth: 40,
                      }}>
                        {roleLabel(row.role)}
                      </span>
                      {/* Price */}
                      <span style={{
                        fontSize: isEntry ? 13 : 14, fontWeight: 800,
                        color: isEntry ? 'var(--txt)' : col,
                        letterSpacing: '-.01em',
                      }}>
                        ${fmtPrice(row.price, dec)}
                      </span>
                      {/* Distance + level */}
                      {!isEntry && (
                        <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 2 }}>
                          {sign}{row.distPct.toFixed(2)}% · {row.levelLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
