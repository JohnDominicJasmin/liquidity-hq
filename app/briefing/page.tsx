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
import { withAlpha } from '@/lib/color';
import { getSupabase } from '@/lib/supabase';
import { nextResetLocalTime, localZoneAbbr } from '@/lib/resetTime';
import PageHint from '@/components/PageHint';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* ── helpers ── */

const OI_ICONS: Record<string, string> = {
  strong_up: '▲', strong_down: '▼', weak_up: '△', weak_down: '▽',
};
const OI_COLORS: Record<string, string> = {
  strong_up: 'var(--green-2)', strong_down: 'var(--red)',
  weak_up: 'var(--amber)', weak_down: 'var(--txt-dim)',
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
  if (rsi >= 70) return 'var(--red)';
  if (rsi >= 60) return 'var(--amber)';
  if (rsi <= 30) return 'var(--green-2)';
  if (rsi <= 40) return 'var(--green-soft)';
  return 'var(--txt2)';
}

function volRatioColor(vr: number | null): string {
  if (vr == null) return 'var(--txt3)';
  if (vr >= 2)   return 'var(--red)';
  if (vr >= 1.5) return 'var(--amber)';
  if (vr >= 1.2) return 'var(--green-soft)';
  return 'var(--txt3)';
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

// Was `new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))`
// - the round-trip-through-a-string trick that yields a Date whose LOCAL getters
// read out Manila's wall clock. Every getHours()/getDay() below then reported
// Manila regardless of where the viewer actually is. A plain Date gives the
// viewer their own clock, which is what this page's header is claiming to show.
function localNow() {
  return new Date();
}

/* ── Which signals fired for a given setup direction ── */
function getSignalTags(
  coin: CoinData,
  dir: 'LONG_LIQ' | 'SHORT_SQ',
  t: (key: LabelKey, vars?: Record<string, string | number>) => string,
): string[] {
  const tags: string[] = [];
  if (coin.fundingRate != null) {
    const fr = coin.fundingRate * 100;
    if (dir === 'LONG_LIQ') {
      if (fr >= 0.05)        tags.push(t('BRIEFING_TAG_FR_POS', { value: fr.toFixed(2) }));
      else if (fr >= 0.01)   tags.push(t('BRIEFING_TAG_FR_ELEVATED'));
    } else {
      if (fr <= -0.03)       tags.push(t('BRIEFING_TAG_FR_NEG_VALUE', { value: fr.toFixed(2) }));
      else if (fr <= -0.005) tags.push(t('BRIEFING_TAG_FR_NEG'));
    }
  }
  if (coin.longRatio != null && coin.shortRatio != null) {
    if (dir === 'LONG_LIQ' && coin.longRatio >= 0.58)
      tags.push(t('BRIEFING_TAG_LONGS_PCT', { pct: (coin.longRatio * 100).toFixed(0) }));
    if (dir === 'SHORT_SQ' && coin.shortRatio >= 0.58)
      tags.push(t('BRIEFING_TAG_SHORTS_PCT', { pct: (coin.shortRatio * 100).toFixed(0) }));
  }
  if (coin.takerBuyRatio != null) {
    if (dir === 'LONG_LIQ' && coin.takerBuyRatio <= 0.42) tags.push(t('BRIEFING_TAG_TAKER_SELL'));
    if (dir === 'SHORT_SQ' && coin.takerBuyRatio >= 0.58) tags.push(t('BRIEFING_TAG_TAKER_BUY'));
  }
  if (coin.volRatio != null && coin.volRatio >= 1.5)
    tags.push(t('BRIEFING_TAG_VOL', { x: coin.volRatio.toFixed(1) }));
  if (coin.rsi14 != null) {
    if (dir === 'LONG_LIQ' && coin.rsi14 >= 65) tags.push(t('BRIEFING_TAG_RSI', { value: Math.round(coin.rsi14) }));
    if (dir === 'SHORT_SQ' && coin.rsi14 <= 35)  tags.push(t('BRIEFING_TAG_RSI', { value: Math.round(coin.rsi14) }));
  }
  if (coin.oiTrend) {
    if (dir === 'LONG_LIQ' && coin.oiTrend.includes('down')) tags.push(t('BRIEFING_TAG_OI_DOWN'));
    if (dir === 'SHORT_SQ' && coin.oiTrend.includes('up'))   tags.push(t('BRIEFING_TAG_OI_UP'));
  }
  return tags;
}

/* ── context builder for Grok ── */
function buildBriefingContext(
  store: MarketStore,
  coinRows: Array<{ id: CoinId; c: MarketStore['coins'][CoinId] }>,
  urgentEcon: Array<{ type: string; name: string; h: number; impact: string; dt: Date }>,
  recentGeo:  Array<{ tag: string; headline: string }>,
  // Passed in rather than read from the clock inside, so the "in Nh" / "Nm ago"
  // lines describe the same instant as the events list the caller just built.
  nowMs: number,
  jpyUsd?: number | null,
): string {
  // UTC, not the viewer's clock: this string is fed to Grok as context, and a
  // bare local time with no zone made the model reason about session timing
  // against an unknown offset. (It used to be Manila's clock labelled "PHT",
  // which was at least unambiguous but wrong for every other user.)
  const nowUtc = new Date().toLocaleString('en-GB', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const jpyStatus = jpyUsd == null ? 'N/A'
    : jpyUsd >= 160 ? `${jpyUsd.toFixed(2)} - DANGER ZONE (BOJ intervention risk, carry trade unwind can trigger BTC liquidations)`
    : jpyUsd >= 158 ? `${jpyUsd.toFixed(2)} - WARNING (approaching 160 danger zone, watch BOJ signals)`
    : `${jpyUsd.toFixed(2)} - Safe (below 158, carry trade stable)`;

  const lines = [
    `Time: ${nowUtc} UTC`,
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
      const lh = (e.dt.getTime() - nowMs) / 3600000;
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
  const { t }                                   = useLabels();
  /* NULL UNTIL THE BROWSER HAS MOUNTED, and that is the whole fix for #193.
   *
   * This was `useState<Date>(localNow)`. `'use client'` does not mean
   * client-only - Next still renders this component on the server to produce the
   * initial HTML, so the lazy initialiser ran twice against two different
   * clocks IN TWO DIFFERENT TIMEZONES. React then found different text and threw
   * #418, 75 times in production and once per load for every user outside the
   * server's zone.
   *
   * Measured, and the timezone is the part that matters - milliseconds would
   * only have broken the minute display:
   *
   *   server  "Sun, Aug 9"      <div className="mb-subtitle">
   *   client  "Mon, Aug 10"     (America/New_York)
   *
   * A whole day apart, so this was never a near-miss that usually agreed.
   *
   * `null` renders identically on the server and on the client's FIRST render,
   * which is the only render hydration compares. The effect below then sets the
   * real clock, and everything downstream re-renders with it. */
  const [now, setNow]           = useState<Date | null>(null);
  // Milliseconds form of the same ticking clock. The event/freshness maths
  // below used to call Date.now() directly, which both made render impure and
  // quietly ignored this state - meaning the "next 24h" and "already released"
  // cutoffs did not actually move with the minute tick that exists right here.
  /* 0 while the clock is unknown, and that is deliberate rather than a fallback
   * nobody thought about. Every real event is decades after the epoch, so the
   * "within the next 24h" filters below evaluate to EMPTY at 0 - the first paint
   * shows no urgent events rather than the wrong ones, on both server and
   * client, and the real list appears a frame later. */
  const nowMs = now?.getTime() ?? 0;
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
        // Stamping when the brief was actually written has to read the real
        // clock, not the render-scoped `now` below - setBrief runs from the
        // generate handler, not during render, so this is genuinely a side
        // effect and the timestamp needs to be accurate rather than stable.
        // eslint-disable-next-line react-hooks/purity
        sessionStorage.setItem('lhq_brief_ts', String(Date.now()));
      } else {
        sessionStorage.removeItem('lhq_brief');
        sessionStorage.removeItem('lhq_brief_ts');
      }
    } catch { /* */ }
  }

  /* Set the clock on mount, then tick once per minute so the header stays fresh.
   * The immediate call is not decoration - without it the header would stay
   * blank for up to 60 seconds waiting for the first interval. */
  useEffect(() => {
    /* `set-state-in-effect` is right about the general case and wrong about this
       one. Reading a browser-only value after mount is precisely what an effect
       is for, and it is the only place this CAN be read: the whole point of #193
       is that the server must not produce this value. Same reasoning as the
       `react-hooks/purity` disable in setBrief above. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(localNow());
    const timer = setInterval(() => setNow(localNow()), 60_000);
    return () => clearInterval(timer);
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
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* Empty until the clock exists. `localZoneAbbr()` is the SECOND client-only
   * value on this line and it is not mentioned in #193 - it reads the browser's
   * zone, so it mismatches for exactly the same reason and would have kept
   * throwing after the date was fixed. Both are behind the same guard. */
  const h = now?.getHours() ?? 0, m = now?.getMinutes() ?? 0;
  const timeStr = now ? `${pad2(h % 12 || 12)}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'} ${localZoneAbbr()}` : '';
  const dateStr = now ? `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}` : '';

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
    if (!user) { setBriefErr(t('BRIEFING_SIGN_IN_REQUIRED')); return; }
    setGen(true); setBrief(''); setBriefErr('');
    try {
      const sb    = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      if (!token) { setBriefErr(t('BRIEFING_SESSION_EXPIRED')); setGen(false); return; }

      const ctx = buildBriefingContext(store, coinRows, urgentEcon, recentGeo, nowMs, jpyUsd);
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
            ? t('BRIEFING_RATE_LIMIT_MSG', { error: data.error ?? t('BRIEFING_RATE_LIMIT_DEFAULT'), resetTime: nextResetLocalTime() })
            : data.error ?? t('BRIEFING_UNKNOWN_ERROR')
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
  const urgentEcon = econEvents.filter(e => { const lh = (e.dt.getTime() - nowMs) / 3600000; return lh > -6 && lh < 24; }).slice(0, 8);
  const recentGeo  = geoEvents.slice(0, 4);

  /* Macro colors */
  const fng      = store.fng;
  const fngColor = fng == null ? 'var(--txt3)'
    : fng >= 75 ? 'var(--red)'
    : fng >= 55 ? 'var(--amber)'
    : fng <= 25 ? 'var(--green-2)'
    : fng <= 45 ? 'var(--green-soft)'
    : 'var(--txt2)';

  const etfFlow  = store.etfNetFlow;
  const etfColor = etfFlow == null ? 'var(--txt3)' : etfFlow > 0 ? 'var(--green-2)' : 'var(--red)';

  const dxyChg    = store.dxyChg;
  const dxySig    = dxyChg == null    ? '-'
    : dxyChg > 0.2  ? t('BRIEFING_DXY_HEADWIND')
    : dxyChg < -0.2 ? t('BRIEFING_DXY_TAILWIND')
    : t('BRIEFING_DXY_NEUTRAL');
  const dxyColor  = dxyChg == null    ? 'var(--txt3)'
    : dxyChg > 0.2  ? 'var(--red)'
    : dxyChg < -0.2 ? 'var(--green-2)'
    : 'var(--txt3)';

  const btcDomHistory = store.btcDomHistory;
  const domTrend = btcDomHistory.length >= 2
    ? btcDomHistory[btcDomHistory.length - 1] > btcDomHistory[0]
      ? { txt: t('BRIEFING_DOM_ALTS_WEAK'), col: 'var(--amber)' }
      : { txt: t('BRIEFING_DOM_ALTS_ACTIVE'), col: 'var(--green-2)' }
    : null;

  const futureEcon = urgentEcon.filter(e => e.dt.getTime() > nowMs);
  const noEvents = futureEcon.length === 0 && recentGeo.length === 0 && (!whaleAlerts || whaleAlerts.length === 0);

  /* Yen Watch */
  const jpyStatus = jpyUsd == null ? null
    : jpyUsd >= 160
      ? { label: t('BRIEFING_YEN_DANGER'), color: 'var(--red)', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)',
          desc: t('BRIEFING_YEN_DANGER_DESC') }
    : jpyUsd >= 158
      ? { label: t('BRIEFING_YEN_WARNING'), color: 'var(--amber)', bg: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.2)',
          desc: t('BRIEFING_YEN_WARNING_DESC') }
      : { label: t('BRIEFING_YEN_SAFE'), color: 'var(--green-2)', bg: 'rgba(52,211,153,0.06)', border: 'rgba(52,211,153,0.2)',
          desc: t('BRIEFING_YEN_SAFE_DESC') };
  // progress bar: 140 = left edge, 165 = right edge
  const jpyPct        = jpyUsd != null ? Math.max(0, Math.min(100, ((jpyUsd - 140) / 25) * 100)) : 0;
  const warn158Pct    = ((158 - 140) / 25) * 100;  // 72%
  const danger160Pct  = ((160 - 140) / 25) * 100;  // 80%
  /* `jpyUpdated` is only ever set from the fetch effect, so it cannot be
     non-null while `now` is still null - but the compiler cannot know that and
     `nowMs` already carries the same guard. Reusing it rather than asserting. */
  const jpyMinutesAgo = jpyUpdated ? Math.round((nowMs - jpyUpdated.getTime()) / 60_000) : null;

  return (
    <div>

      {/* ── Header ── */}
      <div className="mb-header">
        <h1 className="mb-title">{t('BRIEFING_PAGE_TITLE')}</h1>
        {/* The separator lives inside the guard too, or the first paint is a
            lone "·" floating under the title. Non-breaking space holds the
            line's height so the header does not jump when the clock arrives. */}
        <div className="mb-subtitle">{now ? `${dateStr} · ${timeStr}` : ' '}</div>
      </div>

      <PageHint
        pageKey="briefing"
        title={t('BRIEFING_HINT_TITLE')}
        body={t('BRIEFING_HINT_BODY')}
      />

      {/* ── Top 3 Setups Today ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="lbl" style={{ margin: 0 }}>{t('BRIEFING_TOP3_TITLE')}</div>
          <Link href="/arena" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
            {t('BRIEFING_SEE_ALL_ARENA')}
          </Link>
        </div>

        {!pricesLoaded ? (
          <div style={{ padding: '4px 0' }}>
            <SkeletonBar width="55%" height={13} style={{ marginBottom: 8 }} />
            <SkeletonBar width="38%" height={13} />
            <span className="sr-only">{t('BRIEFING_LOADING_MARKET_SR')}</span>
          </div>
        ) : top3Setups.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
            {t('BRIEFING_NO_SETUPS')}
          </div>
        ) : (
          top3Setups.map(({ id, c, sq }, i) => {
            const isLong    = sq.dir === 'SHORT_SQ';
            const dirColor  = isLong ? 'var(--green-2)' : 'var(--red)';
            const dirLabel  = isLong ? t('BRIEFING_DIR_LONG') : t('BRIEFING_DIR_SHORT');
            const tags      = c ? getSignalTags(c, sq.dir as 'LONG_LIQ' | 'SHORT_SQ', t) : [];
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
          <span className="lbl" style={{ margin: 0 }}>{t('BRIEFING_AI_TITLE')}</span>
          <button
            className={`mb-brief-btn${generating ? ' loading' : ''}`}
            onClick={generateBriefing}
            disabled={generating}
          >
            {generating ? t('BRIEFING_BTN_GENERATING') : brief ? t('BRIEFING_BTN_REGENERATE') : t('BRIEFING_BTN_GENERATE')}
          </button>
        </div>

        {!brief && !generating && !briefErr && (
          <div className="mb-brief-empty">
            {t('BRIEFING_EMPTY_STATE')}
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
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Warn /> {briefErr}</div>
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
                const mins = Math.round((nowMs - parseInt(ts)) / 60_000);
                const label = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
                return <div className="mb-brief-cached">{t('BRIEFING_BRIEF_CACHED', { label, mins: Math.max(0, 240 - mins) })}</div>;
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
            {t('BRIEFING_CVD_TITLE')}
          </div>
          <div className="mb-cvd-row">
            {cvdAlerts.map(({ id, div }) => (
              <div
                key={id}
                className="mb-cvd-chip"
                style={{
                  color:       div === 'bullish' ? 'var(--green-2)' : 'var(--red)',
                  borderColor: div === 'bullish' ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)',
                  background:  div === 'bullish' ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                }}
              >
                {id.toUpperCase()} {div === 'bullish' ? t('BRIEFING_CVD_BULL') : t('BRIEFING_CVD_BEAR')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Session Countdown ── */}
      <SessionCountdown />

      {/* ── Macro Pulse ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl">{t('BRIEFING_MACRO_PULSE_TITLE')}</div>
        <div className="mb-macro-row">

          <div className="mb-macro-item">
            <div className="mb-macro-label">
              <Tip text={t('BRIEFING_FNG_TIP')}>{t('BRIEFING_FNG_LABEL')}</Tip>
            </div>
            <div className="mb-macro-val" style={{ color: fngColor }}>
              {fng != null ? fng : '-'}
            </div>
            <div className="mb-macro-sub" style={{ color: fngColor }}>
              {store.fngLabel || '-'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">
              <Tip text={t('BRIEFING_BTCDOM_TIP')}>{t('BRIEFING_BTCDOM_LABEL')}</Tip>
            </div>
            <div className="mb-macro-val">
              {store.btcDom != null ? store.btcDom.toFixed(1) + '%' : '-'}
            </div>
            <div className="mb-macro-sub" style={{ color: domTrend?.col ?? 'var(--txt3)' }}>
              {domTrend?.txt ?? '-'}
            </div>
          </div>

          <div className="mb-macro-item">
            <div className="mb-macro-label">
              <Tip width={260} text={t('BRIEFING_DXY_TIP')}>{t('BRIEFING_DXY_LABEL')}</Tip>
            </div>
            <div className="mb-macro-val">
              {store.dxy != null ? store.dxy.toFixed(2) : '-'}
            </div>
            <div className="mb-macro-sub" style={{ color: dxyColor }}>{dxySig}</div>
          </div>

          {etfFlow != null && (
            <div className="mb-macro-item">
              <div className="mb-macro-label">
                <Tip width={260} text={t('BRIEFING_ETF_TIP')}>{t('BRIEFING_ETF_LABEL')}</Tip>
              </div>
              <div className="mb-macro-val" style={{ color: etfColor }}>
                {(etfFlow >= 0 ? '+' : '') + '$' + Math.abs(etfFlow).toFixed(0) + 'M'}
              </div>
              <div className="mb-macro-sub" style={{ color: etfColor }}>
                {etfFlow > 100  ? t('BRIEFING_ETF_STRONG_IN')
                : etfFlow > 0   ? t('BRIEFING_ETF_MILD_IN')
                : etfFlow < -100 ? t('BRIEFING_ETF_STRONG_OUT')
                :                  t('BRIEFING_ETF_MILD_OUT')}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Yen Watch ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="lbl" style={{ margin: 0 }}>{t('BRIEFING_YEN_WATCH_TITLE')}</div>
          {jpyStatus && (
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '.06em',
              color: jpyStatus.color, background: jpyStatus.bg, border: `0.5px solid ${jpyStatus.border}`,
            }}>{jpyStatus.label}</span>
          )}
        </div>

        {jpyUsd == null ? (
          <div>
            <SkeletonBar width="34%" height={16} style={{ marginBottom: 12 }} />
            <SkeletonBar width="100%" height={6} radius={3} />
            <span className="sr-only">{t('BRIEFING_FETCHING_RATE_SR')}</span>
          </div>
        ) : (
          <>
            {/* Rate */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', letterSpacing: '.05em' }}>{t('BRIEFING_YEN_PAIR_LABEL')}</span>
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
                  boxShadow: `0 0 8px ${withAlpha(jpyStatus!.color, '88')}`,
                }} />
              </div>
              {/* Threshold labels */}
              <span style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>140</span>
              <span style={{
                position: 'absolute', bottom: 0, left: `${warn158Pct}%`, transform: 'translateX(-50%)',
                fontSize: 'var(--fs-caption)', color: 'var(--amber)', fontWeight: 600,
              }}>158<Warn size={9} style={{ verticalAlign: '-1px', marginLeft: 1 }} /></span>
              <span style={{
                position: 'absolute', bottom: 0, left: `${danger160Pct}%`, transform: 'translateX(-50%)',
                fontSize: 'var(--fs-caption)', color: 'var(--red)', fontWeight: 600,
              }}>160</span>
              <span style={{ position: 'absolute', bottom: 0, right: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>165</span>
            </div>

            {/* Interpretation */}
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginTop: 4 }}>
              {jpyStatus!.desc}
            </div>
            {jpyMinutesAgo !== null && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 5 }}>
                {t('BRIEFING_YEN_UPDATED', { time: jpyMinutesAgo < 1 ? 'just now' : `${jpyMinutesAgo}m ago` })}
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
            if (c.rsi14 >= 70)      chips.push({ text: t('BRIEFING_TAG_RSI', { value: Math.round(c.rsi14) }), color: 'var(--red)' });
            else if (c.rsi14 <= 30) chips.push({ text: t('BRIEFING_TAG_RSI', { value: Math.round(c.rsi14) }), color: 'var(--green-2)' });
          }
          if (c.fundingRate != null) {
            const fr = c.fundingRate * 100;
            if (fr >= 0.05)       chips.push({ text: t('BRIEFING_TAG_FR_POS', { value: fr.toFixed(3) }), color: 'var(--red)' });
            else if (fr <= -0.03) chips.push({ text: t('BRIEFING_TAG_FR_NEG_VALUE', { value: fr.toFixed(3) }),  color: 'var(--green-2)' });
          }
          if (c.volRatio != null && c.volRatio >= 1.5)
            chips.push({ text: t('BRIEFING_TAG_VOL', { x: c.volRatio.toFixed(1) }), color: 'var(--accent)' });
          if (c.oiTrend === 'strong_up')        chips.push({ text: t('BRIEFING_TAG_OI_STRONG_UP'),    color: 'var(--green-2)' });
          else if (c.oiTrend === 'strong_down') chips.push({ text: t('BRIEFING_TAG_OI_STRONG_DOWN'),    color: 'var(--red)' });
          if (c.cvdDivergence === 'bullish')    chips.push({ text: t('BRIEFING_TAG_CVD_BULL'), color: 'var(--green-2)' });
          else if (c.cvdDivergence === 'bearish') chips.push({ text: t('BRIEFING_TAG_CVD_BEAR'), color: 'var(--red)' });
          if (chips.length > 0) byCoins.push({ id, label: COIN_LABELS[id], chips });
        }

        byCoins.sort((a, b) => b.chips.length - a.chips.length);
        const shown = byCoins.slice(0, 10);
        const extra = byCoins.length - shown.length;

        return (
          <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: shown.length > 0 ? 10 : 0 }}>
              <div className="lbl" style={{ margin: 0 }}>{t('BRIEFING_NOTABLE_SIGNALS_TITLE')}</div>
              <Link href="/scanner" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
                {t('BRIEFING_FULL_SCANNER_LINK')}
              </Link>
            </div>
            {!pricesLoaded ? (
              <div style={{ padding: '4px 0' }}>
                <SkeletonBar width="55%" height={13} style={{ marginBottom: 8 }} />
                <SkeletonBar width="38%" height={13} />
                <span className="sr-only">{t('BRIEFING_LOADING_MARKET_SR')}</span>
              </div>
            ) : shown.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
                {t('BRIEFING_NO_SIGNALS')}
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
                            color: chip.color, background: withAlpha(chip.color, '18'), border: `0.5px solid ${withAlpha(chip.color, '50')}`,
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
                      {t('BRIEFING_MORE_SIGNALS', { count: extra })}
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
        <div className="lbl">{t('BRIEFING_EVENTS_NEWS_TITLE')}</div>

        {noEvents && (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 0' }}>
            {t('BRIEFING_NO_EVENTS')}
          </div>
        )}

        {urgentEcon.map((e, i) => {
          const lh = (e.dt.getTime() - nowMs) / 3600000;
          const isPast = lh < 0;
          return (
          <div key={i} className="mb-event-row">
            <div className="mb-event-tag" style={{
              background: isPast ? 'rgba(100,100,100,0.15)' : lh < 2 ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.1)',
              color: isPast ? 'var(--txt3)' : lh < 2 ? 'var(--red)' : 'var(--amber)',
            }}>
              {isPast ? '✓ ' : ''}{e.type}
            </div>
            <div className="mb-event-name">{e.name}</div>
            <div className="mb-event-time" style={{
              color: isPast ? 'var(--txt3)' : lh < 1 ? 'var(--red)' : lh < 6 ? 'var(--amber)' : 'var(--txt3)',
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
              color: e.style === 'crypto' ? 'var(--green-2)' : e.style === 'speech' ? 'var(--accent-2)' : 'var(--accent)',
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
              color: w.side === 'BUY' ? 'var(--green-2)' : 'var(--red)',
            }}>
              {t('BRIEFING_WHALE_PREFIX', { side: w.side })}
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
