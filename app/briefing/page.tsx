'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  useMarket, COINS, COIN_DEC, COIN_LABELS, fmtPrice, fmtChg,
  classifyFunding, computeSqueezeScore, type CoinId, type MarketStore, type CoinData,
} from '@/lib/marketStore';
import { useNews } from '@/components/NewsProvider';
import { Warn } from '@/components/icons';
import SessionCountdown from '@/components/SessionCountdown';
import { useAuth } from '@/components/AuthProvider';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { getSupabase } from '@/lib/supabase';
import { nextResetLocalTime } from '@/lib/resetTime';
import PageHint from '@/components/PageHint';

/* ── helpers ── */

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

/* ── Which signals fired for a given setup direction ── */
function getSignalTags(coin: CoinData, dir: 'LONG_LIQ' | 'SHORT_SQ'): string[] {
  const tags: string[] = [];
  if (coin.fundingRate != null) {
    const fr = coin.fundingRate * 100;
    if (dir === 'LONG_LIQ') {
      if (fr >= 0.05)        tags.push(`FR +${fr.toFixed(2)}%`);
      else if (fr >= 0.01)   tags.push('FR Elevated');
    } else {
      if (fr <= -0.03)       tags.push(`FR ${fr.toFixed(2)}%`);
      else if (fr <= -0.005) tags.push('FR Neg');
    }
  }
  if (coin.longRatio != null && coin.shortRatio != null) {
    if (dir === 'LONG_LIQ' && coin.longRatio >= 0.58)
      tags.push(`Longs ${(coin.longRatio * 100).toFixed(0)}%`);
    if (dir === 'SHORT_SQ' && coin.shortRatio >= 0.58)
      tags.push(`Shorts ${(coin.shortRatio * 100).toFixed(0)}%`);
  }
  if (coin.takerBuyRatio != null) {
    if (dir === 'LONG_LIQ' && coin.takerBuyRatio <= 0.42) tags.push('Taker Sell');
    if (dir === 'SHORT_SQ' && coin.takerBuyRatio >= 0.58) tags.push('Taker Buy');
  }
  if (coin.volRatio != null && coin.volRatio >= 1.5)
    tags.push(`Vol ${coin.volRatio.toFixed(1)}x`);
  if (coin.rsi14 != null) {
    if (dir === 'LONG_LIQ' && coin.rsi14 >= 65) tags.push(`RSI ${Math.round(coin.rsi14)}`);
    if (dir === 'SHORT_SQ' && coin.rsi14 <= 35)  tags.push(`RSI ${Math.round(coin.rsi14)}`);
  }
  if (coin.oiTrend) {
    if (dir === 'LONG_LIQ' && coin.oiTrend.includes('down')) tags.push('Open Int ↓');
    if (dir === 'SHORT_SQ' && coin.oiTrend.includes('up'))   tags.push('Open Int ↑');
  }
  return tags;
}

