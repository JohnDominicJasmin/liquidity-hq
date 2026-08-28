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
import { useLabels } from '@/lib/labels';
import { useDesignMode } from '@/components/DesignModeProvider';

export default function ResearchPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
  return (
    <div className={mode === 'terminal' ? 'research-term-wrap' : undefined}>
      <PageHint
        pageKey="research"
        title={t('RESEARCH_HINT_TITLE')}
        body={t('RESEARCH_HINT_BODY')}
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
        <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, padding: '0 2px' }}>
          {t('RESEARCH_HYPOTHESIS_TRACKER_TITLE')}
        </div>
        <HypothesisTracker />
      </div>
    </div>
  );
}
