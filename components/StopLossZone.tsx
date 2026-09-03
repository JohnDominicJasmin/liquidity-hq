'use client';
import { useMarket, COIN_DEC, fmtPrice, computeFibLevels } from '@/lib/marketStore';
import type { CoinData, CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import { withAlpha } from '@/lib/color';
import { useLabels } from '@/lib/labels';

export type Bias = 'long' | 'short' | 'neutral';

interface Level { price: number; label: string; distPct: number; }

/**
 * Tally of the bull/bear evidence in a coin's derivatives and flow data.
 *
 * `includeRsi` exists because this feeds two consumers that need different
 * things. Here in StopLossZone it is a standalone read and RSI belongs in it.
 * In the Confluence Score it sits alongside a SEPARATE "Multi-TF RSI Alignment"
 * factor built from the same three RSI values - so counting RSI in both put the
 * same evidence in the score twice, giving momentum roughly 45 of ~95
 * directional weight while the UI presented it as 20. Correlated inputs agree
 * with each other by construction, so double-counting makes the score most
 * confident exactly where it is least independent.
 *
 * Passing false leaves this measuring what its label claims: order flow.
 */
export function scoreBias(
  d: CoinData,
  { includeRsi = true }: { includeRsi?: boolean } = {},
): { bias: Bias; score: number; total: number } {
  let bull = 0, bear = 0;
  if (includeRsi) {
    if (d.rsi14 != null)  { if (d.rsi14  > 55) bull++; else if (d.rsi14  < 45) bear++; }
    if (d.rsi1h  != null) { if (d.rsi1h  > 55) bull++; else if (d.rsi1h  < 45) bear++; }
    if (d.rsi4h  != null) { if (d.rsi4h  > 55) bull++;  else if (d.rsi4h  < 45) bear++; }
  }
  if (d.oiTrend === 'strong_up'   || d.oiTrend === 'weak_up')   bull++;
  if (d.oiTrend === 'strong_down' || d.oiTrend === 'weak_down') bear++;
  if (d.cvdDivergence === 'bullish') bull++;
  if (d.cvdDivergence === 'bearish') bear++;
  if (d.takerBuyRatio != null) { if (d.takerBuyRatio > 0.55) bull++; else if (d.takerBuyRatio < 0.45) bear++; }
  if (d.poc  != null) { if (d.price > d.poc)  bull++; else bear++; }
  if (d.vwap != null) { if (d.price > d.vwap) bull++; else bear++; }
  // Funding - contrarian: high funding = crowded longs paying to stay in = bearish tilt.
  // Negative funding = crowded shorts = bullish tilt.
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= 0.04) bear++;
    else if (fr <= -0.02) bull++;
  }
  // Liquidation delta - same contrarian/fade convention as funding above: heavy net
  // long liquidations means the over-leveraged long crowd just got flushed out, which
  // tends to mark exhaustion of the down-move (fade it, bullish). Heavy net short
  // liquidations is the mirror case (a squeeze exhausting itself, fade it, bearish).
  if (d.liqDelta != null) {
    if (d.liqDelta > 0) bull++;
    else if (d.liqDelta < 0) bear++;
  }
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

