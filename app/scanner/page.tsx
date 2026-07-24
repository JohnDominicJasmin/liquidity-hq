'use client';
import CoinHeatmap from '@/components/CoinHeatmap';
import DrawdownChart from '@/components/DrawdownChart';
import MultiTFSqueezeView from '@/components/MultiTFSqueezeView';
import SignalAccuracy from '@/components/SignalAccuracy';
import SetupScanner from '@/components/SetupScanner';
import AccumulationTracker from '@/components/AccumulationTracker';
import DistributionTracker from '@/components/DistributionTracker';
import PageHint from '@/components/PageHint';
import { useLabels } from '@/lib/labels';

export default function ScannerPage() {
  const { t } = useLabels();
  return (
    <div>
      <PageHint
        pageKey="scanner"
        title={t('SCANNER_HINT_TITLE')}
        body={t('SCANNER_HINT_BODY')}
      />
      <AccumulationTracker />
      <DistributionTracker />
      <CoinHeatmap />
      <DrawdownChart />
      <MultiTFSqueezeView />
      <SignalAccuracy />
      <SetupScanner />
    </div>
  );
}
