'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';

/* ── Types ── */
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface SwingPt { idx: number; price: number; type: 'high' | 'low'; ts: number }

export interface StructureEvent {
  type:       'BOS' | 'CHoCH';
  dir:        'bullish' | 'bearish';
  price:      number;   // broken level
  ts:         number;   // candle timestamp
  candlesAgo: number;   // how many 4H candles ago
}

export interface MSData {
  bias:          'BULLISH' | 'BEARISH' | 'RANGING';
  lastEvent:     StructureEvent | null;
  lastSwingHigh: number | null;
  lastSwingLow:  number | null;
  events:        StructureEvent[];  // most recent first
}

/* ── Swing-point detection (lookback = 3 candles each side) ── */
function detectSwings(candles: Candle[], lb = 3): SwingPt[] {
  const result: SwingPt[] = [];
  for (let i = lb; i < candles.length - lb; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lb; j <= i + lb; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow  = false;
    }
    if (isHigh) result.push({ idx: i, price: candles[i].h, type: 'high', ts: candles[i].t });
    if (isLow)  result.push({ idx: i, price: candles[i].l, type: 'low',  ts: candles[i].t });
  }
  return result.sort((a, b) => a.idx - b.idx);
}

/* ── BOS / CHoCH analysis ──────────────────────────────────────────────
   BOS   = price breaks a swing in the SAME direction as current trend  → continuation
   CHoCH = price breaks a swing AGAINST the current trend               → possible reversal
─────────────────────────────────────────────────────────────────────── */
function analyzeStructure(candles: Candle[], swings: SwingPt[]): MSData {
  const highs = swings.filter(s => s.type === 'high');
  const lows  = swings.filter(s => s.type === 'low');
  const base: MSData = {
    bias: 'RANGING', lastEvent: null,
    lastSwingHigh: highs[highs.length - 1]?.price ?? null,
    lastSwingLow:  lows[lows.length  - 1]?.price ?? null,
    events: [],
  };
  if (swings.length < 6) return base;

  const events: StructureEvent[] = [];
  let trend: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';
  let kH: SwingPt | null = null;  // last confirmed swing high
  let kL: SwingPt | null = null;  // last confirmed swing low

  for (const sw of swings) {
    if (sw.type === 'high') {
      if (kH && sw.price > kH.price) {
        // Breaking above previous swing high
        if (trend === 'BULLISH') {
          events.push({ type: 'BOS',   dir: 'bullish', price: kH.price, ts: sw.ts, candlesAgo: candles.length - 1 - sw.idx });
        } else if (trend === 'BEARISH') {
          events.push({ type: 'CHoCH', dir: 'bullish', price: kH.price, ts: sw.ts, candlesAgo: candles.length - 1 - sw.idx });
          trend = 'BULLISH';
        } else {
          trend = 'BULLISH';
        }
      }
      kH = sw;
    } else {
      if (kL && sw.price < kL.price) {
        // Breaking below previous swing low
        if (trend === 'BEARISH') {
          events.push({ type: 'BOS',   dir: 'bearish', price: kL.price, ts: sw.ts, candlesAgo: candles.length - 1 - sw.idx });
        } else if (trend === 'BULLISH') {
          events.push({ type: 'CHoCH', dir: 'bearish', price: kL.price, ts: sw.ts, candlesAgo: candles.length - 1 - sw.idx });
          trend = 'BEARISH';
        } else {
          trend = 'BEARISH';
        }
      }
      kL = sw;
    }
  }

  const recent = [...events].reverse().slice(0, 5);
  return {
    bias: trend,
    lastEvent: recent[0] ?? null,
    lastSwingHigh: highs[highs.length - 1]?.price ?? null,
    lastSwingLow:  lows[lows.length  - 1]?.price ?? null,
    events: recent,
  };
}

/* ── Candle-age → human time (each candle = 4h) ── */
function fmtAge(candlesAgo: number): string {
  if (candlesAgo === 0) return 'current';
  const h = candlesAgo * 4;
  if (h < 24) return `~${h}h ago`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r ? `~${d}d ${r}h ago` : `~${d}d ago`;
}

