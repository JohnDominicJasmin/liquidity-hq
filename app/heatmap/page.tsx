'use client';
import { useState } from 'react';
import OrderBookHeatmap from '@/components/OrderBookHeatmap';
import AbsorptionDetector from '@/components/AbsorptionDetector';

type Coin = 'btc' | 'eth';
const COINS: Coin[] = ['btc', 'eth'];
const SYMBOLS: Record<Coin, string> = { btc: 'BTCUSDT', eth: 'ETHUSDT' };

export default function HeatmapPage() {
  const [coin, setCoin] = useState<Coin>('btc');

  return (
    <div>
      <div className="mb-header">
        <div className="mb-title">📈 Order Book</div>
        <div className="mb-subtitle">Bookmap heatmap · wall absorption detector · live depth 20</div>
      </div>

      {/* Coin selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {COINS.map(c => (
          <button
            key={c}
            className={`gsc-tf-btn${coin === c ? ' on' : ''}`}
            onClick={() => setCoin(c)}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 700 }}
          >
            {c.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Heatmap canvas — key forces full remount on coin change */}
      <OrderBookHeatmap key={coin + '-heatmap'} symbol={SYMBOLS[coin]} />

      {/* Absorption detector */}
      <AbsorptionDetector key={coin + '-absorb'} coin={coin} />
    </div>
  );
}
