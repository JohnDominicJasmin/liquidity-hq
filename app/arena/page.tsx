'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarket, classifyFunding, CoinId, computeSqueezeScore, computeFibLevels, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';
import { GrokContext, buildCombinedPrompt, buildQuickPrompt, CombinedResult, ChartData, calcEMA, calcRSI, callGrokViaProxy, GrokUsageInfo } from '@/lib/grok';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { track } from '@/lib/analytics';
import SetupScanner from '@/components/SetupScanner';
import ConfluenceScorer from '@/components/ConfluenceScorer';
import GrokSignalChart from '@/components/GrokSignalChart';

/* ── Basic chart pattern detector from OHLC candles ── */
function detectPatterns(candles: Array<{ o: number; h: number; l: number; c: number }>): string {
  if (candles.length < 10) return '';
  const found: string[] = [];

  // Trend structure (last 10 candles — sequential highs/lows)
  const r = candles.slice(-10);
  const highs = r.map(c => c.h);
  const lows  = r.map(c => c.l);
  const allHH = highs.every((h, i) => i === 0 || h >= highs[i - 1]);
  const allHL = lows.every ((l, i) => i === 0 || l >= lows[i - 1]);
  const allLH = highs.every((h, i) => i === 0 || h <= highs[i - 1]);
  const allLL = lows.every ((l, i) => i === 0 || l <= lows[i - 1]);
  if (allHH && allHL) found.push('Higher highs + higher lows — uptrend structure');
  else if (allLH && allLL) found.push('Lower highs + lower lows — downtrend structure');

  // Engulfing (last 2 candles)
  if (candles.length >= 2) {
    const [p, c] = candles.slice(-2);
    const pr = Math.abs(p.c - p.o), cr = Math.abs(c.c - c.o);
    if (p.c > p.o && c.c < c.o && c.o >= p.c && c.c <= p.o && cr >= pr * 0.8)
      found.push('Bearish engulfing');
    if (p.c < p.o && c.c > c.o && c.o <= p.c && c.c >= p.o && cr >= pr * 0.8)
      found.push('Bullish engulfing');
  }

  // Doji (last candle body < 10% of range)
  const last = candles[candles.length - 1];
  const bodySize = Math.abs(last.c - last.o);
  const wickSize = last.h - last.l;
  if (wickSize > 0 && bodySize / wickSize < 0.1) found.push('Doji — indecision candle');

  // Tight consolidation (last 6 candles range < 1.5% of price)
  const last6 = candles.slice(-6);
  const rangeHi  = Math.max(...last6.map(c => c.h));
  const rangeLo  = Math.min(...last6.map(c => c.l));
  if (last6[last6.length - 1].c > 0 && (rangeHi - rangeLo) / last6[last6.length - 1].c < 0.015)
    found.push('Tight consolidation — compression / potential breakout');

  // Strong prior move (flag pole candidate — last 5 candles moved >3%)
  if (candles.length >= 10) {
    const pole = candles.slice(-10, -5);
    const poleMove = (pole[pole.length - 1].c - pole[0].o) / pole[0].o * 100;
    if (Math.abs(poleMove) > 3 && found.includes('Tight consolidation — compression / potential breakout')) {
      found.splice(found.indexOf('Tight consolidation — compression / potential breakout'), 1);
      found.push(poleMove > 0 ? 'Bull flag (sharp pump + consolidation)' : 'Bear flag (sharp dump + consolidation)');
    }
  }

  return found.join('; ');
}

