'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/settings';
import { Warn } from '@/components/icons';

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

export default function PositionSizer() {
  const router = useRouter();
  const { settings, update: updateSettings } = useSettings();
  const [account, setAccount] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [entry,   setEntry]   = useState('');
  const [stop,    setStop]    = useState('');
  const [tp,      setTp]      = useState('');

  /* Seed from Settings (replaces old localStorage read) */
  useEffect(() => {
    if (settings.account_size) setAccount(String(settings.account_size));
    if (settings.risk_pct)     setRiskPct(String(settings.risk_pct));
  }, [settings.account_size, settings.risk_pct]);

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
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Position Sizer</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Account · risk % · entry · stop → size, leverage & R:R</div>
      </div>

      {/* Account & Risk */}
      <div className="ps-card">
        <div className="ps-card-lbl">Account & Risk</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Account Size</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Account Size" type="number" placeholder="10000" value={account} onChange={e => saveAccount(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Risk %</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Risk Percentage" type="number" placeholder="1" step="0.1" min="0.1" max="10" value={riskPct} onChange={e => saveRisk(e.target.value)} />
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
            At risk: <strong style={{ color: '#f87171' }}>{fmtUSD((parseFloat(account) || 0) * ((parseFloat(riskPct) || 0) / 100))}</strong>
          </div>
        )}
      </div>

      {/* Trade Levels */}
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
              <input className="ps-inp ps-inp-stop" aria-label="Stop Loss" type="number" placeholder="0.00" value={stop} onChange={e => setStop(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="ps-row" style={{ marginTop: 10 }}>
          <div className="ps-field">
            <label className="ps-lbl">Take Profit <span className="ps-opt">(optional — shows R:R)</span></label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp ps-inp-tp" aria-label="Take Profit" type="number" placeholder="0.00" value={tp} onChange={e => setTp(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {result ? (
        <>
          <div className="ps-results">
            <div className="ps-result">
              <div className="ps-rlbl">Direction</div>
              <div className="ps-rval">
                <span className={`ps-dir-pill${result.isLong ? ' ps-dir-long' : ' ps-dir-short'}`}>
                  {result.isLong ? '▲ LONG' : '▼ SHORT'}
                </span>
              </div>
            </div>
            <div className="ps-result ps-result-risk">
              <div className="ps-rlbl">$ at Risk</div>
              <div className="ps-rval">{fmtUSD(result.riskUSD)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Position Size</div>
              <div className="ps-rval">{fmtUSD(result.posUSD)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Units</div>
              <div className="ps-rval">
                {result.posUnits < 1 ? result.posUnits.toFixed(6) : result.posUnits.toFixed(4)}
              </div>
            </div>
            <div className={`ps-result${result.leverage > 10 ? ' ps-result-danger' : result.leverage > 5 ? ' ps-result-warn' : ''}`}>
              <div className="ps-rlbl">Leverage</div>
              <div className="ps-rval">{result.leverage.toFixed(1)}x{result.leverage > 10 ? <Warn style={{ marginLeft: 3 }} /> : null}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Stop Distance</div>
              <div className="ps-rval">{fmtUSD(result.stopDist)} · {result.stopPct.toFixed(2)}%</div>
            </div>
            {result.rrRatio != null && (
              <div className={`ps-result${result.rrRatio >= 2 ? ' ps-result-good' : result.rrRatio < 1.5 ? ' ps-result-danger' : ''}`}>
                <div className="ps-rlbl">R:R Ratio</div>
                <div className="ps-rval">
                  {result.rrRatio.toFixed(2)}R&nbsp;{result.rrRatio >= 2 ? '✓' : result.rrRatio < 1.5 ? '✗' : ''}
                </div>
              </div>
            )}
            {result.potentialPnL != null && (
              <div className="ps-result ps-result-profit">
                <div className="ps-rlbl">Potential Profit</div>
                <div className="ps-rval">+{fmtUSD(result.potentialPnL)}</div>
              </div>
            )}
          </div>

          {result.leverage > 10 && (
            <div className="ps-warn"><Warn /> Leverage over 10x — reduce size or widen stop</div>
          )}
          {result.rrRatio != null && result.rrRatio < 1.5 && (
            <div className="ps-warn"><Warn /> R:R below 1.5 — skip or move TP further out</div>
          )}

          <button className="ps-log-btn" onClick={logTrade}>
            Log This Trade in Journal →
          </button>
        </>
      ) : (
        <div className="ps-empty">Fill in account size, entry and stop loss to calculate</div>
      )}
    </div>
  );
}
