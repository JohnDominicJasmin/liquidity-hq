'use client';
import { useMarket, COINS, BYBIT_SYMS, COIN_DEC, fmtPrice } from '@/lib/marketStore';
import Ticker from '@/components/Ticker';
import FearGreed from '@/components/FearGreed';
import RaidMeter from '@/components/RaidMeter';
import SOTD from '@/components/SOTD';
import NewsBanner from '@/components/NewsBanner';

function MacroStrip() {
  const { store } = useMarket();
  const items = [
    {
      label: 'DXY',
      price: store.dxy,
      chg: store.dxyChg,
      fmt: (v: number) => v.toFixed(2),
      // DXY UP = bad for BTC (dollar strengthens = risk off)
      signal: (chg: number) => chg > 0.2 ? { txt: 'USD strength → BTC headwind', col: 'var(--red)' }
                              : chg < -0.2 ? { txt: 'USD weakness → BTC tailwind', col: 'var(--green)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'SPX',
      price: store.spx,
      chg: store.spxChg,
      fmt: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      // SPX UP = risk-on = good for BTC
      signal: (chg: number) => chg > 0.3 ? { txt: 'Risk-on → crypto tailwind', col: 'var(--green)' }
                              : chg < -0.5 ? { txt: 'Risk-off → crypto headwind', col: 'var(--red)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'Gold',
      price: store.gold,
      chg: store.goldChg,
      fmt: (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      // Gold UP = safe haven demand = mild risk-off
      signal: (chg: number) => chg > 0.5 ? { txt: 'Safe haven bid → mild risk-off', col: 'var(--amber)' }
                              : chg < -0.5 ? { txt: 'Gold falling → risk appetite up', col: 'var(--green)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
  ];

  return (
    <div className="macro-strip">
      <div className="macro-strip-title">🌐 Macro Correlations</div>
      <div className="macro-strip-row">
        {items.map(({ label, price, chg, fmt, signal }) => {
          const sig = chg != null ? signal(chg) : null;
          return (
            <div key={label} className="macro-item">
              <div className="macro-item-label">{label}</div>
              <div className="macro-item-price">
                {price != null ? fmt(price) : '—'}
              </div>
              <div className="macro-item-chg" style={{
                color: chg == null ? 'var(--txt3)' : chg >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : '—'}
              </div>
              {sig && (
                <div className="macro-item-signal" style={{ color: sig.col }}>{sig.txt}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const OI_TREND_META: Record<string, { txt: string; sub: string; col: string }> = {
  strong_up:   { txt: '↑OI ↑P', sub: 'New longs — real trend',  col: '#34d399' },
  strong_down: { txt: '↑OI ↓P', sub: 'New shorts — real dump',  col: '#f87171' },
  weak_up:     { txt: '↓OI ↑P', sub: 'Short covering — weak',   col: '#fbbf24' },
  weak_down:   { txt: '↓OI ↓P', sub: 'Long exits — no panic',   col: '#fbbf24' },
};

function EdgeSignals() {
  const { store } = useMarket();
  const coin = store.coins[store.selectedCoin];

  /* ── Coinbase Premium ── */
  const cbAmt = store.cbPremium;
  const cbPct = store.cbPremiumPct;
  const cbCol  = cbPct == null ? 'var(--txt3)' : cbPct > 0.02 ? 'var(--green)' : cbPct < -0.02 ? 'var(--red)' : 'var(--txt2)';
  const cbBdr  = cbPct == null ? 'var(--bdr)'  : cbPct > 0.05 ? 'var(--green-bdr)' : cbPct < -0.05 ? 'var(--red-bdr)' : 'var(--bdr)';
  const cbSig  = cbPct == null ? 'Loading…'
               : cbPct > 0.05  ? '🇺🇸 US institutional buying'
               : cbPct > 0.01  ? 'CB slight premium'
               : cbPct < -0.05 ? '⚡ US selling — CB discount'
               : cbPct < -0.01 ? 'CB slight discount'
               : 'Neutral spread';

  /* ── VWAP ── */
  const vwap  = coin?.vwap;
  const price = coin?.price;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';
  const vwapBdr   = vwapAbove === null ? 'var(--bdr)' : vwapAbove ? 'var(--green-bdr)' : 'var(--red-bdr)';

  return (
    <>
      {/* Row 1: CB Premium + VWAP */}
      <div className="edge-grid">
        <div className="edge-card" style={{ borderColor: cbBdr }}>
          <div className="edge-card-label">Coinbase Premium</div>
          <div className="edge-card-value" style={{ color: cbCol }}>
            {cbAmt != null
              ? (cbAmt >= 0 ? '+$' : '−$') + Math.abs(cbAmt).toFixed(1)
              : '—'}
          </div>
          {cbPct != null && (
            <div className="edge-card-sub" style={{ color: cbCol }}>
              {(cbPct >= 0 ? '+' : '') + cbPct.toFixed(3) + '%'}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: cbCol }}>{cbSig}</div>
        </div>

        <div className="edge-card" style={{ borderColor: vwapBdr }}>
          <div className="edge-card-label">VWAP · {store.selectedCoin.toUpperCase()}</div>
          {/* Show LIVE price as the hero number */}
          <div className="edge-card-value" style={{ color: vwapCol, fontSize: 15 }}>
            {price != null
              ? '$' + fmtPrice(price, COIN_DEC[store.selectedCoin])
              : '—'}
          </div>
          {/* VWAP reference line */}
          {vwap != null && (
            <div className="edge-card-sub">
              <span style={{ color: 'var(--txt3)' }}>VWAP </span>
              <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>
                ${vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              {vwapPct != null && (
                <span style={{ color: vwapCol }}>
                  {' '}({vwapPct >= 0 ? '+' : ''}{vwapPct.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: vwapCol }}>
            {vwapAbove === null ? 'Calculating…' : vwapAbove ? '▲ Above VWAP — bullish' : '▼ Below VWAP — bearish'}
          </div>
        </div>
      </div>

      {/* Row 2: OI Trend table */}
      <div className="oi-trend-table">
        <div className="oi-trend-title">
          📊 OI Trend vs Price
          <span className="oi-info-wrap">
            <span className="oi-info-icon">ⓘ</span>
            <div className="oi-info-tip">
              <div className="oi-tip-row"><span className="oi-tip-badge tip-green">↑OI ↑P</span><span>Real trend — new money entering longs</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-red">↑OI ↓P</span><span>Real downtrend — new shorts being added</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-amber">↓OI ↑P</span><span>Short covering — no conviction, likely fake</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-amber">↓OI ↓P</span><span>Long exits — capitulation, not fresh shorts</span></div>
            </div>
          </span>
        </div>
        <div className="oi-trend-hdr">
          <div>Coin</div><div>Meaning</div><div>Signal</div>
        </div>
        {COINS.map(id => {
          const c       = store.coins[id];
          const meta    = c?.oiTrend ? OI_TREND_META[c.oiTrend] : null;
          const hasPerp = id in BYBIT_SYMS;
          return (
            <div key={id} className="oi-trend-row">
              <div className="oi-trend-coin">{id.toUpperCase()}</div>
              {meta ? (
                <div
                  className="oi-trend-badge"
                  style={{ color: meta.col, background: meta.col + '1a', border: '0.5px solid ' + meta.col + '44' }}
                >
                  {meta.txt}
                </div>
              ) : (
                <div style={{ fontSize: 9, color: '#2a2a2a' }}>—</div>
              )}
              <div className="oi-trend-desc">
                {!hasPerp
                  ? <span style={{ color: '#2a2a2a' }}>No Bybit perp</span>
                  : meta
                    ? meta.sub
                    : <span style={{ color: '#333' }}>Warming up…</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 3: Taker Buy/Sell ratio table */}
      <div className="taker-table">
        <div className="taker-title">
          ⚡ Taker Buy/Sell Pressure
          <span className="taker-subtitle">Who&apos;s being aggressive — last 5h of 15m candles</span>
        </div>
        <div className="taker-hdr">
          <div>Coin</div><div>Buy/Sell split</div><div>Signal</div>
        </div>
        {COINS.map(id => {
          const c = store.coins[id];
          const ratio = c?.takerBuyRatio;   // 0.0–1.0
          const buyPct  = ratio != null ? Math.round(ratio * 100) : null;
          const sellPct = buyPct != null ? 100 - buyPct : null;

          const isAggBuy  = buyPct != null && buyPct >= 65;
          const isMildBuy = buyPct != null && buyPct >= 55 && buyPct < 65;
          const isAggSell = buyPct != null && buyPct <= 35;
          const isMildSell = buyPct != null && buyPct > 35 && buyPct <= 45;
          const isBalanced = buyPct != null && buyPct > 45 && buyPct < 55;

          const sigTxt = buyPct == null  ? '—'
            : isAggBuy   ? `${buyPct}% buyers ▲`
            : isMildBuy  ? `${buyPct}% mild buy`
            : isAggSell  ? `${sellPct}% sellers ▼`
            : isMildSell ? `${sellPct}% mild sell`
            : `Balanced`;

          const sigCol = buyPct == null ? 'var(--txt3)'
            : isAggBuy   ? '#34d399'
            : isMildBuy  ? '#86efac'
            : isAggSell  ? '#f87171'
            : isMildSell ? '#fca5a5'
            : 'var(--txt3)';

          return (
            <div key={id} className="taker-row">
              <div className="taker-coin">{id.toUpperCase()}</div>
              <div className="taker-bar-wrap">
                {buyPct != null ? (
                  <>
                    <div
                      className="taker-buy-bar"
                      style={{ width: `${buyPct}%` }}
                    />
                    <div className="taker-mid-line" />
                  </>
                ) : (
                  <span style={{ fontSize: 10, color: '#333', paddingLeft: 6 }}>Fetching…</span>
                )}
              </div>
              <div className="taker-signal" style={{ color: sigCol }}>{sigTxt}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

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

      <div className="dash-section">Edge signals</div>
      <EdgeSignals />

      <div className="dash-section">Macro correlations</div>
      <MacroStrip />

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
