'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  useMarket, COINS, COIN_DEC, fmtPrice, fmtChg,
  classifyFunding, computeSqueezeScore, type CoinId, type MarketStore,
} from '@/lib/marketStore';
import { useNews } from '@/components/NewsProvider';
import SessionCountdown from '@/components/SessionCountdown';

/* ── helpers ── */
const COIN_LABELS: Record<CoinId, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR', sui: 'SUI',
  doge: 'DOGE', avax: 'AVAX', link: 'LINK', ada: 'ADA',
  dot: 'DOT', atom: 'ATOM', wif: 'WIF', pepe: 'PEPE', bonk: 'BONK',
};

const OI_ICONS: Record<string, string> = {
  strong_up: '▲', strong_down: '▼', weak_up: '△', weak_down: '▽',
};
const OI_COLORS: Record<string, string> = {
  strong_up: '#34d399', strong_down: '#f87171',
  weak_up: '#fbbf24', weak_down: '#94a3b8',
};

/* Convert decimal hours → "Xh Ym" */
function hToHM(h: number): string {
  if (h < 0.017) return 'NOW';          // < 1 min
  const totalMins = Math.round(h * 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

/* Convert unix-second timestamp → "Xh Ym ago" */
function tsAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m ago` : `${h}h ago`;
}

function rsiColor(rsi: number | null): string {
  if (rsi == null) return 'var(--txt3)';
  if (rsi >= 70) return '#f87171';
  if (rsi >= 60) return '#fbbf24';
  if (rsi <= 30) return '#34d399';
  if (rsi <= 40) return '#86efac';
  return 'var(--txt2)';
}

function volRatioColor(vr: number | null): string {
  if (vr == null) return 'var(--txt3)';
  if (vr >= 2)   return '#f87171';
  if (vr >= 1.5) return '#fbbf24';
  if (vr >= 1.2) return '#86efac';
  return 'var(--txt3)';
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function phtNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

/* ── context builder for Grok ── */
function buildBriefingContext(
  store: MarketStore,
  coinRows: Array<{ id: CoinId; c: MarketStore['coins'][CoinId] }>,
  urgentEcon: Array<{ type: string; name: string; h: number; impact: string; dt: Date }>,
  recentGeo:  Array<{ tag: string; headline: string }>,
): string {
  const phtTime = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const lines = [
    `Time: ${phtTime} PHT`,
    `Fear & Greed: ${store.fng ?? '?'} — ${store.fngLabel ?? '?'}`,
    `BTC Dominance: ${store.btcDom?.toFixed(1) ?? '?'}%`,
    `DXY: ${store.dxy?.toFixed(2) ?? '?'} (${store.dxyChg != null ? (store.dxyChg >= 0 ? '+' : '') + store.dxyChg.toFixed(2) : '?'}% 24h)`,
    `BTC ETF Flow: ${store.etfNetFlow != null ? (store.etfNetFlow >= 0 ? '+' : '') + '$' + store.etfNetFlow.toFixed(0) + 'M' : 'N/A'}`,
    '',
    'COINS (24h change | FR | RSI 15m | CVD divergence | OI trend):',
  ];

  for (const { id, c } of coinRows) {
    if (!c) continue;
    const chg = c.change != null ? (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%' : '—';
    const fr  = c.fundingRate != null ? (c.fundingRate * 100).toFixed(3) + '%' : '—';
    const rsi = c.rsi14 != null ? Math.round(c.rsi14) : '—';
    const cvd = c.cvdDivergence ?? 'none';
    const oi  = c.oiTrend ?? '—';
    lines.push(`${id.toUpperCase()}: ${chg} | FR ${fr} | RSI ${rsi} | CVD ${cvd} | OI ${oi}`);
  }

  if (urgentEcon.length) {
    lines.push('', 'MACRO EVENTS (recent + upcoming):');
    urgentEcon.forEach(e => {
      const lh = (e.dt.getTime() - Date.now()) / 3600000;
      if (lh < 0) {
        const minsAgo = Math.round(-lh * 60);
        lines.push(`  ⚡ JUST RELEASED: ${e.type} — ${e.name} (${minsAgo}m ago — check news for actual print)`);
      } else {
        lines.push(`  ${e.type}: ${e.name} in ${Math.round(lh)}h (${e.impact} impact)`);
      }
    });
  }

  if (recentGeo.length) {
    lines.push('', 'RECENT MARKET NEWS:');
    recentGeo.slice(0, 3).forEach(e => lines.push(`  ${e.tag}: ${e.headline}`));
  }

  return lines.join('\n');
}

/* ── page ── */
export default function MorningBriefing() {
  const { store }                              = useMarket();
  const { econEvents, geoEvents, whaleAlerts } = useNews();
  const [now, setNow]           = useState<Date>(phtNow);
  const [generating, setGen]    = useState(false);
  const [briefErr, setBriefErr] = useState('');

  /* ── AI brief — persist across refreshes via sessionStorage (4h TTL) ── */
  const [brief, setBriefState] = useState('');
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('lhq_brief');
      const ts    = sessionStorage.getItem('lhq_brief_ts');
      if (saved && ts && Date.now() - parseInt(ts) < 4 * 3_600_000) {
        setBriefState(saved);
      }
    } catch { /* incognito / storage blocked */ }
  }, []);
  function setBrief(text: string) {
    setBriefState(text);
    try {
      if (text) {
        sessionStorage.setItem('lhq_brief', text);
        sessionStorage.setItem('lhq_brief_ts', String(Date.now()));
      } else {
        sessionStorage.removeItem('lhq_brief');
        sessionStorage.removeItem('lhq_brief_ts');
      }
    } catch { /* */ }
  }

  /* Tick once per minute so header time stays fresh */
  useEffect(() => {
    const t = setInterval(() => setNow(phtNow()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = now.getHours(), m = now.getMinutes();
  const timeStr = `${pad2(h % 12 || 12)}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'} PHT`;
  const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;

  /* Coin rows */
  const coinRows = COINS.map(id => ({
    id,
    c: store.coins[id],
    sq: computeSqueezeScore(store.coins[id]),
  }));

  /* Loading state — true until at least 8 coins have price data */
  const pricesLoaded = coinRows.filter(r => r.c?.price != null && r.c.price > 0).length >= 8;

  /* Active CVD divergences */
  const cvdAlerts = COINS
    .filter(id => store.coins[id]?.cvdDivergence)
    .map(id => ({ id, div: store.coins[id]!.cvdDivergence! }));

  /* Generate AI briefing */
  async function generateBriefing() {
    setGen(true); setBrief(''); setBriefErr('');
    try {
      const ctx = buildBriefingContext(store, coinRows, urgentEcon, recentGeo);
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx }),
      });
      const data = await res.json() as { briefing?: string; error?: string };
      if (!res.ok || data.error) { setBriefErr(data.error ?? 'Unknown error'); }
      else { setBrief(data.briefing ?? ''); }
    } catch (e) {
      setBriefErr(String(e));
    }
    setGen(false);
  }

  /* Hot setups — score > 20, top 4, only coins with loaded price data */
  const hotSetups = coinRows
    .filter(r => r.sq.score > 20 && r.c?.price != null && r.c.price > 0)
    .sort((a, b) => b.sq.score - a.sq.score)
    .slice(0, 4);

  /* Events — upcoming (next 24h) + recently released (last 6h) */
  const urgentEcon = econEvents.filter(e => { const lh = (e.dt.getTime() - Date.now()) / 3600000; return lh > -6 && lh < 24; }).slice(0, 8);
  const recentGeo  = geoEvents.slice(0, 4);

  /* Macro colors */
  const fng      = store.fng;
  const fngColor = fng == null ? 'var(--txt3)'
    : fng >= 75 ? '#f87171'
    : fng >= 55 ? '#fbbf24'
    : fng <= 25 ? '#34d399'
    : fng <= 45 ? '#86efac'
    : 'var(--txt2)';

  const etfFlow  = store.etfNetFlow;
  const etfColor = etfFlow == null ? 'var(--txt3)' : etfFlow > 0 ? '#34d399' : '#f87171';

  const dxyChg    = store.dxyChg;
  const dxySig    = dxyChg == null    ? '—'
    : dxyChg > 0.2  ? '↑ BTC headwind'
    : dxyChg < -0.2 ? '↓ BTC tailwind'
    : 'Neutral';
  const dxyColor  = dxyChg == null    ? 'var(--txt3)'
    : dxyChg > 0.2  ? '#f87171'
    : dxyChg < -0.2 ? '#34d399'
    : 'var(--txt3)';

  const btcDomHistory = store.btcDomHistory;
  const domTrend = btcDomHistory.length >= 2
    ? btcDomHistory[btcDomHistory.length - 1] > btcDomHistory[0]
      ? { txt: '↑ Alts weak', col: '#fbbf24' }
      : { txt: '↓ Alts active', col: '#34d399' }
    : null;

  const futureEcon = urgentEcon.filter(e => e.dt.getTime() > Date.now());
  const noEvents = futureEcon.length === 0 && recentGeo.length === 0 && (!whaleAlerts || whaleAlerts.length === 0);

  return (
    <div>

      {/* ── Header ── */}
      <div className="mb-header">
        <div className="mb-title">🌅 Morning Briefing</div>
        <div className="mb-subtitle">{dateStr} · {timeStr}</div>
      </div>

      {/* ── AI Briefing ── */}
      <div className="card mb-brief-card">
        <div className="mb-brief-header">
          <span className="lbl" style={{ margin: 0 }}>🤖 AI Pre-Session Briefing</span>
          <button
            className={`mb-brief-btn${generating ? ' loading' : ''}`}
            onClick={generateBriefing}
            disabled={generating}
          >
            {generating ? 'Generating…' : brief ? '↻ Regenerate' : 'Generate Briefing'}
          </button>
        </div>

        {!brief && !generating && !briefErr && (
          <div className="mb-brief-empty">
            Hit Generate to get a LiquidityAI pre-session summary — market conditions, best setup, what to watch.
          </div>
        )}

        {generating && (
          <div className="mb-brief-loading">
            <span className="mb-brief-dot" />
            <span className="mb-brief-dot" />
            <span className="mb-brief-dot" />
          </div>
        )}

        {briefErr && (
          <div style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>⚠ {briefErr}</div>
        )}

        {brief && !generating && (
          <div className="mb-brief-text">
            {brief.split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i} className="mb-brief-para">{para.trim()}</p>
            ))}
            {(() => {
              try {
                const ts = sessionStorage.getItem('lhq_brief_ts');
                if (!ts) return null;
                const mins = Math.round((Date.now() - parseInt(ts)) / 60_000);
                const label = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
                return <div className="mb-brief-cached">Generated {label} · expires in {Math.max(0, 240 - mins)}m</div>;
              } catch { return null; }
            })()}
          </div>
        )}
      </div>

      {/* ── CVD Divergence Callout ── */}
      {cvdAlerts.length > 0 && (
        <div className="card mb-cvd-card">
          <div className="lbl" style={{ marginBottom: 6 }}>⚡ Active CVD Divergences</div>
          <div className="mb-cvd-row">
            {cvdAlerts.map(({ id, div }) => (
              <div
                key={id}
                className="mb-cvd-chip"
                style={{
                  color:       div === 'bullish' ? '#34d399' : '#f87171',
                  borderColor: div === 'bullish' ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)',
                  background:  div === 'bullish' ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                }}
              >
                {id.toUpperCase()} {div === 'bullish' ? '🟢 Bull' : '🔴 Bear'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Session Countdown ── */}
      <SessionCountdown />

      {/* ── Macro Pulse ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl">Macro Pulse</div>
        <div className="mb-macro-row">

          <div className="mb-macro-item">
            <div className="mb-macro-label">Fear &amp; Greed</div>
            <div className="mb-macro-val" style={{ color: fngColor }}>
              {fng != null ? fng : '—'}
            </div>
            <div className="mb-macro-sub" style={{ color: fngColor }}>
              {store.fngLabel || '—'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">BTC Dom</div>
            <div className="mb-macro-val">
              {store.btcDom != null ? store.btcDom.toFixed(1) + '%' : '—'}
            </div>
            <div className="mb-macro-sub" style={{ color: domTrend?.col ?? 'var(--txt3)' }}>
              {domTrend?.txt ?? '—'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">DXY</div>
            <div className="mb-macro-val">
              {store.dxy != null ? store.dxy.toFixed(2) : '—'}
            </div>
            <div className="mb-macro-sub" style={{ color: dxyColor }}>{dxySig}</div>
          </div>

          {etfFlow != null && (
            <div className="mb-macro-item">
              <div className="mb-macro-label">BTC ETF Flow</div>
              <div className="mb-macro-val" style={{ color: etfColor }}>
                {(etfFlow >= 0 ? '+' : '') + '$' + Math.abs(etfFlow).toFixed(0) + 'M'}
              </div>
              <div className="mb-macro-sub" style={{ color: etfColor }}>
                {etfFlow > 100  ? 'Strong inflow'
                : etfFlow > 0   ? 'Mild inflow'
                : etfFlow < -100 ? 'Strong outflow'
                :                  'Mild outflow'}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── All Coins Table ── */}
      <div className="card" style={{ marginBottom: 10, overflowX: 'auto' }}>
        <div className="lbl">All Coins</div>
        <table className="mb-table">
          <thead>
            <tr>
              <th>Coin</th>
              <th>Price</th>
              <th>24h</th>
              <th>Fund</th>
              <th>RSI</th>
              <th>Vol</th>
              <th>OI</th>
            </tr>
          </thead>
          <tbody>
            {coinRows.map(({ id, c }) => {
              const dec   = COIN_DEC[id];
              const fr    = c?.fundingRate ?? null;
              const frCls = fr != null ? classifyFunding(fr) : null;
              const frPct = fr != null ? (fr * 100).toFixed(3) + '%' : '—';
              const frCol = frCls
                ? frCls.rpm === 'pos' ? '#f87171'
                : frCls.rpm === 'neg' ? '#34d399'
                : 'var(--txt3)'
                : 'var(--txt3)';
              const oit  = c?.oiTrend ?? null;
              return (
                <tr key={id}>
                  <td className="mb-coin">{COIN_LABELS[id]}</td>
                  <td>{c?.price != null ? fmtPrice(c.price, dec) : '—'}</td>
                  <td style={{ color: c?.change != null ? c.change >= 0 ? '#34d399' : '#f87171' : 'var(--txt3)' }}>
                    {c?.change != null ? fmtChg(c.change) : '—'}
                  </td>
                  <td style={{ color: frCol }}>{frPct}</td>
                  <td style={{ color: rsiColor(c?.rsi14 ?? null) }}>
                    {c?.rsi14 != null ? (
                      c.rsi14 >= 70 || c.rsi14 <= 30
                        ? <span style={{ background: c.rsi14 >= 70 ? 'rgba(248,113,113,0.18)' : 'rgba(52,211,153,0.18)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{Math.round(c.rsi14)}</span>
                        : Math.round(c.rsi14)
                    ) : '—'}
                  </td>
                  <td style={{ color: volRatioColor(c?.volRatio ?? null) }}>
                    {c?.volRatio != null ? c.volRatio.toFixed(1) + 'x' : '—'}
                  </td>
                  <td style={{ color: oit ? OI_COLORS[oit] : 'var(--txt3)' }}>
                    {oit ? OI_ICONS[oit] : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mb-table-legend">
          <span>Fund: pos = longs pay · neg = shorts pay</span>
          <span style={{ margin: '0 6px', opacity: 0.4 }}>|</span>
          <span>RSI: <span style={{ color: '#f87171' }}>≥70</span> overbought · <span style={{ color: '#34d399' }}>≤30</span> oversold</span>
          <span style={{ margin: '0 6px', opacity: 0.4 }}>|</span>
          <span>OI: <span style={{ color: '#34d399' }}>▲</span> strong · <span style={{ color: '#fbbf24' }}>△</span> weak up · <span style={{ color: '#94a3b8' }}>▽</span> weak dn · <span style={{ color: '#f87171' }}>▼</span> strong dn</span>
        </div>
        {!pricesLoaded && (
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--txt3)', animation: 'pulse 2s infinite' }} />
            Fetching live prices…
          </div>
        )}
      </div>

      {/* ── Hot Setups ── */}
      {hotSetups.length > 0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl">🔥 Hot Setups</div>
          {hotSetups.map(({ id, c, sq }) => (
            <Link key={id} href="/arena" className="mb-setup-row" style={{ textDecoration: 'none', cursor: 'pointer' }}>
              <div className="mb-setup-coin">{COIN_LABELS[id]}</div>
              <div style={{ flex: 1 }}>
                <div className="mb-setup-label" style={{ color: sq.color }}>{sq.label}</div>
                {c?.fundingRate != null && (
                  <div className="mb-setup-sub">
                    FR {(c.fundingRate * 100).toFixed(3)}%
                    {c.longRatio != null ? ` · L/S ${(c.longRatio * 100).toFixed(0)}/${(c.shortRatio! * 100).toFixed(0)}` : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, marginLeft: 'auto' }}>
                <span className="mb-setup-score" style={{ color: sq.color }}>{sq.score}</span>
                <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 500 }}>/100</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--txt3)', marginLeft: 6 }}>→</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Events & News ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl">Events &amp; News</div>

        {noEvents && (
          <div style={{ fontSize: 12, color: 'var(--txt3)', padding: '4px 0' }}>
            No active events in the next 24h. Clean macro backdrop.
          </div>
        )}

        {urgentEcon.map((e, i) => {
          const lh = (e.dt.getTime() - Date.now()) / 3600000;
          const isPast = lh < 0;
          return (
          <div key={i} className="mb-event-row">
            <div className="mb-event-tag" style={{
              background: isPast ? 'rgba(100,100,100,0.15)' : lh < 2 ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.1)',
              color: isPast ? 'var(--txt3)' : lh < 2 ? '#f87171' : '#fbbf24',
            }}>
              {isPast ? '✓' : '📅'} {e.type}
            </div>
            <div className="mb-event-name">{e.name}</div>
            <div className="mb-event-time" style={{
              color: isPast ? 'var(--txt3)' : lh < 1 ? '#f87171' : lh < 6 ? '#fbbf24' : 'var(--txt3)',
            }}>
              {isPast ? `${Math.round(-lh * 60)}m ago` : lh < 0.017 ? 'NOW' : `in ${hToHM(lh)}`}
            </div>
          </div>
          );
        })}

        {recentGeo.map((e, i) => (
          <div key={i} className="mb-event-row">
            <div className="mb-event-tag" style={{
              background: e.style === 'crypto'
                ? 'rgba(52,211,153,0.1)'
                : e.style === 'speech'
                ? 'rgba(96,165,250,0.1)'
                : 'rgba(167,139,250,0.1)',
              color: e.style === 'crypto' ? '#34d399' : e.style === 'speech' ? '#60a5fa' : '#a78bfa',
            }}>
              {e.tag}
            </div>
            <div className="mb-event-name">{e.headline}</div>
            <div className="mb-event-time" style={{ color: 'var(--txt3)' }}>{tsAgo(e.ts)}</div>
          </div>
        ))}

        {whaleAlerts && whaleAlerts.slice(0, 4).map((w, i) => (
          <div key={i} className="mb-event-row">
            <div className="mb-event-tag" style={{
              background: w.side === 'BUY' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
              color: w.side === 'BUY' ? '#34d399' : '#f87171',
            }}>
              🐋 {w.side}
            </div>
            <div className="mb-event-name">
              {w.symbol} · ${(w.usdValue / 1_000_000).toFixed(1)}M @ ${w.price.toLocaleString()}
            </div>
            <div className="mb-event-time" style={{ color: 'var(--txt3)' }}>{tsAgo(w.ts)}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
