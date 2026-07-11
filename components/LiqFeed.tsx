'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';

/* ── Types ── */
interface LiqEvent {
  id:     number;
  symbol: string;
  coin:   string;
  side:   'LONG' | 'SHORT';
  usd:    number;
  price:  number;
  ts:     number;
  source: 'BN' | 'BB';   // Binance | Bybit
}

interface Stats  { longUsd: number; shortUsd: number; count: number; }
interface Cascade { ts: number; totalUsd: number; side: 'LONG' | 'SHORT' | 'MIXED'; coins: string[]; }
export interface Bucket  { label: string; price: number; longUsd: number; shortUsd: number; total: number; coin: string; }

/* ── Constants ── */
const FEED_SIZE          = 30;
const STATS_WIN          = 60 * 60 * 1000;        // 1h stats window
const CLUSTER_WIN        = 24 * 60 * 60 * 1000;   // 24h cluster accumulation
const MIN_SHOW           = 10_000;                 // $10K minimum to appear
const MIN_ALERT          = 500_000;                // $500K = big hit
const CASCADE_THRESHOLD  = 3_000_000;              // $3M in 30s = cascade
const CASCADE_WIN        = 30_000;                 // 30-second window
const CASCADE_HIDE_MS    = 12_000;                 // show cascade badge 12s
const STORAGE_KEY        = 'liq-events-v2';        // localStorage key
const STORAGE_MAX        = 2000;                   // max events to persist locally
const SB_SAVE_MS         = 5 * 60 * 1000;          // save to Supabase every 5 min
const SB_WIN_MS          = 24 * 60 * 60 * 1000;    // load last 24h from Supabase
const SB_RETAIN_MS       = 7 * 24 * 60 * 60 * 1000; // purge events older than 7 days
const SB_SAVE_TS_KEY     = 'liq-sb-ts';            // localStorage: last Supabase save timestamp
const BYBIT_COINS        = Object.values(BYBIT_SYMS);

let idCounter = 0;

/* ── Helpers ── */
function fmtUSD(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}
function coinFromSym(sym: string): string {
  return sym.replace(/^\d+/, '').replace(/USDT$|BUSD$|USDC$/, '');
}
function bucketSz(price: number): number {
  if (price >= 10000) return 200;
  if (price >= 1000)  return 20;
  if (price >= 100)   return 2;
  if (price >= 10)    return 0.5;
  if (price >= 1)     return 0.1;
  return 0.01;
}
function snapBucket(price: number): number {
  const sz = bucketSz(price);
  return Math.round(price / sz) * sz;
}
function fmtBucket(price: number): string {
  const sz  = bucketSz(price);
  const dec = sz >= 1 ? 0 : sz >= 0.1 ? 1 : 2;
  return '$' + price.toLocaleString(undefined, { maximumFractionDigits: dec });
}
function fmtEventPrice(price: number): string {
  return '$' + price.toLocaleString('en-US', { maximumFractionDigits: price < 10 ? 3 : 2 });
}

