'use client';
import { useState } from 'react';
import { Warn } from '@/components/icons';

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

export default function RiskRewardCalc() {
  const [entry,  setEntry]  = useState('');
  const [sl,     setSl]     = useState('');
  const [tp,     setTp]     = useState('');
  const [winRate, setWinRate] = useState('50');

  const result = calc(
    parseFloat(entry)   || 0,
    parseFloat(sl)      || 0,
    parseFloat(tp)      || 0,
    parseFloat(winRate) || 50,
  );

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Risk / Reward</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Entry · SL · TP · win rate → R:R, expected value, breakeven</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Trade Levels</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Entry Price</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Entry Price" type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
            </div>
          </div>
          <div className="ps-field">
            <label className="ps-lbl">Stop Loss</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-stop" aria-label="Stop Loss" type="number" placeholder="0.00" value={sl} onChange={e => setSl(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">Take Profit</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-tp" aria-label="Take Profit" type="number" placeholder="0.00" value={tp} onChange={e => setTp(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Win Rate</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Win Rate" type="number" placeholder="50" min="1" max="99" value={winRate} onChange={e => setWinRate(e.target.value)} />
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
            {result.isLong ? '▲ LONG' : '▼ SHORT'} — {result.rr.toFixed(2)}R setup
          </div>
          <div className="ps-results">
            <div className={`ps-result ${result.rr >= 2 ? 'ps-result-profit' : result.rr < 1.5 ? 'ps-result-danger' : ''}`}>
              <div className="ps-rlbl">R:R Ratio</div>
              <div className="ps-rval">
                {result.rr.toFixed(2)}R&nbsp;{result.rr >= 2 ? '✓' : result.rr < 1.5 ? '✗' : ''}
              </div>
            </div>
            <div className={`ps-result ${result.ev > 0 ? 'ps-result-profit' : 'ps-result-danger'}`}>
              <div className="ps-rlbl">Expected Value (per unit)</div>
              <div className="ps-rval">{result.ev >= 0 ? '+' : ''}{fmtUSD(result.ev)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Breakeven Win Rate</div>
              <div className="ps-rval">{result.breakevenWR.toFixed(1)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">SL Distance</div>
              <div className="ps-rval">{fmtUSD(result.slDist)} · {result.slPct.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">TP Distance</div>
              <div className="ps-rval">{fmtUSD(result.tpDist)} · {result.tpPct.toFixed(2)}%</div>
            </div>
          </div>
          {result.rr < 1.5 && (
            <div className="ps-warn"><Warn /> R:R below 1.5 — not worth taking unless win rate is very high</div>
          )}
          {result.ev < 0 && (
            <div className="ps-warn"><Warn /> Negative expected value at {winRate}% win rate — skip this trade</div>
          )}
          {result.rr >= 2 && result.ev > 0 && (
            <div style={{ background: 'var(--green-bg)', border: '0.5px solid var(--green-bdr)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--green)', marginBottom: 8 }}>
              ✓ Positive expected value with {result.rr.toFixed(2)}R — good setup
            </div>
          )}
        </>
      ) : (
        <div className="ps-empty">Fill in entry, stop loss and take profit to calculate</div>
      )}
    </div>
  );
}
