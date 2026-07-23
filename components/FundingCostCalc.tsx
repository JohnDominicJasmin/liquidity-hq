'use client';
import { useState } from 'react';
import { Warn } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

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
  const { t } = useLabels();
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
        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('CALC_FUNDING_TITLE')}</h2>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CALC_FUNDING_SUBTITLE')}</div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_FUNDING_POSITION_LABEL')}</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_FUNDING_POS_SIZE_LABEL')}</label>
            <div className="ps-irow">
              <span className="ps-affix">$</span>
              <input className="ps-inp" aria-label={t('CALC_FUNDING_POS_SIZE_LABEL')} type="number" placeholder="10000" value={posSize} onChange={e => setPosSize(e.target.value)} />
            </div>
          </div>
          <div className="ps-field ps-field-sm">
            <label className="ps-lbl">{t('CALC_FUNDING_RATE_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_FUNDING_RATE_LABEL')} type="number" placeholder="0.01" step="0.001" value={fundingRate} onChange={e => setFundingRate(e.target.value)} />
              <span className="ps-affix ps-suffix">%</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {rate > 0
            ? t('CALC_FUNDING_RATE_HINT_POSITIVE')
            : rate < 0
              ? t('CALC_FUNDING_RATE_HINT_NEGATIVE')
              : t('CALC_FUNDING_RATE_HINT_NEUTRAL')}
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-card-lbl">{t('CALC_FUNDING_DURATION_LABEL')}</div>
        <div className="ps-row">
          <div className="ps-field">
            <label className="ps-lbl">{t('CALC_FUNDING_DURATION_HOURS_LABEL')}</label>
            <div className="ps-irow">
              <input className="ps-inp" aria-label={t('CALC_FUNDING_DURATION_HOURS_LABEL')} type="number" placeholder="24" min="1" value={hours} onChange={e => setHours(e.target.value)} />
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
            {isPaying ? t('CALC_FUNDING_BANNER_PAYING', { count: result.payments }) : t('CALC_FUNDING_BANNER_RECEIVING', { count: result.payments })}
          </div>
          <div className="ps-results">
            <div className={`ps-result ${isPaying ? 'ps-result-danger' : 'ps-result-profit'}`}>
              <div className="ps-rlbl">{t('CALC_FUNDING_RESULT_TOTAL_COST')}</div>
              <div className="ps-rval">{isPaying ? '-' : '+'}{fmtUSD(result.totalCost)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_FUNDING_RESULT_COST_PER_DAY')}</div>
              <div className="ps-rval">{fmtUSD(result.costPerDay)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_FUNDING_RESULT_COST_PER_WEEK')}</div>
              <div className="ps-rval">{fmtUSD(result.costPerWeek)}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text={t('CALC_FUNDING_ANNUALIZED_TIP')}>{t('CALC_FUNDING_ANNUALIZED_LABEL')}</Tip></div>
              <div className="ps-rval">{result.annualRate.toFixed(2)}%</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl">{t('CALC_FUNDING_RESULT_NUM_PAYMENTS')}</div>
              <div className="ps-rval">{result.payments}</div>
            </div>
            <div className="ps-result">
              <div className="ps-rlbl"><Tip text={t('CALC_FUNDING_BREAKEVEN_TIP')}>{t('CALC_FUNDING_BREAKEVEN_LABEL')}</Tip></div>
              <div className="ps-rval">{fmtUSD(result.breakeven)}</div>
            </div>
          </div>
          {result.annualRate > 50 && isPaying && (
            <div className="ps-warn"><Warn /> {t('CALC_FUNDING_WARN_HIGH_RATE')}</div>
          )}
        </>
      ) : (
        <EmptyState dashed title={t('CALC_FUNDING_EMPTY_TITLE')} />
      )}
    </div>
  );
}
