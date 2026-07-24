'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { COINS, COIN_LABELS, type CoinId } from '@/lib/marketStore';
import CoinIcon from '@/components/CoinIcon';
import PositionSizer    from '@/components/PositionSizer';
import LiquidationCalc  from '@/components/LiquidationCalc';
import PnLCalc          from '@/components/PnLCalc';
import RiskRewardCalc   from '@/components/RiskRewardCalc';
import FundingCostCalc  from '@/components/FundingCostCalc';
import DcaCalc          from '@/components/DcaCalc';
import { useLabels } from '@/lib/labels';

const TABS = [
  { id: 'sizer',       key: 'CALC_TAB_SIZER'       },
  { id: 'liquidation', key: 'CALC_TAB_LIQUIDATION' },
  { id: 'pnl',         key: 'CALC_TAB_PNL'         },
  { id: 'rr',          key: 'CALC_TAB_RR'          },
  { id: 'funding',     key: 'CALC_TAB_FUNDING'     },
  { id: 'dca',         key: 'CALC_TAB_DCA'         },
] as const;

function CalcPageContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState('sizer');
  const { t } = useLabels();

  // Coin selection lives here, one level above the tabs, so it survives
  // switching between Position Sizer / Liquidation / PnL / etc instead of
  // each calculator owning (and losing) its own pick on unmount.
  const [coin, setCoin] = useState<CoinId | ''>(() => {
    const c = searchParams.get('coin')?.toLowerCase() ?? '';
    return (COINS as string[]).includes(c) ? c as CoinId : '';
  });
  const [coinMenuOpen, setCoinMenuOpen] = useState(false);
  const coinMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (coin) url.searchParams.set('coin', coin); else url.searchParams.delete('coin');
    window.history.replaceState(null, '', url.toString());
  }, [coin]);

  useEffect(() => {
    if (!coinMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (coinMenuRef.current && !coinMenuRef.current.contains(e.target as Node)) setCoinMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCoinMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [coinMenuOpen]);

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_PAGE_TITLE')}</h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_PAGE_SUBTITLE')}</div>
      </div>

      <div className="ps-presets" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(tabDef => (
          <button key={tabDef.id} className={`ps-preset${tab === tabDef.id ? ' on' : ''}`} onClick={() => setTab(tabDef.id)}>
            {t(tabDef.key)}
          </button>
        ))}
      </div>

      {/* Shared coin picker - persists across tabs; each calculator below
          auto-fills its own relevant price field from whatever's picked
          here, so switching tools doesn't mean re-selecting the coin. */}
      <div className="ps-coin-row" style={{ marginBottom: 16 }}>
        <label className="ps-lbl">{t('CALC_COIN_LABEL')} <span className="ps-opt">{t('CALC_COIN_OPTIONAL_HINT')}</span></label>
        <div className="ps-coin-irow">
          <div className="ps-coin-combo" ref={coinMenuRef}>
            <button
              type="button"
              className="ps-coin-trigger"
              aria-haspopup="listbox"
              aria-expanded={coinMenuOpen}
              onClick={() => setCoinMenuOpen(o => !o)}
            >
              {coin
                ? <CoinIcon coin={coin} size={18} />
                : <span className="ps-coin-trigger-dot" />}
              <span className="ps-coin-trigger-label">{coin ? COIN_LABELS[coin] : t('CALC_COIN_ANY_LABEL')}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="ps-coin-chevron">
                <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {coinMenuOpen && (
              <div className="ps-coin-menu" role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={coin === ''}
                  className={`ps-coin-opt${coin === '' ? ' on' : ''}`}
                  onClick={() => { setCoin(''); setCoinMenuOpen(false); }}
                >
                  <span className="ps-coin-opt-dot" />
                  <span>{t('CALC_COIN_ANY_LABEL')}</span>
                </button>
                {COINS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={coin === c}
                    className={`ps-coin-opt${coin === c ? ' on' : ''}`}
                    onClick={() => { setCoin(c); setCoinMenuOpen(false); }}
                  >
                    <CoinIcon coin={c} size={18} />
                    <span>{COIN_LABELS[c]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {tab === 'sizer'       && <PositionSizer coin={coin} />}
      {tab === 'liquidation' && <LiquidationCalc coin={coin} />}
      {tab === 'pnl'         && <PnLCalc coin={coin} />}
      {tab === 'rr'          && <RiskRewardCalc coin={coin} />}
      {tab === 'funding'     && <FundingCostCalc />}
      {tab === 'dca'         && <DcaCalc coin={coin} />}
    </div>
  );
}

export default function CalcPage() {
  return (
    <Suspense>
      <CalcPageContent />
    </Suspense>
  );
}
