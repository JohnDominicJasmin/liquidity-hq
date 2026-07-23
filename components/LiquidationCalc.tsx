'use client';
import { useState, useEffect } from 'react';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

type Dir = 'long' | 'short';

interface LiqResult {
  liqPrice:    number;
  distUSD:     number;
  distPct:     number;
  initMargin:  number;
  maintMargin: number;
  notional:    number;
}

function calc(entry: number, margin: number, lev: number, mmr: number, dir: Dir): LiqResult | null {
  if (entry <= 0 || margin <= 0 || lev <= 0 || mmr <= 0) return null;
  const notional   = margin * lev;
  const initMargin = margin;
  const maintMargin = notional * (mmr / 100);
  const liqPrice = dir === 'long'
    ? entry * (1 - 1 / lev + mmr / 100)
    : entry * (1 + 1 / lev - mmr / 100);
  if (liqPrice <= 0) return null;
  const distUSD = Math.abs(entry - liqPrice);
  const distPct = (distUSD / entry) * 100;
  return { liqPrice, distUSD, distPct, initMargin, maintMargin, notional };
}

function fmtP(v: number) {
  if (v >= 10000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1)     return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + v.toFixed(6);
}
function fmtUSD(v: number) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LiquidationCalc({ coin }: { coin: CoinId | '' }) {
  const { store } = useMarket();
  const { t } = useLabels();
  const [dir,      setDir]      = useState<Dir>('long');
  const [entry,    setEntry]    = useState('');
  const [margin,   setMargin]   = useState('');
  const [leverage, setLeverage] = useState('10');
  const [mmr,      setMmr]      = useState('0.5');

  const livePrice = coin ? (store.coins[coin]?.price ?? null) : null;

  // Coin is picked one level up (shared across all calculator tabs) - fill
  // Entry with its live price whenever the shared pick changes, including
  // on mount (e.g. switching back to this tab). One-shot per coin change,
  // so later price ticks don't overwrite what the user is editing.
  useEffect(() => {
    if (!coin) return;
    const p = store.coins[coin]?.price;
    if (p != null) setEntry(String(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  const result = calc(
    parseFloat(entry)    || 0,
    parseFloat(margin)   || 0,
    parseFloat(leverage) || 0,
    parseFloat(mmr)      || 0,
    dir,
  );

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_LIQ_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_LIQ_SUBTITLE')}</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_LIQ_DIRECTION_LABEL')}</div>
        <div className="ps-presets">
          <button className={`ps-preset${dir === 'long'  ? ' on' : ''}`} onClick={() => setDir('long')}>{t('CALC_LIQ_LONG_BUTTON')}</button>
          <button className={`ps-preset${dir === 'short' ? ' on' : ''}`} onClick={() => setDir('short')}>{t('CALC_LIQ_SHORT_BUTTON')}</button>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_LIQ_POSITION_LABEL')}</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setEntry(String(livePrice))} title={t('CALC_LIQ_LIVE_PRICE_TITLE')}>
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{t('CALC_LIQ_PRICE_LOADING', { coin: COIN_LABELS[coin] })}</span>
              )}
            </div>
          </div>
        )}
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_LIQ_ENTRY_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_LIQ_ENTRY_PRICE_LABEL')} type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_LIQ_MARGIN_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_LIQ_MARGIN_ARIA')} type="number" placeholder="1000" value={margin} onChange={e => setMargin(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">{t('CALC_LIQ_LEVERAGE_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_LIQ_LEVERAGE_LABEL')} type="number" placeholder="10" min="1" max="125" value={leverage} onChange={e => setLeverage(e.target.value)} />
              <span className="ps-affix ps-suffix">x</span>
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl"><Tip text={t('CALC_LIQ_MAINT_MARGIN_TIP')}>{t('CALC_LIQ_MAINT_MARGIN_LABEL')}</Tip></label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_LIQ_MAINT_MARGIN_LABEL')} type="number" placeholder="0.5" step="0.01" value={mmr} onChange={e => setMmr(e.target.value)} />
              <span className="ps-affix ps-suffix">%</span>
            </div>
          </div>
        </div>
        <div className="ps-presets" style={{ marginTop: 10 }}>
          {['5', '10', '20', '25', '50'].map(l => (
            <button key={l} className={`ps-preset${leverage === l ? ' on' : ''}`} onClick={() => setLeverage(l)}>{l}x</button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className="ps-banner ps-banner-long" style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '0.5px solid var(--red-bdr)' }}>
            {dir === 'long'
              ? t('CALC_LIQ_BANNER_LONG', { price: fmtP(result.liqPrice) })
              : t('CALC_LIQ_BANNER_SHORT', { price: fmtP(result.liqPrice) })}
          </div>
          <div className="ps-results">
            <div className="ps-result ps-result-danger">
              <div className="ps-rlbl">{t('CALC_LIQ_RESULT_LIQ_PRICE')}</div>
              <div className="ps-rval" style={{ color: 'var(--red)' }}>{fmtP(result.liqPrice)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_LIQ_RESULT_DISTANCE')}</div>
              <div className="ps-rval">{fmtUSD(result.distUSD)} · {result.distPct.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text={t('CALC_LIQ_NOTIONAL_TIP')}>{t('CALC_LIQ_NOTIONAL_LABEL')}</Tip></div>
              <div className="ps-rval">{fmtUSD(result.notional)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_LIQ_RESULT_INIT_MARGIN')}</div>
              <div className="ps-rval">{fmtUSD(result.initMargin)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_LIQ_RESULT_MAINT_MARGIN')}</div>
              <div className="ps-rval">{fmtUSD(result.maintMargin)}</div>
            </div>
          </div>
          {result.distPct < 5 && (
            <div className="ps-warn"><Warn /> {t('CALC_LIQ_WARN_5PCT')}</div>
          )}
          {result.distPct < 10 && result.distPct >= 5 && (
            <div className="ps-warn"><Warn /> {t('CALC_LIQ_WARN_10PCT')}</div>
          )}
        </>
      ) : (
        <EmptyState dashed title={t('CALC_LIQ_EMPTY_TITLE')} />
      )}
    </div>
  );
}
