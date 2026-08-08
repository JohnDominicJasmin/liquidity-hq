'use client';
import { useState, useEffect } from 'react';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

type Dir = 'long' | 'short';

interface PnLResult {
  pnl:      number;
  pnlPct:   number;
  roe:      number;
  notional: number;
  quantity: number;
}

function calc(dir: Dir, entry: number, exit: number, margin: number, lev: number): PnLResult | null {
  if (entry <= 0 || exit <= 0 || margin <= 0 || lev <= 0) return null;
  const notional = margin * lev;
  const quantity = notional / entry;
  const pnl      = dir === 'long' ? (exit - entry) * quantity : (entry - exit) * quantity;
  const pnlPct   = (pnl / margin) * 100;
  return { pnl, pnlPct, roe: pnlPct, notional, quantity };
}

function fmtUSD(v: number) {
  return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQ(v: number) {
  return v >= 1 ? v.toFixed(4) : v.toFixed(6);
}

export default function PnLCalc({ coin }: { coin: CoinId | '' }) {
  const { store } = useMarket();
  const { t } = useLabels();
  const [dir,      setDir]      = useState<Dir>('long');
  const [entry,    setEntry]    = useState('');
  const [exit,     setExit]     = useState('');
  const [margin,   setMargin]   = useState('');
  const [leverage, setLeverage] = useState('1');

  const livePrice = coin ? (store.coins[coin]?.price ?? null) : null;

  // Coin is picked one level up (shared across all calculator tabs) - fill
  // Entry (not Exit, that's the user's own hypothetical target) with its
  // live price whenever the shared pick changes, including on mount.
  useEffect(() => {
    if (!coin) return;
    const p = store.coins[coin]?.price;
    if (p != null) setEntry(String(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  const result = calc(
    dir,
    parseFloat(entry)    || 0,
    parseFloat(exit)     || 0,
    parseFloat(margin)   || 0,
    parseFloat(leverage) || 0,
  );

  const isProfit = result ? result.pnl >= 0 : null;

  return (
    // lhq-private: maskAllInputs covers what is typed in; the computed P&L is
    // rendered TEXT and was never covered. See lib/sessionRecording.ts.
    <div className="lhq-private">
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_PNL_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_PNL_SUBTITLE')}</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_PNL_DIRECTION_LABEL')}</div>
        <div className="ps-presets">
          <button className={`ps-preset${dir === 'long'  ? ' on' : ''}`} onClick={() => setDir('long')}>{t('CALC_PNL_LONG_BUTTON')}</button>
          <button className={`ps-preset${dir === 'short' ? ' on' : ''}`} onClick={() => setDir('short')}>{t('CALC_PNL_SHORT_BUTTON')}</button>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_PNL_TRADE_LABEL')}</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setEntry(String(livePrice))} title={t('CALC_PNL_LIVE_PRICE_TITLE')}>
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{t('CALC_PNL_PRICE_LOADING', { coin: COIN_LABELS[coin] })}</span>
              )}
            </div>
          </div>
        )}
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_PNL_ENTRY_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_PNL_ENTRY_PRICE_LABEL')} type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_PNL_EXIT_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_PNL_EXIT_PRICE_LABEL')} type="number" placeholder="0.00" value={exit} onChange={e => setExit(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_PNL_MARGIN_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_PNL_MARGIN_ARIA')} type="number" placeholder="1000" value={margin} onChange={e => setMargin(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">{t('CALC_PNL_LEVERAGE_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_PNL_LEVERAGE_LABEL')} type="number" placeholder="1" min="1" value={leverage} onChange={e => setLeverage(e.target.value)} />
              <span className="ps-affix ps-suffix">x</span>
            </div>
          </div>
        </div>
        <div className="ps-presets" style={{ marginTop: 10 }}>
          {['1', '2', '5', '10', '20'].map(l => (
            <button key={l} className={`ps-preset${leverage === l ? ' on' : ''}`} onClick={() => setLeverage(l)}>{l}x</button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className="ps-banner" style={
            isProfit
              ? { background: 'var(--green-bg)', color: 'var(--green)', border: '0.5px solid var(--green-bdr)' }
              : { background: 'var(--red-bg)',   color: 'var(--red)',   border: '0.5px solid var(--red-bdr)'   }
          }>
            {isProfit
              ? t('CALC_PNL_BANNER_PROFIT', { pct: `${result.pnlPct >= 0 ? '+' : ''}${result.pnlPct.toFixed(2)}%` })
              : t('CALC_PNL_BANNER_LOSS', { pct: `${result.pnlPct >= 0 ? '+' : ''}${result.pnlPct.toFixed(2)}%` })}
          </div>
          <div className="ps-results">
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl">{t('CALC_PNL_RESULT_PNL')}</div>
              <div className="ps-rval">{result.pnl >= 0 ? '+' : '-'}{fmtUSD(result.pnl)}</div>
            </div>
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl">{t('CALC_PNL_RESULT_PNL_PCT')}</div>
              <div className="ps-rval">{result.pnlPct >= 0 ? '+' : ''}{result.pnlPct.toFixed(2)}%</div>
            </div>
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl"><Tip text={t('CALC_PNL_ROE_TIP')}>{t('CALC_PNL_ROE_LABEL')}</Tip></div>
              <div className="ps-rval">{result.roe >= 0 ? '+' : ''}{result.roe.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text={t('CALC_PNL_NOTIONAL_TIP')}>{t('CALC_PNL_NOTIONAL_LABEL')}</Tip></div>
              <div className="ps-rval">{fmtUSD(result.notional)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_PNL_RESULT_QUANTITY')}</div>
              <div className="ps-rval">{fmtQ(result.quantity)}</div>
            </div>
          </div>
        </>
      ) : (
        <EmptyState dashed title={t('CALC_PNL_EMPTY_TITLE')} />
      )}
    </div>
  );
}
