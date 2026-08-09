'use client';
import { useState, useEffect } from 'react';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import EmptyState from '@/components/EmptyState';
import { useLabels } from '@/lib/labels';

interface Entry { price: string; qty: string; }

const EMPTY_ENTRY: Entry = { price: '', qty: '' };
const MAX_ENTRIES = 8;

function fmtUSD(v: number) {
  return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

export default function DcaCalc({ coin }: { coin: CoinId | '' }) {
  const { store } = useMarket();
  const { t } = useLabels();
  const [entries, setEntries] = useState<Entry[]>([
    { ...EMPTY_ENTRY }, { ...EMPTY_ENTRY },
  ]);
  const [currentPrice, setCurrentPrice] = useState('');

  const livePrice = coin ? (store.coins[coin]?.price ?? null) : null;

  // Coin is picked one level up (shared across all calculator tabs) - fill
  // Current (Market) Price with its live price whenever the shared pick
  // changes, including on mount. The historical buy-entry rows are left
  // alone - those are the user's own past purchase prices, not live data.
  useEffect(() => {
    if (!coin) return;
    const p = store.coins[coin]?.price;
    if (p != null) setCurrentPrice(String(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  const valid = entries
    .map(e => ({ price: parseFloat(e.price), qty: parseFloat(e.qty) }))
    .filter(e => e.price > 0 && e.qty > 0);

  const totalCost = valid.reduce((s, e) => s + e.price * e.qty, 0);
  const totalQty  = valid.reduce((s, e) => s + e.qty, 0);
  const avgEntry  = totalQty > 0 ? totalCost / totalQty : null;

  const cur = parseFloat(currentPrice) || 0;
  const curValue = cur > 0 && totalQty > 0 ? cur * totalQty : null;
  const pnlAbs   = curValue != null ? curValue - totalCost : null;
  const pnlPct   = pnlAbs != null && totalCost > 0 ? (pnlAbs / totalCost) * 100 : null;
  const isProfit  = pnlAbs != null && pnlAbs >= 0;

  function setEntry(i: number, field: keyof Entry, val: string) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }

  function addEntry() {
    if (entries.length < MAX_ENTRIES) setEntries(prev => [...prev, { ...EMPTY_ENTRY }]);
  }

  function removeEntry(i: number) {
    if (entries.length <= 2) return;
    setEntries(prev => prev.filter((_, idx) => idx !== i));
  }

  return (
    // lhq-private: the entered ladder and its averages are the user's position.
    // Rendered as text, so maskAllInputs does not reach it.
    <div className="lhq-private">
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_DCA_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_DCA_SUBTITLE')}</div>
      </div>

      {/* Entry rows */}
      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_DCA_ENTRIES_LABEL')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: '6px 8px', alignItems: 'end', marginBottom: 8 }}>
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{t('CALC_DCA_ENTRY_PRICE_COL')}</span>
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{t('CALC_DCA_QTY_COL')}</span>
          <span />
          {entries.map((e, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div className="ps-irow">
                <span className="ps-affix">$</span>
                <input
                  className="ps-inp"
                  aria-label={t('CALC_DCA_ENTRY_PRICE_ARIA', { n: i + 1 })}
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={e.price}
                  onChange={ev => setEntry(i, 'price', ev.target.value)}
                />
              </div>
              <div className="ps-irow">
                <input
                  className="ps-inp"
                  aria-label={t('CALC_DCA_QTY_ARIA', { n: i + 1 })}
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={e.qty}
                  onChange={ev => setEntry(i, 'qty', ev.target.value)}
                />
              </div>
              <button
                onClick={() => removeEntry(i)}
                disabled={entries.length <= 2}
                style={{
                  width: 26, height: 34, borderRadius: 6, border: '0.5px solid var(--bdr)',
                  background: 'transparent', color: entries.length <= 2 ? 'var(--txt-dim)' : 'var(--txt3)',
                  cursor: entries.length <= 2 ? 'not-allowed' : 'pointer', fontSize: '1rem', lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
          ))}
        </div>
        {entries.length < MAX_ENTRIES && (
          <button
            onClick={addEntry}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 'var(--fs-caption)', fontWeight: 600,
              border: '0.5px dashed var(--bdr)', background: 'transparent',
              color: 'var(--txt3)', cursor: 'pointer', marginTop: 4,
            }}
          >{t('CALC_DCA_ADD_ENTRY_BUTTON')}</button>
        )}
      </div>

      {/* Current price */}
      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_DCA_CURRENT_PRICE_LABEL')}</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setCurrentPrice(String(livePrice))} title={t('CALC_DCA_LIVE_PRICE_TITLE')}>
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{t('CALC_DCA_PRICE_LOADING', { coin: COIN_LABELS[coin] })}</span>
              )}
            </div>
          </div>
        )}
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_DCA_MARKET_PRICE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input
                className="ps-inp"
                aria-label={t('CALC_DCA_MARKET_PRICE_LABEL')}
                type="number"
                placeholder={t('CALC_DCA_MARKET_PRICE_PLACEHOLDER')}
                value={currentPrice}
                onChange={e => setCurrentPrice(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {valid.length >= 1 ? (
        <>
          <div className="ps-results">
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_DCA_RESULT_AVG_ENTRY')}</div>
              <div className="ps-rval">{avgEntry != null ? fmtUSD(avgEntry) : '-'}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_DCA_RESULT_TOTAL_QTY')}</div>
              <div className="ps-rval">{totalQty > 0 ? totalQty.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '-'}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_DCA_RESULT_TOTAL_COST')}</div>
              <div className="ps-rval">{totalCost > 0 ? fmtUSD(totalCost) : '-'}</div>
            </div>
            {curValue != null && (
              <div className="ps-result">
                <div className="ps-rlbl">{t('CALC_DCA_RESULT_CURRENT_VALUE')}</div>
                <div className="ps-rval">{fmtUSD(curValue)}</div>
              </div>
            )}
            {pnlAbs != null && pnlPct != null && (
              <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-danger'}`}>
                <div className="ps-rlbl">{t('CALC_DCA_RESULT_UNREALIZED_PNL')}</div>
                <div className="ps-rval">
                  {isProfit ? '+' : '-'}{fmtUSD(Math.abs(pnlAbs))}
                  <span style={{ fontSize: 'var(--fs-caption)', marginLeft: 6, opacity: .8 }}>{fmtPct(pnlPct)}</span>
                </div>
              </div>
            )}
          </div>

          {avgEntry != null && cur > 0 && (
            <div className="ps-banner" style={
              cur >= avgEntry
                ? { background: 'var(--green-bg)', color: 'var(--green)', border: '0.5px solid var(--green-bdr)' }
                : { background: 'var(--red-bg)',   color: 'var(--red)',   border: '0.5px solid var(--red-bdr)'   }
            }>
              {cur >= avgEntry
                ? t('CALC_DCA_BANNER_ABOVE', { pct: fmtPct(((cur - avgEntry) / avgEntry) * 100) })
                : t('CALC_DCA_BANNER_BELOW', { pct: fmtPct(((cur - avgEntry) / avgEntry) * 100) })}
            </div>
          )}
        </>
      ) : (
        <EmptyState dashed title={t('CALC_DCA_EMPTY_TITLE')} />
      )}
    </div>
  );
}