/* ── Smart price formatter — preserves decimals for sub-$100 coins ── */
function fmtPrice(n: number): string {
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
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

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui'];

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
  const { latestHeadlines, econEvents } = useNews();
  const { user } = useAuth();
  const [selectedCoin, setSelectedCoin] = useState<CoinId>('btc');
  const [readTf, setReadTf]         = useState<'15m'|'1h'|'4h'|'1d'>('15m');
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

  // Derived — current coin's cached result (persists across coin switches)
  const cacheEntry = resultsCache[selectedCoin] ?? null;
  const result     = cacheEntry?.result ?? null;
  const notifCooldown = useRef<Set<string>>(new Set());

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
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));

    if (coin?.fundingRate != null) {
      const fr = coin.fundingRate * 100;
      if (Math.abs(fr) >= 0.05) {
        const key = `fund-${selectedCoin}-${bucket}`;
        if (!notifCooldown.current.has(key)) {
          notifCooldown.current.add(key);
          fireNotif(
            `⚡ ${selectedCoin.toUpperCase()} Extreme Funding`,
            `${fr >= 0 ? '+' : ''}${fr.toFixed(4)}% — ${fr > 0 ? 'Longs at risk ↓' : 'Shorts being squeezed ↑'}`
          );
        }
      }
    }
    if (store.fng != null && (store.fng <= 15 || store.fng >= 85)) {
      const key = `fng-${store.fng < 20 ? 'fear' : 'greed'}-${Math.floor(Date.now() / (4 * 60 * 60 * 1000))}`;
      if (!notifCooldown.current.has(key)) {
        notifCooldown.current.add(key);
        fireNotif(
          store.fng <= 15 ? '🩸 Extreme Fear' : '🔴 Extreme Greed',
          `Fear & Greed: ${store.fng} (${store.fngLabel}) — ${store.fng <= 15 ? 'Potential bottom signal' : 'Markets overextended'}`
        );
      }
    }
  }, [store, selectedCoin, notifEnabled, fireNotif]);

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
      : 'Grok will search';

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
      : 'Grok will search';

    /* Liquidation levels */
    const liqLevels = store.btcLiqLevels && store.btcLiqLevels.length > 0
      ? store.btcLiqLevels.slice(0, 4).map(l => '$' + l.price.toLocaleString() + ' ' + l.side).join(' | ')
      : 'Grok will search';

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

    /* Upcoming events */
    const upcoming = econEvents
      .filter(e => e.h < 24).slice(0, 5)
      .map(e => `${e.name} (${e.dateStr}, impact: ${e.impact})`)
      .join('\n') || 'None in next 24h';

    /* ETF flows */
    const fmtFlow = (v: number | null, asset: string) => {
      if (v == null) return null;
      const sign = v >= 0 ? '+' : '';
      const tag = v > 200 ? ' (strong inflow)' : v > 0 ? ' (inflow)' : v < -200 ? ' (heavy outflow)' : ' (outflow)';
      return `${asset} ${sign}$${Math.abs(v).toFixed(0)}M${tag}`;
    };
    const etfFlows = [fmtFlow(store.etfNetFlow, 'BTC ETF'), fmtFlow(store.ethEtfNetFlow, 'ETH ETF')]
      .filter(Boolean).join(' | ') || 'Grok will search live';

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
      news: latestHeadlines.length > 0 ? latestHeadlines.slice(0, 6).join('\n') : 'No recent alerts',
      rsi14, ma20, priceVsMA, volRatio, longShortRatio,
      oilPrice, bonds10y, upcomingEvents: upcoming, etfFlows,
      rsi1h, rsi4h, rsiDaily: fmt(coin?.rsiDaily), cvd, basis, fibNearest, orderWalls, squeezeScore,
      pcRatio, maxPain, btcGex,
      exchangeNetFlow, stablecoinFlow, googleTrends, liqLevels, btcDomTrend,
      pocLine, dxyLine, spxLine, goldLine,
      cbPremium, vwap, oiTrend, takerRatio, crossExchangeFunding,
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
      if (entry && (mode === 'quick' || entry.mode === 'deep')) {
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
        // Bybit klines: interval uses numbers (15, 60, 240); response is newest-first
        const bybitInterval = readTf === '15m' ? '15' : readTf === '1h' ? '60' : readTf === '4h' ? '240' : 'D';
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
      const recent20 = vis.slice(-10).map(c => `O:${c.o.toFixed(pDec)} H:${c.h.toFixed(pDec)} L:${c.l.toFixed(pDec)} C:${c.c.toFixed(pDec)}`).join(' | ');
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

      // Cache result per coin (with price snapshot for stale-check)
      const priceNow = store.coins[selectedCoin]?.price ?? 0;
      setResultsCache(prev => ({ ...prev, [selectedCoin]: { result: res, priceAtAnalysis: priceNow, mode } }));
      setDetailIdx(null);
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

  return (
    <div>

      {/* ── PAGE HEADER ── */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', letterSpacing: '-0.3px' }}>AI Arena</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em' }}>GROK-4.3 + LIVE X</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Chart · 35-signal engine · confluence · scanner — one page</div>
      </div>

      {/* ── COIN SELECTOR ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="arena-coin-row" style={{ margin: 0, flex: 1 }}>
          {COINS.map(c => (
            <button key={c} className={`arena-coin-btn${selectedCoin === c ? ' sel' : ''}`} onClick={() => setSelectedCoin(c)}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={enableNotifications}
          title={notifEnabled ? 'Alerts enabled — watching funding + F&G' : 'Enable price alerts'}
          style={{
            padding: '6px 10px', borderRadius: 20, border: '0.5px solid',
            background: notifEnabled ? '#152b1e' : '#161616',
            borderColor: notifEnabled ? '#266038' : 'rgba(255,255,255,0.14)',
            color: notifEnabled ? '#7de0a4' : '#606060',
            fontSize: 16, cursor: 'pointer', flexShrink: 0,
          }}
        >{notifEnabled ? '🔔' : '🔕'}</button>
      </div>

      {/* ── CHART — visual anchor ── */}
      <GrokSignalChart coin={selectedCoin} />

      {/* ── SIGNAL ENGINE ── */}
      {/* Squeeze score */}
      <div className="arena-squeeze-card" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: '#444' }}>Squeeze Score — {selectedCoin.toUpperCase()}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: sq.color }}>{sq.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, width: sq.score + '%', background: sq.color, transition: 'width 0.6s ease' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: sq.color, minWidth: 42, textAlign: 'right' }}>{sq.score}/100</span>
        </div>
      </div>

      {/* CVD Divergence banner */}
      {(() => {
        const div = store.coins[selectedCoin]?.cvdDivergence;
        if (!div) return null;
        const isBull = div === 'bullish';
        return (
          <div className={`arena-cvd-div arena-cvd-div-${div}`}>
            <span className="arena-cvd-div-icon">{isBull ? '📈' : '📉'}</span>
            <div>
              <div className="arena-cvd-div-title">{isBull ? 'Bullish CVD Divergence' : 'Bearish CVD Divergence'}</div>
              <div className="arena-cvd-div-desc">
                {isBull
                  ? 'Price falling but net buying pressure rising — smart money accumulating. Potential reversal up.'
                  : 'Price rising but net selling pressure increasing — distribution trap. Watch for reversal down.'}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TF selector + buttons */}
      <div style={{ margin: '10px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>TF</span>
        {(['15m','1h','4h','1d'] as const).map(t => (
          <button key={t} className={`gsc-tf-btn${readTf === t ? ' on' : ''}`} onClick={() => setReadTf(t)} style={{ padding: '3px 8px', fontSize: 11 }}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="arena-fire-btn arena-quick-btn" disabled={readLoading} onClick={() => readMarket('quick')} style={{ width: 'auto', marginBottom: 0 }} title="Uses local data only — no web search. ~$0.003">
          {readLoading && readMode === 'quick' ? readStep || 'Working…' : 'Quick'}
        </button>
        <button
          className={`arena-fire-btn${!user ? ' arena-deep-locked' : ''}`}
          disabled={readLoading}
          onClick={() => { if (!user) { window.location.href = '/login'; return; } readMarket('deep'); }}
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
        {/* Usage chip — signed-in users only */}
        {user && grokUsage && (
          <div className="grok-usage-chip" title={`Quick analyses today: ${grokUsage.quick_used}`}>
            {grokUsage.deep_used}/{grokUsage.deep_limit} deep
          </div>
        )}

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
          Ask Grok
        </button>
      </div>

      {readLoading && (
        <div className="arena-loading">
          <div className="arena-loading-dots">···</div>
          <div className="arena-loading-text">{readStep}</div>
        </div>
      )}

      {readError && <div className="arena-err">{readError}</div>}

      {result && Date.now() - result.analyzedAt < CACHE_MAX_AGE_MS && (() => {
        const sigCol = result.signal === 'LONG' ? '#34d399' : result.signal === 'SHORT' ? '#f87171' : '#9ca3af';
        const secsDiff = Math.floor((Date.now() - result.analyzedAt) / 1000);
        const freshness = secsDiff < 60 ? 'just now' : secsDiff < 3600 ? `${Math.floor(secsDiff/60)}m ago` : `${Math.floor(secsDiff/3600)}h ago`;
        return (
          <div className={`arena-signal-card sig-${result.signal.toLowerCase()}`}>
            {/* Header row */}
            <div className="arena-sig-top">
              <div>
                <div className="arena-sig-pair">{selectedCoin.toUpperCase()}/USDT</div>
                <div className="arena-sig-time">Analysed {freshness} · {result.tf}</div>
              </div>
              <span className={`arena-sig-badge badge-${result.signal.toLowerCase()}`}>
                {result.signal === 'LONG' ? '▲ LONG' : result.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
              </span>
            </div>

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

            {/* Entry / TP / SL chips */}
            {(result.entryLow || result.tp || result.sl) && (
              <div className="gsc-levels-row" style={{ marginTop: 10 }}>
                {result.entryLow && result.entryHigh && (
                  <div className="gsc-chip gsc-chip-entry"><span>Entry</span><span>${fmtPrice(result.entryLow)} – ${fmtPrice(result.entryHigh)}</span></div>
                )}
                {result.tp && <div className="gsc-chip gsc-chip-tp"><span>TP</span><span>${fmtPrice(result.tp)}</span></div>}
                {result.sl && <div className="gsc-chip gsc-chip-sl"><span>SL</span><span>${fmtPrice(result.sl)}</span></div>}
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

            {/* Catalysts — events/news driving the trade */}
            {result.catalysts && result.catalysts.length > 0 && (
              <div className="arena-reasoning" style={{ marginTop: 10, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                <div className="arena-reasoning-title">Catalysts</div>
                <ul style={{ margin: '6px 0 0', padding: '0 0 0 14px', listStyle: 'disc' }}>
                  {result.catalysts.map((c, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7 }}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chart analysis */}
            {result.chartAnalysis && (
              <div className="arena-reasoning" style={{ marginTop: 8, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                <div className="arena-reasoning-title">Chart</div>
                <div className="arena-reasoning-text"><ReasoningText text={result.chartAnalysis} /></div>
              </div>
            )}

            {/* Pattern chips */}
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
                      <span key={i} style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                        background: bg, color: col, border: `0.5px solid ${bdr}`,
                        letterSpacing: '-0.1px',
                      }}>{p}</span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Full reasoning */}
            <div className="arena-reasoning" style={{ marginTop: 8 }}>
              <div className="arena-reasoning-title">Reasoning</div>
              <div className="arena-reasoning-text"><ReasoningText text={result.reasoning} /></div>
            </div>
          </div>
        );
      })()}

      {/* ── DATA CONTEXT (collapsible) ── */}
      <div className="arena-context" style={{ marginTop: 8 }}>
        <div
          className="arena-context-title"
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ctxOpen ? 8 : 0 }}
          onClick={() => setCtxOpen(v => !v)}
        >
          <span>
            Analysing {selectedCoin.toUpperCase()} across {[ctx.rsi14, ctx.rsi1h, ctx.rsi4h, ctx.cvd, ctx.basis, ctx.orderWalls, ctx.pcRatio, ctx.exchangeNetFlow, ctx.cbPremium, ctx.vwap, ctx.oiTrend, ctx.takerRatio, ctx.btcGex].filter(v => v !== '—' && v !== 'Calculating…').length + 21} market signals
          </span>
          <span style={{ fontSize: 9, color: '#444' }}>{ctxOpen ? '▲ hide' : '▼ show context'}</span>
        </div>
        {ctxOpen && [
          ['Coin', ctx.coin], ['Price', ctx.price], ['24h Δ', ctx.change24h],
          ['RSI 15m', ctx.rsi14], ['RSI 1h', ctx.rsi1h], ['RSI 4h', ctx.rsi4h], ['RSI 1D', ctx.rsiDaily],
          ['MA20 (15m)', ctx.ma20], ['vs MA20', ctx.priceVsMA],
          ['Vol Ratio', ctx.volRatio], ['CVD', ctx.cvd],
          ['L/S Ratio', ctx.longShortRatio], ['Squeeze', squeezeToLine(sq)],
          ['Funding', ctx.fundingRate], ['Open Interest', ctx.openInterest],
          ['Basis', ctx.basis], ['Fib Level', ctx.fibNearest],
          ['Vol Profile POC', ctx.pocLine],
          ['Order Walls', ctx.orderWalls.length > 55 ? ctx.orderWalls.slice(0, 55) + '…' : ctx.orderWalls],
          ['P/C Ratio', ctx.pcRatio], ['Max Pain', ctx.maxPain],
          ['BTC GEX', ctx.btcGex.length > 55 ? ctx.btcGex.slice(0, 55) + '…' : ctx.btcGex],
          ['Oil (CL=F)', ctx.oilPrice], ['10Y Yield', ctx.bonds10y],
          ['Taker B/S', ctx.takerRatio.length > 55 ? ctx.takerRatio.slice(0, 55) + '…' : ctx.takerRatio],
          ['CB Premium', ctx.cbPremium], ['VWAP (15m)', ctx.vwap],
          ['OI Trend', ctx.oiTrend.length > 55 ? ctx.oiTrend.slice(0, 55) + '…' : ctx.oiTrend],
          ['X-Exch FR', ctx.crossExchangeFunding.length > 55 ? ctx.crossExchangeFunding.slice(0, 55) + '…' : ctx.crossExchangeFunding],
          ['DXY', ctx.dxyLine], ['SPX', ctx.spxLine], ['Gold', ctx.goldLine],
          ['ETF Flows', ctx.etfFlows], ['Exch. Flow', ctx.exchangeNetFlow],
          ['Stablecoin', ctx.stablecoinFlow], ['G. Trends', ctx.googleTrends],
          ['Liq Levels', ctx.liqLevels], ['Fear & Greed', ctx.fearGreed],
          ['BTC Dom', ctx.btcDomTrend], ['X / Social', 'Grok searches X live'],
          ['Session', ctx.session],
          ['Events', ctx.upcomingEvents.split('\n')[0] + (ctx.upcomingEvents.includes('\n') ? ' +more' : '')],
          ['News', ctx.news.split('\n')[0].slice(0, 55) + '…'],
        ].map(([k, v]) => (
          <div key={k} className="arena-context-row">
            <span className="arena-context-key">{k}</span>
            <span className="arena-context-val">{v}</span>
          </div>
        ))}
      </div>

      {/* ── CONFLUENCE SCORER ── */}
      <div className="dash-section" style={{ marginTop: 16 }}>Confluence Score</div>
      <ConfluenceScorer coin={selectedCoin} />

      {/* ── SETUP SCANNER ── */}
      <div className="dash-section">Setup Scanner</div>
      <SetupScanner coin={selectedCoin} />

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
                  <span style={{ fontSize: 9, color: '#444' }}>{detailIdx === i ? '▲' : '▼'}</span>
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
                      <span style={{ fontSize: 10, color: '#606060', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Entry Zone</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#e8e8e8', fontFamily: 'monospace' }}>{h.entry}</span>
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

    </div>
  );
}

function squeezeToLine(sq: { score: number; label: string; color: string }): string {
  return sq.score + '/100';
}
