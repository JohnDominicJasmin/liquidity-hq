'use client';
import { useState } from 'react';
import PositionSizer    from '@/components/PositionSizer';
import LiquidationCalc  from '@/components/LiquidationCalc';
import PnLCalc          from '@/components/PnLCalc';
import RiskRewardCalc   from '@/components/RiskRewardCalc';
import FundingCostCalc  from '@/components/FundingCostCalc';

const TABS = [
  { id: 'sizer',       label: 'Position Sizer'     },
  { id: 'liquidation', label: 'Liquidation Price'  },
  { id: 'pnl',         label: 'PnL'                },
  { id: 'rr',          label: 'Risk / Reward'      },
  { id: 'funding',     label: 'Funding Cost'       },
];

export default function CalcPage() {
  const [tab, setTab] = useState('sizer');

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Calculators</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Position sizing, liquidation, PnL, risk/reward, and funding cost</div>
      </div>
      <div className="ps-presets" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} className={`ps-preset${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sizer'       && <PositionSizer />}
      {tab === 'liquidation' && <LiquidationCalc />}
      {tab === 'pnl'         && <PnLCalc />}
      {tab === 'rr'          && <RiskRewardCalc />}
      {tab === 'funding'     && <FundingCostCalc />}
    </div>
  );
}
