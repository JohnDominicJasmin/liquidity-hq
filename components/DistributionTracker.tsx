'use client';
import { useMemo } from 'react';
import { useMarket, COINS, CoinId, CoinData, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import { computeDistributionScore, distributionColor, DistributionInputs } from '@/lib/distribution';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

/* ── Distribution Tracker ───────────────────────────────────────────────────
   The mirror of the Accumulation Tracker: detects big players EXITING into
   strength. Price is still up on the day while smart-money footprints point
   the other way - sellers hitting bids (CVD bearish divergence), open interest
   unwinding into the rally, top traders leaning out, retail still paying
   positive funding. High score = profit-taking / distribution phase.
   Scoring lives in lib/distribution.ts, shared with the Telegram alert. */

interface DistRow {
  id: CoinId;
  score: number;
  price: number;
  change: number;
  reasons: string[];
  /** #661: what the score was built from. Threaded through from
   *  computeDistributionScore so the row can disclose an incomplete one. */
  inputsPresent: number;
  inputsTotal: number;
}

function inputsFromCoin(d: CoinData): DistributionInputs {
  return {
    change24hPct:   d.change ?? null,
    cvdDivergence:  d.cvdDivergence,
    takerBuyRatio:  d.takerBuyRatio,
    oiTrend:        d.oiTrend,
    whaleLongRatio: d.bnWhaleLongRatio,
    fundingRatePct: d.fundingRate != null ? d.fundingRate * 100 : null,
    volRatio:       d.volRatio,
    priceBelowVwap: d.vwap != null && d.price ? d.price < d.vwap : null,
  };
}

function scoreCoin(id: CoinId, d: CoinData | undefined): DistRow | null {
  if (!d?.price) return null;
  const res = computeDistributionScore(inputsFromCoin(d));
  if (!res) return null;
  return {
    id, score: res.score, price: d.price, change: d.change ?? 0, reasons: res.reasons,
    inputsPresent: res.inputsPresent, inputsTotal: res.inputsTotal,
  };
}

const MIN_SCORE = 45;
const MAX_ROWS  = 6;

export default function DistributionTracker() {
  const { store, selectCoin } = useMarket();
  const { t } = useLabels();

  const rows = useMemo<DistRow[]>(() => {
    return COINS
      .map(id => scoreCoin(id, store.coins[id]))
      .filter((r): r is DistRow => r != null && r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS);
  }, [store.coins]);

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
          <Tip width={270} text={t('DISTRIBUTION_TRACKER_TOOLTIP')}>
            {t('DISTRIBUTION_TRACKER_TITLE')}
          </Tip>
        </span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('DISTRIBUTION_TRACKER_SUBTITLE')}</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t('DISTRIBUTION_TRACKER_EMPTY_TITLE')}</div>
          <div className="empty-state-sub">{t('DISTRIBUTION_TRACKER_EMPTY_SUB')}</div>
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
              onMouseEnter={e => { if (store.selectedCoin !== r.id) e.currentTarget.style.background = 'rgba(248,113,113,0.05)'; }}
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
                color: distributionColor(r.score), width: 34, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
              }}>
                {r.score}
              </span>
              <div style={{ width: 52, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }}>
                <div style={{ width: `${r.score}%`, height: '100%', borderRadius: 2, background: distributionColor(r.score) }} />
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
                {/* #661: disclose, do not withhold. This card matters more
                    than the accumulation one because its output is a LABEL -
                    Distribution / Early distribution / Quiet at 70 and 45 -
                    and 55 of 100 points sit behind `!= null` guards. A large
                    enough gap does not weaken the claim, it inverts it: a
                    genuine Distribution presents as Quiet.
                    Shown only when incomplete, and the score is a floor -
                    every branch is `score += N`, so a missing input could only
                    have raised it. */}
                {r.inputsPresent < r.inputsTotal && (
                  <Tip width={250} text={t('SCORE_INPUTS_PARTIAL_TIP', { present: String(r.inputsPresent), total: String(r.inputsTotal) })}>
                    <span style={{
                      fontFamily: 'var(--font-mono), monospace',
                      fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt3)',
                      background: 'transparent', border: '0.5px dashed var(--bdr)',
                      borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
                    }}>
                      {t('SCORE_INPUTS_PARTIAL', { present: String(r.inputsPresent), total: String(r.inputsTotal) })}
                    </span>
                  </Tip>
                )}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--fs-caption)', color: 'var(--txt2)',
                flexShrink: 0, fontVariantNumeric: 'tabular-nums',
              }}>
                ${fmtPrice(r.price, COIN_DEC[r.id])}
              </span>
              <span style={{
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
