'use client';
import { useMarket } from '@/lib/marketStore';
import Ticker from '@/components/Ticker';
import FearGreed from '@/components/FearGreed';
import RaidMeter from '@/components/RaidMeter';
import SOTD from '@/components/SOTD';
import NewsBanner from '@/components/NewsBanner';

const RULES = [
  { n: 1, c: 'np', t: 'No bright cluster = no trade. Period.', b: 'If you cannot point to a bright, tight yellow/white zone on Coinglass 24h Model 2, you are guessing.' },
  { n: 2, c: 'np', t: 'Funding rate tells you direction.', b: '+ve funding = too many longs = whales dump DOWN. -ve funding = too many shorts = whales squeeze UP.' },
  { n: 3, c: 'np', t: 'Time window is everything.', b: 'God Tier (Sun 11PM–Mon 3AM PHT) and Prime (daily 2–5AM PHT) are when raids happen. Dead Zone (12–3PM) = stay out.' },
  { n: 4, c: 'ng', t: 'Enter 0.8–1.5% before the zone.', b: 'Not at the zone. Not after. You front-run the magnet — you do not chase it into the kill zone.' },
  { n: 5, c: 'ng', t: 'Exit the SECOND price touches the cluster.', b: 'Do not hold through the touch expecting more. The raid fuel is spent the moment it hits. Get out fast.' },
  { n: 6, c: 'np', t: 'Maximum 2 trades per day.', b: 'More than 2 = you are gambling, not hunting. Flat 90% of the time is how the best players operate.' },
  { n: 7, c: 'ng', t: 'Never trust the first move after news.', b: 'First 30-45 minutes after big news = fake move. Real directional move comes on the second leg.' },
  { n: 8, c: 'ng', t: 'After a raid = 4 hours rest minimum.', b: 'The fuel is gone. They have eaten. Do not revenge-trade. Do not look for the next setup immediately.' },
];

function BTCDominance() {
  const { store } = useMarket();
  const dom = store.btcDom;
  return (
    <div className="ind-card">
      <div className="ind-label">BTC Dominance</div>
      <div className="ind-value">{dom != null ? dom.toFixed(2) + '%' : '---%'}</div>
      <div className="ind-note">
        {dom == null ? 'Loading...'
          : dom >= 60 ? 'High dominance — alts bleeding.'
          : dom >= 55 ? 'Elevated — BTC leading.'
          : dom >= 48 ? 'Normal range. Mixed market.'
          : 'Low — alt season possible.'}
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Liquidity Hunter HQ</div>
        <div style={{ fontSize: 12, color: '#606060' }}>The complete system — read the map, hunt the stops, get out fast</div>
      </div>

      <NewsBanner />

      <div className="dash-section">Live prices — tap a coin to select</div>
      <Ticker />

      <div className="dash-section">Raid conditions</div>
      <RaidMeter />

      <div className="dash-section">Market indicators</div>
      <div className="ind-row">
        <FearGreed />
      </div>
      <div className="ind-row">
        <BTCDominance />
      </div>

      <div className="dash-section">Secret of the Day</div>
      <SOTD />

      <div className="dash-section">The 8 commandments</div>
      <div className="card">
        <div className="lbl">Core rules — never break these</div>
        {RULES.map(r => (
          <div key={r.n} className="row" style={{ marginBottom: 14 }}>
            <div className={`num ${r.c}`}>{r.n}</div>
            <div>
              <div className="st">{r.t}</div>
              <div className="sb">{r.b}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
