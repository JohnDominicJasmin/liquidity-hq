'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MarketContext, MarketStore, defaultStore, CoinId, CoinData, GexLevel,
  BINANCE_SYMS, BYBIT_SYMS,
} from '@/lib/marketStore';
import { bybitPriceFactor } from '@/lib/coins';
import { computeRSI14 } from '@/lib/rsi';
import { detectPatterns } from '@/lib/patterns';
import { getAuthToken } from '@/lib/supabase';

const WHALE_USD_THRESHOLD = 500_000; // $500k single trade = whale

/* How often the REST fallback polls while the WebSocket is down, and how often
   it retries the socket. See ws.onclose for why 5s was dangerous: restPoll
   costs Binance request weight 80, so 5s was 960 weight/min per tab against a
   6000/min per-IP budget, indefinitely. 30s holds it at 160. */
const REST_FALLBACK_MS = 30_000;
const WS_RETRY_MS      = 60_000;

/* ── CVD Divergence Telegram alert ── */
function sendCVDAlert(
  coin: string,
  div: 'bullish' | 'bearish',
  price: number,
  cooldown: Record<string, number>,
) {
  const key = `${coin}-${div}`;
  const now = Date.now();
  if (now - (cooldown[key] ?? 0) < 30 * 60_000) return; // 30-min cooldown
  cooldown[key] = now;
  const emoji = div === 'bullish' ? '🟢' : '🔴';
  const dir   = div === 'bullish' ? 'Bullish' : 'Bearish';
  const hint  = div === 'bullish'
    ? 'Price ↓ but CVD ↑ - hidden accumulation 👀'
    : 'Price ↑ but CVD ↓ - distribution in progress ⚠️';
  const priceStr = price > 0
    ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
    : '';
  fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${emoji} <b>CVD Divergence - ${coin.toUpperCase()}</b>\n<b>${dir}</b>\n${hint}\n\n📊 ${coin.toUpperCase()} ${priceStr}\nliquidity-hq.com`,
    }),
  }).catch(() => {});
}

/* ── Liquidation Cascade ── */
const LIQ_CASCADE_THRESHOLDS: Record<string, number> = {
  BTC: 5_000_000, ETH: 2_000_000, SOL: 1_000_000, DEFAULT: 800_000,
};
const MARKET_CASCADE_THRESHOLD = 20_000_000;
const LIQ_DELTA_WINDOW_MS = 15 * 60_000; // rolling window for the net long/short liquidation delta
const LIQ_DELTA_MIN_TOTAL = 20_000; // ignore near-zero noise below this combined $ volume

function sendCascadeAlert(
  coin: string,
  side: 'LONG' | 'SHORT' | 'MIXED',
  totalUsd: number,
  cooldown: Record<string, number>,
) {
  const key = `casc-${coin}`;
  const now = Date.now();
  if (now - (cooldown[key] ?? 0) < 10 * 60_000) return; // 10-min cooldown
  cooldown[key] = now;
  const emoji = side === 'LONG' ? '🔴' : side === 'SHORT' ? '🟢' : '⚡';
  const who   = side === 'LONG' ? 'LONGS' : side === 'SHORT' ? 'SHORTS' : 'cascade';
  const hint  = side === 'LONG'  ? 'Bears flushing longs - short squeeze possible ⚠️'
              : side === 'SHORT' ? 'Bulls squeezing shorts - watch for reversal ⚠️'
              : 'Multi-directional flush - vol spike ahead ⚠️';
  const usdStr = totalUsd >= 1e6
    ? `$${(totalUsd / 1e6).toFixed(1)}M`
    : `$${(totalUsd / 1e3).toFixed(0)}K`;
  fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${emoji} <b>Liquidation Cascade - ${coin}</b>\n${usdStr} ${who} wiped in 60s\n\n${hint}\nliquidity-hq.com`,
    }),
  }).catch(() => {});
}

const _WS_STREAMS = Object.values(BINANCE_SYMS)
  .map(s => `${s.toLowerCase()}@ticker`)
  .join('/');

const WS_URLS = [
  `wss://stream.binance.com:9443/stream?streams=${_WS_STREAMS}`,
  `wss://stream.binance.com/stream?streams=${_WS_STREAMS}`,
];

const SYM_MAP: Record<string, CoinId> = Object.fromEntries(
  Object.entries(BINANCE_SYMS).map(([id, sym]) => [sym, id as CoinId])
);

/* computeRSI14 moved to lib/rsi so app/api/market/rsi computes the identical
   number - see that file for why two copies would drift silently. */

/* `enabled` exists so a route can mount the provider WITHOUT the polling (#200).
 *
 * Not "do not mount the provider" - that was the obvious version and it crashes.
 * `useMarket()` throws when there is no context, and two components inside the
 * app shell consume it on EVERY route: GrokChat and NavDrawer's status dot. So
 * removing the provider on a route kills the shell, not just the page.
 *
 * Measured by QA against deployed staging: /backtest and /live-tracking each make
 * 210 exchange requests per visit and render BYTE-IDENTICALLY with all of them
 * blocked - same element count, same text length, same graphics, no errors. The
 * data is fetched and thrown away. /scanner was the control and loses 21% of its
 * text when blocked, which is what makes the other two numbers mean something.
 *
 * Blocking the network and disabling the polling leave the store in the same
 * shape, so that experiment is direct evidence for this switch rather than
 * merely adjacent to it.
 *
 * Default is `true`: a route has to opt OUT deliberately, so adding a page never
 * silently loses its market data. */
