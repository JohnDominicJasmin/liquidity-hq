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

export default function StopLossZone({ coin }: { coin: CoinId }) {
  const { store } = useMarket();
  const d    = store.coins[coin];
  const dec  = COIN_DEC[coin] ?? 2;

  if (!d?.price) return null;

  const { bias, score, total } = scoreBias(d);
  const stop = computeStop(d, bias);
  const tp   = stop ? computeTP(d, bias, stop) : null;
  const rr   = stop && tp ? (tp.distPct / stop.distPct) : null;

  const biasCol = bias === 'long' ? '#34d399' : bias === 'short' ? '#f87171' : '#6b7280';

  type Row = { role: 'sl' | 'entry' | 'tp'; price: number; distPct: number; levelLabel: string };
  const rows: Row[] = [];

  if (bias !== 'neutral' && stop) {
    const slRow:    Row = { role: 'sl',    price: stop.price, distPct: stop.distPct, levelLabel: stop.label };
    const entryRow: Row = { role: 'entry', price: d.price,    distPct: 0,            levelLabel: '' };
    const tpRow:    Row | null = tp ? { role: 'tp', price: tp.price, distPct: tp.distPct, levelLabel: tp.label } : null;
    const all: Row[] = tpRow ? [slRow, entryRow, tpRow] : [slRow, entryRow];
    rows.push(...all.sort((a, b) => b.price - a.price));
  }

  const roleCol   = (role: Row['role']) => role === 'sl' ? '#f87171' : role === 'tp' ? '#34d399' : 'var(--txt)';
  const roleTint  = (role: Row['role']) => role === 'tp' ? 'rgba(52,211,153,0.07)' : role === 'sl' ? 'rgba(248,113,113,0.07)' : 'transparent';
  const roleLabel = (role: Row['role']) => role === 'sl' ? 'Stop Loss' : role === 'tp' ? 'Take Profit' : 'Entry';

  return (
    <div className="sms-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 14px 8px' }}>
        <span className="sms-title">Trade Setup</span>
        <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
          {coin.toUpperCase()} · {score}/{total} {bias === 'neutral' ? 'signals split' : bias === 'long' ? 'bullish' : 'bearish'}
        </span>
      </div>

      {bias === 'neutral' || !stop || rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.6, padding: '0 14px 14px' }}>
          Signals are split — wait for RSI and OI to agree on direction before entering.
        </div>
      ) : (
        <>
          {/* Direction pill + R:R ratio */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 10px' }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 5,
              color: biasCol, background: biasCol + '18', border: `0.5px solid ${biasCol}40`,
              letterSpacing: '.03em',
            }}>
              {bias === 'long' ? '▲ Long' : '▼ Short'}
            </span>
            {rr && (
              <span style={{
                fontSize: 13, fontWeight: 800, letterSpacing: '-.01em',
                color: rr >= 2 ? '#34d399' : rr >= 1.5 ? '#f59e0b' : '#6b7280',
              }}>
                R:R&nbsp;1:{rr.toFixed(1)}
              </span>
            )}
          </div>

          {/* Proportional reward / risk bar */}
          {rr && (
            <div style={{ padding: '0 14px 14px' }}>
              <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ flex: rr, background: '#34d399', opacity: 0.65, borderRadius: '3px 0 0 3px' }} />
                <div style={{ flex: 1, background: '#f87171', opacity: 0.65, borderRadius: '0 3px 3px 0' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 8, color: 'rgba(52,211,153,0.5)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Reward</span>
                <span style={{ fontSize: 8, color: 'rgba(248,113,113,0.5)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Risk</span>
              </div>
            </div>
          )}

          {/* Price level rows */}
          {rows.map((row, i) => {
            const col     = roleCol(row.role);
            const isEntry = row.role === 'entry';
            const sign    = row.price > d.price ? '+' : row.price < d.price ? '-' : '';

            return (
              <div key={row.role} style={{
                background: roleTint(row.role),
                borderTop: '0.5px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: isEntry ? '14px 14px' : '11px 14px',
                }}>
                  {/* Left: label above price */}
                  <div>
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: isEntry ? 'var(--txt3)' : col,
                      marginBottom: 5,
                    }}>
                      {roleLabel(row.role)}
                    </div>
                    <div style={{
                      fontSize: isEntry ? 17 : 15, fontWeight: 800,
                      color: isEntry ? 'var(--txt)' : col,
                      letterSpacing: '-.02em',
                    }}>
                      ${fmtPrice(row.price, dec)}
                    </div>
                  </div>

                  {/* Right: bold % above dim level name */}
                  {!isEntry ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: col, letterSpacing: '-.01em', marginBottom: 4 }}>
                        {sign}{row.distPct.toFixed(2)}%
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                        {row.levelLabel}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)' }}>current</div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
