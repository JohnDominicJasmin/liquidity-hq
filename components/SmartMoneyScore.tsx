'use client';
import { useMarket } from '@/lib/marketStore';

/* ── Score mappings ── */
const SCORE_CHIP: Record<string, { bg: string; col: string }> = {
  '2':  { bg: 'rgba(52,211,153,0.12)',  col: '#34d399' },
  '1':  { bg: 'rgba(134,239,172,0.10)', col: '#86efac' },
  '0':  { bg: 'rgba(156,163,175,0.07)', col: '#555'    },
  '-1': { bg: 'rgba(252,165,165,0.10)', col: '#fca5a5' },
  '-2': { bg: 'rgba(248,113,113,0.12)', col: '#f87171' },
};
function chip(s: number) { return SCORE_CHIP[String(s)] ?? SCORE_CHIP['0']; }

function getVerdict(score: number): { label: string; col: string } {
  if (score >=  6) return { label: 'STRONG BULLISH', col: '#34d399' };
  if (score >=  3) return { label: 'BULLISH',        col: '#34d399' };
  if (score >=  1) return { label: 'MILD BULLISH',   col: '#86efac' };
  if (score <= -6) return { label: 'STRONG BEARISH', col: '#ef4444' };
  if (score <= -3) return { label: 'BEARISH',        col: '#f87171' };
  if (score <= -1) return { label: 'MILD BEARISH',   col: '#fca5a5' };
  return { label: 'NEUTRAL', col: '#9ca3af' };
}

interface SRow { name: string; badge: string; value: string; score: number; note: string; global: boolean; has: boolean }

