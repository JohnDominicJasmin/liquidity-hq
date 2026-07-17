'use client';
import { useState, Suspense } from 'react';
import PositionSizer    from '@/components/PositionSizer';
import LiquidationCalc  from '@/components/LiquidationCalc';
import PnLCalc          from '@/components/PnLCalc';
import RiskRewardCalc   from '@/components/RiskRewardCalc';
import FundingCostCalc  from '@/components/FundingCostCalc';
import DcaCalc          from '@/components/DcaCalc';

const TABS = [
  { id: 'sizer',       label: 'Position Sizer'     },
  { id: 'liquidation', label: 'Liquidation Price'  },
  { id: 'pnl',         label: 'PnL'                },
  { id: 'rr',          label: 'Risk / Reward'      },
  { id: 'funding',     label: 'Funding Cost'       },
  { id: 'dca',         label: 'DCA Average'        },
];

function CalcPageContent() {
  const [tab, setTab] = useState('sizer');

  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Calculators</h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>Position sizing, liquidation, PnL, risk/reward, funding cost, and DCA average</div>
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
      {tab === 'dca'         && <DcaCalc />}
    </div>
  );
}

export default function CalcPage() {
  return (
    <Suspense>
      <CalcPageContent />
    </Suspense>
  );
}
