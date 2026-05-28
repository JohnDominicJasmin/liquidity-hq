'use client';
import { useEffect, useRef, useState } from 'react';

interface LiqEvent {
  id: number;
  symbol: string;       // e.g. "BTCUSDT"
  coin: string;         // e.g. "BTC"
  side: 'LONG' | 'SHORT'; // which side was liquidated
  usd: number;          // notional USD value
  price: number;        // execution price
  ts: number;           // unix ms
}

interface Stats {
  longUsd: number;   // total long liq in window
  shortUsd: number;  // total short liq in window
  count: number;
}

const FEED_SIZE   = 30;   // events shown in feed
const STATS_WIN   = 60 * 60 * 1000; // 1 hour window for stats
const MIN_SHOW    = 10_000;   // minimum USD to appear in feed
const MIN_ALERT   = 500_000;  // big hit threshold

let idCounter = 0;

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function coinFromSymbol(sym: string): string {
  // e.g. BTCUSDT → BTC, 1000SHIBUSDT → SHIB
  return sym.replace(/\d+/, '').replace(/USDT$|BUSD$|USDC$/, '');
}

export default function LiqFeed() {
  const [feed,     setFeed]     = useState<LiqEvent[]>([]);
  const [stats,    setStats]    = useState<Stats>({ longUsd: 0, shortUsd: 0, count: 0 });
  const [status,   setStatus]   = useState<'connecting' | 'live' | 'error'>('connecting');
  const [msgCount, setMsgCount] = useState(0);
  const wsRef               = useRef<WebSocket | null>(null);
  const historyRef          = useRef<LiqEvent[]>([]);
  const msgRef              = useRef(0);

  // Recompute stats from history
  function rebuildStats(history: LiqEvent[]) {
    const cutoff = Date.now() - STATS_WIN;
    const win = history.filter(e => e.ts >= cutoff);
    const longUsd  = win.filter(e => e.side === 'LONG').reduce((s, e) => s + e.usd, 0);
    const shortUsd = win.filter(e => e.side === 'SHORT').reduce((s, e) => s + e.usd, 0);
    setStats({ longUsd, shortUsd, count: win.length });
  }

  function connect() {
    const ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
    wsRef.current = ws;

    ws.onopen  = () => setStatus('live');
    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      setStatus('error');
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
      }, 3000);
    };

    ws.onmessage = (ev) => {
      try {
        msgRef.current += 1;
        if (msgRef.current % 10 === 0) setMsgCount(msgRef.current);
        const msg = JSON.parse(ev.data as string);
        const o = msg?.o;
        if (!o) return;

        const ap  = parseFloat(o.ap ?? o.p ?? '0');
        const qty = parseFloat(o.z ?? o.q ?? '0');
        const usd = ap * qty;
        if (usd < MIN_SHOW || !isFinite(usd)) return;

        // S: "SELL" means the liq order is a sell → the trader was LONG → LONG liq
        // S: "BUY"  means the liq order is a buy  → the trader was SHORT → SHORT liq
        const side: 'LONG' | 'SHORT' = o.S === 'SELL' ? 'LONG' : 'SHORT';
        const symbol = (o.s ?? '') as string;

        const event: LiqEvent = {
          id: ++idCounter,
          symbol,
          coin: coinFromSymbol(symbol),
          side,
          usd,
          price: ap,
          ts: Date.now(),
        };

        historyRef.current = [...historyRef.current, event].slice(-2000);
        rebuildStats(historyRef.current);

        setFeed(prev => [event, ...prev].slice(0, FEED_SIZE));
      } catch {
        // ignore parse errors
      }
    };
  }

  useEffect(() => {
    connect();
    // Refresh stats every 30s even without new events
    const interval = setInterval(() => rebuildStats(historyRef.current), 30_000);
    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const longDom  = stats.longUsd  > stats.shortUsd * 1.2;
  const shortDom = stats.shortUsd > stats.longUsd  * 1.2;
  const totalUsd = stats.longUsd + stats.shortUsd;

  return (
    <div className="liqfeed-wrap">
      {/* Header */}
      <div className="liqfeed-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8' }}>⚡ Live Liquidations</span>
          <span className={`liqfeed-dot liqfeed-dot-${status}`} title={status} />
        </div>
        <span style={{ fontSize: 11, color: '#444' }}>All markets · &gt;$10K · {msgCount > 0 ? `${msgCount} msgs` : 'waiting…'}</span>
      </div>

      {/* Stats bar */}
      <div className="liqfeed-stats">
        <div className="liqfeed-stat">
          <span className="liqfeed-stat-lbl">Longs liq'd (1h)</span>
          <span className="liqfeed-stat-val" style={{ color: '#f87171' }}>{fmtUSD(stats.longUsd)}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'center' }}>
          <span className="liqfeed-stat-lbl">Events</span>
          <span className="liqfeed-stat-val" style={{ color: '#a78bfa', textAlign: 'center' }}>{stats.count}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'right' }}>
          <span className="liqfeed-stat-lbl">Shorts liq'd (1h)</span>
          <span className="liqfeed-stat-val" style={{ color: '#34d399' }}>{fmtUSD(stats.shortUsd)}</span>
        </div>
      </div>

      {/* Bias bar */}
      {totalUsd > 0 && (
        <div className="liqfeed-bias-wrap">
          <div
            className="liqfeed-bias-bar liqfeed-bias-long"
            style={{ width: `${(stats.longUsd / totalUsd) * 100}%` }}
          />
          <div
            className="liqfeed-bias-bar liqfeed-bias-short"
            style={{ width: `${(stats.shortUsd / totalUsd) * 100}%` }}
          />
        </div>
      )}
      {totalUsd > 0 && (
        <div className="liqfeed-bias-label">
          {longDom  && <span style={{ color: '#f87171' }}>⚠ Longs getting wrecked — whales dumping</span>}
          {shortDom && <span style={{ color: '#34d399' }}>🚀 Shorts getting wrecked — whales pumping</span>}
          {!longDom && !shortDom && <span style={{ color: '#606060' }}>Balanced — no dominant side</span>}
        </div>
      )}

      {/* Feed */}
      {feed.length === 0 && status === 'connecting' && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#444', fontSize: 12 }}>
          Connecting to Binance liquidation stream…
        </div>
      )}
      {feed.length === 0 && status === 'live' && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#444', fontSize: 12 }}>
          Waiting for liquidations {'>'} $10K…
        </div>
      )}

      <div className="liqfeed-list">
        {feed.map(ev => {
          const isLong  = ev.side === 'LONG';
          const isBig   = ev.usd >= MIN_ALERT;
          const accent  = isLong ? '#f87171' : '#34d399';
          return (
            <div
              key={ev.id}
              className={`liqfeed-row${isBig ? ' liqfeed-row-big' : ''}`}
              style={{ borderLeftColor: accent }}
            >
              <span className="liqfeed-row-coin" style={{ color: accent }}>
                {ev.coin}
              </span>
              <span className={`liqfeed-row-side liqfeed-row-side-${isLong ? 'long' : 'short'}`}>
                {isLong ? 'LONG LIQ' : 'SHORT LIQ'}
              </span>
              <span className="liqfeed-row-usd" style={{ color: isBig ? accent : '#8e8e93' }}>
                {fmtUSD(ev.usd)}{isBig ? ' 🔥' : ''}
              </span>
              <span className="liqfeed-row-price">${ev.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              <span className="liqfeed-row-time">{fmtTime(ev.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
