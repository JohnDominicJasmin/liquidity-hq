'use client';
import { useState, useEffect } from 'react';
import { useMarket, classifyFunding, type LiqWall } from '@/lib/marketStore';
import { getLocalNow } from '@/lib/session';

function calcWallProximity(
  price: number,
  bidWalls: LiqWall[] | null,
  askWalls: LiqWall[] | null,
): { wallScore: number; wallLabel: string; wallPct: number | null; hasWallData: boolean } {
  const hasWallData = bidWalls !== null || askWalls !== null;
  if (!hasWallData || price <= 0) return { wallScore: 0, wallLabel: 'No data', wallPct: null, hasWallData: false };

  const allWalls = [...(bidWalls ?? []), ...(askWalls ?? [])];
  if (allWalls.length === 0) return { wallScore: 0, wallLabel: 'No walls detected', wallPct: null, hasWallData: true };

  const nearest = allWalls.reduce((closest, w) => {
    const d = Math.abs(w.price - price);
    return d < Math.abs(closest.price - price) ? w : closest;
  });
  const pct = Math.abs(nearest.price - price) / price * 100;

  let wallScore = 0; let wallLabel = '';
  if      (pct <= 0.5)  { wallScore = 30; wallLabel = `Wall ${pct.toFixed(2)}% away — tight`; }
  else if (pct <= 1.0)  { wallScore = 22; wallLabel = `Wall ${pct.toFixed(2)}% away — close`; }
  else if (pct <= 1.5)  { wallScore = 15; wallLabel = `Wall ${pct.toFixed(2)}% away`; }
  else if (pct <= 2.5)  { wallScore =  8; wallLabel = `Wall ${pct.toFixed(2)}% away — far`; }
  else                  { wallScore =  0; wallLabel = `Wall ${pct.toFixed(1)}% — too far`; }

  return { wallScore, wallLabel, wallPct: pct, hasWallData: true };
}

function calcRPM(
  fng: number,
  rpmFunding: 'pos' | 'neg' | 'neu',
  price = 0,
  bidWalls: LiqWall[] | null = null,
  askWalls: LiqWall[] | null = null,
) {
  const pht = getLocalNow();
  const day = pht.getDay();
  const mins = pht.getHours() * 60 + pht.getMinutes();

  const isSunNight = (day === 0 && mins >= 23 * 60) || (day === 1 && mins < 3 * 60);
  const isPrimeTm = mins >= 2 * 60 && mins < 5 * 60;
  const isLondonTm = mins >= 15 * 60 && mins < 18 * 60;
  const isDeadTm = mins >= 12 * 60 && mins < 15 * 60;
  const isMondayEve = day === 1 && mins >= 20 * 60 && mins < 23 * 60;

  let timeScore = 0; let timeLabel = '';
  if (isSunNight) { timeScore = 30; timeLabel = 'God Tier'; }
  else if (isPrimeTm) { timeScore = 26; timeLabel = 'Prime'; }
  else if (isMondayEve) { timeScore = 22; timeLabel = 'Mon Evening'; }
  else if (isLondonTm) { timeScore = 16; timeLabel = 'London Open'; }
  else if (isDeadTm) { timeScore = 2; timeLabel = 'Dead Zone'; }
  else { timeScore = 10; timeLabel = 'Off-peak'; }

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayScores = [15, 14, 11, 10, 9, 4, 12];
  const dayScore = dayScores[day];
  const dayLabel = days[day];

  let fngScore = 0; let fngLabel = '';
  if (fng <= 15) { fngScore = 25; fngLabel = 'Extreme Fear'; }
  else if (fng <= 30) { fngScore = 22; fngLabel = 'Fear'; }
  else if (fng <= 45) { fngScore = 18; fngLabel = 'Mild Fear'; }
  else if (fng <= 55) { fngScore = 12; fngLabel = 'Neutral'; }
  else if (fng <= 70) { fngScore = 18; fngLabel = 'Greed'; }
  else if (fng <= 85) { fngScore = 22; fngLabel = 'High Greed'; }
  else { fngScore = 25; fngLabel = 'Extreme Greed'; }

  let fundScore = 0; let fundLabel = '';
  if (rpmFunding === 'pos') { fundScore = 30; fundLabel = 'Heavily +ve'; }
  else if (rpmFunding === 'neg') { fundScore = 30; fundLabel = 'Heavily -ve'; }
  else { fundScore = 8; fundLabel = 'Neutral'; }

  const { wallScore, wallLabel, hasWallData } = calcWallProximity(price, bidWalls, askWalls);

  // Normalize against the actual max so wall data doesn't silently inflate scores past 100.
  // Without wall data: max = 100. With wall data: max = 130. Always resolves to true 0–100.
  const rawTotal  = timeScore + dayScore + fngScore + fundScore + wallScore;
  const maxTotal  = 30 + 15 + 25 + 30 + (hasWallData ? 30 : 0);
  const total     = Math.min(100, Math.round((rawTotal / maxTotal) * 100));
  let col = 'col-low', barCl = 'bar-low', verdict = '', sub = '';
  if (total >= 80) { col = 'col-max'; barCl = 'bar-max'; verdict = 'Extreme raid conditions'; sub = 'All signals aligned. Whales are likely positioning RIGHT NOW. Have your cluster zones ready and stay glued to the heatmap.'; }
  else if (total >= 60) { col = 'col-high'; barCl = 'bar-high'; verdict = 'High raid probability'; sub = 'Strong conditions for a liquidity hunt. Price is within range of a significant order wall — prime entry window.'; }
  else if (total >= 40) { col = 'col-med'; barCl = 'bar-med'; verdict = 'Moderate conditions'; sub = 'Some signals are aligned but not ideal. Only trade if a very bright, tight cluster is within 1.5% of price.'; }
  else { col = 'col-low'; barCl = 'bar-low'; verdict = 'Low raid probability'; sub = 'Conditions are not favourable right now. High chance of choppy fake moves. Best move is to stay in cash and wait.'; }

  return { total, col, barCl, verdict, sub, timeLabel, timeScore, dayLabel, dayScore, fngLabel, fngScore, fundLabel, fundScore, wallScore, wallLabel, hasWallData };
}

