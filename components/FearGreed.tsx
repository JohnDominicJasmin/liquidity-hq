'use client';
import { useMarket } from '@/lib/marketStore';

const FNG_NOTES: Record<string, string> = {
  'Extreme Fear': 'Market is in extreme fear. Most retail is panic selling. This is when whales accumulate. High probability of a violent bounce raid soon.',
  'Fear': 'Market sentiment is fearful. Retail is nervous. Longs getting hunted. Watch for sudden squeeze setups on the heatmap.',
  'Neutral': 'Market sentiment is balanced. No strong bias either way. Cluster direction + funding rate are your main signals right now.',
  'Greed': 'Market is greedy. Longs are overleveraged and confident. Classic setup for a short squeeze reversal. Watch bright zones above price.',
  'Extreme Greed': 'Extreme greed — most dangerous zone. Everyone is long and euphoric. This is exactly when whales hunt the longs. High reversal risk.',
};

function getScoreCls(v: number): string {
  if (v <= 24) return 'score-extreme-fear';
  if (v <= 44) return 'score-fear';
  if (v <= 55) return 'score-neutral';
  if (v <= 74) return 'score-greed';
  return 'score-extreme-greed';
}

export default function FearGreed() {
  const { store } = useMarket();
  const { fng, fngLabel, fngPrev } = store;

  if (fng == null) {
    return (
      <div className="ind-card">
        <div className="ind-label">Fear &amp; Greed</div>
        <div className="ind-value" style={{ color: '#606060' }}>--</div>
        <div className="ind-note">Loading...</div>
      </div>
    );
  }

  const cls = getScoreCls(fng);
  const delta = fngPrev != null ? fng - fngPrev : null;

  return (
    <div className="ind-card" style={{ gridColumn: 'span 2' }}>
      <div className="ind-label">Fear &amp; Greed Index</div>
      <div className="fng-wrap">
        <div className="fng-row">
          <div>
            <div className={`fng-score ${cls}`}>{fng}</div>
            <div className={`fng-label ${cls}`}>{fngLabel}</div>
          </div>
          <div className="fng-right">
            <div className="fng-bar-bg">
              <div className="fng-marker" style={{ left: fng + '%' }} />
            </div>
            <div className="fng-zones">
              <span>Fear</span><span>Neutral</span><span>Greed</span>
            </div>
            <div className="fng-note">{FNG_NOTES[fngLabel] || FNG_NOTES['Neutral']}</div>
          </div>
        </div>
        {delta != null && (
          <div className="fng-delta-row">
            <div className={`fng-delta-pill ${delta > 3 ? 'fng-delta-up' : delta < -3 ? 'fng-delta-down' : 'fng-delta-flat'}`}>
              {delta > 3 ? '▲' : delta < -3 ? '▼' : '◆'} {delta > 0 ? '+' : ''}{delta} pts vs yesterday
            </div>
            <div style={{ fontSize: 10, color: '#606060' }}>
              Yesterday: <span style={{ fontWeight: 600, color: '#a0a0a0' }}>{fngPrev}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
