import OrderBookHeatmap from '@/components/OrderBookHeatmap';

export const metadata = {
  title: 'Book Map — Liquidity HQ',
  description: 'Bookmap-style live order book depth heatmap for BTC/USDT',
};

export default function HeatmapPage() {
  return (
    <main style={{ padding: '12px 14px', maxWidth: 900, margin: '0 auto' }}>
      <OrderBookHeatmap />
    </main>
  );
}