export default function RaidMeter() {
  const { store } = useMarket();
  const { fng, coins, selectedCoin } = store;
  const coin = coins[selectedCoin];
  const fundRpm = coin?.fundingRate != null ? classifyFunding(coin.fundingRate).rpm : 'neu';
  const [manualFund, setManualFund] = useState<'pos' | 'neg' | 'neu' | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const rpmFunding = manualFund ?? fundRpm;

  const price    = coin?.price ?? 0;
  const bidWalls = coin?.orderBidWalls ?? null;
  const askWalls = coin?.orderAskWalls ?? null;

  const [rpm, setRpm] = useState(() => calcRPM(fng ?? 50, rpmFunding, price, bidWalls, askWalls));

  useEffect(() => {
    setRpm(calcRPM(fng ?? 50, rpmFunding, price, bidWalls, askWalls));
    const t = setInterval(() => setRpm(calcRPM(fng ?? 50, rpmFunding, price, bidWalls, askWalls)), 60 * 1000);
    return () => clearInterval(t);
  }, [fng, rpmFunding, price, bidWalls, askWalls]);

  /* ── Ambient urgency state — body data-rpm-level drives global CSS glow ── */
  useEffect(() => {
    document.body.dataset.rpmLevel = rpm.total >= 80 ? 'extreme' : rpm.total >= 60 ? 'high' : '';
    return () => { delete document.body.dataset.rpmLevel; };
  }, [rpm.total]);

  return (
    <div className="rpm-wrap" style={{ marginBottom: 10 }}>
      <div className="rpm-card">
        <div className="rpm-header">
          <div className="rpm-title-row">
            <div className="rpm-pulse" />
            <div>
              <div className="rpm-title">Raid Probability Meter</div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>Is now a good time to trade?</div>
            </div>
          </div>
          <div className="rpm-score-wrap">
            <div suppressHydrationWarning className={`rpm-score ${rpm.col}`}>{rpm.total}</div>
            <div className="rpm-max">/ 100</div>
          </div>
        </div>
        <div suppressHydrationWarning className={`rpm-verdict ${rpm.col}`}>{rpm.verdict}</div>
        <div suppressHydrationWarning className="rpm-sub">{rpm.sub}</div>
        <div className="rpm-bar-track">
          <div className={`rpm-bar-fill ${rpm.barCl}`} style={{ width: rpm.total + '%' }} />
        </div>
        <div className="rpm-factors">
          {[
            { l: 'Session', v: rpm.timeLabel, p: rpm.timeScore },
            { l: 'Day', v: rpm.dayLabel, p: rpm.dayScore },
            { l: 'Fear & Greed', v: rpm.fngLabel, p: rpm.fngScore },
            { l: 'Funding', v: rpm.fundLabel, p: rpm.fundScore },
          ].map(f => (
            <div key={f.l} className="rpm-factor">
              <div className="rpm-factor-label">{f.l}</div>
              <div className="rpm-factor-row">
                <div suppressHydrationWarning className="rpm-factor-val">{f.v}</div>
                <div suppressHydrationWarning className="rpm-factor-pts">{f.p} pts</div>
              </div>
            </div>
          ))}
          {rpm.hasWallData && (
            <div className="rpm-factor">
              <div className="rpm-factor-label">Order Wall</div>
              <div className="rpm-factor-row">
                <div className="rpm-factor-val" style={{ color: rpm.wallScore >= 22 ? '#34d399' : rpm.wallScore >= 8 ? '#fbbf24' : 'var(--txt3)' }}>
                  {rpm.wallLabel}
                </div>
                <div className="rpm-factor-pts">{rpm.wallScore} pts</div>
              </div>
            </div>
          )}
        </div>
        <div className="rpm-funding-row">
          <button
            onClick={() => setShowOverride(v => !v)}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: 11, color: manualFund ? '#fbbf24' : 'var(--txt3)',
              cursor: 'pointer', letterSpacing: '0.04em',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {manualFund ? `override: ${manualFund === 'pos' ? '+ve' : manualFund === 'neg' ? '-ve' : 'neutral'}` : 'override funding'}
              {showOverride ? ' ▲' : ' ▼'}
            </span>
          </button>
          {showOverride && (
            <div className="rpm-funding-opts" style={{ marginTop: 6 }}>
              {(['pos', 'neg', 'neu'] as const).map(opt => (
                <button
                  key={opt}
                  className={`rpm-fopt${rpmFunding === opt ? ` active-${opt}` : ''}`}
                  onClick={() => { setManualFund(f => f === opt ? null : opt); }}
                >
                  {opt === 'pos' ? '+ve / Long heavy' : opt === 'neg' ? '-ve / Short heavy' : 'Neutral'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
