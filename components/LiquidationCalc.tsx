'use client';
import { useState } from 'react';
import { Warn } from '@/components/icons';

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

export default function LiquidationCalc() {
  const [dir,      setDir]      = useState<Dir>('long');
  const [entry,    setEntry]    = useState('');
  const [margin,   setMargin]   = useState('');
  const [leverage, setLeverage] = useState('10');
  const [mmr,      setMmr]      = useState('0.5');

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
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Liquidation Price</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--txt3)' }}>Entry · margin · leverage · maintenance margin → liq price and distance</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Direction</div>
        <div className="ps-presets">
          <button className={`ps-preset${dir === 'long'  ? ' on' : ''}`} onClick={() => setDir('long')}>Long</button>
          <button className={`ps-preset${dir === 'short' ? ' on' : ''}`} onClick={() => setDir('short')}>Short</button>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Position</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Entry Price</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Entry Price" type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">Margin (Collateral)</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Margin" type="number" placeholder="1000" value={margin} onChange={e => setMargin(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Leverage</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Leverage" type="number" placeholder="10" min="1" max="125" value={leverage} onChange={e => setLeverage(e.target.value)} />
              <span className="ps-affix ps-suffix">x</span>
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Maintenance Margin</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Maintenance Margin" type="number" placeholder="0.5" step="0.01" value={mmr} onChange={e => setMmr(e.target.value)} />
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
            {dir === 'long' ? '▲ LONG' : '▼ SHORT'} - Liquidation at {fmtP(result.liqPrice)}
          </div>
          <div className="ps-results">
            <div className="ps-result ps-result-danger">
              <div className="ps-rlbl">Liquidation Price</div>
              <div className="ps-rval" style={{ color: 'var(--red)' }}>{fmtP(result.liqPrice)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Distance to Liquidation</div>
              <div className="ps-rval">{fmtUSD(result.distUSD)} · {result.distPct.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Notional Value</div>
              <div className="ps-rval">{fmtUSD(result.notional)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Initial Margin</div>
              <div className="ps-rval">{fmtUSD(result.initMargin)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Maintenance Margin</div>
              <div className="ps-rval">{fmtUSD(result.maintMargin)}</div>
            </div>
          </div>
          {result.distPct < 5 && (
            <div className="ps-warn"><Warn /> Less than 5% from liquidation - dangerously close</div>
          )}
          {result.distPct < 10 && result.distPct >= 5 && (
            <div className="ps-warn"><Warn /> Less than 10% from liquidation - high risk</div>
          )}
        </>
      ) : (
        <div className="ps-empty">Fill in entry price, margin and leverage to calculate</div>
      )}
    </div>
  );
}
