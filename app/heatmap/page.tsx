import BookmapChart from '@/components/OrderBookHeatmap';

export const metadata = {
  title: 'Book Map · Liquidity HQ',
  description: 'Bookmap-style real-time order book heatmap — time × price × wall size',
};

export default function HeatmapPage() {
  return (
    <div className="heatmap-page">
      <div className="heatmap-page-header">
        <div className="heatmap-page-title">📈 Order Book Heatmap</div>
        <div className="heatmap-page-sub">
          X = time · Y = price · colour = wall size · white line = price path · brighter = bigger order
        </div>
      </div>
      <BookmapChart />
    </div>
  );
}
