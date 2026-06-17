'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarket, classifyFunding, CoinId, computeSqueezeScore, computeFibLevels, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';
import { GrokContext, buildCombinedPrompt, buildQuickPrompt, CombinedResult, ChartData, calcEMA, calcRSI, callGrokViaProxy, fetchGrokUsage, GrokUsageInfo } from '@/lib/grok';
import { detectPatternsStr, Candle } from '@/lib/patterns';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { track } from '@/lib/analytics';
import ConfluenceScorer from '@/components/ConfluenceScorer';
import KLineProChart, { ChartTf } from '@/components/KLineProChart';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import MarketStructure, { MSData } from '@/components/MarketStructure';
import AbsorptionDetector, { AbsorptionData } from '@/components/AbsorptionDetector';

/* ── Pattern detection — delegates to shared lib/patterns.ts ── */
function detectPatterns(candles: Candle[]): string { return detectPatternsStr(candles); }

/* ── Crypto coin icon — CDN with letter-avatar fallback ── */
function CoinIcon({ coin, size = 22, color, bg }: { coin: CoinId; size?: number; color?: string; bg?: string }) {
  const [failed, setFailed] = useState(false);
  // cryptocurrency-icons covers BTC/ETH/SOL/XRP/BNB/DOGE/AVAX/LINK/ADA/DOT/ATOM/NEAR
  // HYPE/SUI/WIF/PEPE/BONK are too new — onError falls through to letter avatar
  const src = `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${coin}.svg`;
  if (failed) {
    return (
      <span style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: bg ?? 'rgba(255,255,255,0.07)',
        border: `0.5px solid ${color ? color + '44' : 'rgba(255,255,255,0.1)'}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.38), fontWeight: 800,
        color: color ?? '#555',
      }}>
        {coin.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={coin}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}

/* ── Smart price formatter — preserves decimals for all coins including memes ── */
function fmtPrice(n: number): string {
  if (n >= 10000)   return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)     return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)       return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (n >= 0.01)    return n.toFixed(4);
  if (n >= 0.0001)  return n.toFixed(6);
  return n.toFixed(8);  // PEPE, BONK, etc.
}

/* ── Reasoning markdown renderer ─────────────────────────────────────────── */
function ReasoningText({ text }: { text: string }) {
  // Split on **bold**, [text](url), [[n]](url), or newlines
  const parts = text.split(/(\*\*[\s\S]*?\*\*|\[\[?[^\]]*\]?\]\([^)]+\)|\n)/g);
  return (
    <>
      {parts.map((seg, i) => {
        if (!seg) return null;
        if (seg === '\n') return <br key={i} />;
        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
          return <strong key={i}>{seg.slice(2, -2)}</strong>;
        const link = seg.match(/^\[(\[?[^\]]*\]?)\]\(([^)]+)\)$/);
        if (link) {
          const label = link[1].replace(/^\[/, '').replace(/\]$/, '') || '🔗';
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="reasoning-link">
              {label}
            </a>
          );
        }
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

const COINS: CoinId[] = [
  'btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui',
  'doge', 'avax', 'link', 'ada', 'dot', 'atom', 'wif', 'pepe', 'bonk',
];

const CAT_FILTER_COINS: Record<'all' | 'majors' | 'alts' | 'meme', readonly CoinId[]> = {
  all:    COINS,
  majors: ['btc', 'eth', 'sol', 'xrp', 'bnb'],
  alts:   ['hype', 'near', 'sui', 'avax', 'link', 'ada', 'dot', 'atom'],
  meme:   ['doge', 'pepe', 'wif', 'bonk'],
};


/* ── Usage panel — shows daily call counts for signed-in users ── */
function UsagePanel({ usage }: { usage: GrokUsageInfo }) {
  const deepPct  = Math.min((usage.deep_used  / usage.deep_limit)  * 100, 100);
  const quickPct = Math.min((usage.quick_used / usage.quick_limit) * 100, 100);
  const deepCol  = deepPct  >= 90 ? '#f87171' : deepPct  >= 70 ? '#fbbf24' : '#b8aeff';
  const quickCol = quickPct >= 90 ? '#f87171' : quickPct >= 70 ? '#fbbf24' : '#34d399';
  return (
    <div className="usage-panel">
      <div className="usage-row">
        <span className="usage-label">⚡ Quick</span>
        <div className="usage-track"><div className="usage-fill" style={{ width: quickPct + '%', background: quickCol }} /></div>
        <span className="usage-count" style={{ color: quickCol }}>{usage.quick_used}<span className="usage-max">/{usage.quick_limit}</span></span>
      </div>
      <div className="usage-row">
        <span className="usage-label">🔬 Deep</span>
        <div className="usage-track"><div className="usage-fill" style={{ width: deepPct + '%', background: deepCol }} /></div>
        <span className="usage-count" style={{ color: deepCol }}>{usage.deep_used}<span className="usage-max">/{usage.deep_limit}</span></span>
      </div>
      <div className="usage-footer">Today · resets midnight UTC</div>
    </div>
  );
}

/* ── Result cache ── */
interface CacheEntry { result: CombinedResult; priceAtAnalysis: number; mode: 'quick' | 'deep' }
const PRICE_MOVE_PCT    = 0.5;             // re-analyze when price moves >0.5%
const ARENA_RESULTS_KEY = 'arena-results-v2';
const CACHE_MAX_AGE_MS  = 4 * 60 * 60 * 1000; // 4 hours — older results are discarded
/** Dynamic TTL: tighter during NY/pre-NY session (volatile), relaxed off-hours */
function getCacheTTL(): number {
  const phtHour = (new Date().getUTCHours() + 8) % 24;
  return (phtHour >= 20 || phtHour < 4) ? 2 * 60_000 : 15 * 60_000;
}

interface HistItem {
  signal: string;
  confidence: number;
  coin: string;
  time: string;
  entry?: string;
  reasoning?: string;
  session?: string;
}

const ARENA_HIST_KEY = 'arena-session-history-v1';

export default function Arena() {
  const { store } = useMarket();
  const { latestHeadlines, econEvents, whaleAlerts } = useNews();
  const { user, loading: authLoading, isPro } = useAuth();
  const { settings } = useSettings();
  const [selectedCoin, setSelectedCoin] = useState<CoinId>('btc');
  const [readTf, setReadTf]         = useState<ChartTf>('15m');
  const arenaInitRef  = useRef(false);
  const oi1hDataRef   = useRef<{ pct: number | null; signal: string }>({ pct: null, signal: '—' });
  const msDataRef     = useRef<MSData | null>(null);
  const absDataRef    = useRef<AbsorptionData | null>(null);
  const oi1h          = useOI1h(selectedCoin);
  const [readLoading, setReadLoading] = useState(false);
  const [readStep, setReadStep]       = useState('');
  const [readError, setReadError]     = useState('');
  const [readMode,  setReadMode]      = useState<'quick' | 'deep'>('deep');
  const [resultsCache, setResultsCache] = useState<Partial<Record<CoinId, CacheEntry>>>({});
  const [history, setHistory]         = useState<HistItem[]>([]);
  const [detailIdx, setDetailIdx]     = useState<number | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [ctxOpen, setCtxOpen]         = useState(false);
  const [grokUsage, setGrokUsage]     = useState<GrokUsageInfo | null>(null);
  // Track last Quick signal per coin so Deep can compare and show an override notice
  const [quickSignals, setQuickSignals] = useState<Partial<Record<CoinId, string>>>({});
  const [scannerOpen, setScannerOpen]   = useState(false);
  const [coinCat, setCoinCat]           = useState<'all' | 'majors' | 'alts' | 'meme'>('all');
  const [sigDetailsOpen, setSigDetailsOpen] = useState(false);
  const [copiedKey, setCopiedKey]           = useState<string | null>(null);
  const [jpyUsd, setJpyUsd]                 = useState<number | null>(null);
  const scannerRef      = useRef<HTMLDivElement>(null);
  const hoverOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hover over trigger → auto-open; moving away cancels the timer
  const handleScannerHoverEnter = () => {
    if (scannerOpen) return;
    hoverOpenTimer.current = setTimeout(() => setScannerOpen(true), 800);
  };
  const handleScannerHoverLeave = () => {
    if (hoverOpenTimer.current) { clearTimeout(hoverOpenTimer.current); hoverOpenTimer.current = null; }
  };

  // Close scanner when clicking anywhere outside the scanner widget
  useEffect(() => {
    if (!scannerOpen) return;
    const handler = (e: MouseEvent) => {
      if (scannerRef.current && !scannerRef.current.contains(e.target as Node)) {
        setScannerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [scannerOpen]);

  /* Fetch USD/JPY via server proxy, refresh every 5 min */
  useEffect(() => {
    const load = () =>
      fetch('/api/forex/jpy')
        .then(r => r.json())
        .then((d: { jpy?: number }) => { if (d?.jpy) setJpyUsd(d.jpy); })
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Derived — current coin's cached result (persists across coin switches)
  const cacheEntry = resultsCache[selectedCoin] ?? null;
  const result     = cacheEntry?.result ?? null;
  const notifCooldown = useRef<Set<string>>(new Set());

  /* ── Seed coin + TF from settings once settings are loaded ── */
  useEffect(() => {
    if (arenaInitRef.current || settings.default_coin === 'btc' && settings.default_tf === '15m') {
      // Only override if settings differ from hardcoded defaults, and only once
    }
    if (!arenaInitRef.current) {
      arenaInitRef.current = true;
      if (COINS.includes(settings.default_coin as CoinId)) {
        setSelectedCoin(settings.default_coin as CoinId);
      }
      if (['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(settings.default_tf)) {
        setReadTf(settings.default_tf as ChartTf);
      }
    }
  }, [settings.default_coin, settings.default_tf]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sync OI 1h hook data → ref (used by Grok context builder) ── */
  useEffect(() => {
    if (oi1h.loading || oi1h.pct == null) return;
    const { txt } = oi1hSignal(oi1h.pct, store.coins[selectedCoin]?.oiTrend);
    oi1hDataRef.current = { pct: oi1h.pct, signal: txt };
  }, [oi1h.pct, oi1h.loading, selectedCoin, store.coins]);

  /* ── Market Structure data callback — keeps ref in sync without re-renders ── */
  const handleMsData = useCallback((d: MSData | null) => {
    msDataRef.current = d;
  }, []);

  /* ── Absorption Detector data callback ── */
  const handleAbsData = useCallback((d: AbsorptionData | null) => {
    absDataRef.current = d;
  }, []);

  /* ── Fetch today's usage on mount (and whenever auth state changes) ── */
  useEffect(() => {
    if (!user) return;
    fetchGrokUsage().then(u => { if (u) setGrokUsage(u); });
  }, [user]);

  /* ── Persist history in sessionStorage (survives nav away + back) ── */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ARENA_HIST_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(ARENA_HIST_KEY, JSON.stringify(history)); } catch { /* ignore */ }
  }, [history]);

  /* ── Persist results cache in localStorage — purge entries older than 4h on load ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ARENA_RESULTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Record<CoinId, CacheEntry>>;
        const now = Date.now();
        const fresh: Partial<Record<CoinId, CacheEntry>> = {};
        Object.entries(parsed).forEach(([k, v]) => {
          if (v && now - v.result.analyzedAt < CACHE_MAX_AGE_MS) fresh[k as CoinId] = v;
        });
        setResultsCache(fresh);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(ARENA_RESULTS_KEY, JSON.stringify(resultsCache)); } catch { /* ignore */ }
  }, [resultsCache]);

  /* ── Cross-exchange funding data ── */
  type FundingRow = { coin: string; binance: number|null; bybit: number|null; okx: number|null };
  const [fundingData, setFundingData] = useState<Record<string, FundingRow>>({});
  useEffect(() => {
    const load = async () => {
      try {
        const res  = await fetch('/api/funding');
        const json = await res.json();
        if (json.data) {
          const map: Record<string, FundingRow> = {};
          (json.data as FundingRow[]).forEach(r => { map[r.coin] = r; });
          setFundingData(map);
        }
      } catch { /* silent */ }
    };
    load();
    let iv = setInterval(load, 60_000);
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(iv);
      } else {
        load();
        iv = setInterval(load, 60_000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  /* ── Push notifications ── */
  const enableNotifications = async () => {
    if (!('Notification' in window)) { alert('Notifications not supported in this browser.'); return; }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') setNotifEnabled(true);
    else alert('Notification permission denied. Enable in browser settings.');
  };

  const fireNotif = useCallback(async (title: string, body: string) => {
    if (!notifEnabled) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: '/icons/icon-192.png' });
    } catch {
      try { new Notification(title, { body }); } catch { /* */ }
    }
  }, [notifEnabled]);

  useEffect(() => {
    if (!notifEnabled) return;
    const coin = store.coins[selectedCoin];
    const sym  = selectedCoin.toUpperCase();
    const b30  = Math.floor(Date.now() / (30 * 60 * 1000));  // 30-min bucket
    const b1h  = Math.floor(Date.now() / (60 * 60 * 1000));  // 1-hour bucket
    const b2h  = Math.floor(Date.now() / (2  * 60 * 60 * 1000));
    const b4h  = Math.floor(Date.now() / (4  * 60 * 60 * 1000));

    const fire = (key: string, title: string, body: string) => {
      if (notifCooldown.current.has(key)) return;
      notifCooldown.current.add(key);
      fireNotif(title, body);
    };

    /* 1 — Extreme funding rate (30 min cooldown) */
    if (coin?.fundingRate != null) {
      const fr = coin.fundingRate * 100;
      if (Math.abs(fr) >= settings.fr_threshold)
        fire(`fund-${selectedCoin}-${b30}`,
          `⚡ ${sym} Extreme Funding`,
          `${fr >= 0 ? '+' : ''}${fr.toFixed(4)}% — ${fr > 0 ? 'Longs at risk ↓' : 'Shorts being squeezed ↑'}`);
    }

    /* 2 — Fear & Greed extreme (4 hour cooldown) */
    if (store.fng != null && (store.fng <= settings.fng_fear || store.fng >= settings.fng_greed))
      fire(`fng-${store.fng <= settings.fng_fear ? 'fear' : 'greed'}-${b4h}`,
        store.fng <= settings.fng_fear ? '🩸 Extreme Fear' : '🔴 Extreme Greed',
        `Fear & Greed: ${store.fng} (${store.fngLabel}) — ${store.fng <= settings.fng_fear ? 'Potential bottom signal' : 'Markets overextended'}`);

    /* 3 — CVD Divergence (1 hour cooldown) */
    if (coin?.cvdDivergence)
      fire(`cvd-${selectedCoin}-${coin.cvdDivergence}-${b1h}`,
        coin.cvdDivergence === 'bullish'
          ? `📈 ${sym} Bullish CVD Divergence`
          : `📉 ${sym} Bearish CVD Divergence`,
        coin.cvdDivergence === 'bullish'
          ? 'Price falling but buyers absorbing — smart money accumulating. Watch for reversal ↑'
          : 'Price rising but sellers increasing — distribution detected. Watch for reversal ↓');

    /* 4 — RSI 1h extreme (2 hour cooldown) */
    if (coin?.rsi1h != null) {
      if (coin.rsi1h >= settings.rsi_ob)
        fire(`rsi-ob-${selectedCoin}-${b2h}`,
          `⚠ ${sym} RSI Overbought (1H)`,
          `RSI 1H: ${coin.rsi1h.toFixed(0)} — Exhaustion zone. Avoid chasing longs, watch for reversal candle.`);
      else if (coin.rsi1h <= settings.rsi_os)
        fire(`rsi-os-${selectedCoin}-${b2h}`,
          `⚠ ${sym} RSI Oversold (1H)`,
          `RSI 1H: ${coin.rsi1h.toFixed(0)} — Bounce setup forming. Watch for volume spike + rejection candle.`);
    }

    /* 5 — Chart pattern detected (30 min cooldown) */
    if (coin?.chartPattern) {
      const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(coin.chartPattern);
      const isBear = /bear|lower high|engulf.*bear|shooting|hanging|double top/i.test(coin.chartPattern);
      if (isBull)
        fire(`pat-bull-${selectedCoin}-${b30}`,
          `📊 ${sym} Bullish Pattern`,
          `${coin.chartPattern.split(';')[0].trim()} — Check for entry confirmation.`);
      else if (isBear)
        fire(`pat-bear-${selectedCoin}-${b30}`,
          `📊 ${sym} Bearish Pattern`,
          `${coin.chartPattern.split(';')[0].trim()} — Watch for breakdown confirmation.`);
    }

    /* 6 — OI trend signal (1 hour cooldown) */
    if (coin?.oiTrend === 'strong_up')
      fire(`oi-sup-${selectedCoin}-${b1h}`,
        `📈 ${sym} OI Spike — New Longs`,
        'OI rising with price — real trend, new money entering. Bullish continuation likely.');
    else if (coin?.oiTrend === 'strong_down')
      fire(`oi-sdn-${selectedCoin}-${b1h}`,
        `📉 ${sym} OI Spike — New Shorts`,
        'OI rising with price falling — new shorts entering. Bearish continuation likely.');

    /* 7 — Sentiment Extremes: F&G + FR + L/S all aligned (#20) */
    if (store.fng != null && coin?.fundingRate != null && coin?.longRatio != null) {
      const fng      = store.fng;
      const fr       = coin.fundingRate * 100;
      const longRat  = coin.longRatio * 100;  // e.g. 62.1
      const shortRat = 100 - longRat;
      // Bearish: all 3 screaming "longs overcrowded"
      if (fng >= 75 && fr >= 0.04 && longRat >= 60)
        fire(`sent-bear-${b4h}`,
          '🚨 Sentiment Extremes — Bearish',
          `F&G ${fng} (Extreme Greed) · FR +${fr.toFixed(3)}% · ${longRat.toFixed(0)}% Long — all 3 at extremes. Long flush risk elevated. Tighten stops.`);
      // Contrarian bullish: all 3 screaming "shorts overcrowded"
      if (fng <= 25 && fr <= -0.02 && longRat <= 40)
        fire(`sent-bull-${b4h}`,
          '🟢 Sentiment Extremes — Contrarian Bullish',
          `F&G ${fng} (Extreme Fear) · FR ${fr.toFixed(3)}% · ${shortRat.toFixed(0)}% Short — all 3 at extremes. Potential reversal zone. Wait for confirmation.`);
    }

  }, [store, selectedCoin, notifEnabled, fireNotif, settings]);

  const gatherContext = (): GrokContext => {
    const coin = store.coins[selectedCoin];
    const pht = getPHT();
    const session = getSessionName(pht);

    /* 15m technicals */
    const rsi14 = coin?.rsi14 != null
      ? coin.rsi14.toFixed(1) + (coin.rsi14 >= 70 ? ' (Overbought)' : coin.rsi14 <= 30 ? ' (Oversold)' : ' (Neutral)')
      : '—';
    const ma20 = coin?.ma20 != null ? '$' + coin.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
    const priceVsMA = coin?.price && coin?.ma20
      ? coin.price > coin.ma20
        ? 'ABOVE MA20 (+' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% — bullish)'
        : 'BELOW MA20 (' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% — bearish)'
      : '—';
    const volRatio = coin?.volRatio != null
      ? coin.volRatio.toFixed(2) + 'x' + (coin.volRatio >= 1.5 ? ' (spike)' : coin.volRatio <= 0.6 ? ' (dry)' : ' (normal)')
      : '—';
    const longShortRatio = coin?.longRatio != null && coin?.shortRatio != null
      ? 'Long ' + (coin.longRatio * 100).toFixed(1) + '% / Short ' + (coin.shortRatio * 100).toFixed(1) + '%'
        + (coin.longRatio > 0.6 ? ' (overleveraged longs)' : coin.shortRatio > 0.6 ? ' (overleveraged shorts)' : ' (balanced)')
      : '—';

    /* Multi-TF RSI */
    const fmt = (v: number | null | undefined) => v != null
      ? v.toFixed(0) + (v >= 70 ? ' (Overbought)' : v <= 30 ? ' (Oversold)' : ' (Neutral)')
      : '—';
    const rsi1h = fmt(coin?.rsi1h);
    const rsi4h = fmt(coin?.rsi4h);

    /* CVD */
    const cvd = coin?.cvd != null
      ? (coin.cvd >= 0 ? '+' : '') + (coin.cvd / 1000).toFixed(1) + 'K'
        + (coin.cvd > 0 ? ' (net buying)' : ' (net selling)')
      : '—';
    const cvdDivergence = coin?.cvdDivergence
      ? coin.cvdDivergence === 'bullish'
        ? 'BULLISH DIVERGENCE DETECTED — price falling but net buying rising (smart money accumulating)'
        : 'BEARISH DIVERGENCE DETECTED — price rising but net selling rising (distribution)'
      : 'None';

    /* Basis */
    const basis = coin?.perpPrice != null && coin?.price
      ? (() => {
          const b = ((coin.perpPrice - coin.price) / coin.price) * 100;
          return b.toFixed(4) + '%' + (b > 0.05 ? ' (perp premium — bullish)' : b < -0.05 ? ' (perp discount — bearish)' : ' (neutral)');
        })()
      : '—';

    /* Fibonacci nearest */
    const fibNearest = coin?.high && coin?.low && coin.high > coin.low && coin?.price
      ? (() => {
          const fibs = computeFibLevels(coin.high, coin.low, coin.price);
          if (!fibs.length) return '—';
          const nearest = fibs.reduce((acc, f) => Math.abs(coin.price - f.price) < Math.abs(coin.price - acc.price) ? f : acc);
          return nearest.label + ' @ $' + nearest.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' (' + nearest.dist + ')';
        })()
      : '—';

    /* Order book walls */
    const orderWalls = coin?.orderBidWalls && coin?.orderAskWalls
      ? 'Bid walls: ' + coin.orderBidWalls.map(w => '$' + w.price.toLocaleString(undefined, { maximumFractionDigits: 0 })).join(', ')
        + ' | Ask walls: ' + coin.orderAskWalls.map(w => '$' + w.price.toLocaleString(undefined, { maximumFractionDigits: 0 })).join(', ')
      : '—';

    /* Squeeze score */
    const sq = computeSqueezeScore(coin);
    const squeezeScore = sq.score + '/100 — ' + sq.label;

    /* Options */
    const pcRatio = store.btcPcRatio != null
      ? store.btcPcRatio.toFixed(2) + (store.btcPcRatio > 1.2 ? ' (bearish — more puts)' : store.btcPcRatio < 0.7 ? ' (bullish — more calls)' : ' (neutral)')
      : '—';
    const maxPain = store.btcMaxPain != null ? '$' + store.btcMaxPain.toLocaleString() : '—';

    /* Exchange net flow */
    const exchangeNetFlow = store.btcExchangeNetFlow != null
      ? (store.btcExchangeNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.btcExchangeNetFlow).toFixed(1) + 'M'
        + (store.btcExchangeNetFlow > 50 ? ' (inflow — sell pressure)' : store.btcExchangeNetFlow < -50 ? ' (outflow — accumulation)' : ' (neutral)')
      : 'AI will search';

    /* Stablecoin flow */
    const stablecoinFlow = store.stablecoinSupply != null
      ? '$' + store.stablecoinSupply.toFixed(1) + 'B'
        + (store.stablecoinPrev != null
          ? (store.stablecoinSupply > store.stablecoinPrev ? ' ↑ minting (bullish)' : ' ↓ burning (bearish)')
          : '')
      : '—';

    /* Google Trends */
    const googleTrends = store.googleTrendsBtc != null
      ? store.googleTrendsBtc + '/100' + (store.googleTrendsBtc > 70 ? ' (high retail — possible top)' : store.googleTrendsBtc < 25 ? ' (low — possible bottom)' : ' (moderate)')
      : 'AI will search';

    /* Liquidation levels */
    const liqLevels = store.btcLiqLevels && store.btcLiqLevels.length > 0
      ? store.btcLiqLevels.slice(0, 4).map(l => '$' + l.price.toLocaleString() + ' ' + l.side).join(' | ')
      : 'AI will search';

    /* BTC dom trend */
    const btcDomTrend = store.btcDomHistory && store.btcDomHistory.length >= 3
      ? (() => {
          const h = store.btcDomHistory;
          const trend = h[h.length - 1] - h[0];
          return (store.btcDom?.toFixed(2) ?? '') + '%'
            + (trend > 0.3 ? ' ↑ rising (alt weakness)' : trend < -0.3 ? ' ↓ falling (alt season)' : ' → flat');
        })()
      : (store.btcDom != null ? store.btcDom.toFixed(2) + '%' : '—');

    /* Volume Profile POC */
    const pocLine = coin?.poc != null
      ? '$' + coin.poc.toLocaleString(undefined, { maximumFractionDigits: 2 })
        + (coin.vah != null ? ' | VAH $' + coin.vah.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')
        + (coin.val != null ? ' | VAL $' + coin.val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')
        + (coin.price && coin.poc ? (coin.price > coin.poc ? ' — price ABOVE POC (bullish)' : ' — price BELOW POC (bearish)') : '')
      : '—';

    /* Taker Buy/Sell ratio */
    const takerBuy = coin?.takerBuyRatio;
    const takerRatio = takerBuy != null
      ? `Buy ${Math.round(takerBuy * 100)}% / Sell ${Math.round((1 - takerBuy) * 100)}%`
        + (takerBuy >= 0.65 ? ' — aggressive buyers hitting asks (BULLISH)'
        :  takerBuy >= 0.55 ? ' — mild buy pressure'
        :  takerBuy <= 0.35 ? ' — aggressive sellers hitting bids (BEARISH)'
        :  takerBuy <= 0.45 ? ' — mild sell pressure'
        :                     ' — balanced flow')
      : '—';

    /* Coinbase Premium */
    const cbPremium = store.cbPremium != null && store.cbPremiumPct != null
      ? (store.cbPremium >= 0 ? '+' : '') + '$' + Math.abs(store.cbPremium).toFixed(1)
        + ' (' + (store.cbPremiumPct >= 0 ? '+' : '') + store.cbPremiumPct.toFixed(3) + '%)'
        + (store.cbPremiumPct > 0.05  ? ' — US institutional buying (BULLISH)'
        :  store.cbPremiumPct < -0.05 ? ' — US institutional selling (BEARISH)'
        :                               ' — neutral')
      : '—';

    /* VWAP */
    const vwap = coin?.vwap != null
      ? '$' + coin.vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })
        + (coin.price
          ? (coin.price > coin.vwap
              ? ' — price ABOVE VWAP (bullish, paying up)'
              : ' — price BELOW VWAP (bearish, distributing)')
          : '')
      : '—';

    /* OI Trend vs Price */
    const OI_TREND_LABELS: Record<string, string> = {
      strong_up:   'OI ↑ + Price ↑ — real bullish trend (new money entering longs)',
      strong_down: 'OI ↑ + Price ↓ — real bearish trend (new money entering shorts)',
      weak_up:     'OI ↓ + Price ↑ — short covering rally (no conviction, likely fake)',
      weak_down:   'OI ↓ + Price ↓ — long exits (capitulation, not fresh shorts)',
    };
    const oiTrend = coin?.oiTrend ? OI_TREND_LABELS[coin.oiTrend] : '—';

    /* GEX (Gamma Exposure) */
    const btcGex = (() => {
      const net = store.btcNetGex;
      const flip = store.btcGexFlip;
      if (net == null) return 'Calculating…';
      const absN = Math.abs(net);
      const netStr = (net >= 0 ? '+' : '−') + '$' + (absN >= 1e9 ? (absN / 1e9).toFixed(2) + 'B' : (absN / 1e6).toFixed(0) + 'M');
      const regime = net >= 0
        ? 'Dealers LONG gamma — market pins/mean-reverts near large strikes'
        : 'Dealers SHORT gamma — moves accelerate, expect trending/explosive vol';
      const flipStr = flip ? ` | Flip level: $${flip.toLocaleString()} (break = regime shift)` : '';
      const topStrike = store.btcGexLevels.length > 0
        ? store.btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
        : null;
      const pinStr = topStrike ? ` | Pin strike: $${topStrike.strike.toLocaleString()}` : '';
      return `${netStr} — ${regime}${flipStr}${pinStr}`;
    })();

    /* Macro */
    const oilPrice  = store.oilPrice  != null ? '$' + store.oilPrice.toFixed(2)  + '/bbl' : '—';
    const bonds10y  = store.bonds10y  != null ? store.bonds10y.toFixed(3)  + '%'   : '—';
    const dxyLine   = store.dxy       != null ? store.dxy.toFixed(2) + (store.dxyChg != null ? ' (' + (store.dxyChg >= 0 ? '+' : '') + store.dxyChg.toFixed(2) + '%)' : '') + (store.dxyChg != null && store.dxyChg > 0.2 ? ' → BTC headwind' : store.dxyChg != null && store.dxyChg < -0.2 ? ' → BTC tailwind' : '') : '—';
    const spxLine   = store.spx       != null ? store.spx.toLocaleString(undefined, { maximumFractionDigits: 0 }) + (store.spxChg != null ? ' (' + (store.spxChg >= 0 ? '+' : '') + store.spxChg.toFixed(2) + '%)' : '') + (store.spxChg != null && store.spxChg > 0.3 ? ' → risk-on' : store.spxChg != null && store.spxChg < -0.5 ? ' → risk-off' : '') : '—';
    const goldLine  = store.gold      != null ? '$' + store.gold.toLocaleString(undefined, { maximumFractionDigits: 0 }) + (store.goldChg != null ? ' (' + (store.goldChg >= 0 ? '+' : '') + store.goldChg.toFixed(2) + '%)' : '') : '—';

    /* Upcoming events + recently released */
    const now = Date.now();
    const recentlyReleased = econEvents
      .filter(e => { const lh = (e.dt.getTime() - now) / 3600000; return lh >= -6 && lh < 0; }).slice(0, 3)
      .map(e => { const minsAgo = Math.round((now - e.dt.getTime()) / 60000); return `⚡ JUST RELEASED: ${e.name} — ${minsAgo}m ago (check news headlines for actual print)`; })
      .join('\n');
    const upcomingList = econEvents
      .filter(e => { const lh = (e.dt.getTime() - now) / 3600000; return lh > 0 && lh < 24; }).slice(0, 5)
      .map(e => `${e.name} (${e.dateStr}, impact: ${e.impact})`)
      .join('\n') || 'None in next 24h';
    const upcoming = [recentlyReleased, upcomingList].filter(Boolean).join('\n');

    /* ETF flows */
    const fmtFlow = (v: number | null, asset: string) => {
      if (v == null) return null;
      const sign = v >= 0 ? '+' : '';
      const tag = v > 200 ? ' (strong inflow)' : v > 0 ? ' (inflow)' : v < -200 ? ' (heavy outflow)' : ' (outflow)';
      return `${asset} ${sign}$${Math.abs(v).toFixed(0)}M${tag}`;
    };
    const etfFlows = [fmtFlow(store.etfNetFlow, 'BTC ETF'), fmtFlow(store.ethEtfNetFlow, 'ETH ETF')]
      .filter(Boolean).join(' | ') || 'AI will search live';

    /* Liquidation cascade size (#30) */
    const ca = store.cascadeAlert;
    const cascadeLine = ca && (Date.now() - ca.ts < 4 * 60 * 60 * 1000)
      ? `${ca.side} cascade on ${ca.coin} — $${(ca.totalUsd / 1e6).toFixed(1)}M liquidated (${Math.floor((Date.now() - ca.ts) / 60000)}m ago)`
      : 'None in last 4h';

    /* Whale net flow — last 1h for selected coin (#29) */
    const nowSec = Math.floor(Date.now() / 1000);
    const coinSym = selectedCoin.toUpperCase();
    const recentWhales = whaleAlerts.filter(w => w.symbol === coinSym && nowSec - w.ts < 3600);
    const whaleFlow = (() => {
      if (!['btc', 'eth'].includes(selectedCoin)) return 'Whale monitoring: BTC/ETH only';
      if (recentWhales.length === 0) return 'No whale trades (>$500K) detected in last 1h';
      let buyUsd = 0, sellUsd = 0, buyCount = 0, sellCount = 0;
      recentWhales.forEach(w => {
        if (w.side === 'BUY')  { buyUsd  += w.usdValue; buyCount++;  }
        else                   { sellUsd += w.usdValue; sellCount++; }
      });
      const net = buyUsd - sellUsd;
      const f = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}K`;
      return `Net ${net >= 0 ? 'BUY' : 'SELL'} ${f(Math.abs(net))} — ${buyCount} buys (${f(buyUsd)}) vs ${sellCount} sells (${f(sellUsd)}) · ${recentWhales.length} whale trades >$500K in last 1h`;
    })();

    /* Cross-exchange funding */
    const cf = fundingData[selectedCoin];
    const crossExchangeFunding = cf
      ? (() => {
          const fmt = (v: number | null) => v !== null ? (v >= 0 ? '+' : '') + (v * 100).toFixed(4) + '%' : '—';
          const vals = [cf.binance, cf.bybit, cf.okx].filter((v): v is number => v !== null);
          const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
          const divergent = avg !== null && [cf.binance, cf.bybit, cf.okx]
            .some(v => v !== null && Math.abs(v - avg) * 100 >= 0.02);
          const sentiment = avg === null ? '' : avg * 100 >= 0.05 ? ' — extreme long crowding (flush risk)'
            : avg * 100 >= 0.01 ? ' — longs paying, mild crowding'
            : avg * 100 <= -0.05 ? ' — extreme short crowding (squeeze risk)'
            : avg * 100 <= -0.01 ? ' — shorts paying, mild crowding'
            : ' — neutral';
          return `Binance ${fmt(cf.binance)} | Bybit ${fmt(cf.bybit)} | OKX ${fmt(cf.okx)} | Avg ${fmt(avg)}${sentiment}${divergent ? ' ⚡ DIVERGENCE: one exchange significantly different — flow imbalance' : ''}`;
        })()
      : '—';

    return {
      coin: selectedCoin.toUpperCase() + '/USDT',
      price: coin?.price ? '$' + coin.price.toLocaleString() : '—',
      change24h: coin?.change != null ? (coin.change >= 0 ? '+' : '') + coin.change.toFixed(2) + '%' : '—',
      fundingRate: coin?.fundingRate != null ? classifyFunding(coin.fundingRate).label : '—',
      openInterest: coin?.oi != null ? '$' + (coin.oi / 1e9).toFixed(2) + 'B' : '—',
      fearGreed: store.fng != null ? store.fng + ' (' + store.fngLabel + ')' : '—',
      btcDominance: btcDomTrend,
      session, clusters: '—',
      news: latestHeadlines.length > 0 ? latestHeadlines.slice(0, 15).join('\n') : 'No recent alerts',
      rsi14, ma20, priceVsMA, volRatio, longShortRatio,
      oilPrice, bonds10y, upcomingEvents: upcoming, etfFlows,
      rsi1h, rsi4h, rsiDaily: fmt(coin?.rsiDaily), cvd, cvdDivergence, basis, fibNearest, orderWalls, squeezeScore,
      pcRatio, maxPain, btcGex,
      exchangeNetFlow, stablecoinFlow, googleTrends, liqLevels, btcDomTrend,
      pocLine, dxyLine, spxLine, goldLine,
      cbPremium, vwap, oiTrend, takerRatio, crossExchangeFunding,
      cascadeLine, whaleFlow,
      setupScan: (() => {
        const sq = computeSqueezeScore(coin);
        const oiChip  = coin?.oiTrend   ? { strong_up: 'OI ↑↑', weak_up: 'OI ↑', weak_down: 'OI ↓', strong_down: 'OI ↓↓' }[coin.oiTrend] ?? 'OI —' : 'OI —';
        const cvdChip = coin?.cvdDivergence === 'bullish' ? 'CVD ↑' : coin?.cvdDivergence === 'bearish' ? 'CVD ↓' : 'CVD —';
        const tkr     = coin?.takerBuyRatio != null ? 'Tkr ' + (coin.takerBuyRatio * 100).toFixed(0) + '%' : 'Tkr —';
        const rsi     = coin?.rsi14 != null ? 'RSI ' + Math.round(coin.rsi14) : 'RSI —';
        return `Score ${sq.score}/100 · ${sq.label} · ${oiChip}, ${cvdChip}, ${tkr}, ${rsi}`;
      })(),
      oi1hChange: (() => {
        const { pct, signal } = oi1hDataRef.current;
        if (pct == null) return '—';
        return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% · ' + signal;
      })(),
      marketStructure: (() => {
        const ms = msDataRef.current;
        if (!ms) return '—';
        let s = ms.bias;
        if (ms.lastEvent) {
          const le = ms.lastEvent;
          s += ` · Last: ${le.type} ${le.dir} @ $${fmtPrice(le.price)} (${le.candlesAgo === 0 ? 'current' : le.candlesAgo + 'c ago'})`;
          if (le.type === 'CHoCH') s += ' — STRUCTURE FLIP';
        }
        if (ms.lastSwingHigh != null) s += ` · SH $${fmtPrice(ms.lastSwingHigh)}`;
        if (ms.lastSwingLow  != null) s += ` · SL $${fmtPrice(ms.lastSwingLow)}`;
        return s;
      })(),
      absorptionScore: (() => {
        const ab = absDataRef.current;
        if (!ab || ab.label === 'None') return 'None';
        let s = `${ab.label} ${ab.type === 'accumulation' ? 'ACCUMULATION' : ab.type === 'distribution' ? 'DISTRIBUTION' : ''} (${ab.score}/100)`;
        if (ab.duration > 0) {
          const m = ab.durationMin;
          s += ` · ${ab.duration} candles (~${m < 60 ? m + 'm' : Math.floor(m/60) + 'h' + (m % 60 ? ' ' + m % 60 + 'm' : '')})`;
        }
        if (ab.nearLevel) s += ` · ${ab.nearLevel}`;
        if (ab.mtfConfirmed) s += ' · 1H CONFIRMED';
        return s;
      })(),
      yenWatch: jpyUsd == null ? '—'
        : jpyUsd >= 160
          ? `${jpyUsd.toFixed(2)} — DANGER ZONE: BOJ intervention risk high, carry trade unwind can trigger BTC liquidations`
          : jpyUsd >= 158
            ? `${jpyUsd.toFixed(2)} — WARNING: Approaching 160 danger zone, watch for BOJ signals`
            : `${jpyUsd.toFixed(2)} — Safe: below 158, carry trade stable, low JPY liquidation risk`,
    };
  };

  const readMarket = useCallback(async (mode: 'quick' | 'deep' = 'deep', force = false) => {
    const binanceSym = BINANCE_SYMS[selectedCoin] as string | undefined;
    const bybitSym   = BYBIT_SYMS[selectedCoin]   as string | undefined;
    if (!binanceSym && !bybitSym) {
      setReadError('No market data source for ' + selectedCoin.toUpperCase());
      return;
    }

    // ── Cache check — skip API call if result is fresh and price hasn't moved >0.5% ──
    // Quick accepts any cached result (Quick or Deep).
    // Deep only accepts a cached Deep result — clicking Deep always re-fetches if last was Quick.
    if (!force) {
      const currentPrice = store.coins[selectedCoin]?.price ?? 0;
      const entry = resultsCache[selectedCoin];
      if (entry && entry.mode === mode) {
        const ageSecs  = (Date.now() - entry.result.analyzedAt) / 1000;
        const pricePct = currentPrice > 0
          ? Math.abs(currentPrice - entry.priceAtAnalysis) / currentPrice * 100
          : 0;
        if (ageSecs < getCacheTTL() / 1000 && pricePct < PRICE_MOVE_PCT && entry.result.tf === readTf) {
          return; // serve cache silently — no banner, no state change
        }
      }
    }

    setReadMode(mode);
    setReadLoading(true); setReadError('');

    try {
      // Step 1 — fetch candles (Binance preferred; fall back to Bybit for HYPE etc.)
      setReadStep('Reading chart…');
      let raw: (string|number)[][];
      if (binanceSym) {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${readTf}&limit=300`);
        if (!r.ok) throw new Error('Binance API error');
        raw = await r.json();
      } else {
        // Bybit klines: interval uses numbers (1, 5, 15, 30, 60, 240) or 'D'; response is newest-first
        const bybitInterval = readTf === '1m' ? '1' : readTf === '5m' ? '5' : readTf === '30m' ? '30' : readTf === '15m' ? '15' : readTf === '1h' ? '60' : readTf === '4h' ? '240' : 'D';
        const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=${bybitInterval}&limit=300`);
        if (!r.ok) throw new Error('Bybit API error');
        const data = await r.json();
        raw = [...(data?.result?.list ?? [])].reverse(); // oldest-first to match Binance
      }
      // k[0]=time k[1]=open k[2]=high k[3]=low k[4]=close k[5]=vol — same index for both
      const candles = raw.map(k => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
      const closes  = candles.map(c => c.c);
      const vis     = candles.slice(-80);
      const ema9    = calcEMA(closes, 9).at(-1) ?? null;
      const ema200  = calcEMA(closes, 200).at(-1) ?? null;
      const rsi     = calcRSI(closes, 14).at(-1) ?? null;
      const lastC    = vis[vis.length - 1].c;
      const pDec     = lastC >= 10000 ? 0 : lastC >= 100 ? 2 : lastC >= 1 ? 3 : 4;
      // Include volume so AI can detect drying-up volume (exhaustion signal)
      const recent20 = vis.slice(-15).map(c => `O:${c.o.toFixed(pDec)} H:${c.h.toFixed(pDec)} L:${c.l.toFixed(pDec)} C:${c.c.toFixed(pDec)} V:${c.v >= 1e6 ? (c.v/1e6).toFixed(2)+'M' : c.v >= 1e3 ? (c.v/1e3).toFixed(1)+'K' : c.v.toFixed(0)}`).join(' | ');
      const detectedPatterns = detectPatterns(vis);
      const chartData: ChartData = {
        tf: readTf, ema9, ema200, rsi, recent20,
        hi: Math.max(...vis.map(c => c.h)),
        lo: Math.min(...vis.map(c => c.l)),
        lastClose: vis[vis.length - 1].c,
        detectedPatterns: detectedPatterns || undefined,
      };

      // Step 1.5 — fetch daily RSI (parallel, silent fail)
      let rsiDailyStr = '—';
      try {
        if (binanceSym) {
          const dr = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=1d&limit=20`);
          const dd = await dr.json() as (string|number)[][];
          const dc = dd.map(k => Number(k[4]));
          const dv = calcRSI(dc, 14).at(-1);
          if (dv != null) rsiDailyStr = dv.toFixed(1) + (dv >= 70 ? ' (Overbought)' : dv <= 30 ? ' (Oversold)' : ' (Neutral)');
        } else if (bybitSym) {
          const dr = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=D&limit=20`);
          const dd = await dr.json() as { result?: { list?: string[][] } };
          const dc = [...(dd?.result?.list ?? [])].reverse().map(k => parseFloat(k[4]));
          const dv = calcRSI(dc, 14).at(-1);
          if (dv != null) rsiDailyStr = dv.toFixed(1) + (dv >= 70 ? ' (Overbought)' : dv <= 30 ? ' (Oversold)' : ' (Neutral)');
        }
      } catch { /* silent */ }

      // Step 2 — gather 34 market signals
      setReadStep('Reading market…');
      const ctx = { ...gatherContext(), rsiDaily: rsiDailyStr };

      // Step 3 — ask Grok via server proxy (key hidden, rate-limited)
      setReadStep(mode === 'quick' ? 'Quick analysis…' : 'Searching live…');
      const prompt = mode === 'quick'
        ? buildQuickPrompt(ctx, chartData)
        : buildCombinedPrompt(ctx, chartData);
      const { result: res, usage } = await callGrokViaProxy(prompt, readTf, ctx.session, mode);
      if (usage) setGrokUsage(usage);
      track.arenaAnalysis(mode, selectedCoin);

      // ── Liquidity Raid → Telegram alert (1h cooldown per coin + setup type) ──
      if (res.raidSetup) {
        try {
          const raidKey  = `raid-tg-${selectedCoin}-${res.raidSetup}`;
          const lastSent = Number(localStorage.getItem(raidKey) ?? 0);
          if (Date.now() - lastSent > 60 * 60 * 1000) {
            localStorage.setItem(raidKey, String(Date.now()));
            const sym  = selectedCoin.toUpperCase();
            const lines: string[] = [
              '<b>LIQUIDITY RAID DETECTED</b>',
              `<b>${res.raidSetup} — ${sym}/USDT</b>`,
              '',
            ];
            if (res.raidTarget)  lines.push(`Target: ${res.raidTarget}`);
            if (res.raidTrigger) lines.push(`Trigger: ${res.raidTrigger}`);
            lines.push(`Signal: ${res.signal} · ${res.confidence}% confidence`);
            lines.push(`Session: ${ctx.session}`);
            lines.push('');
            lines.push('<i>LiquidityHQ Arena</i>');
            fetch('/api/telegram/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: lines.join('\n') }),
            }).catch(() => { /* silent — alert failure must not block UI */ });
          }
        } catch { /* localStorage unavailable — skip silently */ }
      }

      // Cache result per coin (with price snapshot for stale-check)
      const priceNow = store.coins[selectedCoin]?.price ?? 0;
      setResultsCache(prev => ({ ...prev, [selectedCoin]: { result: res, priceAtAnalysis: priceNow, mode } }));
      // Track Quick signals separately so Deep can show an override notice when they disagree
      if (mode === 'quick') setQuickSignals(prev => ({ ...prev, [selectedCoin]: res.signal }));
      setDetailIdx(null);
      setSigDetailsOpen(false);
      const entryStr = res.entryLow && res.entryHigh
        ? `$${fmtPrice(res.entryLow)} – $${fmtPrice(res.entryHigh)}`
        : '—';
      setHistory(h => [{
        signal: res.signal, confidence: res.confidence,
        coin: ctx.coin, time: new Date().toLocaleTimeString(),
        entry: entryStr, reasoning: res.reasoning, session: ctx.session,
      }, ...h].slice(0, 10));
      if (user && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        getSupabase()!.from('signals').insert({
          coin: ctx.coin, signal: res.signal, confidence: res.confidence,
          entry_zone: entryStr, reasoning: res.reasoning, session: ctx.session,
        }).then(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setReadError(msg);
      // If rate limit error, update usage display so the chip reflects the limit
      const usageFromErr = (e as { usage?: GrokUsageInfo }).usage;
      if (usageFromErr) setGrokUsage(usageFromErr);
    } finally {
      setReadLoading(false); setReadStep('');
    }
  }, [selectedCoin, readTf, store, latestHeadlines, econEvents, fundingData, resultsCache]);

  const ctx = gatherContext();
  const sq = computeSqueezeScore(store.coins[selectedCoin]);

  /* ── Squeeze scanner data — sorted by 24h volume descending (BTC → ETH → ...) ── */
  const scannerRows = COINS
    .filter(c => coinCat === 'all' || (CAT_FILTER_COINS[coinCat] as readonly CoinId[]).includes(c))
    .map(c => ({
      c,
      sq:     computeSqueezeScore(store.coins[c]),
      price:  store.coins[c]?.price  ?? null,
      change: store.coins[c]?.change ?? null,
      vol24:  store.coins[c]?.vol24  ?? 0,
    })).sort((a, b) => (b.vol24 ?? 0) - (a.vol24 ?? 0));
  const sqzCount   = scannerRows.filter(x => x.sq.dir === 'SHORT_SQ'  && x.sq.score >= 30).length;
  const flushCount = scannerRows.filter(x => x.sq.dir === 'LONG_LIQ'  && x.sq.score >= 30).length;

  return (
    <div>

      {/* ── PAGE HEADER ── */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', letterSpacing: '-0.3px' }}>LiquidityAI Arena</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em' }}>LiquidityAI · LIVE X</span>
          {jpyUsd != null && (() => {
            const col = jpyUsd >= 160 ? '#f87171' : jpyUsd >= 158 ? '#fbbf24' : '#34d399';
            const label = jpyUsd >= 160 ? 'DANGER' : jpyUsd >= 158 ? 'WARN' : 'SAFE';
            return (
              <span title={`USD/JPY ${jpyUsd.toFixed(2)} — Yen carry trade risk indicator. Danger zone: ≥160`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                color: col, background: col + '14', border: `0.5px solid ${col}44`,
                letterSpacing: '.04em', cursor: 'default',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: col, boxShadow: `0 0 5px ${col}` }} />
                JPY {jpyUsd.toFixed(0)} · {label}
              </span>
            );
          })()}
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Chart · 35-signal engine · confluence · scanner — one page</div>
      </div>

      {/* ── COIN CATEGORY TABS ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['all', 'majors', 'alts', 'meme'] as const).map(c => (
          <button
            key={c}
            className={`gsc-tf-btn${coinCat === c ? ' on' : ''}`}
            style={{ padding: '3px 9px', fontSize: 10, textTransform: 'capitalize' }}
            onClick={() => setCoinCat(c)}
          >
            {c === 'all' ? 'All' : c === 'majors' ? 'Majors' : c === 'alts' ? 'Alts' : 'Meme'}
          </button>
        ))}
      </div>

      {/* ── SQUEEZE SCANNER — hover flyout (Bybit-style watchlist) ── */}
      <div
        ref={scannerRef}
        style={{ position: 'relative', marginBottom: 12 }}
        onMouseEnter={handleScannerHoverEnter}
        onMouseLeave={handleScannerHoverLeave}
      >
        {/* ── Compact trigger bar ── */}
        <button
          onClick={() => setScannerOpen(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 8,
            background: scannerOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
            border: `0.5px solid ${scannerOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
            cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          {/* Dot indicator */}
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: sqzCount > 0 ? '#34d399' : flushCount > 0 ? '#f87171' : '#333',
            boxShadow: sqzCount > 0 ? '0 0 6px #34d39966' : flushCount > 0 ? '0 0 6px #f8717166' : 'none',
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#555', letterSpacing: '.04em', flex: 1 }}>
            Squeeze Scanner
          </span>
          {/* Active signal chips */}
          {sqzCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '1px 7px', borderRadius: 20, border: '0.5px solid rgba(52,211,153,0.2)' }}>
              ↑ {sqzCount}
            </span>
          )}
          {flushCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '1px 7px', borderRadius: 20, border: '0.5px solid rgba(248,113,113,0.2)' }}>
              ↓ {flushCount}
            </span>
          )}
          {sqzCount === 0 && flushCount === 0 && (
            <span style={{ fontSize: 10, color: '#333' }}>All neutral</span>
          )}
          {/* Selected coin chip */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 700, color: '#b8aeff',
            background: 'rgba(184,174,255,0.1)', padding: '2px 9px 2px 5px',
            borderRadius: 20, border: '0.5px solid rgba(184,174,255,0.2)',
            flexShrink: 0,
          }}>
            <CoinIcon coin={selectedCoin} size={16} color="#b8aeff" bg="rgba(184,174,255,0.15)" />
            {selectedCoin.toUpperCase()}
          </span>
          {/* Notification bell — div to avoid button-in-button invalid HTML */}
          <div
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); enableNotifications(); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); enableNotifications(); } }}
            title={notifEnabled ? 'Alerts ON' : 'Enable browser alerts'}
            style={{
              padding: '3px 7px', borderRadius: 7, border: '0.5px solid',
              background: notifEnabled ? '#152b1e' : 'transparent',
              borderColor: notifEnabled ? '#266038' : 'rgba(255,255,255,0.08)',
              color: notifEnabled ? '#7de0a4' : '#444',
              fontSize: 12, cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            }}
          >{notifEnabled ? '🔔' : '🔕'}</div>
          <span style={{ fontSize: 10, color: '#333', flexShrink: 0 }}>{scannerOpen ? '▲' : '▼'}</span>
        </button>

        {/* ── Flyout panel (appears on hover / click) ── */}
        {scannerOpen && (
          <div
            className="scanner-flyout"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            }}
          >
          <div style={{
            background: '#111', border: '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}>
            {/* Column header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 84px 48px 80px 36px',
              padding: '6px 12px',
              borderBottom: '0.5px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}>
              {[['Name', 'left'], ['Price', 'right'], ['24h', 'right'], ['Status', 'right'], ['Scr', 'right']].map(([h, align]) => (
                <span key={h} style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: '#333', textAlign: align as 'left' | 'right' }}>{h}</span>
              ))}
            </div>

            {/* Coin rows */}
            {scannerRows.map(({ c, sq: rowSq, price, change }, idx) => {
              const isSelected  = c === selectedCoin;
              const isActive    = rowSq.dir !== 'NEUTRAL' && rowSq.score >= 30;
              const icon        = rowSq.dir === 'SHORT_SQ' ? '↑' : rowSq.dir === 'LONG_LIQ' ? '↓' : '';
              const statusLabel = rowSq.dir === 'SHORT_SQ' ? 'Squeeze' : rowSq.dir === 'LONG_LIQ' ? 'Flush' : 'Neutral';
              return (
                <button
                  key={c}
                  onClick={() => {
                    setSelectedCoin(c); setScannerOpen(false); window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'coins' }));
                  }}
                  style={{
                    width: '100%', display: 'grid',
                    gridTemplateColumns: '1fr 84px 48px 80px 36px',
                    alignItems: 'center', padding: '7px 12px',
                    background: isSelected ? 'rgba(184,174,255,0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: idx < scannerRows.length - 1 ? '0.5px solid rgba(255,255,255,0.04)' : 'none',
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {/* Coin icon + name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CoinIcon
                      coin={c}
                      size={22}
                      color={isActive ? rowSq.color : undefined}
                      bg={isActive ? rowSq.color + '1a' : undefined}
                    />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#b8aeff' : isActive ? 'var(--txt)' : '#666', lineHeight: 1.2 }}>
                        {c.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 9, color: '#333', lineHeight: 1 }}>USDT Perp</div>
                    </div>
                  </div>
                  {/* Price */}
                  <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? 'var(--txt)' : '#555', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                    {price ? '$' + fmtPrice(price) : '—'}
                  </span>
                  {/* 24h % */}
                  <span style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: change == null ? '#333' : change >= 0 ? '#34d399' : '#f87171' }}>
                    {change != null ? (change >= 0 ? '+' : '') + change.toFixed(1) + '%' : '—'}
                  </span>
                  {/* Status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    {isActive ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.04em', padding: '1px 6px',
                        borderRadius: 4, background: rowSq.color + '18',
                        border: `0.5px solid ${rowSq.color}44`,
                        color: rowSq.color,
                      }}>
                        {icon} {statusLabel}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#2e2e2e' }}>· Neutral</span>
                    )}
                  </div>
                  {/* Score */}
                  <span style={{ fontSize: 10, fontWeight: 700, color: isActive ? rowSq.color : '#2e2e2e', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                    {rowSq.score}
                  </span>
                </button>
              );
            })}

            {/* Footer */}
            <div style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.01)', borderTop: '0.5px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: 9, color: '#2a2a2a' }}>Funding rate + L/S ratio · ↑ Squeeze = shorts overcrowded · ↓ Flush = longs overcrowded</span>
            </div>
          </div>
          </div>
        )}
      </div>

      {/* ── CHART — KLineChart with auto Entry/SL/TP overlays ── */}
      <KLineProChart coin={selectedCoin} tf={readTf} result={result} />

      {/* ── BELOW CHART: left-aligned, max 860px on wide screens ── */}
      <div className="arena-below-chart">

      {/* Data collectors — run hooks for Grok context, render nothing */}
      <div style={{ display: 'none' }}>
        <MarketStructure coin={selectedCoin} onData={handleMsData} />
        <AbsorptionDetector coin={selectedCoin} onData={handleAbsData} />
      </div>

      {/* TF selector + buttons */}
      <div style={{ margin: '10px 0 4px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginRight: 2 }}>TF</span>
        {(['1m','5m','15m','30m','1h','4h','1d'] as const).map(t => (
          <button key={t} className={`gsc-tf-btn${readTf === t ? ' on' : ''}`} onClick={() => setReadTf(t)} style={{ padding: '3px 8px', fontSize: 11 }}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Quick button — requires sign-in */}
        <button
          className={`arena-fire-btn arena-quick-btn${!user ? ' arena-deep-locked' : ''}`}
          disabled={readLoading || !!(user && grokUsage && grokUsage.quick_used >= grokUsage.quick_limit)}
          onClick={() => {
            if (!user) { window.location.href = '/login'; return; }
            const entry = resultsCache[selectedCoin];
            const force = !!(entry && entry.mode === 'quick' && entry.result.tf === readTf && Date.now() - entry.result.analyzedAt > 30_000);
            readMarket('quick', force);
            window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }));
          }}
          style={{ width: 'auto', marginBottom: 0 }}
          title={!user ? 'Sign in to use Quick Analysis' : 'Uses local data only — no web search. ~$0.003'}
        >
          {readLoading && readMode === 'quick' ? readStep || 'Working…' : (
            !user ? (
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, lineHeight: 1.2 }}>
                <span>🔒 Quick</span>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.04em', color: '#a37a2a' }}>sign in →</span>
              </span>
            ) : 'Quick'
          )}
        </button>

        {/* Deep button — requires sign-in */}
        <button
          className={`arena-fire-btn${!user ? ' arena-deep-locked' : ''}`}
          disabled={readLoading || !!(user && grokUsage && grokUsage.deep_used >= grokUsage.deep_limit)}
          onClick={() => {
            if (!user) { window.location.href = '/login'; return; }
            const entry = resultsCache[selectedCoin];
            const force = !!(entry && entry.mode === 'deep' && entry.result.tf === readTf && Date.now() - entry.result.analyzedAt > 30_000);
            readMarket('deep', force);
            window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }));
          }}
          style={{ width: 'auto', marginBottom: 0 }}
          title={!user ? 'Sign in to use Deep Analysis' : 'Searches live web + X for catalysts. ~$0.10'}
        >
          {readLoading && readMode === 'deep' ? readStep || 'Working…' : (
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, lineHeight: 1.2 }}>
              <span>{!user ? '🔒 ' : ''}Deep Research</span>
              {!user && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.04em', color: '#a37a2a' }}>sign in →</span>}
            </span>
          )}
        </button>

        <button
          className="arena-ask-grok-btn"
          style={{ width: 'auto', marginBottom: 0 }}
          onClick={() => window.dispatchEvent(new CustomEvent('grok-chat', {
            detail: {
              coin: selectedCoin,
              prompt: result
                ? `I just ran a full market read on ${selectedCoin.toUpperCase()}: ${result.signal} signal at ${result.confidence}% confidence. Entry zone: ${result.entryLow && result.entryHigh ? `$${fmtPrice(result.entryLow)} – $${fmtPrice(result.entryHigh)}` : '—'}. ${result.reasoning} What should I watch out for, and are there any scenarios that would invalidate this signal?`
                : `Give me a complete analysis of ${selectedCoin.toUpperCase()}/USDT right now. What's the trend, key levels, directional bias, best entry if any, and should I trade or wait?`,
            },
          }))}
        >
          Ask LiquidityAI
        </button>
      </div>

      {/* ── Usage panel — visible for signed-in users ── */}
      {user && grokUsage && <UsagePanel usage={grokUsage} />}

      {/* ── Auth / upgrade notice ── */}
      {!user && !authLoading && (
        <div className="usage-auth-notice">
          Sign in to run Quick and Deep analysis — required to control API costs.{' '}
          <a href="/login" className="usage-auth-link">Sign In →</a>
        </div>
      )}
      {user && !isPro && !authLoading && (
        <div className="usage-auth-notice" style={{ borderColor: 'rgba(155,127,212,0.2)', background: 'rgba(155,127,212,0.04)' }}>
          Free tier: 7 Quick + 3 Deep per day.{' '}
          <a href="/upgrade" className="usage-auth-link" style={{ color: '#b8aeff' }}>Upgrade to Pro for more →</a>
        </div>
      )}

      {readLoading && (
        <div className="arena-loading">
          <div className="arena-loading-dots">···</div>
          <div className="arena-loading-text">{readStep}</div>
        </div>
      )}

      {readError && <div className="arena-err">{readError}</div>}

      {result && Date.now() - result.analyzedAt < CACHE_MAX_AGE_MS && (() => {
        const sigCol = result.signal === 'LONG' ? '#34d399' : result.signal === 'SHORT' ? '#f87171' : '#9ca3af';
        const prevQuickSignal = quickSignals[selectedCoin];
        const showOverride = !!(
          cacheEntry?.mode === 'deep' &&
          prevQuickSignal &&
          prevQuickSignal !== result.signal
        );
        const secsDiff = Math.floor((Date.now() - result.analyzedAt) / 1000);
        const freshness = secsDiff < 60 ? 'just now' : secsDiff < 3600 ? `${Math.floor(secsDiff/60)}m ago` : `${Math.floor(secsDiff/3600)}h ago`;
        return (
          <div className={`arena-signal-card sig-${result.signal.toLowerCase()}`}>
            {/* Header row */}
            <div className="arena-sig-top">
              <div>
                <div className="arena-sig-pair">{selectedCoin.toUpperCase()}/USDT</div>
                <div className="arena-sig-time">
                  Analysed {freshness} · {result.tf}
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                    padding: '1px 6px', borderRadius: 4,
                    background: cacheEntry?.mode === 'quick' ? 'rgba(52,211,153,0.1)' : 'rgba(167,139,250,0.1)',
                    color: cacheEntry?.mode === 'quick' ? '#34d399' : '#b8aeff',
                    border: `0.5px solid ${cacheEntry?.mode === 'quick' ? 'rgba(52,211,153,0.25)' : 'rgba(167,139,250,0.25)'}`,
                  }}>
                    {cacheEntry?.mode === 'quick' ? '⚡ Quick' : '🔬 Deep'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                <span className={`arena-sig-badge badge-${result.signal.toLowerCase()}`}>
                  {result.signal === 'LONG' ? '▲ LONG' : result.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
                </span>
                {result.signal === 'FLAT' && result.bias && result.bias !== 'NEUTRAL' && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
                    color: result.bias === 'BEARISH' ? '#f87171' : '#34d399',
                    padding: '2px 8px', borderRadius: 6,
                    background: result.bias === 'BEARISH' ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)',
                    border: `0.5px solid ${result.bias === 'BEARISH' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'}`,
                  }}>
                    {result.bias === 'BEARISH' ? '↓ bearish lean' : '↑ bullish lean'}
                  </span>
                )}
              </div>
            </div>

            {/* Deep override notice */}
            {showOverride && (
              <div className="arena-override-notice">
                Deep overrides Quick — web search found a catalyst that shifted the signal from{' '}
                <strong>{prevQuickSignal}</strong> to <strong>{result.signal}</strong>. See Catalysts below.
              </div>
            )}

            {/* Confidence bar */}
            <div className="arena-sig-stats">
              <div className="arena-stat"><div className="arena-stat-label">Confidence</div><div className="arena-stat-val">{result.confidence}%</div></div>
              {result.entryLow && result.entryHigh && (
                <div className="arena-stat"><div className="arena-stat-label">Entry Zone</div><div className="arena-stat-val" style={{ fontSize: 12 }}>${fmtPrice(result.entryLow)} – ${fmtPrice(result.entryHigh)}</div></div>
              )}
              <div className="arena-stat"><div className="arena-stat-label">Session</div><div className="arena-stat-val" style={{ fontSize: 12 }}>{result.session}</div></div>
            </div>
            <div className="arena-conf-bar">
              <div className="arena-conf-fill" style={{ width: result.confidence + '%', background: sigCol }} />
            </div>

            {/* Wait For — shown when signal is FLAT */}
            {result.signal === 'FLAT' && result.waitFor && (
              <div className="arena-wait-for">
                <div className="arena-wait-for-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>👁 Watch For</span>
                  {result.bias && result.bias !== 'NEUTRAL' && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: result.bias === 'BEARISH' ? '#f87171' : '#34d399',
                    }}>
                      — {result.bias === 'BEARISH' ? '↓ leaning bearish' : '↑ leaning bullish'}
                    </span>
                  )}
                </div>
                <div className="arena-wait-for-body">{result.waitFor}</div>
              </div>
            )}

            {/* Entry / TP / SL chips — click to copy */}
            {(result.entryLow || result.tp || result.sl) && (
              <div className="gsc-levels-row" style={{ marginTop: 10 }}>
                {result.entryLow && result.entryHigh && (
                  <button className="gsc-chip gsc-chip-entry" title="Copy entry zone" onClick={() => {
                    const v = `${fmtPrice(result.entryLow!)}–${fmtPrice(result.entryHigh!)}`;
                    navigator.clipboard.writeText(v).catch(() => {});
                    setCopiedKey('entry'); setTimeout(() => setCopiedKey(null), 1500);
                  }}>
                    <span>Entry</span>
                    <span>{copiedKey === 'entry' ? '✓ Copied' : `$${fmtPrice(result.entryLow)} – $${fmtPrice(result.entryHigh)}`}</span>
                  </button>
                )}
                {result.tp && (
                  <button className="gsc-chip gsc-chip-tp" title="Copy TP" onClick={() => {
                    navigator.clipboard.writeText(fmtPrice(result.tp!)).catch(() => {});
                    setCopiedKey('tp'); setTimeout(() => setCopiedKey(null), 1500);
                  }}>
                    <span>TP</span>
                    <span>{copiedKey === 'tp' ? '✓ Copied' : `$${fmtPrice(result.tp)}`}</span>
                  </button>
                )}
                {result.sl && (
                  <button className="gsc-chip gsc-chip-sl" title="Copy SL" onClick={() => {
                    navigator.clipboard.writeText(fmtPrice(result.sl!)).catch(() => {});
                    setCopiedKey('sl'); setTimeout(() => setCopiedKey(null), 1500);
                  }}>
                    <span>SL</span>
                    <span>{copiedKey === 'sl' ? '✓ Copied' : `$${fmtPrice(result.sl)}`}</span>
                  </button>
                )}
              </div>
            )}

            {/* Key levels */}
            {result.levels.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {result.levels.map((lv, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                    background: lv.type === 'support' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                    color: lv.type === 'support' ? '#34d399' : '#f87171',
                    border: `0.5px solid ${lv.type === 'support' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
                  }}>
                    ${fmtPrice(lv.price)} {lv.label}
                  </span>
                ))}
              </div>
            )}

            {/* ── Liquidity Raid Setup ── */}
            {result.raidSetup && (
              <div className="arena-raid-block" style={{
                marginTop: 10,
                borderRadius: 10,
                border: `0.5px solid ${result.raidSetup === 'SHORT SQUEEZE' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                background: result.raidSetup === 'SHORT SQUEEZE' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px 6px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 15 }}>{result.raidSetup === 'SHORT SQUEEZE' ? '⚡' : '🔥'}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: '.05em',
                    color: result.raidSetup === 'SHORT SQUEEZE' ? '#34d399' : '#f87171',
                  }}>
                    LIQUIDITY RAID — {result.raidSetup}
                  </span>
                </div>
                <div style={{ padding: '7px 12px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {result.raidTarget && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 52, flexShrink: 0 }}>Target</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>{result.raidTarget}</span>
                    </div>
                  )}
                  {result.raidTrigger && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 52, flexShrink: 0 }}>Trigger</span>
                      <span style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.5 }}>{result.raidTrigger}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Catalysts — top 3 bullets only */}
            {result.catalysts && result.catalysts.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                  {result.catalysts.slice(0, 3).map((c, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7 }}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Details toggle — chart / patterns / full reasoning ── */}
            <button
              onClick={() => setSigDetailsOpen(v => !v)}
              style={{
                marginTop: 12, width: '100%', padding: '6px 0',
                background: 'transparent', border: 'none',
                borderTop: '0.5px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                color: '#3a3a3a', fontSize: 11,
              }}
            >
              <span>{sigDetailsOpen ? '▲ hide details' : '▼ full reasoning + chart + patterns'}</span>
            </button>

            {sigDetailsOpen && (
              <>
                {result.chartAnalysis && (
                  <div className="arena-reasoning" style={{ marginTop: 8, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                    <div className="arena-reasoning-title">Chart</div>
                    <div className="arena-reasoning-text"><ReasoningText text={result.chartAnalysis} /></div>
                  </div>
                )}
                {result.patterns && result.patterns.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                    <div className="arena-reasoning-title" style={{ marginBottom: 8 }}>Patterns</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {result.patterns.map((p, i) => {
                        const isBull = /bull|higher high|engulf.*bull|hammer|morning/i.test(p);
                        const isBear = /bear|lower high|engulf.*bear|shooting|evening|head.*shoulder|double top/i.test(p);
                        const col = isBull ? '#34d399' : isBear ? '#f87171' : '#a78bfa';
                        const bg  = isBull ? 'rgba(52,211,153,0.08)' : isBear ? 'rgba(248,113,113,0.08)' : 'rgba(167,139,250,0.08)';
                        const bdr = isBull ? 'rgba(52,211,153,0.25)' : isBear ? 'rgba(248,113,113,0.25)' : 'rgba(167,139,250,0.25)';
                        return (
                          <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: bg, color: col, border: `0.5px solid ${bdr}` }}>{p}</span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="arena-reasoning" style={{ marginTop: 8 }}>
                  <div className="arena-reasoning-title">Reasoning</div>
                  <div className="arena-reasoning-text"><ReasoningText text={result.reasoning} /></div>
                </div>
              </>
            )}
          </div>
        );
      })()}



      {/* ── SESSION HISTORY ── */}
      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#444' }}>Session History</div>
            <button
              onClick={() => { setHistory([]); setDetailIdx(null); try { sessionStorage.removeItem(ARENA_HIST_KEY); } catch {} }}
              style={{ fontSize: 10, color: '#444', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >Clear</button>
          </div>

          {history.map((h, i) => (
            <div key={i}>
              <div
                className={`arena-hist-item${detailIdx === i ? ' arena-hist-open' : ''}`}
                onClick={() => setDetailIdx(detailIdx === i ? null : i)}
                style={{ cursor: 'pointer' }}
              >
                <div className="arena-hist-left">
                  <span className={`arena-hist-badge tag ${h.signal === 'LONG' ? 'tg' : h.signal === 'SHORT' ? 'tr' : 'tp'}`}>
                    {h.signal === 'LONG' ? '▲ LONG' : h.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
                  </span>
                  <div>
                    <div className="arena-hist-pair">{h.coin}</div>
                    <div className="arena-hist-time">{h.time}{h.session ? ` · ${h.session}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="arena-hist-conf">{h.confidence}%</div>
                  <span style={{ fontSize: 11, color: '#444' }}>{detailIdx === i ? '▲' : '▼'}</span>
                </div>
              </div>

              {detailIdx === i && (
                <div className={`arena-hist-detail sig-${h.signal.toLowerCase()}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className={`arena-sig-badge badge-${h.signal.toLowerCase()}`} style={{ fontSize: 11 }}>
                      {h.signal === 'LONG' ? '▲ LONG' : h.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
                    </span>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b8aeff' }}>{h.confidence}% confidence</div>
                  </div>
                  {h.entry && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Entry Zone</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', fontFamily: 'monospace' }}>{h.entry}</span>
                    </div>
                  )}
                  <div className="arena-conf-bar" style={{ marginBottom: 10 }}>
                    <div className="arena-conf-fill" style={{
                      width: h.confidence + '%',
                      background: h.signal === 'LONG' ? '#7de0a4' : h.signal === 'SHORT' ? '#ff9a92' : '#606060',
                    }} />
                  </div>
                  {h.reasoning && (
                    <div className="arena-reasoning">
                      <div className="arena-reasoning-title">Reasoning</div>
                      <div className="arena-reasoning-text"><ReasoningText text={h.reasoning} /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      </div> {/* end arena-below-chart */}
    </div>
  );
}

function squeezeToLine(sq: { score: number; label: string; color: string }): string {
  return sq.score + '/100';
}