export default function MarketProvider(
  { children, enabled = true }: { children: React.ReactNode; enabled?: boolean },
) {
  const [store, setStore] = useState<MarketStore>(defaultStore);
  /* Mirror of `store` for callbacks that must read the CURRENT value without
     depending on it. fetchSnapshot needs to know whether a coin already has a
     price before deciding to seed one; depending on `store` would rebuild the
     callback on every price tick and re-arm its interval. Written in the effect
     below rather than during render - a ref write during render is its own
     violation (react-hooks/refs). */
  const storeRef = useRef<MarketStore>(defaultStore);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const urlIdxRef = useRef(0);
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Retries the socket while the REST fallback is running, so falling back is
     temporary rather than permanent. See ws.onclose. */
  const wsRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* CVD divergence: 5-snapshot sliding window per coin */
  const cvdSnapsRef = useRef<Partial<Record<CoinId, Array<{ price: number; cvd: number }>>>>({});
  /* Whale dedup: track last seen aggTrade id per symbol */
  const lastAggIdRef = useRef<Partial<Record<CoinId, number>>>({});
  /* OI Trend: sliding window of last 4 OI + price readings per coin */
  const oiHistRef = useRef<Partial<Record<CoinId, Array<{ oi: number; price: number }>>>>({});
  /* CVD Divergence alerts: last known divergence + 30-min cooldown */
  const cvdDivStateRef    = useRef<Partial<Record<string, 'bullish' | 'bearish' | null>>>({});
  const cvdAlertCooldown  = useRef<Record<string, number>>({});
  /* Liquidation cascade: rolling event buffer + per-coin cooldown */
  const liqBufferRef    = useRef<Array<{ coin: string; side: 'LONG' | 'SHORT'; usd: number; ts: number }>>([]);
  const cascadeCooldown = useRef<Record<string, number>>({});

  useEffect(() => { storeRef.current = store; }, [store]);

  const updateCoin = useCallback((id: CoinId, patch: Partial<MarketStore['coins'][CoinId]>) => {
    setStore(s => ({
      ...s,
      coins: { ...s.coins, [id]: { ...s.coins[id], ...patch } as MarketStore['coins'][CoinId] },
    }));
  }, []);

  const selectCoin = useCallback((c: CoinId) => {
    setStore(s => ({ ...s, selectedCoin: c }));
  }, []);

  /* ── Binance REST fallback ── */
  const restPoll = useCallback(async () => {
    try {
      const syms = Object.values(BINANCE_SYMS).filter(s => s !== 'HYPEUSDT');
      const batch = encodeURIComponent(JSON.stringify(syms));
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${batch}`);
      const data = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach((d: Record<string, string>) => {
        const id = SYM_MAP[d.symbol];
        if (!id) return;
        updateCoin(id, {
          price: parseFloat(d.lastPrice),
          change: parseFloat(d.priceChangePercent),
          high: parseFloat(d.highPrice),
          low: parseFloat(d.lowPrice),
        });
      });
      setStore(s => ({ ...s, wsStatus: 'Live · backup feed' }));
    } catch { /* ignore */ }
  }, [updateCoin]);

  /* ── Binance WebSocket ── */
  // The reconnect below re-enters this function, so it cannot reference the
  // `startWS` binding directly - that is a const being read before its own
  // initialiser completes, which is what react-hooks/immutability flags.
  //
  // It was also a real staleness bug, not only a lint complaint. `startWS` is a
  // useCallback over [restPoll, updateCoin]; when either changes, a NEW startWS
  // exists, but a socket opened by the previous one still has the previous
  // closure wired into its onclose. A drop after that point would reconnect
  // using the stale restPoll/updateCoin - so the backup REST poll and the store
  // writes could be the ones from an earlier render. Going through a ref means
  // a retry always runs whatever the current startWS is.
  const startWSRef = useRef<() => void>(() => {});

  const startWS = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* */ } }
    const url = WS_URLS[urlIdxRef.current % WS_URLS.length];
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0; urlIdxRef.current = 0;
      if (restTimerRef.current) { clearInterval(restTimerRef.current); restTimerRef.current = null; }
      if (wsRetryRef.current)  { clearInterval(wsRetryRef.current);  wsRetryRef.current = null; }
      setStore(s => ({ ...s, wsStatus: 'Live' }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const d = msg.data;
        const id = SYM_MAP[d.s];
        if (!id) return;
        updateCoin(id, {
          price: parseFloat(d.c),
          change: parseFloat(d.P),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
        });
      } catch { /* */ }
    };

    ws.onclose = () => {
      retriesRef.current++;
      urlIdxRef.current++;
      if (retriesRef.current <= 5) {
        setTimeout(() => startWSRef.current(), 2000 * retriesRef.current);
        return;
      }

      /* ── REST fallback ──
         This used to poll every 5 seconds, forever, and never retry the
         socket. restPoll asks Binance for ticker/24hr across 45 symbols, which
         costs request weight 80 (weight scales with symbol count: 21-100
         symbols is the 80 band). At one call per 5s that is 960 weight per
         minute against a 6000/minute per-IP budget - from a single tab, with
         nothing else running, indefinitely. Two tabs, or one tab plus a normal
         page load's other requests, and the visitor's own IP earns a Binance
         ban within minutes. A ban returns 418 to every request from that IP,
         including the chart's, so the whole app looks broken and the cause is
         invisible.
         30s holds the same fallback at 160 weight/minute. Prices come from the
         socket whenever it is up; this path exists only while it is down, and
         a slightly staler backup beats a banned IP. */
      setStore(s => ({ ...s, wsStatus: 'Live · backup feed' }));
      if (restTimerRef.current) clearInterval(restTimerRef.current);
      restPoll();
      restTimerRef.current = setInterval(restPoll, REST_FALLBACK_MS);

      /* Falling back was permanent: after five failed reconnects nothing ever
         opened a socket again, so a visitor who hit one bad minute stayed on
         the REST feed for the life of the tab. Keep trying in the background;
         ws.onopen tears both timers down when one succeeds. */
      if (!wsRetryRef.current) {
        wsRetryRef.current = setInterval(() => {
          retriesRef.current = 0;
          urlIdxRef.current  = 0;
          startWSRef.current();
        }, WS_RETRY_MS);
      }
    };
  }, [restPoll, updateCoin]);

  // Kept current in an effect rather than assigned during render - a ref write
  // during render is its own violation (react-hooks/refs) and would just trade
  // one warning for another. Declared here, above the effect that first calls
  // startWS(), so React runs this assignment first and the ref is never the
  // initial no-op by the time a reconnect can fire.
  useEffect(() => { startWSRef.current = startWS; }, [startWS]);

  /* ── Bybit: all coins - single bulk fetch instead of per-symbol calls ── */
  const fetchBybit = useCallback(async () => {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
      const d = await res.json();
      // Build symbol → ticker map for O(1) lookup
      const bySymbol: Record<string, Record<string, string>> = {};
      for (const t of (d.result?.list ?? [])) bySymbol[t.symbol] = t;

      for (const coin of Object.keys(BYBIT_SYMS)) {
        const item = bySymbol[BYBIT_SYMS[coin]];
        if (!item) continue;

        // Shared helper rather than an inline startsWith - this same conversion
        // was open-coded here and in the alert cron, and forgotten in the
        // outcome resolver. See bybitPriceFactor in lib/coins.
        const curPrice = parseFloat(item.lastPrice || '0') * bybitPriceFactor(coin);
        // openInterestValue = USD-denominated OI; fall back to base-qty × price if missing
        const rawOIValue = parseFloat(item.openInterestValue || '0');
        const curOI = rawOIValue || (parseFloat(item.openInterest || '0') * curPrice);

        /* ── OI Trend vs Price divergence ── */
        const hist    = oiHistRef.current[coin as CoinId] ?? [];
        const newHist = [...hist, { oi: curOI, price: curPrice }].slice(-4);
        oiHistRef.current[coin as CoinId] = newHist;

        let oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' | null = null;
        if (newHist.length >= 2) {
          const first = newHist[0], last = newHist[newHist.length - 1];
          if (first.oi > 0 && first.price > 0) {
            const oiChg    = (last.oi    - first.oi)    / first.oi;
            const priceChg = (last.price - first.price) / first.price;
            if (Math.abs(oiChg) > 0.003 || Math.abs(priceChg) > 0.002) {
              const oiUp = oiChg > 0, priceUp = priceChg > 0;
              if      (oiUp && priceUp)    oiTrend = 'strong_up';
              else if (oiUp && !priceUp)   oiTrend = 'strong_down';
              else if (!oiUp && priceUp)   oiTrend = 'weak_up';
              else                         oiTrend = 'weak_down';
            }
          }
        }

        /* ── Next FR estimate from mark–index spread ── */
        const markBybit  = parseFloat(item.markPrice   || '0');
        const indexBybit = parseFloat(item.indexPrice  || '0');
        const nextFtMs   = parseInt(item.nextFundingTime || '0');
        let nextFrBybit: number | null = null;
        if (markBybit > 0 && indexBybit > 0) {
          const P  = (markBybit - indexBybit) / indexBybit;
          const ir = 0.0001 / 3; // Bybit ~0.01%/day → ~0.000033 per 8h
          nextFrBybit = P + Math.max(-0.0005, Math.min(0.0005, ir - P));
        }

        const patch: Partial<MarketStore['coins'][CoinId]> = {
          fundingRate: parseFloat(item.fundingRate || '0'),
          oi: curOI,
          perpPrice: curPrice,
          oiTrend,
          ...(nextFrBybit !== null ? { nextFrEstimate: nextFrBybit } : {}),
          ...(nextFtMs > 0        ? { nextFundingTime: nextFtMs }    : {}),
        };
        // Always set price/change/high/low/vol for Bybit-only coins.
        // For dual-listed coins, Binance WebSocket will overwrite with fresher data.
        if (!(coin in BINANCE_SYMS)) {
          patch.price  = curPrice;
          patch.change = parseFloat(item.price24hPcnt || '0') * 100;
          patch.high   = parseFloat(item.highPrice24h || '0');
          patch.low    = parseFloat(item.lowPrice24h  || '0');
          patch.vol24  = parseFloat(item.turnover24h  || '0');
        }
        updateCoin(coin as CoinId, patch);
      }
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Bybit + Binance LSR ── */
  const fetchLSR = useCallback(async () => {
    await Promise.allSettled([
      /* Bybit account ratio (1h) - ONE request for all coins (#200).
         This was a loop of ~50 per-symbol fetches, 393 requests per visitor and
         the largest single line left after batch 1. Bybit has no batch
         parameter, so the fan-out moved server-side where one cache entry serves
         every visitor - see lib/bybitFanout.ts. */
      (async () => {
        try {
          const res = await fetch('/api/market/account-ratio?period=1h');
          if (!res.ok) return;
          const { data } = await res.json() as {
            data: Record<string, { longRatio: number; shortRatio: number }>;
          };
          for (const [coin, sym] of Object.entries(BYBIT_SYMS)) {
            const item = data?.[sym];
            if (!item) continue;          // absent means not fetched, not zero
            updateCoin(coin as CoinId, { longRatio: item.longRatio, shortRatio: item.shortRatio });
          }
        } catch { /* */ }
      })(),
      // The Binance half of this - two ratio requests per coin, 91 requests
      // in total - moved to app/api/market/snapshot. Bybit stays here: it is
      // one request per coin against a different provider with its own limit,
      // and it is the only source for the Bybit-only coins.
    ]);
  }, [updateCoin]);

  /* ── 24h ticker, 15m kline metrics and long/short ratios, in one call ──
     Replaces fetchKlines (one kline request per coin), fetchVolume (a
     45-symbol ticker/24hr batch plus a fetchKlines per coin) and the Binance
     half of fetchLSR (two ratio requests per coin).

     Measured on a real /dashboard load, those were 138 of the 193 Binance
     requests the browser made, and 341 of the 554 request-weight. Every one
     returned data identical for every visitor. Now one request.

     app/api/market/snapshot fans out once per cache window on the server and
     serves everyone from the result, so the upstream cost is fixed rather
     than per-visitor. See that route for why that mattered: Binance limits by
     IP, and a limited IP gets 418 on everything including the chart.

     Polled at fetchVolume's old 3-minute cadence. The ratios are cached
     server-side at their own 5-minute TTL, so this does not re-fetch them
     more often than before.

     Failure is silent and non-destructive: updateCoin runs only for coins the
     response actually carried, so a partial or missing response leaves the
     previous values on screen rather than blanking them. */
  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/market/snapshot');
      if (!res.ok) return;
      const body = await res.json() as {
        ticker?: Record<string, { price: number; change: number; high: number; low: number; vol24: number }>;
        klines?: Record<string, Record<string, unknown>>;
        lsr?: Record<string, Record<string, number>>;
      };
      /* vol24 always; price only as a FIRST paint.

         The socket owns price, change, high and low - they arrive live and are
         correct to the second. Applying the cached ticker on every poll would
         overwrite a live price with one up to three minutes old, which on
         screen is a visible tick backwards.

         But before the socket connects there is no price at all, which is what
         restPoll() was doing on mount: one ticker/24hr call for 45 symbols,
         request weight 80, purely to fill the gap for a second or two. Seeding
         from data already in this response removes that call entirely. The
         null check is what keeps it a seed rather than a stomp - once a coin
         has any price, the socket owns it and this never touches it again.
         restPoll still exists for the socket-down fallback path. */
      for (const [coin, v] of Object.entries(body.ticker ?? {})) {
        if (!v) continue;
        const id = coin as CoinId;
        const patch: Partial<CoinData> = {};
        if (v.vol24 != null) patch.vol24 = v.vol24;
        if (storeRef.current.coins[id]?.price == null && v.price) {
          patch.price = v.price; patch.change = v.change; patch.high = v.high; patch.low = v.low;
        }
        if (Object.keys(patch).length) updateCoin(id, patch);
      }
      for (const [coin, m] of Object.entries(body.klines ?? {})) {
        if (m && Object.keys(m).length) updateCoin(coin as CoinId, m as Partial<CoinData>);
      }
      for (const [coin, r] of Object.entries(body.lsr ?? {})) {
        if (r && Object.keys(r).length) updateCoin(coin as CoinId, r as Partial<CoinData>);
      }
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Bybit klines for Bybit-only coins (HYPE, PEPE, BONK, XAU, SPX, …) ── */
  // Bybit kline format (newest-first): [startTime, open, high, low, close, volume, turnover]
  const fetchBybitKlines = useCallback(async () => {
    const bybitOnly = (Object.keys(BYBIT_SYMS) as CoinId[]).filter(c => !BINANCE_SYMS[c]);
    await Promise.allSettled(bybitOnly.map(async (coin) => {
      const sym = BYBIT_SYMS[coin];
      try {
        const res = await fetch(
          `/api/market/klines?source=bybit&symbol=${sym}&interval=15&limit=100`
        );
        const d = await res.json();
        // Bybit returns newest-first - reverse to oldest-first
        const klines: string[][] = [...(d?.result?.list ?? [])].reverse();
        if (klines.length < 15) return;

        // 1000x denomination coins need price scaling to match coin.price set by fetchBybit
        const pf = sym.startsWith('1000') ? 0.001 : 1;

        const closes = klines.map(k => parseFloat(k[4]) * pf);
        const highs  = klines.map(k => parseFloat(k[2]) * pf);
        const lows   = klines.map(k => parseFloat(k[3]) * pf);
        const vols   = klines.map(k => parseFloat(k[6])); // turnover = quote vol (USD)

        const rsi14     = computeRSI14(closes);
        const ma20Slice = closes.slice(-20);
        const ma20      = ma20Slice.reduce((a, b) => a + b, 0) / ma20Slice.length;

        // Volume ratio (current candle vs rolling avg)
        const current = vols[vols.length - 2];
        const avg     = vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1);
        const volRatio = avg > 0 ? current / avg : 1;

        // VWAP (base volume k[5])
        let sumTPV = 0, sumVol = 0;
        klines.forEach((k, i) => {
          const tp      = (highs[i] + lows[i] + closes[i]) / 3;
          const baseVol = parseFloat(k[5]);
          sumTPV += tp * baseVol;
          sumVol += baseVol;
        });
        const vwap = sumVol > 0 ? sumTPV / sumVol : null;

        // Volume Profile / POC / VAH / VAL
        const allPrices = [...highs, ...lows];
        const minP = Math.min(...allPrices);
        const maxP = Math.max(...allPrices);
        const range = maxP - minP;
        const BUCKETS = 60;
        const bSize = range / BUCKETS;
        const buckets = new Array<number>(BUCKETS).fill(0);
        klines.forEach((k, i) => {
          const h = highs[i], l = lows[i], v = vols[i];
          const lo = Math.max(0, Math.floor((l - minP) / bSize));
          const hi = Math.min(BUCKETS - 1, Math.floor((h - minP) / bSize));
          const span = Math.max(1, hi - lo + 1);
          for (let b = lo; b <= hi; b++) buckets[b] += v / span;
        });
        let maxVb = 0, pocBucket = 0;
        buckets.forEach((v, i) => { if (v > maxVb) { maxVb = v; pocBucket = i; } });
        const poc = minP + (pocBucket + 0.5) * bSize;
        const totalVol = buckets.reduce((a, b) => a + b, 0);
        let lo = pocBucket, hi = pocBucket, captured = buckets[pocBucket];
        while (captured < totalVol * 0.70 && (lo > 0 || hi < BUCKETS - 1)) {
          const addLo = lo > 0 ? buckets[lo - 1] : 0;
          const addHi = hi < BUCKETS - 1 ? buckets[hi + 1] : 0;
          if (addLo >= addHi && lo > 0) { lo--; captured += buckets[lo]; }
          else if (hi < BUCKETS - 1)    { hi++; captured += buckets[hi]; }
          else                           { lo--; captured += buckets[lo]; }
        }
        const val = minP + lo * bSize;
        const vah = minP + (hi + 1) * bSize;

        // Chart pattern detection (Bybit klines: [time, open, high, low, close, ...])
        const patternCandles = klines.slice(-25).map((k: string[]) => ({
          o: parseFloat(k[1]) * pf, h: parseFloat(k[2]) * pf,
          l: parseFloat(k[3]) * pf, c: parseFloat(k[4]) * pf,
        }));
        const patterns = detectPatterns(patternCandles);
        updateCoin(coin, { rsi14, ma20, volRatio, vwap, poc, vah, val, chartPattern: patterns.length > 0 ? patterns.join('; ') : null });

        // Taker buy ratio from recent trades (Bybit klines don't split maker/taker)
        try {
          const tradeRes = await fetch(
            `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}&limit=500`
          );
          const tradeData = await tradeRes.json();
          const trades: Array<{ side: string; size: string }> = tradeData?.result?.list ?? [];
          let buyVol = 0, totalVol = 0;
          trades.forEach(t => {
            const qty = parseFloat(t.size || '0');
            totalVol += qty;
            if (t.side === 'Buy') buyVol += qty;
          });
          if (totalVol > 0) updateCoin(coin, { takerBuyRatio: buyVol / totalVol });
        } catch { /* */ }

      } catch { /* */ }
    }));
  }, [updateCoin]);

  /* ── RSI for every coin and timeframe, in one server call ──
     Replaces five separate pollers - fetch5mRSI, fetchMultiTFRSI,
     fetchBybitMultiTFRSI, fetchDailyRSI and fetchWeeklyMonthlyRSI - each of
     which looped the whole coin list and fired one kline request per coin per
     timeframe. That was 276 requests from the visitor's own IP on every page
     load, all returning data identical for every visitor: a weekly RSI does
     not differ per user.

     app/api/market/rsi does that fan-out once per cache window on the server
     and serves everyone from the one result, so this is a single request. See
     that route for why the burst mattered - it is the suspected cause of the
     intermittent blank chart, since tripping Binance's per-IP limit makes
     unrelated kline calls start returning 429.

     Polled at the old 5m cadence. The slower timeframes are cached server-side
     at their own 15-minute TTL, so calling this every 3 minutes does not
     re-fetch weekly and monthly candles - it just serves them warm.

     Failure is silent and non-destructive by design: updateCoin runs only for
     coins the response actually carried, so a partial or missing response
     leaves the previous RSI values on screen instead of blanking the badges.
     That matches how the per-coin version behaved when one symbol was rate
     limited. */
  const fetchRSI = useCallback(async () => {
    try {
      const res = await fetch('/api/market/rsi');
      if (!res.ok) return;
      const body = await res.json() as {
        rsi?: Record<string, Partial<Record<
          'rsi5m' | 'rsi1h' | 'rsi4h' | 'rsiDaily' | 'rsiWeekly' | 'rsiMonthly', number
        >>>;
      };
      for (const [coin, fields] of Object.entries(body.rsi ?? {})) {
        if (fields && Object.keys(fields).length > 0) {
          updateCoin(coin as CoinId, fields);
        }
      }
    } catch { /* */ }
  }, [updateCoin]);

  /* ── CVD + Divergence + Whale detection (all Binance coins + HYPE via Bybit) ── */
  const fetchCVD = useCallback(async () => {
    // All Binance-listed coins
    const binanceCoins = (Object.keys(BINANCE_SYMS) as CoinId[]).filter(c => c !== 'hype');
    await Promise.allSettled([
      /* ── Binance aggTrades - ONE request for all coins (#200 batch 3) ──
         This was a sweep of ~45 per-symbol fetches, 360 requests per visitor.
         The map is fetched once here; each coin then reads its own entry, so the
         per-coin CVD and whale logic below is unchanged. */
      (async () => {
        let aggAll: Record<string, Array<{ m: boolean; q: string; p: string; a: number }>> = {};
        try {
          const r = await fetch('/api/market/agg-trades?limit=200');
          if (r.ok) aggAll = (await r.json()).data ?? {};
        } catch { /* every coin below then sees no trades and returns early */ }

        await Promise.allSettled(binanceCoins.map(async (coin) => {
        const sym = BINANCE_SYMS[coin];
        try {
          const trades = aggAll[sym];
          if (!Array.isArray(trades)) return;

          let buyVol = 0, sellVol = 0;
          const lastSeenId = lastAggIdRef.current[coin] ?? 0;
          let newLastId = lastSeenId;

          trades.forEach((t: { m: boolean; q: string; p: string; a: number }) => {
            const qty = parseFloat(t.q);
            const price = parseFloat(t.p);
            const usd = price * qty;

            // CVD
            if (t.m) sellVol += qty; else buyVol += qty;

            // Whale detection - only emit for truly new trades
            if (t.a > lastSeenId && usd >= WHALE_USD_THRESHOLD) {
              const side = t.m ? 'SELL' : 'BUY';
              window.dispatchEvent(new CustomEvent('whale-trade', {
                detail: { id: t.a, symbol: coin.toUpperCase(), side, usdValue: usd, price, qty, ts: Math.floor(Date.now() / 1000) },
              }));
            }
            if (t.a > newLastId) newLastId = t.a;
          });

          lastAggIdRef.current[coin] = newLastId;
          const cvdValue = buyVol - sellVol;

          // CVD divergence: compare first vs last of 5-snapshot window
          let _newDiv: 'bullish' | 'bearish' | null = null;
          let _capPrice = 0;
          setStore(prev => {
            const currentPrice = prev.coins[coin]?.price ?? 0;
            const snaps = [...(cvdSnapsRef.current[coin] ?? []), { price: currentPrice, cvd: cvdValue }].slice(-5);
            cvdSnapsRef.current[coin] = snaps;

            let cvdDivergence: 'bullish' | 'bearish' | null = null;
            if (snaps.length >= 4 && snaps[0].price > 0) {
              const first = snaps[0], last = snaps[snaps.length - 1];
              const pricePct = (last.price - first.price) / first.price;
              const cvdDelta = last.cvd - first.cvd;
              // Direction matters more than magnitude for alts - use price % as primary gate
              if (pricePct > 0.003 && cvdDelta < 0) cvdDivergence = 'bearish';
              if (pricePct < -0.003 && cvdDelta > 0) cvdDivergence = 'bullish';
            }
            _newDiv = cvdDivergence;
            _capPrice = currentPrice;

            return {
              ...prev,
              coins: {
                ...prev.coins,
                [coin]: { ...prev.coins[coin], cvd: cvdValue, cvdDivergence } as CoinData,
              },
            };
          });
          // Alert on new divergence (transition from null/other → bullish/bearish)
          if (_newDiv && _newDiv !== (cvdDivStateRef.current[coin] ?? null)) {
            sendCVDAlert(coin, _newDiv, _capPrice, cvdAlertCooldown.current);
          }
          cvdDivStateRef.current[coin] = _newDiv;
        } catch { /* */ }
        }));
      })(),
      // ── HYPE via Bybit recent-trade (Bybit-only coin) ──
      (async () => {
        try {
          const res = await fetch(
            'https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=HYPEUSDT&limit=200',
            { cache: 'no-store' }
          );
          const data = await res.json();
          // Bybit linear recent-trade fields: price, size, side (NOT p/v/S - those are spot fields)
          const trades: Array<{ side: string; size: string; price: string }> = data.result?.list ?? [];
          let buyVol = 0, sellVol = 0;
          trades.forEach(t => {
            const qty = parseFloat(t.size);
            const usd = parseFloat(t.price) * qty;
            if (!isFinite(qty) || !isFinite(usd)) return;
            if (t.side === 'Buy') buyVol += qty; else sellVol += qty;
            // Whale detection for HYPE
            if (usd >= WHALE_USD_THRESHOLD) {
              window.dispatchEvent(new CustomEvent('whale-trade', {
                detail: { id: Date.now(), symbol: 'HYPE', side: t.side === 'Buy' ? 'BUY' : 'SELL', usdValue: usd, price: parseFloat(t.price), qty, ts: Math.floor(Date.now() / 1000) },
              }));
            }
          });
          const cvdValue = buyVol - sellVol;
          let _hypeDiv: 'bullish' | 'bearish' | null = null;
          let _hypePrice = 0;
          setStore(prev => {
            const currentPrice = prev.coins.hype?.price ?? 0;
            const snaps = [...(cvdSnapsRef.current.hype ?? []), { price: currentPrice, cvd: cvdValue }].slice(-5);
            cvdSnapsRef.current.hype = snaps;
            let cvdDivergence: 'bullish' | 'bearish' | null = null;
            if (snaps.length >= 4 && snaps[0].price > 0) {
              const first = snaps[0], last = snaps[snaps.length - 1];
              const pricePct = (last.price - first.price) / first.price;
              const cvdDelta = last.cvd - first.cvd;
              if (pricePct > 0.003 && cvdDelta < 0) cvdDivergence = 'bearish';
              if (pricePct < -0.003 && cvdDelta > 0) cvdDivergence = 'bullish';
            }
            _hypeDiv = cvdDivergence;
            _hypePrice = currentPrice;
            return { ...prev, coins: { ...prev.coins, hype: { ...prev.coins.hype, cvd: cvdValue, cvdDivergence } as CoinData } };
          });
          if (_hypeDiv && _hypeDiv !== (cvdDivStateRef.current.hype ?? null)) {
            sendCVDAlert('hype', _hypeDiv, _hypePrice, cvdAlertCooldown.current);
          }
          cvdDivStateRef.current.hype = _hypeDiv;
        } catch { /* */ }
      })(),
    ]);
  }, []);  // no deps - uses refs + setStore callback

  /* ── Order Book walls (BTC + ETH only) ── */
  const fetchOrderBook = useCallback(async () => {
    await Promise.allSettled(
      (['btc', 'eth'] as CoinId[]).map(async (coin) => {
        const sym = BINANCE_SYMS[coin];
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/depth?symbol=${sym}&limit=50`
          );
          const data = await res.json();
          if (!data.bids || !data.asks) return;

          const parseSide = (arr: string[][]): { price: number; size: number }[] =>
            arr
              .map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }))
              .sort((a, b) => b.size - a.size)
              .slice(0, 3);

          updateCoin(coin, {
            orderBidWalls: parseSide(data.bids),
            orderAskWalls: parseSide(data.asks),
          });
        } catch { /* */ }
      })
    );
  }, [updateCoin]);

  /* ── Deribit options: Put/Call ratio + Max Pain + GEX ── */
  const fetchDeribitOptions = useCallback(async () => {
    try {
      const res = await fetch(
        'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'
      );
      const data = await res.json();
      const summaries: Array<{
        instrument_name: string;
        open_interest: number;
        mark_iv: number;           // implied volatility %
        underlying_price: number;  // BTC spot at time of snapshot
      }> = data?.result ?? [];
      if (!summaries.length) return;

      const now = Date.now();

      /* ── Black-Scholes helpers ── */
      const normalPDF = (x: number): number =>
        Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

      // Gamma = N'(d1) / (S × σ × √T)
      // Minimum T of 1 day avoids 0/0 → NaN for options expiring today/imminently
      const bsGamma = (S: number, K: number, T: number, sigma: number): number => {
        if (T < 1 / 365 || sigma <= 0 || S <= 0 || K <= 0) return 0;
        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
        const g = normalPDF(d1) / (S * sigma * sqrtT);
        return isFinite(g) ? g : 0;   // guard against any residual Inf/NaN
      };

      const MON: Record<string, number> = {
        JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      };

      // Deribit format: BTC-27JUN25-100000-C
      const expiryMs = (expStr: string): number => {
        const d = parseInt(expStr.slice(0, 2));
        const m = MON[expStr.slice(2, 5)];
        const y = 2000 + parseInt(expStr.slice(5, 7));
        return new Date(y, m, d, 8, 0, 0, 0).getTime(); // 08:00 UTC expiry
      };

      const callsOI: Record<number, number> = {};
      const putsOI:  Record<number, number> = {};
      let totalCallOI = 0, totalPutOI = 0;

      // GEX accumulators keyed by strike
      const gexByStrike: Record<number, number> = {};
      let spotForGex = 0;

      summaries.forEach(({ instrument_name, open_interest, mark_iv, underlying_price }) => {
        const parts = instrument_name.split('-');
        if (parts.length < 4) return;
        const strike = parseFloat(parts[2]);
        const type   = parts[3]; // 'C' or 'P'
        if (isNaN(strike)) return;
        const oi = open_interest || 0;

        /* ── P/C ratio OI tracking ── */
        if (type === 'C') { callsOI[strike] = (callsOI[strike] ?? 0) + oi; totalCallOI += oi; }
        if (type === 'P') { putsOI[strike]  = (putsOI[strike]  ?? 0) + oi; totalPutOI  += oi; }

        /* ── GEX calculation ── */
        if (oi <= 0) return;
        const iv = mark_iv;
        const S  = underlying_price;
        if (!iv || iv <= 0 || iv > 500 || !S || S <= 0) return;
        if (!spotForGex) spotForGex = S;

        const T     = Math.max(0, (expiryMs(parts[1]) - now) / (365.25 * 24 * 3600 * 1000));
        if (T <= 0) return; // expired
        const sigma = iv / 100;
        const gamma = bsGamma(S, strike, T, sigma);
        if (!gamma || !isFinite(gamma)) return; // skip NaN / Inf / 0 gamma

        // Calls add positive GEX (dealers long gamma above); puts subtract (dealers short gamma below)
        const sign = type === 'C' ? 1 : -1;
        const gexContrib = sign * gamma * oi * S * S;
        if (!isFinite(gexContrib)) return; // guard against overflow
        gexByStrike[strike] = (gexByStrike[strike] ?? 0) + gexContrib;
      });

      /* ── P/C Ratio ── */
      const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : null;

      /* ── Max Pain ── */
      const allStrikes = Array.from(
        new Set([...Object.keys(callsOI), ...Object.keys(putsOI)].map(Number))
      ).sort((a, b) => a - b);

      let minPain = Infinity, maxPain: number | null = null;
      allStrikes.forEach(testPrice => {
        let pain = 0;
        allStrikes.forEach(k => {
          pain += (callsOI[k] ?? 0) * Math.max(0, testPrice - k);
          pain += (putsOI[k] ?? 0) * Math.max(0, k - testPrice);
        });
        if (pain < minPain) { minPain = pain; maxPain = testPrice; }
      });

      /* ── GEX summary ── */
      const hasGexData = Object.keys(gexByStrike).length > 0;
      // Use ?? 0 inside reduce so a stray NaN entry doesn't sink everything;
      // store null only when we genuinely have no options data.
      const rawNetGex = hasGexData
        ? Object.values(gexByStrike).reduce((a, b) => a + (isFinite(b) ? b : 0), 0)
        : null;
      const btcNetGex: number | null = hasGexData
        ? (isFinite(rawNetGex as number) ? (rawNetGex as number) : 0)
        : null;

      // Zero-gamma flip level: cumulative GEX from lowest strike crosses zero
      const sortedByStrike = Object.keys(gexByStrike)
        .map(Number).sort((a, b) => a - b);
      let cumGex = 0, btcGexFlip: number | null = null;
      for (let i = 0; i < sortedByStrike.length; i++) {
        const prev = cumGex;
        const v = gexByStrike[sortedByStrike[i]];
        if (!isFinite(v)) continue;
        cumGex += v;
        if (i > 0 && prev !== 0 && Math.sign(prev) !== Math.sign(cumGex)) {
          const sA = sortedByStrike[i - 1], sB = sortedByStrike[i];
          btcGexFlip = Math.round(sA + (sB - sA) * Math.abs(prev) / (Math.abs(prev) + Math.abs(cumGex)));
          break;
        }
      }

      // The 8 strikes that MATTER - i.e. the biggest gamma walls (largest |GEX|),
      // not the 8 highest strikes. Bug fix: this used to sort by strike descending
      // and slice(8), which just grabbed the top of the ±35% band (e.g. $82-89K
      // when spot is $66K) and hid the real near-spot magnets. Sort by |GEX| to
      // pick the actual pins - they naturally cluster near the money - then order
      // by strike for a readable high→low ladder.
      const btcGexLevels: GexLevel[] = Object.entries(gexByStrike)
        .map(([k, v]) => ({ strike: Number(k), gex: v }))
        .filter(e => isFinite(e.gex) && (spotForGex > 0
          ? Math.abs(e.strike - spotForGex) / spotForGex <= 0.35
          : true))
        .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
        .slice(0, 8)
        .sort((a, b) => b.strike - a.strike);

      setStore(s => ({
        ...s,
        btcPcRatio: pcRatio,
        btcMaxPain: maxPain,
        btcNetGex,                         // proper null only when no data
        btcGexFlip: btcGexFlip ?? null,
        btcGexLevels,
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Stablecoin supply (DefiLlama) ── */
  const fetchStablecoinFlows = useCallback(async () => {
    try {
      const res = await fetch(
        'https://stablecoins.llama.fi/stablecoins?includePrices=true',
        { cache: 'no-cache' }
      );
      const data = await res.json();
      const coins: Array<{ symbol: string; circulating: { peggedUSD?: number } }> =
        data?.peggedAssets ?? [];

      let total = 0;
      coins.forEach(({ symbol, circulating }) => {
        if (symbol === 'USDT' || symbol === 'USDC') {
          total += circulating?.peggedUSD ?? 0;
        }
      });

      const supplyB = total / 1e9;
      if (supplyB === 0) return;

      setStore(s => ({
        ...s,
        stablecoinPrev: s.stablecoinSupply,
        stablecoinSupply: supplyB,
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Coinglass: exchange net flow + liquidation levels - DISABLED ────────
   * Coinglass retired the /public/v2/ API this called. Both endpoints now
   * return HTTP 500 in prod even with COINGLASS_API_KEY attached, and the v4
   * replacement answers `{"code":"401","msg":"Upgrade plan"}` on this
   * account's tier - verified 2026-07-30. There is no free API tier; plans
   * start at $29/mo and Coinglass does not publish which tier includes the
   * exchange-balance and liquidation endpoints.
   *
   * Both call sites already failed soft (a `catch {}` plus null guards), so
   * nothing was ever fed a wrong value - btcExchangeNetFlow simply stayed
   * null and the Arena liquidation card, which renders conditionally on
   * btcLiqLevels.length, silently stopped appearing. The only live cost was
   * two doomed requests per tab every 15 minutes, which is what this removes.
   *
   * Only the fetching is gone. store.btcExchangeNetFlow / store.btcLiqLevels,
   * the prompt lines that read them, and the Arena heatmap component are all
   * still wired and correct, so restoring this means pointing the proxy at
   * open-api-v4.coinglass.com and re-filling those two fields - nothing has to
   * be rebuilt. Restore steps are in pendings/PENDING.md.
   */

  /* Google Trends fetch removed 2026-07-31. Google blocks the unofficial
     endpoint (confirmed from Render and locally), and its only consumer was
     the Grok prompt's retail-sentiment line, which came out at the same time.
     It ran on mount and hourly in every session, so it was a recurring call
     to a known-blocked host for a value nothing read. /api/proxy?type=trends
     still exists and is still health-tracked - restore a caller here if a
     working source turns up. */

  /* ── OI Trend bootstrap - Bybit historical OI + klines ── */
  // Fires once on mount to populate OI trend without waiting for two 8-min Bybit polls
  const bootstrapOITrend = useCallback(async () => {
    /* Open interest for every symbol in ONE request (#200), fetched before the
       per-symbol work rather than inside it. This was ~50 fetches - 392 requests
       per visitor. Klines stay per-symbol because they genuinely differ per
       symbol, and they already go through the cached route from batch 1. */
    let oiAll: Record<string, Array<{ openInterest: string }>> = {};
    try {
      const r = await fetch('/api/market/open-interest?intervalTime=1h&limit=3');
      if (r.ok) oiAll = (await r.json()).data ?? {};
    } catch { /* leave empty; the length guard below already handles no data */ }

    await Promise.allSettled(
      Object.entries(BYBIT_SYMS).map(async ([coin, sym]) => {
        try {
          const klRes = await fetch(`/api/market/klines?source=bybit&symbol=${sym}&interval=60&limit=4`);
          const klData = await klRes.json();

          // Both are newest-first - reverse to oldest-first
          const oiList: Array<{ openInterest: string }> = [...(oiAll[sym] ?? [])].reverse();
          const klList: string[][] = [...(klData?.result?.list ?? [])].reverse();

          if (oiList.length < 2 || klList.length < 2) return;

          const readings = [
            { oi: parseFloat(oiList[0].openInterest), price: parseFloat(klList[0][4]) },
            { oi: parseFloat(oiList[oiList.length - 1].openInterest), price: parseFloat(klList[klList.length - 1][4]) },
          ].filter(r => r.oi > 0 && r.price > 0);

          if (readings.length < 2) return;

          // Pre-populate history so live polls have a baseline
          oiHistRef.current[coin as CoinId] = readings;

          const first = readings[0], last = readings[1];
          const oiChg    = (last.oi    - first.oi)    / first.oi;
          const priceChg = (last.price - first.price) / first.price;

          if (Math.abs(oiChg) > 0.002 || Math.abs(priceChg) > 0.001) {
            const oiUp = oiChg > 0, priceUp = priceChg > 0;
            const oiTrend: 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' =
                  oiUp && priceUp   ? 'strong_up'
                : oiUp && !priceUp  ? 'strong_down'
                : !oiUp && priceUp  ? 'weak_up'
                :                     'weak_down';
            updateCoin(coin as CoinId, { oiTrend });
          }
        } catch { /* fail silently */ }
      })
    );
  }, [updateCoin]);

  /* ── Coinbase Premium Index (Coinbase BTC − Bybit BTC) ── */
  const fetchCoinbasePremium = useCallback(async () => {
    try {
      const res = await fetch('/api/coinbase-price', { cache: 'no-store' });
      if (!res.ok) return;
      const { price: cbPrice } = await res.json() as { price: number };
      if (!cbPrice || isNaN(cbPrice)) return;
      setStore(s => {
        const bybitPrice = s.coins.btc?.price;
        if (!bybitPrice) return { ...s, cbPremium: null, cbPremiumPct: null };
        const premium    = cbPrice - bybitPrice;
        const premiumPct = (premium / bybitPrice) * 100;
        return { ...s, cbPremium: premium, cbPremiumPct: premiumPct };
      });
    } catch { /* fail silently */ }
  }, []);

  /* ── Binance premium index → next FR estimate (Binance perps) ── */
  const fetchPremiumIndex = useCallback(async () => {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' });
      if (!res.ok) return;
      const data: Array<{
        symbol: string; markPrice: string; indexPrice: string;
        interestRate: string; nextFundingTime: number;
      }> = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach(item => {
        const id = SYM_MAP[item.symbol];
        if (!id) return;
        const mark  = parseFloat(item.markPrice);
        const index = parseFloat(item.indexPrice);
        if (!mark || !index || index === 0) return;
        // Binance: FR = P + clamp(interestRate − P, −0.05%, +0.05%)
        const P  = (mark - index) / index;
        const ir = parseFloat(item.interestRate);
        const nextFrEstimate = P + Math.max(-0.0005, Math.min(0.0005, ir - P));
        updateCoin(id, { nextFrEstimate, nextFundingTime: item.nextFundingTime });
      });
    } catch { /* */ }
  }, [updateCoin]);

  /* ── Oil + DXY + SPX + Gold - fetched via /api/macro (server-side, no CORS) ── */
  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch('/api/macro', { cache: 'no-store' });
      if (!res.ok) return;
      const d: {
        oil:  { price: number; chg: number } | null;
        dxy:  { price: number; chg: number } | null;
        spx:  { price: number; chg: number } | null;
        gold: { price: number; chg: number } | null;
        jpy:  { price: number; chg: number } | null;
      } = await res.json();

      setStore(s => ({
        ...s,
        ...(d.oil  ? { oilPrice: d.oil.price }                           : {}),
        ...(d.dxy  ? { dxy:  d.dxy.price,  dxyChg:  d.dxy.chg  }       : {}),
        ...(d.spx  ? { spx:  d.spx.price,  spxChg:  d.spx.chg  }       : {}),
        ...(d.gold ? { gold: d.gold.price, goldChg: d.gold.chg  }       : {}),
        ...(d.jpy  ? { jpy:  d.jpy.price,  jpyChg:  d.jpy.chg  }       : {}),
      }));
    } catch { /* fail silently */ }
  }, []);

  /* ── Fear & Greed ── */
  const fetchFNG = useCallback(async () => {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=2&format=json', { cache: 'no-cache' });
      const d = await res.json();
      const items = d.data;
      if (!items?.[0]?.value) return;
      setStore(s => ({
        ...s,
        fng: parseInt(items[0].value),
        fngLabel: items[0].value_classification || '',
        fngPrev: items[1] ? parseInt(items[1].value) : null,
      }));
    } catch {
      try {
        const res = await fetch('https://api.alternative.me/fng/?limit=2&format=json', { cache: 'no-cache' });
        const d = await res.json();
        const items = d.data;
        if (!items?.[0]?.value) return;
        setStore(s => ({
          ...s,
          fng: parseInt(items[0].value),
          fngLabel: items[0].value_classification || '',
          fngPrev: items[1] ? parseInt(items[1].value) : null,
        }));
      } catch { /* */ }
    }
  }, []);

  /* ── BTC + ETH Spot ETF Net Flows (SoSoValue) ── */
  const fetchETF = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/proxy?type=etf', {
        cache: 'no-cache',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const { btc, eth } = await res.json();
      /* Plain numbers in MILLIONS since #175. The route used to hand back
         SoSoValue's raw payload and this read four possible nesting shapes out
         of it; the authenticated API returns one documented field, so the route
         now extracts and converts it and this just stores it.

         `!= null` rather than a truthiness check on purpose: a zero-flow day is
         real data and `if (btc)` would discard it. */
      if (btc != null && Number.isFinite(btc)) setStore(s => ({ ...s, etfNetFlow: btc as number }));
      if (eth != null && Number.isFinite(eth)) setStore(s => ({ ...s, ethEtfNetFlow: eth as number }));
    } catch { /* fail silently */ }
  }, []);

  /* ── BTC + ETH Dominance via CMC (accurate - excludes stablecoins from total) ── */
  const fetchCMCGlobal = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/cmc?type=global', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const d = await res.json();
      const dom    = d?.data?.btc_dominance   as number | undefined;
      const ethDom = d?.data?.eth_dominance   as number | undefined;
      if (dom) {
        setStore(s => ({
          ...s,
          btcDom:       parseFloat(dom.toFixed(2)),
          btcDomHistory:[...s.btcDomHistory.slice(-9), parseFloat(dom.toFixed(2))],
          ethDom:       ethDom != null ? parseFloat(ethDom.toFixed(2)) : s.ethDom,
        }));
      }
    } catch { /* */ }
  }, []);

  /* ── Alt Season Index (top-50 alts vs BTC, 90-day) ── */
  // Symbols to exclude from the top-50 eligible list
  const STABLECOINS = new Set([
    'USDT','USDC','DAI','BUSD','TUSD','FRAX','USDP','GUSD','PYUSD',
    'USDE','FDUSD','USDS','USDD','LUSD','SUSD','CRVUSD','USDX',
  ]);
  const WRAPPED = new Set(['WBTC','WETH','WEETH','WBETH','STETH','CBETH','RETH']);

  const fetchAltSeason = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/cmc?type=altseason', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const d = await res.json();
      const coins = (d?.data ?? []) as Array<{
        symbol: string;
        tags?: string[];
        quote?: { USD?: { percent_change_90d?: number } };
      }>;

      const btc   = coins.find(c => c.symbol === 'BTC');
      if (!btc) return;
      const btc90 = btc.quote?.USD?.percent_change_90d ?? 0;

      const eligible = coins
        .filter(c =>
          c.symbol !== 'BTC' &&
          !STABLECOINS.has(c.symbol) &&
          !WRAPPED.has(c.symbol) &&
          !c.tags?.includes('stablecoin') &&
          !c.tags?.includes('wrapped-tokens')
        )
        .slice(0, 50);

      if (!eligible.length) return;

      const beat  = eligible.filter(c => (c.quote?.USD?.percent_change_90d ?? -Infinity) > btc90).length;
      const score = Math.round((beat / eligible.length) * 100);

      setStore(s => ({ ...s, altSeasonScore: score }));
    } catch { /* */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Liquidation Cascade Detector - Binance futures all-symbols stream ── */
  useEffect(() => {
    if (!enabled) return;          // #200 - no socket on data-free routes
    const FUTURES_MAP: Record<string, string> = {
      BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL',
      XRPUSDT: 'XRP', BNBUSDT: 'BNB', NEARUSDT: 'NEAR', SUIUSDT: 'SUI',
    };
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    function connect() {
      if (!alive) return;
      ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const order = msg.data?.o ?? msg.o;
          if (!order?.s) return;
          const coin = FUTURES_MAP[order.s];
          if (!coin) return;
          // S:"SELL" = long position liquidated (forced sell); S:"BUY" = short liquidated
          const side: 'LONG' | 'SHORT' = order.S === 'SELL' ? 'LONG' : 'SHORT';
          const usd = parseFloat(order.ap || order.p || '0') * parseFloat(order.z || order.q || '0');
          if (!isFinite(usd) || usd <= 0) return;
          const now = Date.now();
          liqBufferRef.current.push({ coin, side, usd, ts: now });
          // Keep rolling buffer covering both the 60s cascade window and the
          // longer liquidation-delta window (LIQ_DELTA_WINDOW_MS) below.
          liqBufferRef.current = liqBufferRef.current.filter(l => l.ts > now - (LIQ_DELTA_WINDOW_MS + 60_000));
        } catch { /* */ }
      };
      ws.onclose = () => { if (alive) reconnectTimer = setTimeout(connect, 5_000); };
      ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
    }

    connect();

    // Cascade analyzer - check every 5s
    const analyzer = setInterval(() => {
      const now = Date.now();
      const w = liqBufferRef.current.filter(l => l.ts > now - 60_000);
      if (!w.length) return;

      const byCoin: Record<string, { l: number; s: number }> = {};
      let mktL = 0, mktS = 0;
      w.forEach(({ coin, side, usd }) => {
        if (!byCoin[coin]) byCoin[coin] = { l: 0, s: 0 };
        if (side === 'LONG') { byCoin[coin].l += usd; mktL += usd; }
        else                 { byCoin[coin].s += usd; mktS += usd; }
      });

      let fired = false;
      for (const [coin, { l: lUsd, s: sUsd }] of Object.entries(byCoin)) {
        const thr = LIQ_CASCADE_THRESHOLDS[coin] ?? LIQ_CASCADE_THRESHOLDS.DEFAULT;
        if (lUsd >= thr || sUsd >= thr) {
          const side: 'LONG' | 'SHORT' | 'MIXED' =
            (lUsd >= thr && sUsd >= thr) ? 'MIXED' : lUsd >= thr ? 'LONG' : 'SHORT';
          setStore(s => ({ ...s, cascadeAlert: { coin, side, totalUsd: lUsd + sUsd, ts: now } }));
          sendCascadeAlert(coin, side, lUsd + sUsd, cascadeCooldown.current);
          fired = true; break;
        }
      }
      if (!fired) {
        const mktTotal = mktL + mktS;
        if (mktTotal >= MARKET_CASCADE_THRESHOLD) {
          const side: 'LONG' | 'SHORT' | 'MIXED' =
            mktL > mktS * 1.5 ? 'LONG' : mktS > mktL * 1.5 ? 'SHORT' : 'MIXED';
          setStore(s => ({ ...s, cascadeAlert: { coin: 'MARKET', side, totalUsd: mktTotal, ts: now } }));
          sendCascadeAlert('MARKET', side, mktTotal, cascadeCooldown.current);
        }
      }

      // Liquidation delta - net long vs short liquidation $ over the longer rolling
      // window, exposed per-coin for display and for StopLossZone's bias scoring.
      const wDelta = liqBufferRef.current.filter(l => l.ts > now - LIQ_DELTA_WINDOW_MS);
      const deltaByCoin: Record<string, { l: number; s: number }> = {};
      wDelta.forEach(({ coin, side, usd }) => {
        if (!deltaByCoin[coin]) deltaByCoin[coin] = { l: 0, s: 0 };
        if (side === 'LONG') deltaByCoin[coin].l += usd; else deltaByCoin[coin].s += usd;
      });
      for (const [coin, { l, s }] of Object.entries(deltaByCoin)) {
        if (l + s < LIQ_DELTA_MIN_TOTAL) continue;
        updateCoin(coin.toLowerCase() as CoinId, { liqDelta: l - s, liqLongUsd: l, liqShortUsd: s });
      }
    }, 5_000);

    return () => {
      alive = false;
      clearInterval(analyzer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* */ }
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Initialise on mount ── */
  useEffect(() => {
    /* #200: mount the context, skip the traffic. `Idle` rather than leaving
       wsStatus undefined, because NavDrawer's dot treats undefined as
       "Connecting..." and would spin forever on a page that is never going to
       connect - a permanent spinner reads as broken, which is worse than the
       210 requests it replaces. */
    if (!enabled) {
      setStore(s => ({ ...s, wsStatus: 'Idle' }));
      return;
    }
    startWS();
    fetchBybit();
    fetchLSR();
    fetchSnapshot();
    fetchBybitKlines();       // RSI/MA20/VWAP/POC for HYPE
    fetchFNG();
    fetchCMCGlobal();
    fetchAltSeason();
    fetchMacro();
    fetchETF();
    fetchRSI();               // all timeframes, all coins - one server call
    fetchCVD();
    fetchOrderBook();
    fetchPremiumIndex();
    fetchDeribitOptions();
    fetchStablecoinFlows();
    // CB Premium needs BTC price first - wait 3s for WS/REST to populate
    setTimeout(fetchCoinbasePremium, 3000);
    // Retry server-proxied APIs that may miss on Render cold start
    setTimeout(fetchCMCGlobal, 12_000);
    setTimeout(fetchMacro, 12_000);
    // OI bootstrap - gives immediate trend signal without waiting for two 8-min Bybit polls
    bootstrapOITrend();

    const intervals = [
      setInterval(fetchBybit,             8  * 60 * 1000),
      setInterval(fetchLSR,               5  * 60 * 1000),
      setInterval(fetchSnapshot,          3  * 60 * 1000),
      setInterval(fetchBybitKlines,       3  * 60 * 1000),  // same cadence as Binance klines
      setInterval(fetchFNG,             24  * 60 * 60 * 1000),
      setInterval(fetchCMCGlobal,         5  * 60 * 1000),   // BTC/ETH dom - CMC, every 5m
      setInterval(fetchAltSeason,        15  * 60 * 1000),   // 90d score - slow-moving, every 15m
      setInterval(fetchMacro,            10  * 60 * 1000),
      setInterval(fetchETF,              30  * 60 * 1000),
      // 5m RSI's old cadence. The 1h/4h/1d/1w/1M values are cached server-side
      // at their own 15m TTL, so this does not re-fetch them every 3 minutes.
      setInterval(fetchRSI,               3  * 60 * 1000),
      setInterval(fetchCVD,               5  * 60 * 1000),
      setInterval(fetchOrderBook,         2  * 60 * 1000),
      setInterval(fetchPremiumIndex,     30  * 1000),        // every 30s - premium changes frequently
      setInterval(fetchDeribitOptions,   15  * 60 * 1000),
      setInterval(fetchStablecoinFlows,  30  * 60 * 1000),
      setInterval(fetchCoinbasePremium,   30 * 1000),      // every 30s
    ];

    return () => {
      intervals.forEach(clearInterval);
      /* Detach onclose before closing. Otherwise unmounting fires the handler
         above, which starts the REST fallback and the socket-retry timer for a
         provider that no longer exists - the polling then outlives the page
         that needed it. */
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      if (restTimerRef.current) clearInterval(restTimerRef.current);
      if (wsRetryRef.current)  clearInterval(wsRetryRef.current);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MarketContext.Provider value={{ store, setStore, selectCoin }}>
      {children}
    </MarketContext.Provider>
  );
}
