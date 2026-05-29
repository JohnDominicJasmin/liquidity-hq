'use client';
import { useState } from 'react';
import { useMarket, COINS, BYBIT_SYMS, COIN_DEC, fmtPrice, fmtChg, fmtOI, classifyFunding } from '@/lib/marketStore';
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

const OI_TREND_META: Record<string, { txt: string; sub: string; hint: string; col: string }> = {
  strong_up:   { txt: '↑OI ↑P', sub: 'New longs — real trend',  hint: 'New money entering longs. Trend has conviction — follow it.',      col: '#34d399' },
  strong_down: { txt: '↑OI ↓P', sub: 'New shorts — real dump',  hint: 'Fresh shorts being added. Real downtrend — not a dip to buy.',     col: '#f87171' },
  weak_up:     { txt: '↓OI ↑P', sub: 'Short covering — weak',   hint: 'Shorts exiting, not new longs. Fake pump — no fresh conviction.',  col: '#86efac' },
  weak_down:   { txt: '↓OI ↓P', sub: 'Long exits — no panic',   hint: 'Longs taking profit/exiting. Not new shorts — capitulation risk.', col: '#fca5a5' },
};

/* ── Coin Sidebar — desktop only ── */
function CoinSidebar() {
  const { store, selectCoin } = useMarket();

  const OI_SIG: Record<string, { txt: string; col: string }> = {
    strong_up:   { txt: '↑↑ OI', col: '#34d399' },
    strong_down: { txt: '↑↓ OI', col: '#f87171' },
    weak_up:     { txt: '↓↑ OI', col: '#86efac' },
    weak_down:   { txt: '↓↓ OI', col: '#fca5a5' },
  };

  return (
    <div className="csb-container">
      <div className="csb-header-row">Live Prices · tap to select</div>
      {COINS.map(id => {
        const d   = store.coins[id];
        const dec = COIN_DEC[id];
        const up  = (d?.change ?? 0) >= 0;
        const sel = store.selectedCoin === id;
        const fund = d?.fundingRate != null ? classifyFunding(d.fundingRate) : null;
        const oiSig = d?.oiTrend ? OI_SIG[d.oiTrend] : null;
        const tbp = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : null;
        const tkrCol = tbp == null ? '' : tbp >= 65 ? '#34d399' : tbp <= 35 ? '#f87171' : '#606060';
        const tkrBg  = tbp == null ? '' : tbp >= 65 ? 'rgba(52,211,153,0.1)' : tbp <= 35 ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.03)';

        return (
          <div key={id} className={`csb-row${sel ? ' csb-sel' : ''}`} onClick={() => selectCoin(id)}>
            <div className="csb-top">
              <span className="csb-name">{id.toUpperCase()}</span>
              <span className="csb-price">{d?.price ? '$' + fmtPrice(d.price, dec) : '—'}</span>
            </div>
            <div className="csb-top" style={{ marginTop: 1 }}>
              <span className="csb-oi">
                {d?.oi != null ? fmtOI(d.oi) + ' OI' : ''}
              </span>
              <span className={`csb-chg ${up ? 'chg-up' : 'chg-dn'}`}>{d ? fmtChg(d.change) : '--'}</span>
            </div>
            <div className="csb-sub">
              {fund && (
                <span className={`csb-fr ${fund.cls}`}>
                  FR {(d!.fundingRate! * 100 >= 0 ? '+' : '') + (d!.fundingRate! * 100).toFixed(4)}%
                </span>
              )}
              {oiSig && (
                <span className="csb-badge" style={{ color: oiSig.col, background: oiSig.col + '18' }}>
                  {oiSig.txt}
                </span>
              )}
              {tbp != null && (
                <span className="csb-badge" style={{ color: tkrCol, background: tkrBg }}>
                  {tbp}% buy
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="csb-status">{store.wsStatus}</div>
    </div>
  );
}

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
        <div className="oi-trend-title">📊 OI Trend vs Price</div>
        <div className="oi-trend-hdr">
          <div>Coin</div><div>Signal</div><div>What it means</div>
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
                <div style={{ fontSize: 10, color: 'var(--txt3)' }}>—</div>
              )}
              <div className="oi-trend-desc">
                {!hasPerp ? (
                  <span style={{ color: 'var(--txt3)' }}>No perp</span>
                ) : meta ? (
                  <div>{meta.sub}</div>
                ) : (
                  <span style={{ color: 'var(--txt3)' }}>Warming up…</span>
                )}
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

/* ── GEX Table component ── */
function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '−';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(0) + 'M';
  return sign + '$' + abs.toFixed(0);
}

function GexTable() {
  const { store } = useMarket();
  const { btcNetGex, btcGexFlip, btcGexLevels, btcMaxPain } = store;

  const gexLoaded = btcNetGex !== null && btcGexLevels.length > 0;
  const isLongGamma = (btcNetGex ?? 0) >= 0;

  const gexCol     = isLongGamma ? '#34d399' : '#f87171';
  const gexBg      = isLongGamma ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';
  const gexBorder  = isLongGamma ? 'rgba(52,211,153,0.3)'  : 'rgba(248,113,113,0.3)';

  const maxAbsGex = btcGexLevels.length
    ? Math.max(...btcGexLevels.map(l => Math.abs(l.gex)))
    : 1;

  const spotPrice = store.coins.btc?.price ?? 0;

  return (
    <div className="gex-table">
      {/* Title + net GEX chip */}
      <div className="gex-title-row">
        <div className="gex-title">🔬 BTC Gamma Exposure (GEX)</div>
        {gexLoaded ? (
          <div
            className="gex-net-chip"
            style={{ color: gexCol, background: gexBg, border: `0.5px solid ${gexBorder}` }}
          >
            {fmtGex(btcNetGex!)} net
          </div>
        ) : (
          <div className="gex-net-chip" style={{ color: '#333', background: 'transparent' }}>Fetching…</div>
        )}
        {btcMaxPain != null && (
          <div className="gex-meta">Max pain: ${btcMaxPain.toLocaleString()}</div>
        )}
      </div>

      {/* Signal interpretation */}
      <div className="gex-signal-row">
        {gexLoaded ? (() => {
          // Directional lean: flip level is primary judge, largest GEX magnet is fallback
          const largestGexLevel = btcGexLevels.length > 0
            ? btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
            : null;

          let lean: 'bull' | 'bear' | 'neutral' = 'neutral';
          let leanReason = '';
          if (btcGexFlip != null && spotPrice > 0) {
            if (spotPrice > btcGexFlip) {
              lean = 'bull';
              leanReason = `price above gamma flip ($${btcGexFlip.toLocaleString()})`;
            } else {
              lean = 'bear';
              leanReason = `price below gamma flip ($${btcGexFlip.toLocaleString()})`;
            }
          } else if (largestGexLevel && spotPrice > 0) {
            if (largestGexLevel.strike > spotPrice) {
              lean = 'bull';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is above`;
            } else {
              lean = 'bear';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is below`;
            }
          }

          const leanColor = lean === 'bull' ? '#34d399' : lean === 'bear' ? '#f87171' : '#9ca3af';
          const leanLabel = lean === 'bull' ? '↑ BULLISH LEAN' : lean === 'bear' ? '↓ BEARISH LEAN' : '→ NEUTRAL';
          const regimeLabel = isLongGamma ? 'RANGING' : 'TRENDING';
          const regimeColor = isLongGamma ? '#34d399' : '#f87171';
          const regimeDesc  = isLongGamma
            ? 'price pins & mean-reverts between levels'
            : 'breakouts follow through, no fading';

          return (
            <>
              <span style={{ color: leanColor, fontWeight: 700 }}>{leanLabel}</span>
              {leanReason && <span style={{ color: '#555' }}> — {leanReason}</span>}
              <span style={{ color: '#3a3a3a' }}> · </span>
              <span style={{ color: regimeColor }}>{regimeLabel}</span>
              <span style={{ color: '#555' }}> regime — {regimeDesc}</span>
            </>
          );
        })() : (
          <span style={{ color: '#2a2a2a' }}>Calculating from Deribit options chain…</span>
        )}
      </div>

      {/* Strike chart */}
      {gexLoaded && btcGexLevels.length > 0 && (
        <>
          <div className="gex-hdr">
            <div>Strike</div><div>Gamma exposure</div><div>Net GEX</div>
          </div>
          {btcGexLevels.map(({ strike, gex }) => {
            const pct   = maxAbsGex > 0 ? Math.abs(gex) / maxAbsGex * 100 : 0;
            const col   = gex >= 0 ? 'rgba(52,211,153,0.65)' : 'rgba(248,113,113,0.65)';
            const vcol  = gex >= 0 ? '#34d399' : '#f87171';
            const isAtm = spotPrice > 0 && Math.abs(strike - spotPrice) / spotPrice < 0.005;
            return (
              <div key={strike} className="gex-row" style={isAtm ? { background: 'rgba(255,255,255,0.03)' } : {}}>
                <div className="gex-strike" style={isAtm ? { color: '#e8e8e8' } : {}}>
                  ${strike >= 1000 ? (strike / 1000).toFixed(0) + 'K' : strike}
                  {isAtm && <span style={{ fontSize: 8, color: '#606060', marginLeft: 4 }}>ATM</span>}
                </div>
                <div className="gex-bar-wrap">
                  <div className="gex-bar-fill" style={{ width: `${pct}%`, background: col }} />
                </div>
                <div className="gex-value" style={{ color: vcol }}>{fmtGex(gex)}</div>
              </div>
            );
          })}
        </>
      )}

      {/* Flip level + pin */}
      {gexLoaded && (
        <div className="gex-flip-row">
          {btcGexFlip != null && (
            <div>
              Zero-gamma flip: <span>${btcGexFlip.toLocaleString()}</span>
              <span style={{ color: '#2a2a2a', fontWeight: 400 }}> — break {(btcGexFlip < (spotPrice || btcGexFlip)) ? 'below' : 'above'} = vol acceleration</span>
            </div>
          )}
          {btcGexLevels.length > 0 && (() => {
            const top = btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b);
            return (
              <div>
                Largest GEX: <span>${top.strike.toLocaleString()}</span>
                <span style={{ color: '#2a2a2a', fontWeight: 400 }}> — options pin / magnet strike</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
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
  const [cmdsOpen, setCmdsOpen] = useState(false);

  return (
    <div className="dashboard-grid">

      {/* ── Left sticky sidebar (desktop only) ── */}
      <aside className="dash-sidebar">
        <CoinSidebar />
        <div className="ind-row" style={{ margin: 0 }}><FearGreed /></div>
        <div className="ind-row" style={{ margin: 0 }}><BTCDominance /></div>
      </aside>

      {/* ── Main content ── */}
      <div className="dash-main">
        <div style={{ padding: '1rem 0 0.75rem' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2, letterSpacing: '-0.3px' }}>Liquidity Hunter HQ</div>
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>The complete system — read the map, hunt the stops, get out fast</div>
        </div>

        <NewsBanner />

        {/* Mobile-only ticker + market indicators (desktop shows in sidebar) */}
        <div className="mobile-only">
          <div className="dash-section">Live prices</div>
          <Ticker />
          <div className="dash-section">Market indicators</div>
          <div className="ind-row"><FearGreed /></div>
          <div className="ind-row"><BTCDominance /></div>
        </div>

        <div className="dash-section">Raid conditions</div>
        <RaidMeter />

        <div className="dash-section">Edge signals</div>
        <EdgeSignals />

        {/* GEX + Macro: shown inline on mobile/tablet, hidden when right panel is visible */}
        <div className="hide-on-desktop">
          <div className="dash-section">Gamma exposure</div>
          <GexTable />
          <div className="dash-section">Macro correlations</div>
          <MacroStrip />
        </div>

        <div className="dash-section">Secret of the Day</div>
        <SOTD />

        <div
          className="dash-section"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setCmdsOpen(o => !o)}
        >
          The 8 commandments
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt3)', letterSpacing: 0 }}>
            {cmdsOpen ? '▲ hide' : '▼ show'}
          </span>
        </div>
        {cmdsOpen && (
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
        )}
      </div>

      {/* ── Right panel (desktop ≥1100px only) ── */}
      <aside className="dash-right">
        <div className="dash-section" style={{ marginTop: 0, marginBottom: 8 }}>Gamma exposure</div>
        <GexTable />
        <div className="dash-section" style={{ marginBottom: 8 }}>Macro</div>
        <MacroStrip />
      </aside>

    </div>
  );
}