/* ── Price formatter ── */
function fmtP(n: number): string {
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/* ── Event colour helpers ── */
function evCol(ev: StructureEvent): string {
  return ev.type === 'CHoCH'
    ? (ev.dir === 'bullish' ? '#5a6aff' : '#f87171')
    : (ev.dir === 'bullish' ? '#34d399' : '#f87171');
}
function evBg(ev: StructureEvent): string {
  return ev.type === 'CHoCH'
    ? (ev.dir === 'bullish' ? 'rgba(90,106,255,0.10)' : 'rgba(248,113,113,0.10)')
    : (ev.dir === 'bullish' ? 'rgba(52,211,153,0.10)'  : 'rgba(248,113,113,0.10)');
}

/* ── Component ── */
interface Props { coin: CoinId; onData?: (d: MSData | null) => void }

export default function MarketStructure({ coin, onData }: Props) {
  const [data,    setData]    = useState<MSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const cbRef = useRef(onData);
  useEffect(() => { cbRef.current = onData; }, [onData]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const binSym = BINANCE_SYMS[coin] as string | undefined;
      const bytSym = BYBIT_SYMS[coin]   as string | undefined;
      let candles: Candle[];

      if (binSym) {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=4h&limit=100`);
        if (!r.ok) throw new Error('Binance 4H fetch failed');
        const raw = await r.json() as (string | number)[][];
        candles = raw.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      } else if (bytSym) {
        const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bytSym}&interval=240&limit=100`);
        if (!r.ok) throw new Error('Bybit 4H fetch failed');
        const raw = await r.json() as { result?: { list?: string[][] } };
        candles = [...(raw?.result?.list ?? [])].reverse().map(k => ({
          t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
        }));
      } else {
        throw new Error('No data source for ' + coin);
      }

      const swings = detectSwings(candles);
      const ms     = analyzeStructure(candles, swings);
      setData(ms);
      cbRef.current?.(ms);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      cbRef.current?.(null);
    } finally {
      setLoading(false);
    }
  }, [coin]);

  /* fetch on coin change; refresh every 4 hours */
  useEffect(() => {
    load();
    const iv = setInterval(load, 4 * 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  /* ── Loading skeleton ── */
  if (loading && !data) {
    return (
      <div className="ms-card">
        <div className="ms-header">
          <span className="ms-title">Market Structure · 4H</span>
          <span style={{ fontSize: 11, color: '#444' }}>Loading…</span>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (err && !data) {
    return (
      <div className="ms-card">
        <div className="ms-header">
          <span className="ms-title">Market Structure · 4H</span>
          <span style={{ fontSize: 11, color: '#f87171' }}>Failed</span>
        </div>
      </div>
    );
  }

  const d  = data!;
  const le = d.lastEvent;
  const biasCol = d.bias === 'BULLISH' ? '#34d399' : d.bias === 'BEARISH' ? '#f87171' : '#9ca3af';

  return (
    <div className="ms-card">

      {/* ── Header: title + bias ── */}
      <div className="ms-header">
        <span className="ms-title">Market Structure · 4H</span>
        <span className="ms-bias" style={{ color: biasCol }}>{d.bias}</span>
      </div>

      {/* ── Last event ── */}
      {le && (
        <div className="ms-last-event" style={{ borderColor: evCol(le) + '33', background: evBg(le) }}>
          <span className="ms-ev-badge" style={{ background: evBg(le), color: evCol(le), border: `0.5px solid ${evCol(le)}44` }}>
            {le.type} {le.dir === 'bullish' ? '▲' : '▼'}
          </span>
          <span className="ms-ev-price">${fmtP(le.price)}</span>
          <span className="ms-ev-ago">{fmtAge(le.candlesAgo)}</span>
          {le.type === 'CHoCH' && (
            <span style={{ fontSize: 10, color: evCol(le), fontWeight: 700, marginLeft: 4 }}>FLIP</span>
          )}
        </div>
      )}

      {/* ── Key swing levels ── */}
      <div className="ms-levels">
        {d.lastSwingHigh != null && (
          <div className="ms-level">
            <span className="ms-level-lbl">Swing High</span>
            <span className="ms-level-val" style={{ color: '#f87171' }}>${fmtP(d.lastSwingHigh)}</span>
          </div>
        )}
        {d.lastSwingLow != null && (
          <div className="ms-level">
            <span className="ms-level-lbl">Swing Low</span>
            <span className="ms-level-val" style={{ color: '#34d399' }}>${fmtP(d.lastSwingLow)}</span>
          </div>
        )}
      </div>

      {/* ── Recent event history (skip the first since it's already shown above) ── */}
      {d.events.length > 1 && (
        <div className="ms-history">
          {d.events.slice(1, 5).map((ev, i) => (
            <div key={i} className="ms-hist-row">
              <span className="ms-hist-badge" style={{ background: evBg(ev), color: evCol(ev) }}>
                {ev.type} {ev.dir === 'bullish' ? '▲' : '▼'}
              </span>
              <span className="ms-hist-price">${fmtP(ev.price)}</span>
              <span className="ms-hist-ago">{fmtAge(ev.candlesAgo)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ms-footer">
        BOS = trend continuation · CHoCH = potential reversal · 4H swing lookback 3
      </div>
    </div>
  );
}