export default function StopLossZone({ coin, grokSignal }: { coin: CoinId; grokSignal?: string }) {
  const { store } = useMarket();
  const { t } = useLabels();
  const d    = store.coins[coin];
  const dec  = COIN_DEC[coin] ?? 2;

  if (!d?.price) return null;

  const { bias, score, total } = scoreBias(d);
  const stop = computeStop(d, bias);
  const tp   = stop ? computeTP(d, bias, stop) : null;
  const rr   = stop && tp ? (tp.distPct / stop.distPct) : null;

  const biasCol = bias === 'long' ? 'var(--green-2)' : bias === 'short' ? 'var(--red)' : 'var(--txt-dim)';

  // Conflict: technical indicator bias vs Grok AI signal
  const grokUp = grokSignal?.toUpperCase() ?? '';
  const hasConflict = bias !== 'neutral' && (
    (bias === 'long'  && (grokUp === 'SHORT' || grokUp === 'LEAN SHORT')) ||
    (bias === 'short' && (grokUp === 'LONG'  || grokUp === 'LEAN LONG'))
  );

  type Row = { role: 'sl' | 'entry' | 'tp'; price: number; distPct: number; levelLabel: string };
  const rows: Row[] = [];

  if (bias !== 'neutral' && stop) {
    const slRow:    Row = { role: 'sl',    price: stop.price, distPct: stop.distPct, levelLabel: stop.label };
    const entryRow: Row = { role: 'entry', price: d.price,    distPct: 0,            levelLabel: '' };
    const tpRow:    Row | null = tp ? { role: 'tp', price: tp.price, distPct: tp.distPct, levelLabel: tp.label } : null;
    const all: Row[] = tpRow ? [slRow, entryRow, tpRow] : [slRow, entryRow];
    rows.push(...all.sort((a, b) => b.price - a.price));
  }

  const roleCol   = (role: Row['role']) => role === 'sl' ? 'var(--red)' : role === 'tp' ? 'var(--green-2)' : 'var(--txt)';
  const roleTint  = (role: Row['role']) => role === 'tp' ? 'rgba(52,211,153,0.07)' : role === 'sl' ? 'rgba(248,113,113,0.07)' : 'transparent';
  const roleLabel = (role: Row['role']) => role === 'sl' ? t('STOP_LOSS_ZONE_ROLE_SL') : role === 'tp' ? t('STOP_LOSS_ZONE_ROLE_TP') : t('STOP_LOSS_ZONE_ROLE_ENTRY');

  return (
    <div className="sms-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 14px 8px' }}>
        <span className="sms-title">{t('STOP_LOSS_ZONE_TITLE')}</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {coin.toUpperCase()} · {t('STOP_LOSS_ZONE_INDICATOR_COUNT', { score, total })}
        </span>
      </div>

      {bias === 'neutral' || !stop || rows.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.6, padding: '0 14px 14px' }}>
          {t('STOP_LOSS_ZONE_NEUTRAL_HINT')}
        </div>
      ) : (
        <>
          {/* Conflict notice - shown when AI signal contradicts indicator bias */}
          {hasConflict && (
            <div style={{ padding: '0 14px 10px' }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 7,
                padding: '8px 10px', borderRadius: 7,
                background: 'rgba(245,158,11,0.07)',
                border: '0.5px solid rgba(245,158,11,0.22)',
              }}>
                <span style={{ color: 'var(--amber)', flexShrink: 0, lineHeight: 0 }}><Warn size={12} /></span>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.5 }}>
                  {t('STOP_LOSS_ZONE_CONFLICT_PREFIX')}{' '}
                  <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{grokSignal}</span>
                  {' '}{t('STOP_LOSS_ZONE_CONFLICT_SUFFIX')}
                </span>
              </div>
            </div>
          )}

          {/* Direction pill + R:R ratio */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 10px' }}>
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '3px 10px', borderRadius: 5,
              color: biasCol, background: withAlpha(biasCol, '18'), border: `0.5px solid ${withAlpha(biasCol, '40')}`,
              letterSpacing: '.03em',
            }}>
              {bias === 'long' ? t('STOP_LOSS_ZONE_BULLISH') : t('STOP_LOSS_ZONE_BEARISH')}
            </span>
            {rr && (
              <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, letterSpacing: '-.01em', color: 'var(--txt2)' }}>
                {t('STOP_LOSS_ZONE_RR_LABEL')}&nbsp;1:{rr.toFixed(1)}
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
                <span style={{ fontSize: 'var(--fs-micro)', color: 'rgba(52,211,153,0.5)', letterSpacing: '.07em', textTransform: 'uppercase' }}>{t('STOP_LOSS_ZONE_REWARD')}</span>
                <span style={{ fontSize: 'var(--fs-micro)', color: 'rgba(248,113,113,0.5)', letterSpacing: '.07em', textTransform: 'uppercase' }}>{t('STOP_LOSS_ZONE_RISK')}</span>
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
                      fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: isEntry ? 'var(--txt3)' : col,
                      marginBottom: 5,
                    }}>
                      {roleLabel(row.role)}
                    </div>
                    <div style={{
                      fontSize: isEntry ? '1.0625rem' : '0.9375rem', fontWeight: 800,
                      color: isEntry ? 'var(--txt)' : col,
                      letterSpacing: '-.02em',
                    }}>
                      ${fmtPrice(row.price, dec)}
                    </div>
                  </div>

                  {/* Right: bold % above dim level name */}
                  {!isEntry ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: col, letterSpacing: '-.01em', marginBottom: 4 }}>
                        {sign}{row.distPct.toFixed(2)}%
                      </div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                        {row.levelLabel}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'rgba(255,255,255,0.18)' }}>{t('STOP_LOSS_ZONE_CURRENT')}</div>
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