export default function LiqFeed({ onClusters, coinFilter }: { onClusters?: (clusters: Bucket[]) => void; coinFilter: string }) {
  const [feed,     setFeed]     = useState<LiqEvent[]>([]);
  const [stats,    setStats]    = useState<Stats>({ longUsd: 0, shortUsd: 0, count: 0 });
  const [cascade,  setCascade]  = useState<Cascade | null>(null);
  const [clusters, setClusters] = useState<Bucket[]>([]);
  const [bnStatus, setBnStatus] = useState<'connecting'|'live'|'error'>('connecting');
  const [bbStatus, setBbStatus] = useState<'connecting'|'live'|'error'>('connecting');
  const [msgCount, setMsgCount] = useState(0);
  const coinFilterRef = useRef(coinFilter);

  const bnWsRef         = useRef<WebSocket | null>(null);
  const bbWsRef         = useRef<WebSocket | null>(null);
  const historyRef      = useRef<LiqEvent[]>([]);
  const msgRef          = useRef(0);
  const cascadeTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sbSaveTimer     = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Rebuild derived state from history ── */
  const rebuild = useCallback((history: LiqEvent[]) => {
    const now = Date.now();
    const cf  = coinFilterRef.current;

    // 1h stats — filtered to selected coin
    const win = history.filter(e => now - e.ts < STATS_WIN && (cf === 'ALL' || e.coin === cf));
    setStats({
      longUsd:  win.filter(e => e.side === 'LONG').reduce((s, e)  => s + e.usd, 0),
      shortUsd: win.filter(e => e.side === 'SHORT').reduce((s, e) => s + e.usd, 0),
      count: win.length,
    });

    // Cascade: $3M+ in 30s
    const cascWin   = history.filter(e => now - e.ts < CASCADE_WIN);
    const cascTotal = cascWin.reduce((s, e) => s + e.usd, 0);
    if (cascTotal >= CASCADE_THRESHOLD) {
      const lUsd  = cascWin.filter(e => e.side === 'LONG').reduce((s, e)  => s + e.usd, 0);
      const sUsd  = cascWin.filter(e => e.side === 'SHORT').reduce((s, e) => s + e.usd, 0);
      const side: Cascade['side'] = lUsd > sUsd * 1.5 ? 'LONG' : sUsd > lUsd * 1.5 ? 'SHORT' : 'MIXED';
      const coins = [...new Set(cascWin.map(e => e.coin))].slice(0, 4);
      setCascade({ ts: now, totalUsd: cascTotal, side, coins });
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current);
      cascadeTimer.current = setTimeout(() => setCascade(null), CASCADE_HIDE_MS);
    }

    // Price clusters keyed per-coin so callers can filter by selected coin
    const cWin = history.filter(e => now - e.ts < CLUSTER_WIN);
    const map  = new Map<string, { longUsd: number; shortUsd: number; coin: string; price: number }>();
    cWin.forEach(e => {
      const bp  = snapBucket(e.price);
      const key = `${e.coin}::${bp}`;
      const cur = map.get(key) ?? { longUsd: 0, shortUsd: 0, coin: e.coin, price: bp };
      if (e.side === 'LONG') cur.longUsd += e.usd; else cur.shortUsd += e.usd;
      map.set(key, cur);
    });
    const buckets: Bucket[] = Array.from(map.values())
      .map(({ longUsd, shortUsd, coin, price }) => ({
        label: fmtBucket(price), price, longUsd, shortUsd, total: longUsd + shortUsd, coin,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 100);
    setClusters(buckets);
    onClusters?.(buckets);
  }, [onClusters]);

  /* ── Sync coinFilter prop → ref and re-derive stats/clusters ── */
  useEffect(() => {
    coinFilterRef.current = coinFilter;
    rebuild(historyRef.current);
  }, [coinFilter, rebuild]);

  /* ── Persist history to localStorage (debounced 5s) ── */
  const saveToStorage = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      try {
        const now = Date.now();
        const recent = historyRef.current
          .filter(e => now - e.ts < CLUSTER_WIN)
          .slice(-STORAGE_MAX);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
      } catch { /* storage full — ignore */ }
    }, 5000);
  }, []);

  /* ── Common event processor for both exchanges ── */
  const onLiq = useCallback((
    sym: string, side: 'LONG' | 'SHORT', usd: number, price: number, source: 'BN' | 'BB'
  ) => {
    if (usd < MIN_SHOW || !isFinite(usd)) return;
    msgRef.current++;
    if (msgRef.current % 5 === 0) setMsgCount(msgRef.current);

    const ev: LiqEvent = {
      id: ++idCounter, symbol: sym, coin: coinFromSym(sym),
      side, usd, price, ts: Date.now(), source,
    };
    historyRef.current = [...historyRef.current, ev].slice(-5000);
    rebuild(historyRef.current);
    setFeed(prev => [ev, ...prev].slice(0, FEED_SIZE));
    saveToStorage();
  }, [rebuild, saveToStorage]);

  /* ── Binance forceOrder WebSocket (individual symbol streams — all-market @arr is deprecated) ── */
  const BN_SYMBOLS = Object.values(BINANCE_SYMS).map(s => s.toLowerCase());
  const connectBN = useCallback(() => {
    try { bnWsRef.current?.close(); } catch { /* */ }
    // Combined stream: each symbol has its own forceOrder feed
    const streams = BN_SYMBOLS.map(s => `${s}@forceOrder`).join('/');
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);
    bnWsRef.current = ws;
    ws.onopen  = () => setBnStatus('live');
    ws.onerror = () => setBnStatus('error');
    ws.onclose = () => { setBnStatus('error'); setTimeout(connectBN, 5000); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        // Combined stream wraps: {stream:"btcusdt@forceOrder", data:{e,E,o}}
        const o = msg?.data?.o ?? msg?.o;
        if (!o) return;
        if (o.X && o.X !== 'FILLED') return;
        const priceAp = parseFloat(o.ap ?? '0');
        const priceP  = parseFloat(o.p  ?? '0');
        const price   = priceAp > 0 ? priceAp : priceP;
        const qty     = parseFloat(o.z  ?? o.q ?? '0');
        if (price <= 0 || qty <= 0) return;
        onLiq(o.s ?? '', o.S === 'SELL' ? 'LONG' : 'SHORT', price * qty, price, 'BN');
      } catch { /* */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLiq]);

  /* ── Bybit liquidation WebSocket (try primary, fall back to bytick.com mirror) ── */
  const bbRetriesRef2 = useRef(0);
  const connectBB = useCallback(() => {
    try { bbWsRef.current?.close(); } catch { /* */ }
    // bytick.com is Bybit's alternative domain — less likely to be blocked by extensions
    const host = bbRetriesRef2.current % 2 === 0
      ? 'wss://stream.bybit.com/v5/public/linear'
      : 'wss://stream.bytick.com/v5/public/linear';
    const ws = new WebSocket(host);
    bbWsRef.current = ws;
    ws.onopen = () => {
      setBbStatus('live');
      // v5 topic: allLiquidation.{symbol} — max 25 topics per subscribe message
      const topics = BYBIT_COINS.map(s => `allLiquidation.${s}`);
      for (let i = 0; i < topics.length; i += 25) {
        ws.send(JSON.stringify({ op: 'subscribe', args: topics.slice(i, i + 25) }));
      }
    };
    ws.onerror = () => setBbStatus('error');
    ws.onclose = () => {
      setBbStatus('error');
      bbRetriesRef2.current++;
      setTimeout(connectBB, 5000);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.op === 'subscribe') return;   // ignore subscription ack
        if (!msg.topic?.startsWith('allLiquidation.') || !msg.data) return;
        const items = Array.isArray(msg.data) ? msg.data : [msg.data];
        items.forEach((d: Record<string, string>) => {
          // allLiquidation fields: s=symbol, S=side (Buy=long liq), v=size, p=bankruptcy price
          const price = parseFloat(d.p ?? '0');
          const qty   = parseFloat(d.v ?? '0');
          if (price <= 0 || qty <= 0) return;
          // S:"Buy" = long position was liquidated; S:"Sell" = short position liquidated
          onLiq(d.s ?? '', d.S === 'Buy' ? 'LONG' : 'SHORT', price * qty, price, 'BB');
        });
      } catch { /* */ }
    };
  }, [onLiq]);

  useEffect(() => {
    // ── Seed from localStorage (fast, synchronous) ───────────────────────
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: LiqEvent[] = JSON.parse(stored);
        const now = Date.now();
        const valid = parsed
          .filter(e => now - e.ts < CLUSTER_WIN)
          .map(e => ({ ...e, id: ++idCounter }));
        if (valid.length > 0) {
          historyRef.current = valid;
          rebuild(valid);
          setFeed(valid.slice().reverse().slice(0, FEED_SIZE));
        }
      }
    } catch { /* corrupted storage — ignore */ }

    // ── Connect to exchanges ─────────────────────────────────────────────
    connectBN();
    connectBB();
    const iv = setInterval(() => rebuild(historyRef.current), 30_000);

    // ── Load 24h history from Supabase (async, fills clusters on arrival) ─
    const sb = getSupabase();
    if (sb) {
      const since = Date.now() - SB_WIN_MS;
      sb.from(T.liq_events)
        .select('coin, side, usd, price, source, ts')
        .gte('ts', since)
        .order('ts', { ascending: true })
        .limit(5000)
        .then(({ data }) => {
          if (!data || data.length === 0) return;
          const seen = new Set(
            historyRef.current.map(e => `${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`)
          );
          const newEvts = (data as Array<{ coin: string; side: string; usd: number; price: number; source: string; ts: number }>)
            .filter(r => !seen.has(`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`))
            .map(r => ({
              id: ++idCounter,
              symbol: r.coin + 'USDT',
              coin: r.coin,
              side: r.side as 'LONG' | 'SHORT',
              usd: r.usd,
              price: r.price,
              ts: r.ts,
              source: r.source as 'BN' | 'BB',
            }));
          if (newEvts.length === 0) return;
          const merged = [...historyRef.current, ...newEvts]
            .sort((a, b) => a.ts - b.ts)
            .slice(-5000);
          historyRef.current = merged;
          rebuild(merged);
          // Do NOT update setFeed here — old events should not appear in the live feed
        });

      // ── Periodic save of new events to Supabase ──────────────────────
      sbSaveTimer.current = setInterval(() => {
        const lastTs = parseInt(localStorage.getItem(SB_SAVE_TS_KEY) || '0');
        const toSave = historyRef.current.filter(e => e.ts > lastTs);
        if (toSave.length === 0) return;
        const rows = toSave.map(e => ({
          coin: e.coin, side: e.side, usd: e.usd, price: e.price, source: e.source, ts: e.ts,
        }));
        sb.from(T.liq_events).insert(rows).then(({ error }) => {
          if (error) { console.error('[liq] sb save failed:', error.message); return; }
          localStorage.setItem(SB_SAVE_TS_KEY, String(Date.now()));
          // Occasional purge — delete events older than 7 days
          const cutoff = Date.now() - SB_RETAIN_MS;
          sb.from(T.liq_events).delete().lt('ts', cutoff).then(() => { /* fire and forget */ });
        });
      }, SB_SAVE_MS);
    }

    return () => {
      clearInterval(iv);
      if (sbSaveTimer.current) clearInterval(sbSaveTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      bnWsRef.current?.close();
      bbWsRef.current?.close();
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived display values ── */
  const displayed = coinFilter === 'ALL' ? feed : feed.filter(e => e.coin === coinFilter);
  const totalUsd  = stats.longUsd + stats.shortUsd;
  const longDom   = stats.longUsd  > stats.shortUsd * 1.2;
  const shortDom  = stats.shortUsd > stats.longUsd  * 1.2;
  const anyLive   = bnStatus === 'live' || bbStatus === 'live';

  return (
    <div className="liqfeed-wrap">

      {/* ── Header ── */}
      <div className="liqfeed-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)' }}>⚡ Live Liquidations</span>
          <span className={`liqfeed-dot liqfeed-dot-${bnStatus}`} title={`Binance: ${bnStatus}`} />
          <span className={`liqfeed-dot liqfeed-dot-${bbStatus}`} title={`Bybit: ${bbStatus}`} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
          Binance + Bybit · &gt;$10K · {msgCount > 0 ? `${msgCount} events` : 'waiting…'}
        </span>
      </div>

      {/* ── Cascade alert ── */}
      {cascade && (
        <div className={`liq-cascade liq-cascade-${cascade.side.toLowerCase()}`}>
          <span className="liq-cascade-icon">⚡⚡</span>
          <div className="liq-cascade-body">
            <span className="liq-cascade-label">
              {cascade.side === 'LONG' ? 'LONG CASCADE' : cascade.side === 'SHORT' ? 'SHORT CASCADE' : 'CASCADE'}
            </span>
            <span className="liq-cascade-amt">
              {' '}{fmtUSD(cascade.totalUsd)} wiped in 30s
            </span>
            {cascade.coins.length > 0 && (
              <span className="liq-cascade-coins"> · {cascade.coins.join(', ')}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="liqfeed-stats">
        <div className="liqfeed-stat">
          <span className="liqfeed-stat-lbl">Longs liq'd (1h)</span>
          <span className="liqfeed-stat-val" style={{ color: '#f87171' }}>{fmtUSD(stats.longUsd)}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'center' }}>
          <span className="liqfeed-stat-lbl">Events</span>
          <span className="liqfeed-stat-val" style={{ color: 'var(--accent)' }}>{stats.count}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'right' }}>
          <span className="liqfeed-stat-lbl">Shorts liq'd (1h)</span>
          <span className="liqfeed-stat-val" style={{ color: '#34d399' }}>{fmtUSD(stats.shortUsd)}</span>
        </div>
      </div>

      {/* ── Bias bar ── */}
      {totalUsd > 0 && (
        <>
          <div className="liqfeed-bias-wrap">
            <div className="liqfeed-bias-bar liqfeed-bias-long"  style={{ width: `${(stats.longUsd  / totalUsd) * 100}%` }} />
            <div className="liqfeed-bias-bar liqfeed-bias-short" style={{ width: `${(stats.shortUsd / totalUsd) * 100}%` }} />
          </div>
          <div className="liqfeed-bias-label">
            {longDom  && <span style={{ color: '#f87171' }}>⚠ Longs getting wrecked — price accelerating down</span>}
            {shortDom && <span style={{ color: '#34d399' }}>Shorts getting wrecked — price accelerating up</span>}
            {!longDom && !shortDom && <span style={{ color: 'var(--txt3)' }}>Balanced — no dominant side liquidating</span>}
          </div>
        </>
      )}

      {/* ── Price clusters ── */}
      {clusters.length > 0 && (() => {
        const filtered = coinFilter === 'ALL'
          ? clusters
          : clusters.filter(c => c.coin === coinFilter);
        if (filtered.length === 0) return null;
        const displayMax = Math.max(...filtered.map(c => c.total));
        return (
          <div className="liq-clusters">
            <div className="liq-clusters-title">
              Hot price levels · 24h cluster
              <span style={{ color: '#444', fontWeight: 400, marginLeft: 6 }}>— where liqs are concentrating</span>
            </div>
            {filtered.map(c => (
              <div key={`${c.coin}::${c.price}`} className="liq-cluster-row">
                <div>
                  {coinFilter === 'ALL' && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '.06em', display: 'block', marginBottom: 1 }}>{c.coin}</span>
                  )}
                  <span className="liq-cluster-price">{c.label}</span>
                </div>
                <div className="liq-cluster-bars">
                  <div
                    className="liq-cluster-bar liq-cluster-bar-long"
                    style={{ width: `${(c.longUsd / displayMax) * 100}%` }}
                  />
                  <div
                    className="liq-cluster-bar liq-cluster-bar-short"
                    style={{ width: `${(c.shortUsd / displayMax) * 100}%` }}
                  />
                </div>
                <span className="liq-cluster-amt">{fmtUSD(c.total)}</span>
                <span
                  className="liq-cluster-dom"
                  style={{ color: c.longUsd > c.shortUsd ? '#f87171' : '#34d399' }}
                >
                  {c.longUsd > c.shortUsd ? 'L' : 'S'}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Feed ── */}
      {displayed.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#444', fontSize: 12 }}>
          {anyLive ? `Watching for ${coinFilter === 'ALL' ? 'all markets' : coinFilter} liquidations > $10K…` : 'Connecting to Binance + Bybit…'}
        </div>
      )}

      <div className="liqfeed-list">
        {displayed.map(ev => {
          const isLong = ev.side === 'LONG';
          const isBig  = ev.usd >= MIN_ALERT;
          const accent = isLong ? '#f87171' : '#34d399';
          return (
            <div
              key={ev.id}
              className={`liqfeed-row${isBig ? ' liqfeed-row-big' : ''}`}
              style={{ borderLeftColor: accent }}
            >
              <span className="liqfeed-row-coin" style={{ color: accent }}>{ev.coin}</span>
              <span className={`liqfeed-row-side liqfeed-row-side-${isLong ? 'long' : 'short'}`}>
                {isLong ? 'LONG LIQ' : 'SHORT LIQ'}
              </span>
              <span className="liqfeed-row-usd" style={{ color: isBig ? accent : '#8e8e93' }}>
                {fmtUSD(ev.usd)}
              </span>
              <span className="liqfeed-row-price">{fmtEventPrice(ev.price)}</span>
              <span className="liqfeed-row-time">
                <span className={`liq-src liq-src-${ev.source.toLowerCase()}`}>{ev.source}</span>
                {fmtTime(ev.ts)}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}
