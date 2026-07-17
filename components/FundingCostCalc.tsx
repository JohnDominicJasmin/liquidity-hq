'use client';
import { useState } from 'react';
import { Warn } from '@/components/icons';

interface FundResult {
  totalCost:    number;
  costPerDay:   number;
  costPerWeek:  number;
  annualRate:   number;
  payments:     number;
  breakeven:    number;
}

function calc(posSize: number, fundingRate: number, hours: number): FundResult | null {
  if (posSize <= 0 || fundingRate === 0 || hours <= 0) return null;
  const payments   = hours / 8;
  const rate       = fundingRate / 100;
  const totalCost  = posSize * rate * payments;
  const costPerDay = posSize * rate * 3;
  const costPerWeek = posSize * rate * 21;
  const annualRate = rate * 3 * 365 * 100;
  const breakeven  = Math.abs(totalCost);
  return { totalCost, costPerDay, costPerWeek, annualRate, payments, breakeven };
}

function fmtUSD(v: number) {
  return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DURATION_PRESETS = [
  { label: '8h',   hours: 8    },
  { label: '1d',   hours: 24   },
  { label: '3d',   hours: 72   },
  { label: '7d',   hours: 168  },
  { label: '30d',  hours: 720  },
];

export default function FundingCostCalc() {
  const [posSize,     setPosSize]     = useState('');
  const [fundingRate, setFundingRate] = useState('0.01');
  const [hours,       setHours]       = useState('24');

  const result = calc(
    parseFloat(posSize)     || 0,
    parseFloat(fundingRate) || 0,
    parseFloat(hours)       || 0,
  );

  const rate     = parseFloat(fundingRate) || 0;
  const isLong   = rate > 0;
  const isPaying = isLong;

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Funding Cost</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Position size · funding rate · hold duration → total funding cost</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Position</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Position Size (Notional)</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label="Position Size" type="number" placeholder="10000" value={posSize} onChange={e => setPosSize(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">Funding Rate (8h)</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Funding Rate (8h)" type="number" placeholder="0.01" step="0.001" value={fundingRate} onChange={e => setFundingRate(e.target.value)} />
              <span className="ps-affix ps-suffix">%</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--txt3)' }}>
          {rate > 0
            ? 'Positive rate - longs pay shorts. You pay if long.'
            : rate < 0
              ? 'Negative rate - shorts pay longs. You pay if short.'
              : 'Enter a funding rate to see who pays.'}
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">Hold Duration</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">Duration (hours)</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label="Duration (hours)" type="number" placeholder="24" min="1" value={hours} onChange={e => setHours(e.target.value)} />
              <span className="ps-affix ps-suffix">h</span>
            </div>
          </div>
        </div>
        <div className="ps-presets" style={{ marginTop: 10 }}>
          {DURATION_PRESETS.map(p => (
            <button key={p.label} className={`ps-preset${hours === String(p.hours) ? ' on' : ''}`} onClick={() => setHours(String(p.hours))}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {result ? (
        <>
          <div className="ps-banner" style={
            isPaying
              ? { background: 'var(--red-bg)',   color: 'var(--red)',   border: '0.5px solid var(--red-bdr)'   }
              : { background: 'var(--green-bg)', color: 'var(--green)', border: '0.5px solid var(--green-bdr)' }
          }>
            {isPaying ? '▼ PAYING' : '▲ RECEIVING'} funding - {result.payments} payment{result.payments !== 1 ? 's' : ''}
          </div>
          <div className="ps-results">
            <div className={`ps-result ${isPaying ? 'ps-result-danger' : 'ps-result-profit'}`}>
              <div className="ps-rlbl">Total Funding Cost</div>
              <div className="ps-rval">{isPaying ? '-' : '+'}{fmtUSD(result.totalCost)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Cost Per Day</div>
              <div className="ps-rval">{fmtUSD(result.costPerDay)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Cost Per Week</div>
              <div className="ps-rval">{fmtUSD(result.costPerWeek)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Annualized Rate</div>
              <div className="ps-rval">{result.annualRate.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Number of Payments</div>
              <div className="ps-rval">{result.payments}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">Breakeven PnL Needed</div>
              <div className="ps-rval">{fmtUSD(result.breakeven)}</div>
            </div>
          </div>
          {result.annualRate > 50 && isPaying && (
            <div className="ps-warn"><Warn /> Annualized rate over 50% - funding is eating your position fast</div>
          )}
        </>
      ) : (
        <div className="ps-empty">Fill in position size and funding rate to calculate</div>
      )}
    </div>
  );
}
