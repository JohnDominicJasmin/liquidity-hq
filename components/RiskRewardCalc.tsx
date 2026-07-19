'use client';
import { useState, useEffect } from 'react';
import { useMarket, COIN_LABELS, COIN_DEC, fmtPrice, type CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';

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
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Risk / Reward</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>Entry · SL · TP · win rate → R:R, expected value, breakeven</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Trade Levels</div>
        {coin && (
          <div className="ps-coin-row">
            <div className="ps-coin-irow">
              {livePrice != null ? (
                <button type="button" className="ps-live-btn" onClick={() => setEntry(String(livePrice))} title="Set entry to the current live price">
                  <span className="ps-live-dot" /> {COIN_LABELS[coin]} {fmtPrice(livePrice, COIN_DEC[coin])}
                </button>
              ) : (
                <span className="ps-live-wait">{COIN_LABELS[coin]} price loading…</span>
              )}
            </div>
          </div>
        )}
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
            {result.isLong ? '▲ LONG' : '▼ SHORT'} - {result.rr.toFixed(2)}R setup
          </div>
          <div className="ps-results">
            <div className={`ps-result ${result.rr >= 2 ? 'ps-result-profit' : result.rr < 1.5 ? 'ps-result-danger' : ''}`}>
              <div className="ps-rlbl"><Tip text="Risk:Reward - how many dollars you stand to make for every dollar risked. 2R means a win pays double the loss. Below 1.5R, you need too high a win rate to be profitable long-term - the math doesn't work in your favor.">R:R Ratio</Tip></div>
              <div className="ps-rval">
                {result.rr.toFixed(2)}R&nbsp;{result.rr >= 2 ? '✓' : result.rr < 1.5 ? '✗' : ''}
              </div>
            </div>
            <div className={`ps-result ${result.ev > 0 ? 'ps-result-profit' : 'ps-result-danger'}`}>
              <div className="ps-rlbl"><Tip text="The average $ outcome per unit if you took this exact setup many times at the win rate you entered: (win% × TP distance) - (loss% × SL distance). Positive means the math favors taking the trade; negative means it doesn't, even if it 'feels' right.">Expected Value (per unit)</Tip></div>
              <div className="ps-rval">{result.ev >= 0 ? '+' : ''}{fmtUSD(result.ev)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text="The minimum win rate this exact R:R needs just to break even long-term. Win below this rate and you lose money overall; win above it and the setup is profitable.">Breakeven Win Rate</Tip></div>
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
            <div className="ps-warn"><Warn /> R:R below 1.5 - not worth taking unless win rate is very high</div>
          )}
          {result.ev < 0 && (
            <div className="ps-warn"><Warn /> Negative expected value at {winRate}% win rate - skip this trade</div>
          )}
          {result.rr >= 2 && result.ev > 0 && (
            <div style={{ background: 'var(--green-bg)', border: '0.5px solid var(--green-bdr)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-caption)', color: 'var(--green)', marginBottom: 8 }}>
              ✓ Positive expected value with {result.rr.toFixed(2)}R - good setup
            </div>
          )}
        </>
      ) : (
        <EmptyState dashed title="Fill in entry, stop loss and take profit to calculate" />
      )}
    </div>
  );
}