export default function SmartMoneyScore() {
  const { store } = useMarket();
  const coin     = store.selectedCoin;
  const coinData = store.coins[coin];

  /* ── 1. Coinbase Premium (BTC-wide) ── */
  const cbPct = store.cbPremiumPct;
  const cbScore: number = cbPct == null ? 0
    : cbPct >  0.05 ?  2 : cbPct >  0.01 ?  1
    : cbPct < -0.05 ? -2 : cbPct < -0.01 ? -1 : 0;
  const cbRow: SRow = {
    name: 'CB Premium', badge: 'BTC',
    value: cbPct != null ? (cbPct >= 0 ? '+' : '') + cbPct.toFixed(3) + '%' : '—',
    score: cbScore,
    note: cbPct == null       ? 'Fetching…'
      : cbScore >=  2 ? 'US institutions buying ▲'
      : cbScore ===  1 ? 'Mild CB premium'
      : cbScore <= -2 ? 'US institutions selling ▼'
      : cbScore === -1 ? 'Mild CB discount'
      :                  'Neutral spread',
    global: true, has: cbPct != null,
  };

  /* ── 2. Exchange Net Flow (BTC-wide) ── */
  const flow = store.btcExchangeNetFlow;
  const flowScore: number = flow == null ? 0
    : flow >  100 ? -2 : flow >  50 ? -1
    : flow < -100 ?  2 : flow < -50 ?  1 : 0;
  const flowRow: SRow = {
    name: 'Exch. Flow', badge: 'BTC',
    value: flow != null ? (flow >= 0 ? '+$' : '−$') + Math.abs(flow).toFixed(0) + 'M' : '—',
    score: flowScore,
    note: flow == null         ? 'Fetching…'
      : flowScore >=  2 ? 'Heavy outflow — accumulation ▲'
      : flowScore ===  1 ? 'Outflow — mild accum.'
      : flowScore <= -2 ? 'Heavy inflow — sell pressure ▼'
      : flowScore === -1 ? 'Inflow — mild sell pressure'
      :                    'Balanced flow',
    global: true, has: flow != null,
  };

  /* ── 3. Taker Buy/Sell ratio (per-coin) ── */
  const takerRaw = coinData?.takerBuyRatio;
  const buyPct   = takerRaw != null ? Math.round(takerRaw * 100) : null;
  const takerScore: number = buyPct == null ? 0
    : buyPct >= 65 ?  2 : buyPct >= 55 ?  1
    : buyPct <= 35 ? -2 : buyPct <= 45 ? -1 : 0;
  const takerRow: SRow = {
    name: 'Taker B/S', badge: coin.toUpperCase(),
    value: buyPct != null ? buyPct + '% buy' : '—',
    score: takerScore,
    note: buyPct == null       ? 'Fetching…'
      : takerScore >=  2 ? 'Aggressive buyers ▲'
      : takerScore ===  1 ? 'Mild buy pressure'
      : takerScore <= -2 ? 'Aggressive sellers ▼'
      : takerScore === -1 ? 'Mild sell pressure'
      :                     'Balanced flow',
    global: false, has: buyPct != null,
  };

  /* ── 4. OI Trend (per-coin) ── */
  const oiTrend = coinData?.oiTrend;
  const oiScore: number = oiTrend == null ? 0
    : oiTrend === 'strong_up'   ?  2
    : oiTrend === 'weak_up'     ?  1
    : oiTrend === 'weak_down'   ? -1
    : /* strong_down */           -2;
  const OI_NOTES: Record<string, string> = {
    strong_up:   'OI↑ Price↑ — new longs ▲',
    weak_up:     'OI↓ Price↑ — short covering',
    weak_down:   'OI↓ Price↓ — long exits',
    strong_down: 'OI↑ Price↓ — new shorts ▼',
  };
  const oiRow: SRow = {
    name: 'OI Trend', badge: coin.toUpperCase(),
    value: oiTrend ? oiTrend.replace('_', ' ') : '—',
    score: oiScore,
    note: oiTrend ? OI_NOTES[oiTrend] : 'Warming up…',
    global: false, has: oiTrend != null,
  };

  /* ── Totals ── */
  const rows: SRow[] = [cbRow, flowRow, takerRow, oiRow];
  const total     = rows.reduce((s, r) => s + (r.has ? r.score : 0), 0);
  const available = rows.filter(r => r.has).length;
  const maxPts    = available * 2 || 8;
  const { label, col } = getVerdict(total);

  /* gauge: each side is 50% of the track */
  const gaugeHalf = maxPts > 0 ? Math.min(Math.abs(total) / maxPts, 1) * 50 : 0;

  return (
    <div className="sms-card">

      {/* ── Top row: title + verdict ── */}
      <div className="sms-header">
        <div>
          <div className="sms-title">Smart Money Score</div>
          <div className="sms-sub">CB premium · exchange flow · taker · OI</div>
        </div>
        <div className="sms-verdict" style={{ color: col }}>{label}</div>
      </div>

      {/* ── Gauge bar ── */}
      <div className="sms-gauge-wrap">
        <div className="sms-gauge-track">
          <div className="sms-gauge-center" />
          {total > 0 && <div className="sms-gauge-pos" style={{ width: gaugeHalf + '%', background: col }} />}
          {total < 0 && <div className="sms-gauge-neg" style={{ width: gaugeHalf + '%', background: col }} />}
        </div>
        <div className="sms-gauge-labels">
          <span style={{ color: '#f87171' }}>Bearish</span>
          <span style={{ color: col, fontWeight: 700 }}>
            {total > 0 ? '+' : ''}{total} / {maxPts}
          </span>
          <span style={{ color: '#34d399' }}>Bullish</span>
        </div>
      </div>

      {/* ── Signal breakdown ── */}
      <div className="sms-hdr">
        <div>Signal</div>
        <div>Value</div>
        <div>Score</div>
        <div>Reading</div>
      </div>

      {rows.map(row => {
        const { bg, col: sc } = chip(row.score);
        return (
          <div key={row.name} className="sms-row">
            <div className="sms-row-name">
              {row.name}
              <span className="sms-badge">{row.badge}</span>
            </div>
            <div className="sms-row-val">{row.value}</div>
            <div className="sms-score-chip" style={{ background: bg, color: sc }}>
              {row.has ? (row.score > 0 ? '+' : '') + row.score : '—'}
            </div>
            <div className="sms-row-note" style={{ color: row.has ? sc : '#333' }}>{row.note}</div>
          </div>
        );
      })}

      <div className="sms-footer">
        CB Premium &amp; Exchange Flow are BTC-wide signals. Taker B/S and OI Trend are {coin.toUpperCase()}-specific.
      </div>
    </div>
  );
}
