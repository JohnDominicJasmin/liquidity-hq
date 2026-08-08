'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSettings } from '@/lib/settings';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

interface CalcResult {
  riskUSD:      number;
  posUSD:       number;
  posUnits:     number;
  leverage:     number;
  stopDist:     number;
  stopPct:      number;
  isLong:       boolean;
  rrRatio:      number | null;
  potentialPnL: number | null;
}

function calculate(acc: number, riskPct: number, entry: number, stop: number, tp: number | null): CalcResult | null {
  if (acc <= 0 || riskPct <= 0 || entry <= 0 || stop <= 0 || entry === stop) return null;
  const riskUSD  = acc * (riskPct / 100);
  const stopDist = Math.abs(entry - stop);
  const stopPct  = (stopDist / entry) * 100;
  const posUnits = riskUSD / stopDist;
  const posUSD   = posUnits * entry;
  const leverage = posUSD / acc;
  const isLong   = entry > stop;

  let rrRatio: number | null = null;
  let potentialPnL: number | null = null;
  if (tp && tp > 0 && tp !== entry) {
    const tpDist = Math.abs(tp - entry);
    rrRatio      = tpDist / stopDist;
    potentialPnL = riskUSD * rrRatio;
  }

  return { riskUSD, posUSD, posUnits, leverage, stopDist, stopPct, isLong, rrRatio, potentialPnL };
}

