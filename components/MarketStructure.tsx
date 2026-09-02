'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';
import { bybitSymbolPriceFactor } from '@/lib/coins';
import { withAlpha } from '@/lib/color';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { detectStructureSignals, structureState, type PACandle } from '@/lib/priceAction';

/* ── Types ── */
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

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

/* ── BOS / CHoCH analysis ──────────────────────────────────────────────
   BOS   = price breaks a swing in the SAME direction as current trend  → continuation
   CHoCH = price breaks a swing AGAINST the current trend               → possible reversal

   Delegated to lib/priceAction.ts, which is also what the Arena chart's
   Structure markers, the Telegram structure alerts and the AI prompt context
   all read. This component used to carry a second, independent implementation:
   its own swing detector, its own break walk, and a trend variable set to
   whichever direction the LAST break went. Two consequences, both visible to
   the user:

     1. Breaks were detected at swing points rather than on candle closes, so
        the card and the chart markers disagreed about WHEN structure broke.
     2. Because consecutive breaks alternate direction about half the time,
        deriving trend from the last break labelled roughly half of all events
        CHoCH - the card would call a routine continuation a structure flip,
        including the "STRUCTURE FLIP" tag fed into the AI context, while the
        chart called the same bar a plain BOS.

   One definition now. The card reads differently than it used to: far fewer
   CHoCH labels, and event timing that lines up with the chart markers.
─────────────────────────────────────────────────────────────────────── */
function analyzeStructure(candles: Candle[]): MSData {
  const pa: PACandle[] = candles.map(c => ({
    timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
  }));
  const { trend, lastSwingHigh, lastSwingLow } = structureState(pa);
  const bias = trend === 'up' ? 'BULLISH' : trend === 'down' ? 'BEARISH' : 'RANGING';

  // candlesAgo is measured from the breaking candle, which is what the card's
  // "~8h ago" reads off. Signals carry a timestamp rather than an index, so map
  // back through the series once instead of scanning per signal.
  const idxByTs = new Map(candles.map((c, i) => [c.t, i]));

  const events: StructureEvent[] = detectStructureSignals(pa)
    .map(s => ({
      type: (s.kind === 'CHOCH' ? 'CHoCH' : 'BOS') as StructureEvent['type'],
      dir: (s.dir === 'bull' ? 'bullish' : 'bearish') as StructureEvent['dir'],
      // The level that was taken out, not the breaking close - unchanged from
      // what this card displayed before, and what "broken level" means to a
      // reader comparing it against the swing levels shown below it.
      price: s.level,
      ts: s.timestamp,
      candlesAgo: candles.length - 1 - (idxByTs.get(s.timestamp) ?? candles.length - 1),
    }))
    .reverse()      // most recent first
    .slice(0, 5);

  return { bias, lastEvent: events[0] ?? null, lastSwingHigh, lastSwingLow, events };
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

/* ── Price formatter ──
   The sub-0.01 tiers exist because PEPE and BONK trade around 0.0000027. The
   old floor was 4 decimal places, which rendered every one of those as "$0" -
   invisible until the 1000x Bybit normalisation landed and the real per-token
   price finally reached this function. Significant digits rather than a fixed
   scale, so the same call works for BTC at 64,000 and PEPE at 0.0000027. */
function fmtP(n: number): string {
  if (n >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (n >= 0.01)  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  // toLocaleString caps at 20 fraction digits; significant digits keeps a
  // meaningful number of them regardless of how many leading zeros there are.
  return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

/* ── Event colour helpers ── */
function evCol(ev: StructureEvent): string {
  return ev.type === 'CHoCH'
    // Bullish CHoCH used to hardcode the current design's blue (#1a7aff) -
    // the only branch of either helper that wasn't a token, invisible until
    // terminal un-hid this component (#598). --accent takes gold on
    // terminal and the same blue on the current design, so this is a fix
    // for both, not just terminal.
    ? (ev.dir === 'bullish' ? 'var(--accent)' : 'var(--red)')
    : (ev.dir === 'bullish' ? 'var(--green-2)' : 'var(--red)');
}
function evBg(ev: StructureEvent): string {
  return ev.type === 'CHoCH'
    ? (ev.dir === 'bullish' ? withAlpha('var(--accent)', '1a') : 'color-mix(in srgb, var(--red) 10%, transparent)')
    : (ev.dir === 'bullish' ? 'color-mix(in srgb, var(--green-2) 10%, transparent)'  : 'color-mix(in srgb, var(--red) 10%, transparent)');
}

/* ── Component ── */
interface Props { coin: CoinId; onData?: (d: MSData | null) => void }

export default function MarketStructure({ coin, onData }: Props) {
  const { t } = useLabels();
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
        const r = await fetch(`/api/market/klines?source=binance&symbol=${binSym}&interval=4h&limit=100`);
        if (!r.ok) throw new Error('Binance 4H fetch failed');
        const raw = await r.json() as (string | number)[][];
        candles = raw.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      } else if (bytSym) {
        const r = await fetch(`/api/market/klines?source=bybit&symbol=${bytSym}&interval=240&limit=100`);
        if (!r.ok) throw new Error('Bybit 4H fetch failed');
        // Per-1000 quoting on 1000PEPEUSDT / 1000BONKUSDT. This card prints the
        // broken level and both swing levels as dollar prices, so without the
        // factor they read 1000x against the ticker right above them.
        const pf = bybitSymbolPriceFactor(bytSym);
        const raw = await r.json() as { result?: { list?: string[][] } };
        candles = [...(raw?.result?.list ?? [])].reverse().map(k => ({
          t: +k[0], o: +k[1] * pf, h: +k[2] * pf, l: +k[3] * pf, c: +k[4] * pf, v: +k[5],
        }));
      } else {
        throw new Error('No data source for ' + coin);
      }

      const ms = analyzeStructure(candles);
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
      <div className="ms-card" role="status" aria-live="polite">
        <span className="sr-only">{t('MARKET_STRUCTURE_LOADING_SR')}</span>
        <div className="ms-header">
          <span className="ms-title">{t('MARKET_STRUCTURE_TITLE')}</span>
          <SkeletonBar width={50} height={11} radius={4} />
        </div>
        <div className="ms-last-event">
          <SkeletonBar width={72} height={18} radius={5} />
          <SkeletonBar width={60} height={14} radius={3} />
        </div>
        <div className="ms-levels">
          <SkeletonBar width={70} height={14} radius={3} />
          <SkeletonBar width={70} height={14} radius={3} />
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (err && !data) {
    return (
      <div className="ms-card">
        <div className="ms-header">
          <span className="ms-title">{t('MARKET_STRUCTURE_TITLE')}</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>{t('MARKET_STRUCTURE_FAILED')}</span>
        </div>
      </div>
    );
  }

  const d  = data!;
  const le = d.lastEvent;
  const biasCol = d.bias === 'BULLISH' ? 'var(--green-2)' : d.bias === 'BEARISH' ? 'var(--red)' : 'var(--txt3)';

  return (
    <div className="ms-card">

      {/* ── Header: title + bias ── */}
      <div className="ms-header">
        <span className="ms-title">{t('MARKET_STRUCTURE_TITLE')}</span>
        <span className="ms-bias" style={{ color: biasCol }}>{d.bias}</span>
      </div>

      {/* ── Last event ── */}
      {le && (
        <div className="ms-last-event" style={{ borderColor: withAlpha(evCol(le), '33'), background: evBg(le) }}>
          <span className="ms-ev-badge" style={{ background: evBg(le), color: evCol(le), border: `0.5px solid ${withAlpha(evCol(le), '44')}` }}>
            {le.type} <span className="ms-dir-glyph">{le.dir === 'bullish' ? '▲' : '▼'}</span>
          </span>
          <span className="ms-ev-price">${fmtP(le.price)}</span>
          <span className="ms-ev-ago">{fmtAge(le.candlesAgo)}</span>
          {le.type === 'CHoCH' && (
            <span style={{ fontSize: 'var(--fs-caption)', color: evCol(le), fontWeight: 700, marginLeft: 4 }}>{t('MARKET_STRUCTURE_FLIP_TAG')}</span>
          )}
        </div>
      )}

      {/* ── Key swing levels ── */}
      <div className="ms-levels">
        {d.lastSwingHigh != null && (
          <div className="ms-level">
            <span className="ms-level-lbl">{t('MARKET_STRUCTURE_SWING_HIGH_LABEL')}</span>
            <span className="ms-level-val" style={{ color: 'var(--red)' }}>${fmtP(d.lastSwingHigh)}</span>
          </div>
        )}
        {d.lastSwingLow != null && (
          <div className="ms-level">
            <span className="ms-level-lbl">{t('MARKET_STRUCTURE_SWING_LOW_LABEL')}</span>
            <span className="ms-level-val" style={{ color: 'var(--green-2)' }}>${fmtP(d.lastSwingLow)}</span>
          </div>
        )}
      </div>

      {/* ── Recent event history (skip the first since it's already shown above) ── */}
      {d.events.length > 1 && (
        <div className="ms-history">
          {d.events.slice(1, 5).map((ev, i) => (
            <div key={i} className="ms-hist-row">
              <span className="ms-hist-badge" style={{ background: evBg(ev), color: evCol(ev) }}>
                {ev.type} <span className="ms-dir-glyph">{ev.dir === 'bullish' ? '▲' : '▼'}</span>
              </span>
              <span className="ms-hist-price">${fmtP(ev.price)}</span>
              <span className="ms-hist-ago">{fmtAge(ev.candlesAgo)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ms-footer">
        {t('MARKET_STRUCTURE_FOOTER')}
      </div>
    </div>
  );
}
