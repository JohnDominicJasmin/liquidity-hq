'use client';
import SetupScanner from '@/components/SetupScanner';
import OISpikeScanner from '@/components/OISpikeScanner';

export default function ScannerPage() {
  return (
    <div>
      <div className="mb-header">
        <div className="mb-title">📡 Scanner</div>
        <div className="mb-subtitle">Cross-coin setup scanner + live OI spike monitor</div>
      </div>
      <div className="dash-section">OI Spike Scanner</div>
      <OISpikeScanner />
      <div className="dash-section" style={{ marginTop: 16 }}>Setup Scanner</div>
      <SetupScanner />
    </div>
  );
}
