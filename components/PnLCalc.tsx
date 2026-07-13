'use client';
import { useState } from 'react';

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

export default function PnLCalc() {
  const [dir,      setDir]      = useState<Dir>('long');
  const [entry,    setEntry]    = useState('');
  const [exit,     setExit]     = useState('');
  const [margin,   setMargin]   = useState('');
  const [leverage, setLeverage] = useState('1');

  const result = calc(
    dir,
    parseFloat(entry)    || 0,
    parseFloat(exit)     || 0,
    parseFloat(margin)   || 0,
    parseFloat(leverage) || 0,
  );

  const isProfit = result ? result.pnl >= 0 : null;

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>PnL Calculator</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Entry · exit · margin · leverage → PnL, PnL%, ROE%</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Direction</div>
        <div className="ps-presets">
          <button className={`ps-preset${dir === 'long'  ? ' on' : ''}`} onClick={() => setDir('long')}>Long</button>
          <button className={`ps-preset${dir === 'short' ? ' on' : ''}`} onClick={() => setDir('short')}>Short</button>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Trade</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Entry Price</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Entry Price" type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">Exit Price</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Exit Price" type="number" placeholder="0.00" value={exit} onChange={e => setExit(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">Margin (Capital)</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Margin" type="number" placeholder="1000" value={margin} onChange={e => setMargin(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Leverage</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Leverage" type="number" placeholder="1" min="1" value={leverage} onChange={e => setLeverage(e.target.value)} />
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
            {isProfit ? '▲ PROFIT' : '▼ LOSS'} — {result.pnlPct >= 0 ? '+' : ''}{result.pnlPct.toFixed(2)}%
          </div>
          <div className="ps-results">
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl">PnL</div>
              <div className="ps-rval">{result.pnl >= 0 ? '+' : '-'}{fmtUSD(result.pnl)}</div>
            </div>
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl">PnL%</div>
              <div className="ps-rval">{result.pnlPct >= 0 ? '+' : ''}{result.pnlPct.toFixed(2)}%</div>
            </div>
            <div className={`ps-result ${isProfit ? 'ps-result-profit' : 'ps-result-risk'}`}>
              <div className="ps-rlbl">ROE%</div>
              <div className="ps-rval">{result.roe >= 0 ? '+' : ''}{result.roe.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Notional Value</div>
              <div className="ps-rval">{fmtUSD(result.notional)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Quantity</div>
              <div className="ps-rval">{fmtQ(result.quantity)}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="ps-empty">Fill in entry, exit, margin and leverage to calculate</div>
      )}
    </div>
  );
}
