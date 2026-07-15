'use client';
import CoinHeatmap from '@/components/CoinHeatmap';
import DrawdownChart from '@/components/DrawdownChart';
import MultiTFSqueezeView from '@/components/MultiTFSqueezeView';
import SignalAccuracy from '@/components/SignalAccuracy';
import SetupScanner from '@/components/SetupScanner';
import AccumulationTracker from '@/components/AccumulationTracker';
import DistributionTracker from '@/components/DistributionTracker';
import PageHint from '@/components/PageHint';

export default function ScannerPage() {
  return (
    <div>
      <PageHint
        pageKey="scanner"
        title="Scanners"
        body="Scan the market for squeeze setups, multi-timeframe confluences, and coins showing unusual accumulation or distribution patterns."
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
