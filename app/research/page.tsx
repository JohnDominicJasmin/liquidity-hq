'use client';
import HypothesisTracker from '@/components/HypothesisTracker';
import PageHint from '@/components/PageHint';
import CycleDayCounter from '@/components/CycleDayCounter';
import BtcRiskLevel from '@/components/BtcRiskLevel';
import CycleChart from '@/components/CycleChart';
import VolatilityRegime from '@/components/VolatilityRegime';
import DryPowder from '@/components/DryPowder';
import GlobalMacroContext from '@/components/GlobalMacroContext';
import OnChainScore from '@/components/OnChainScore';

export default function ResearchPage() {
  return (
    <>
      <PageHint
        pageKey="research"
        title="Market Research"
        body="Big-picture context: cycle positioning, BTC risk level, volatility regime, on-chain score, macro environment, and dry powder. Use this for daily orientation before trading."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div style={{ borderRadius: 10, overflow: 'hidden' }}><CycleDayCounter /></div>
        <div style={{ borderRadius: 10, overflow: 'hidden' }}><BtcRiskLevel /></div>
      </div>
      <div style={{ marginBottom: 10 }}><VolatilityRegime /></div>
      <div style={{ marginBottom: 10 }}><DryPowder /></div>
      <div style={{ marginBottom: 10 }}><GlobalMacroContext /></div>
      <div style={{ marginBottom: 10 }}><OnChainScore /></div>
      <div style={{ marginBottom: 10 }}><CycleChart /></div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, padding: '0 2px' }}>
          Hypothesis Tracker
        </div>
        <HypothesisTracker />
      </div>
    </>
  );
}
