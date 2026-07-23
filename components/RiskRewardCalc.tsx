'use client';
import { useState, useEffect } from 'react';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

interface RRResult {
  isLong:       boolean;
  slDist:       number;
  slPct:        number;
  tpDist:       number;
  tpPct:        number;
  rr:           number;
  ev:           number;
  breakevenWR:  number;
}

function calc(entry: number, sl: number, tp: number, wr: number): RRResult | null {
  if (entry <= 0 || sl <= 0 || tp <= 0 || sl === entry || tp === entry) return null;
  const isLong = entry > sl;
  const slDist = Math.abs(entry - sl);
  const tpDist = Math.abs(tp - entry);
  const slPct  = (slDist / entry) * 100;
  const tpPct  = (tpDist / entry) * 100;
  const rr     = tpDist / slDist;
  const w      = wr / 100;
  const ev     = w * tpDist - (1 - w) * slDist;
  const breakevenWR = (1 / (1 + rr)) * 100;
  return { isLong, slDist, slPct, tpDist, tpPct, rr, ev, breakevenWR };
}

function fmtUSD(v: number) {
  if (v >= 100) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + v.toFixed(4);
}

export default function RiskRewardCalc({ coin }: { coin: CoinId | '' }) {
  const { store } = useMarket();
  const { t } = useLabels();
  const [entry,  setEntry]  = useState('');
  const [sl,     setSl]     = useState('');
  const [tp,     setTp]     = useState('');
  const [winRate, setWinRate] = useState('50');

  const livePrice = coin ? (store.coins[coin]?.price ?? null) : null;

  // Coin is picked one level up (shared across all calculator tabs) - fill
  // Entry with its live price whenever the shared pick changes, including
  // on mount (e.g. switching back to this tab).
  useEffect(() => {
    if (!coin) return;
    const p = store.coins[coin]?.price;
    if (p != null) setEntry(String(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  const result = calc(
    parseFloat(entry)   || 0,
    parseFloat(sl)      || 0,
    parseFloat(tp)      || 0,
    parseFloat(winRate) || 50,
  );

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_RR_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_RR_SUBTITLE')}</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_RR_TRADE_LEVELS_LABEL')}</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setEntry(String(livePrice))} title={t('CALC_RR_LIVE_PRICE_TITLE')}>
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{t('CALC_RR_PRICE_LOADING', { coin: COIN_LABELS[coin] })}</span>
              )}
            </div>
          </div>
        )}
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_RR_ENTRY_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_RR_ENTRY_PRICE_LABEL')} type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_RR_STOP_LOSS_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-stop" aria-label={t('CALC_RR_STOP_LOSS_LABEL')} type="number" placeholder="0.00" value={sl} onChange={e => setSl(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_RR_TP_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-tp" aria-label={t('CALC_RR_TP_LABEL')} type="number" placeholder="0.00" value={tp} onChange={e => setTp(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">{t('CALC_RR_WIN_RATE_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_RR_WIN_RATE_LABEL')} type="number" placeholder="50" min="1" max="99" value={winRate} onChange={e => setWinRate(e.target.value)} />
              <span className="ps-affix ps-suffix">%</span>
            </div>
          </div>
        </div>
        <div className="ps-presets" style={{ marginTop: 10 }}>
          {['40', '45', '50', '55', '60'].map(w => (
            <button key={w} className={`ps-preset${winRate === w ? ' on' : ''}`} onClick={() => setWinRate(w)}>{w}%</button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className="ps-banner" style={
            result.isLong
              ? { background: 'var(--green-bg)', color: 'var(--green)', border: '0.5px solid var(--green-bdr)' }
              : { background: 'var(--red-bg)',   color: 'var(--red)',   border: '0.5px solid var(--red-bdr)'   }
          }>
            {result.isLong
              ? t('CALC_RR_BANNER_LONG', { rr: result.rr.toFixed(2) })
              : t('CALC_RR_BANNER_SHORT', { rr: result.rr.toFixed(2) })}
          </div>
          <div className="ps-results">
            <div className={`ps-result ${result.rr >= 2 ? 'ps-result-profit' : result.rr < 1.5 ? 'ps-result-danger' : ''}`}>
              <div className="ps-rlbl"><Tip text={t('CALC_RR_RATIO_TIP')}>{t('CALC_RR_RATIO_LABEL')}</Tip></div>
              <div className="ps-rval">
                {result.rr.toFixed(2)}R&nbsp;{result.rr >= 2 ? '✓' : result.rr < 1.5 ? '✗' : ''}
              </div>
            </div>
            <div className={`ps-result ${result.ev > 0 ? 'ps-result-profit' : 'ps-result-danger'}`}>
              <div className="ps-rlbl"><Tip text={t('CALC_RR_EV_TIP')}>{t('CALC_RR_EV_LABEL')}</Tip></div>
              <div className="ps-rval">{result.ev >= 0 ? '+' : ''}{fmtUSD(result.ev)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text={t('CALC_RR_BREAKEVEN_TIP')}>{t('CALC_RR_BREAKEVEN_LABEL')}</Tip></div>
              <div className="ps-rval">{result.breakevenWR.toFixed(1)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_RR_RESULT_SL_DISTANCE')}</div>
              <div className="ps-rval">{fmtUSD(result.slDist)} · {result.slPct.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_RR_RESULT_TP_DISTANCE')}</div>
              <div className="ps-rval">{fmtUSD(result.tpDist)} · {result.tpPct.toFixed(2)}%</div>
            </div>
          </div>
          {result.rr < 1.5 && (
            <div className="ps-warn"><Warn /> {t('CALC_RR_WARN_LOW_RR')}</div>
          )}
          {result.ev < 0 && (
            <div className="ps-warn"><Warn /> {t('CALC_RR_WARN_NEGATIVE_EV', { winRate })}</div>
          )}
          {result.rr >= 2 && result.ev > 0 && (
            <div style={{ background: 'var(--green-bg)', border: '0.5px solid var(--green-bdr)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-caption)', color: 'var(--green)', marginBottom: 8 }}>
              {t('CALC_RR_POSITIVE_EV_BANNER', { rr: result.rr.toFixed(2) })}
            </div>
          )}
        </>
      ) : (
        <EmptyState dashed title={t('CALC_RR_EMPTY_TITLE')} />
      )}
    </div>
  );
}
