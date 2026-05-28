import OrderBookHeatmap from '@/components/OrderBookHeatmap';

export const metadata = {
  title: 'Book Map · Liquidity HQ',
  description: 'Real-time BTC/USDT order book depth heatmap',
};

export default function HeatmapPage() {
  return (
    <div className="heatmap-page">
      <div className="heatmap-page-header">
        <div className="heatmap-page-title">📈 Order Book Heatmap</div>
        <div className="heatmap-page-sub">
          LIVE BTC/USDT · 20-level depth · bids = green · asks = red · brighter = bigger wall · white line = mid-price
        </div>
      </div>
      <OrderBookHeatmap />
    </div>
  );
}
