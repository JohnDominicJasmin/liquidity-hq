'use client';
import { useMarket } from '@/lib/marketStore';
import Tip from '@/components/Tip';

const FNG_NOTES: Record<string, string> = {
  'Extreme Fear':  'Whales accumulate - bounce raids likely',
  'Fear':          'Retail nervous - watch squeeze setups',
  'Neutral':       'No bias - follow cluster + funding',
  'Greed':         'Longs overleveraged - dump risk',
  'Extreme Greed': 'Everyone long - whale hunt imminent',
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
        <div className="ind-value" style={{ color: 'var(--txt3)' }}>--</div>
        <div className="ind-note">Loading...</div>
      </div>
    );
  }

  const cls = getScoreCls(fng);
  const delta = fngPrev != null ? fng - fngPrev : null;

  return (
    <div className="ind-card" style={{ gridColumn: 'span 2' }}>
      <div className="ind-label"><Tip text="A 0–100 score measuring overall market sentiment from volatility, volume, and social data. Extreme Fear (under 25) means the market is oversold and historically a good time to watch for bounces. Extreme Greed (above 75) means the market is overheated and a correction is likely.">Fear &amp; Greed Index</Tip></div>
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
            <div className="fng-note">{FNG_NOTES[fngLabel] || FNG_NOTES['Neutral']}</div>
          </div>
        </div>
        {delta != null && (
          <div className="fng-delta-row">
            <div className={`fng-delta-pill ${delta > 3 ? 'fng-delta-up' : delta < -3 ? 'fng-delta-down' : 'fng-delta-flat'}`}>
              {delta > 3 ? '▲' : delta < -3 ? '▼' : '◆'} {delta > 0 ? '+' : ''}{delta} pts vs yesterday
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
              Yesterday: <span style={{ fontWeight: 600, color: 'var(--txt2)' }}>{fngPrev}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
