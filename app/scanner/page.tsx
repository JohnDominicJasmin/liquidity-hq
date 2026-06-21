'use client';
import CoinHeatmap from '@/components/CoinHeatmap';
import DrawdownChart from '@/components/DrawdownChart';
import MultiTFSqueezeView from '@/components/MultiTFSqueezeView';
import SetupScanner from '@/components/SetupScanner';

export default function ScannerPage() {
  return (
    <div>
      <CoinHeatmap />
      <DrawdownChart />
      <MultiTFSqueezeView />
      <SetupScanner />
    </div>
  );
}
