import OrderBookDepth from '@/components/OrderBookHeatmap';

export const metadata = {
  title: 'Book Map · Liquidity HQ',
  description: 'Real-time order book depth chart — live bid/ask walls with size visualization',
};

export default function HeatmapPage() {
  return (
    <div className="heatmap-page">
      <div className="heatmap-page-header">
        <div className="heatmap-page-title">📈 Order Book Depth</div>
        <div className="heatmap-page-sub">
          LIVE · real Binance order book · green = buy walls · red = sell walls · wider bar = bigger order
        </div>
      </div>
      <OrderBookDepth />
    </div>
  );
}