/* ── context builder for Grok ── */
function buildBriefingContext(
  store: MarketStore,
  coinRows: Array<{ id: CoinId; c: MarketStore['coins'][CoinId] }>,
  urgentEcon: Array<{ type: string; name: string; h: number; impact: string; dt: Date }>,
  recentGeo:  Array<{ tag: string; headline: string }>,
  jpyUsd?: number | null,
): string {
  const phtTime = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const jpyStatus = jpyUsd == null ? 'N/A'
    : jpyUsd >= 160 ? `${jpyUsd.toFixed(2)} - DANGER ZONE (BOJ intervention risk, carry trade unwind can trigger BTC liquidations)`
    : jpyUsd >= 158 ? `${jpyUsd.toFixed(2)} - WARNING (approaching 160 danger zone, watch BOJ signals)`
    : `${jpyUsd.toFixed(2)} - Safe (below 158, carry trade stable)`;

  const lines = [
    `Time: ${phtTime} PHT`,
    `Fear & Greed: ${store.fng ?? '?'} - ${store.fngLabel ?? '?'}`,
    `BTC Dominance: ${store.btcDom?.toFixed(1) ?? '?'}%`,
    `DXY: ${store.dxy?.toFixed(2) ?? '?'} (${store.dxyChg != null ? (store.dxyChg >= 0 ? '+' : '') + store.dxyChg.toFixed(2) : '?'}% 24h)`,
    `USD/JPY (Yen Watch): ${jpyStatus}`,
    `BTC ETF Flow: ${store.etfNetFlow != null ? (store.etfNetFlow >= 0 ? '+' : '') + '$' + store.etfNetFlow.toFixed(0) + 'M' : 'N/A'}`,
    '',
    'COINS (24h change | FR | RSI 15m | CVD divergence | OI trend):',
  ];

  for (const { id, c } of coinRows) {
    if (!c) continue;
    const chg = c.change != null ? (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%' : '-';
    const fr  = c.fundingRate != null ? (c.fundingRate * 100).toFixed(3) + '%' : '-';
    const rsi = c.rsi14 != null ? Math.round(c.rsi14) : '-';
    const cvd = c.cvdDivergence ?? 'none';
    const oi  = c.oiTrend ?? '-';
    lines.push(`${id.toUpperCase()}: ${chg} | FR ${fr} | RSI ${rsi} | CVD ${cvd} | OI ${oi}`);
  }

  if (urgentEcon.length) {
    lines.push('', 'MACRO EVENTS (recent + upcoming):');
    urgentEcon.forEach(e => {
      const lh = (e.dt.getTime() - Date.now()) / 3600000;
      if (lh < 0) {
        const minsAgo = Math.round(-lh * 60);
        lines.push(`  ⚡ JUST RELEASED: ${e.type} - ${e.name} (${minsAgo}m ago - check news for actual print)`);
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
  const { user }                               = useAuth();
  const { usage, setUsage }                    = useGrokUsage();
  const [now, setNow]           = useState<Date>(phtNow);
  const [generating, setGen]    = useState(false);
  const [briefErr, setBriefErr] = useState('');
  const [jpyUsd, setJpyUsd]     = useState<number | null>(null);
  const [jpyUpdated, setJpyUpdated] = useState<Date | null>(null);

  /* ── AI brief - persist across refreshes via sessionStorage (4h TTL) ── */
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

  /* Fetch USD/JPY via server proxy (avoids CORS), refreshes every 5 min */
  useEffect(() => {
    const load = () =>
      fetch('/api/forex/jpy')
        .then(r => r.json())
        .then((d: { jpy?: number }) => {
          if (d?.jpy) { setJpyUsd(d.jpy); setJpyUpdated(new Date()); }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
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

  /* Loading state - true until at least 8 coins have price data */
  const pricesLoaded = coinRows.filter(r => r.c?.price != null && r.c.price > 0).length >= 8;

  /* Active CVD divergences */
  const cvdAlerts = COINS
    .filter(id => store.coins[id]?.cvdDivergence)
    .map(id => ({ id, div: store.coins[id]!.cvdDivergence! }));

  /* Generate AI briefing */
  async function generateBriefing() {
    if (!user) { setBriefErr('Sign in to generate a briefing.'); return; }
    setGen(true); setBrief(''); setBriefErr('');
    try {
      const sb    = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      if (!token) { setBriefErr('Session expired - please sign in again.'); setGen(false); return; }

      const ctx = buildBriefingContext(store, coinRows, urgentEcon, recentGeo, jpyUsd);
      const res = await fetch('/api/briefing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ context: ctx }),
      });
      const data = await res.json() as {
        briefing?: string; error?: string; code?: string;
        _usage?: { briefing_used: number; briefing_limit: number };
      };
      if (!res.ok || data.error) {
        setBriefErr(
          data.code === 'RATE_LIMIT'
            ? `${data.error ?? 'Rate limit reached.'} Resets at ${nextResetLocalTime()}.`
            : data.error ?? 'Unknown error'
        );
      } else {
        setBrief(data.briefing ?? '');
        if (data._usage && usage) setUsage({ ...usage, ...data._usage });
      }
    } catch (e) {
      setBriefErr(String(e));
    }
    setGen(false);
  }

  /* Top 3 Setups - non-neutral direction only, sorted by score */
  const top3Setups = coinRows
    .filter(r => r.sq.dir !== 'NEUTRAL' && r.c?.price != null && r.c.price > 0)
    .sort((a, b) => b.sq.score - a.sq.score)
    .slice(0, 3);

  /* Events - upcoming (next 24h) + recently released (last 6h) */
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
  const dxySig    = dxyChg == null    ? '-'
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

  /* Yen Watch */
  const jpyStatus = jpyUsd == null ? null
    : jpyUsd >= 160
      ? { label: 'DANGER', color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)',
          desc: 'BOJ intervention risk high - carry trade unwind can trigger BTC liquidations. Reduce leverage.' }
    : jpyUsd >= 158
      ? { label: 'WARNING', color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.2)',
          desc: 'Approaching 160 danger zone. Watch for BOJ rhetoric or surprise rate hike signals.' }
      : { label: 'SAFE', color: '#34d399', bg: 'rgba(52,211,153,0.06)', border: 'rgba(52,211,153,0.2)',
          desc: 'Yen carry trade stable. Reduced crypto liquidation risk from JPY side.' };
  // progress bar: 140 = left edge, 165 = right edge
  const jpyPct        = jpyUsd != null ? Math.max(0, Math.min(100, ((jpyUsd - 140) / 25) * 100)) : 0;
  const warn158Pct    = ((158 - 140) / 25) * 100;  // 72%
  const danger160Pct  = ((160 - 140) / 25) * 100;  // 80%
  const jpyMinutesAgo = jpyUpdated ? Math.round((now.getTime() - jpyUpdated.getTime()) / 60_000) : null;

  return (
    <div>

      {/* ── Header ── */}
      <div className="mb-header">
        <h1 className="mb-title">Morning Briefing</h1>
        <div className="mb-subtitle">{dateStr} · {timeStr}</div>
      </div>

      <PageHint
        pageKey="briefing"
        title="Morning Briefing"
        body="Your daily market summary - top setups, key support and resistance levels, macro signals, and AI-generated trade ideas updated each morning."
      />

      {/* ── Top 3 Setups Today ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="lbl" style={{ margin: 0 }}>Top 3 Setups Today</div>
          <Link href="/arena" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'none' }}>
            See all in Arena →
          </Link>
        </div>

        {!pricesLoaded ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>Loading market data…</div>
        ) : top3Setups.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
            No strong setups right now - market positioning is balanced.
          </div>
        ) : (
          top3Setups.map(({ id, c, sq }, i) => {
            const isLong    = sq.dir === 'SHORT_SQ';
            const dirColor  = isLong ? '#34d399' : '#f87171';
            const dirLabel  = isLong ? 'Long ↑' : 'Short ↓';
            const tags      = c ? getSignalTags(c, sq.dir as 'LONG_LIQ' | 'SHORT_SQ') : [];
            const isLast    = i === top3Setups.length - 1;
            return (
              <Link key={id} href="/arena" style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 0',
                  borderBottom: isLast ? 'none' : '0.5px solid var(--bdr)',
                }}>
                  <div style={{
                    fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)',
                    minWidth: 46, letterSpacing: '-0.3px',
                  }}>
                    {COIN_LABELS[id]}
                  </div>

                  <span style={{
                    fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                    letterSpacing: '.03em', flexShrink: 0,
                    color: dirColor,
                    background: isLong ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                    border: `0.5px solid ${isLong ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)'}`,
                  }}>
                    {dirLabel}
                  </span>

                  <div style={{ display: 'flex', gap: 5, flex: 1, flexWrap: 'wrap' }}>
                    {tags.map(tag => (
                      <span key={tag} style={{
                        fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt3)',
                        background: 'var(--bg2)', borderRadius: 4,
                        padding: '2px 6px', letterSpacing: '.02em',
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 1 }}>
                    <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: sq.color, letterSpacing: '-0.5px' }}>
                      {sq.score}
                    </span>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontWeight: 500 }}>/100</span>
                  </div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--txt3)' }}>→</span>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* ── AI Briefing ── */}
      <div className="card mb-brief-card">
        <div className="mb-brief-header">
          <span className="lbl" style={{ margin: 0 }}>AI Pre-Session Briefing</span>
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
            Hit Generate to get a LiquidityAI pre-session summary - market conditions, best setup, what to watch.
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
          <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Warn /> {briefErr}</div>
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
          <div className="lbl" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z" fill="currentColor" /></svg>
            Active CVD Divergences
          </div>
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
                {id.toUpperCase()} {div === 'bullish' ? '▲ Bull' : '▼ Bear'}
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
              {fng != null ? fng : '-'}
            </div>
            <div className="mb-macro-sub" style={{ color: fngColor }}>
              {store.fngLabel || '-'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">BTC Dom</div>
            <div className="mb-macro-val">
              {store.btcDom != null ? store.btcDom.toFixed(1) + '%' : '-'}
            </div>
            <div className="mb-macro-sub" style={{ color: domTrend?.col ?? 'var(--txt3)' }}>
              {domTrend?.txt ?? '-'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">DXY</div>
            <div className="mb-macro-val">
              {store.dxy != null ? store.dxy.toFixed(2) : '-'}
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

      {/* ── Yen Watch ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="lbl" style={{ margin: 0 }}>Yen Watch</div>
          {jpyStatus && (
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '.06em',
              color: jpyStatus.color, background: jpyStatus.bg, border: `0.5px solid ${jpyStatus.border}`,
            }}>{jpyStatus.label}</span>
          )}
        </div>

        {jpyUsd == null ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>Fetching rate…</div>
        ) : (
          <>
            {/* Rate */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', letterSpacing: '.05em' }}>USD/JPY</span>
              <span style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.5px', color: jpyStatus!.color }}>
                {jpyUsd.toFixed(2)}
              </span>
            </div>

            {/* Danger zone bar */}
            <div style={{ position: 'relative', paddingBottom: 18, marginBottom: 6 }}>
              <div style={{
                height: 6, borderRadius: 3, overflow: 'hidden',
                background: `linear-gradient(to right,
                  rgba(52,211,153,0.35) 0%, rgba(52,211,153,0.35) ${warn158Pct}%,
                  rgba(251,191,36,0.45) ${warn158Pct}%, rgba(251,191,36,0.45) ${danger160Pct}%,
                  rgba(248,113,113,0.45) ${danger160Pct}%, rgba(248,113,113,0.45) 100%)`,
              }}>
                {/* Current rate dot */}
                <div style={{
                  position: 'absolute', top: 0, left: `${jpyPct}%`, transform: 'translate(-50%, 0)',
                  width: 12, height: 12, borderRadius: '50%', marginTop: -3,
                  background: jpyStatus!.color, border: '2px solid #111',
                  boxShadow: `0 0 8px ${jpyStatus!.color}88`,
                }} />
              </div>
              {/* Threshold labels */}
              <span style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>140</span>
              <span style={{
                position: 'absolute', bottom: 0, left: `${warn158Pct}%`, transform: 'translateX(-50%)',
                fontSize: 'var(--fs-caption)', color: '#fbbf24', fontWeight: 600,
              }}>158<Warn size={9} style={{ verticalAlign: '-1px', marginLeft: 1 }} /></span>
              <span style={{
                position: 'absolute', bottom: 0, left: `${danger160Pct}%`, transform: 'translateX(-50%)',
                fontSize: 'var(--fs-caption)', color: '#f87171', fontWeight: 600,
              }}>160</span>
              <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>165</span>
            </div>

            {/* Interpretation */}
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginTop: 4 }}>
              {jpyStatus!.desc}
            </div>
            {jpyMinutesAgo !== null && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 5 }}>
                Updated {jpyMinutesAgo < 1 ? 'just now' : `${jpyMinutesAgo}m ago`}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Notable Signals ── */}
      {(() => {
        type Chip = { text: string; color: string };
        const byCoins: Array<{ id: CoinId; label: string; chips: Chip[] }> = [];

        for (const { id, c } of coinRows) {
          if (!c?.price) continue;
          const chips: Chip[] = [];
          if (c.rsi14 != null) {
            if (c.rsi14 >= 70)      chips.push({ text: `RSI ${Math.round(c.rsi14)}`, color: '#f87171' });
            else if (c.rsi14 <= 30) chips.push({ text: `RSI ${Math.round(c.rsi14)}`, color: '#34d399' });
          }
          if (c.fundingRate != null) {
            const fr = c.fundingRate * 100;
            if (fr >= 0.05)       chips.push({ text: `FR +${fr.toFixed(3)}%`, color: '#f87171' });
            else if (fr <= -0.03) chips.push({ text: `FR ${fr.toFixed(3)}%`,  color: '#34d399' });
          }
          if (c.volRatio != null && c.volRatio >= 1.5)
            chips.push({ text: `Vol ${c.volRatio.toFixed(1)}x`, color: 'var(--accent)' });
          if (c.oiTrend === 'strong_up')        chips.push({ text: 'OI ↑↑',    color: '#34d399' });
          else if (c.oiTrend === 'strong_down') chips.push({ text: 'OI ↓↓',    color: '#f87171' });
          if (c.cvdDivergence === 'bullish')    chips.push({ text: 'CVD Bull', color: '#34d399' });
          else if (c.cvdDivergence === 'bearish') chips.push({ text: 'CVD Bear', color: '#f87171' });
          if (chips.length > 0) byCoins.push({ id, label: COIN_LABELS[id], chips });
        }

        byCoins.sort((a, b) => b.chips.length - a.chips.length);
        const shown = byCoins.slice(0, 10);
        const extra = byCoins.length - shown.length;

        return (
          <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: shown.length > 0 ? 10 : 0 }}>
              <div className="lbl" style={{ margin: 0 }}>Notable Signals</div>
              <Link href="/scanner" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'none' }}>
                Full scanner →
              </Link>
            </div>
            {!pricesLoaded ? (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>Loading market data…</div>
            ) : shown.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
                All quiet - no extreme signals right now.
              </div>
            ) : (
              <>
                {shown.map(({ id, label, chips }, i) => (
                  <Link key={id} href="/arena" style={{ textDecoration: 'none', display: 'block', borderBottom: i < shown.length - 1 ? '0.5px solid var(--bdr)' : 'none' }}>
                    <div className="nbs-row">
                      <div style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', minWidth: 48, letterSpacing: '-0.3px' }}>
                        {label}
                      </div>
                      <div style={{ display: 'flex', gap: 5, flex: 1, flexWrap: 'wrap' }}>
                        {chips.map(chip => (
                          <span key={chip.text} style={{
                            fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                            color: chip.color, background: chip.color + '18', border: `0.5px solid ${chip.color}50`,
                          }}>{chip.text}</span>
                        ))}
                      </div>
                      <span className="nbs-arrow">›</span>
                    </div>
                  </Link>
                ))}
                {extra > 0 && (
                  <Link href="/scanner" style={{ textDecoration: 'none', display: 'block', paddingTop: 8, borderTop: '0.5px solid var(--bdr)', marginTop: 2 }}>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center' }}>
                      +{extra} more coins with signals - Full scanner →
                    </div>
                  </Link>
                )}
              </>
            )}
          </div>
        );
      })()}


      {/* ── Events & News ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl">Events &amp; News</div>

        {noEvents && (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
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
              {isPast ? '✓ ' : ''}{e.type}
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
                : 'var(--accent-bg)',
              color: e.style === 'crypto' ? '#34d399' : e.style === 'speech' ? '#60a5fa' : 'var(--accent)',
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
              WHALE {w.side}
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