function fmtUSD(v: number) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PositionSizer({ coin }: { coin: CoinId | '' }) {
  const router = useRouter();
  const { store } = useMarket();
  const { settings, loading: settingsLoading, update: updateSettings } = useSettings();
  const { t } = useLabels();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState(() => searchParams.get('acc') ?? '');
  const [riskPct, setRiskPct] = useState(() => searchParams.get('risk') ?? '1');
  const [entry,   setEntry]   = useState(() => searchParams.get('entry') ?? '');
  const [stop,    setStop]    = useState(() => searchParams.get('stop') ?? '');
  const [tp,      setTp]      = useState(() => searchParams.get('tp') ?? '');
  const seededRef = useRef(false);

  const livePrice = coin ? (store.coins[coin]?.price ?? null) : null;
  const coinLabel = coin ? COIN_LABELS[coin] : '';

  // Coin is picked one level up (shared across all calculator tabs) - when
  // it changes (including on mount, e.g. switching back to this tab), fill
  // Entry with its current live price. One-shot per coin change, so later
  // price ticks don't overwrite what the user is editing; the "live" button
  // re-syncs on demand.
  //
  // Adjusted during render rather than from an effect - React's documented
  // shape for "reset some state when a prop changes", and what
  // react-hooks/set-state-in-effect is pointing at. The effect version painted
  // once with the previous coin's price still in the box before correcting
  // itself; setting during render re-renders before anything is shown.
  const [seededCoin, setSeededCoin] = useState<CoinId | ''>('');
  if (coin && coin !== seededCoin) {
    setSeededCoin(coin);
    const p = store.coins[coin]?.price;
    if (p != null) setEntry(String(p));
  }

  /* Seed from Settings (replaces old localStorage read) - URL params win, so a
     shared link always reproduces the sender's exact setup.

     Waits for settingsLoading to clear, and that guard is load-bearing rather
     than cosmetic. SettingsProvider starts at DEFAULT_SETTINGS, whose
     account_size is 1000 and risk_pct 1.5 - both truthy. Without the guard this
     effect ran on mount against those placeholders, seeded 1000/1.5, and set
     seededRef. When the user's real settings arrived a moment later the effect
     re-ran and hit the early return, so a saved account size was silently
     discarded and the calculator always started at the default.

     On a position-size calculator that is not a cosmetic flash: every figure it
     produced was scaled to an account balance the user had not chosen. */
  useEffect(() => {
    if (settingsLoading || seededRef.current) return;
    seededRef.current = true;
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('acc')  && settings.account_size) setAccount(String(settings.account_size));
    if (!urlParams.has('risk') && settings.risk_pct)      setRiskPct(String(settings.risk_pct));
  }, [settingsLoading, settings.account_size, settings.risk_pct]);

  /* Sync every input to the URL so the setup - entry, stop, TP, account,
     risk - is shareable, same pattern as Arena's coin+tf sync. Coin itself
     is synced one level up in app/calc/page.tsx, which owns that state. */
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const set = (k: string, v: string) => { v ? p.set(k, v) : p.delete(k); };
    set('acc',   account);
    set('risk',  riskPct);
    set('entry', entry);
    set('stop',  stop);
    set('tp',    tp);
    window.history.replaceState(null, '', url.toString());
  }, [account, riskPct, entry, stop, tp]);

  const saveAccount = (v: string) => {
    setAccount(v);
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) updateSettings({ account_size: n });
  };
  const saveRisk = (v: string) => {
    setRiskPct(v);
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) updateSettings({ risk_pct: n });
  };

  const result = calculate(
    parseFloat(account) || 0,
    parseFloat(riskPct) || 0,
    parseFloat(entry)   || 0,
    parseFloat(stop)    || 0,
    tp ? parseFloat(tp) : null,
  );

  const logTrade = () => {
    const p = new URLSearchParams();
    p.set('dir',  result?.isLong ? 'LONG' : 'SHORT');
    p.set('entry', entry);
    p.set('stop',  stop);
    if (tp)      p.set('tp',   tp);
    if (account) p.set('acc',  account);
    if (riskPct) p.set('risk', riskPct);
    router.push('/journal?' + p.toString());
  };

  return (
    // lhq-private: account size and risk are entered, but the sizing result is
    // rendered text. Masked in session replay, see lib/sessionRecording.ts.
    <div className="lhq-private">
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_SIZER_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_SIZER_SUBTITLE')}</div>
      </div>

      {/* Account & Risk */}
      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_SIZER_ACCOUNT_RISK_LABEL')}</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_SIZER_ACCOUNT_SIZE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_SIZER_ACCOUNT_SIZE_LABEL')} type="number" placeholder="10000" value={account} onChange={e => saveAccount(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">{t('CALC_SIZER_RISK_PCT_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_SIZER_RISK_PCT_ARIA')} type="number" placeholder="1" step="0.1" min="0.1" max="10" value={riskPct} onChange={e => saveRisk(e.target.value)} />
              <span className="ps-affix ps-suffix">%</span>
            </div>
          </div>
        </div>
        <div className="ps-presets">
          {['0.25', '0.5', '1', '1.5', '2'].map(p => (
            <button key={p} className={`ps-preset${riskPct === p ? ' on' : ''}`} onClick={() => saveRisk(p)}>{p}%</button>
          ))}
        </div>
        {account && riskPct && (
          <div className="ps-risk-line">
            {t('CALC_SIZER_AT_RISK_PREFIX')} <strong style={{ color: 'var(--red)' }}>{fmtUSD((parseFloat(account) || 0) * ((parseFloat(riskPct) || 0) / 100))}</strong>
          </div>
        )}
      </div>

      {/* Trade Levels */}
      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_SIZER_TRADE_LEVELS_LABEL')}</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setEntry(String(livePrice))} title={t('CALC_SIZER_LIVE_PRICE_TITLE')}>
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{t('CALC_SIZER_PRICE_LOADING', { coin: COIN_LABELS[coin] })}</span>
              )}
            </div>
          </div>
        )}
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_SIZER_ENTRY_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_SIZER_ENTRY_PRICE_LABEL')} type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_SIZER_STOP_LOSS_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-stop" aria-label={t('CALC_SIZER_STOP_LOSS_LABEL')} type="number" placeholder="0.00" value={stop} onChange={e => setStop(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_SIZER_TP_LABEL')} <span className="ps-opt">{t('CALC_SIZER_TP_OPTIONAL_HINT')}</span></label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-tp" aria-label={t('CALC_SIZER_TP_LABEL')} type="number" placeholder="0.00" value={tp} onChange={e => setTp(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {result ? (
        <>
          <div className="ps-results">
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_SIZER_RESULT_DIRECTION')}</div>
              <div className="ps-rval">
                <span className={`ps-dir-pill${result.isLong ? ' ps-dir-long' : ' ps-dir-short'}`}>
                  {result.isLong ? t('CALC_SIZER_LONG_PILL') : t('CALC_SIZER_SHORT_PILL')}
                </span>
              </div>
            </div>
            <div className="ps-result ps-result-risk">
              <div className="ps-rlbl">{t('CALC_SIZER_RESULT_RISK_USD')}</div>
              <div className="ps-rval">{fmtUSD(result.riskUSD)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_SIZER_RESULT_POS_SIZE')}</div>
              <div className="ps-rval">{fmtUSD(result.posUSD)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_SIZER_RESULT_UNITS')}{coinLabel ? ` (${coinLabel})` : ''}</div>
              <div className="ps-rval">
                {result.posUnits < 1 ? result.posUnits.toFixed(6) : result.posUnits.toFixed(4)}{coinLabel ? ` ${coinLabel}` : ''}
              </div>
            </div>
            <div className={`ps-result${result.leverage > 10 ? ' ps-result-danger' : result.leverage > 5 ? ' ps-result-warn' : ''}`}>
              <div className="ps-rlbl"><Tip text={t('CALC_SIZER_LEVERAGE_TIP')}>{t('CALC_SIZER_LEVERAGE_LABEL')}</Tip></div>
              <div className="ps-rval">{result.leverage.toFixed(1)}x{result.leverage > 10 ? <Warn style={{ marginLeft: 3 }} /> : null}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_SIZER_RESULT_STOP_DISTANCE')}</div>
              <div className="ps-rval">{fmtUSD(result.stopDist)} · {result.stopPct.toFixed(2)}%</div>
            </div>
            {result.rrRatio != null && (
              <div className={`ps-result${result.rrRatio >= 2 ? ' ps-result-good' : result.rrRatio < 1.5 ? ' ps-result-danger' : ''}`}>
                <div className="ps-rlbl"><Tip text={t('CALC_SIZER_RR_TIP')}>{t('CALC_SIZER_RR_LABEL')}</Tip></div>
                <div className="ps-rval">
                  {result.rrRatio.toFixed(2)}R&nbsp;{result.rrRatio >= 2 ? '✓' : result.rrRatio < 1.5 ? '✗' : ''}
                </div>
              </div>
            )}
            {result.potentialPnL != null && (
              <div className="ps-result ps-result-profit">
                <div className="ps-rlbl">{t('CALC_SIZER_RESULT_POTENTIAL_PROFIT')}</div>
                <div className="ps-rval">+{fmtUSD(result.potentialPnL)}</div>
              </div>
            )}
          </div>

          {result.leverage > 10 && (
            <div className="ps-warn"><Warn /> {t('CALC_SIZER_WARN_HIGH_LEVERAGE')}</div>
          )}
          {result.rrRatio != null && result.rrRatio < 1.5 && (
            <div className="ps-warn"><Warn /> {t('CALC_SIZER_WARN_LOW_RR')}</div>
          )}

          <button className="ps-log-btn" onClick={logTrade}>
            {t('CALC_SIZER_LOG_TRADE_BUTTON')}
          </button>
        </>
      ) : (
        <EmptyState dashed title={t('CALC_SIZER_EMPTY_TITLE')} />
      )}
    </div>
  );
}
