'use client';
import { useEffect, useRef, useState } from 'react';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';

/* ── Binance futures combined aggTrade stream - Binance-listed coins only (HYPE is Bybit-only) ── */
const SYMBOLS = ['btcusdt','ethusdt','solusdt','xrpusdt','bnbusdt','nearusdt','suiusdt'];

const COIN_MAP: Record<string, string> = {
  btcusdt:'BTC', ethusdt:'ETH', solusdt:'SOL', xrpusdt:'XRP',
  bnbusdt:'BNB', nearusdt:'NEAR', suiusdt:'SUI',
};

const STREAMS  = SYMBOLS.map(s => `${s}@aggTrade`).join('/');
const WS_URL   = `wss://fstream.binance.com/stream?streams=${STREAMS}`;

const MIN_USD  = 50_000;      // $50K  - large trade threshold
const BIG_USD  = 200_000;     // $200K - whale
const MEGA_USD = 1_000_000;   // $1M   - mega whale
const FEED_MAX = 30;
const STATS_WIN = 60 * 60 * 1000; // 1h

let idCtr = 0;

interface WhaleTrade {
  id:    number;
  coin:  string;
  side:  'BUY' | 'SELL';
  usd:   number;
  price: number;
  ts:    number;
}

interface Stats {
  buyUsd:  number;
  sellUsd: number;
  count:   number;
}

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function WhaleTradesFeed() {
  const [feed,     setFeed]     = useState<WhaleTrade[]>([]);
  const [stats,    setStats]    = useState<Stats>({ buyUsd: 0, sellUsd: 0, count: 0 });
  const [status,   setStatus]   = useState<'connecting' | 'live' | 'error'>('connecting');
  const [msgCount, setMsgCount] = useState(0);
  const wsRef      = useRef<WebSocket | null>(null);
  const historyRef = useRef<WhaleTrade[]>([]);
  const msgRef     = useRef(0);

  function rebuildStats(history: WhaleTrade[]) {
    const cutoff = Date.now() - STATS_WIN;
    const win    = history.filter(t => t.ts >= cutoff);
    setStats({
      buyUsd:  win.filter(t => t.side === 'BUY').reduce((s, t) => s + t.usd, 0),
      sellUsd: win.filter(t => t.side === 'SELL').reduce((s, t) => s + t.usd, 0),
      count:   win.length,
    });
  }

  function connect() {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen  = () => setStatus('live');
    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      setStatus('error');
      setTimeout(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
      }, 3000);
    };

    ws.onmessage = (ev) => {
      try {
        msgRef.current += 1;
        if (msgRef.current % 50 === 0) setMsgCount(msgRef.current);
        const msg = JSON.parse(ev.data as string);
        const d   = msg?.data;
        if (d?.e !== 'aggTrade') return;

        const price = parseFloat(d.p);
        const qty   = parseFloat(d.q);
        const usd   = price * qty;
        if (usd < MIN_USD || !isFinite(usd)) return;

        /* m = true → buyer is maker → aggressor was a SELLER (market sell)
           m = false → buyer is taker → aggressor was a BUYER  (market buy) */
        const side: 'BUY' | 'SELL' = d.m ? 'SELL' : 'BUY';
        const symbol = ((d.s ?? '') as string).toLowerCase();
        const coin   = COIN_MAP[symbol] ?? symbol.replace('usdt', '').toUpperCase();

        const trade: WhaleTrade = { id: ++idCtr, coin, side, usd, price, ts: Date.now() };
        historyRef.current = [...historyRef.current, trade].slice(-2000);
        rebuildStats(historyRef.current);
        setFeed(prev => [trade, ...prev].slice(0, FEED_MAX));
      } catch { /* ignore parse errors */ }
    };
  }

  useEffect(() => {
    connect();
    const iv = setInterval(() => rebuildStats(historyRef.current), 30_000);
    return () => { clearInterval(iv); wsRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const netFlow  = stats.buyUsd - stats.sellUsd;
  const totalUsd = stats.buyUsd + stats.sellUsd;
  const netBull  = totalUsd > 0 && netFlow > totalUsd * 0.2;
  const netBear  = totalUsd > 0 && netFlow < -(totalUsd * 0.2);

  return (
    <div className="wf-wrap">
      {/* Header */}
      <div className="wf-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)' }}>
            <Tip text="Live single trades over $50K on Binance futures. Large clusters of buys or sells often signal institutional positioning before smaller traders react.">Whale Trades</Tip>
          </span>
          <span className={`wf-dot wf-dot-${status}`} title={status} />
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>All markets · &gt;$50K · {msgCount > 0 ? `${msgCount} msgs` : 'waiting…'}</span>
      </div>

      {/* Stats bar */}
      <div className="wf-stats">
        <div className="wf-stat">
          <span className="wf-stat-lbl">Whale Buys (1h)</span>
          <span className="wf-stat-val" style={{ color: '#22d3ee' }}>{fmtUSD(stats.buyUsd)}</span>
        </div>
        <div className="wf-stat-sep" />
        <div className="wf-stat" style={{ textAlign: 'center' }}>
          <span className="wf-stat-lbl">Net Flow</span>
          <span className="wf-stat-val" style={{ color: netFlow >= 0 ? '#22d3ee' : '#f97316' }}>
            {netFlow >= 0 ? '+' : ''}{fmtUSD(Math.abs(netFlow))}
            <span style={{ fontSize: 'var(--fs-caption)', color: '#444', marginLeft: 3 }}>
              {netFlow >= 0 ? '↑' : '↓'}
            </span>
          </span>
        </div>
        <div className="wf-stat-sep" />
        <div className="wf-stat" style={{ textAlign: 'right' }}>
          <span className="wf-stat-lbl">Whale Sells (1h)</span>
          <span className="wf-stat-val" style={{ color: '#f97316' }}>{fmtUSD(stats.sellUsd)}</span>
        </div>
      </div>

      {/* Bias bar */}
      {totalUsd > 0 && (
        <div className="wf-bias-wrap">
          <div className="wf-bias-bar wf-bias-buy"  style={{ width: `${(stats.buyUsd  / totalUsd) * 100}%` }} />
          <div className="wf-bias-bar wf-bias-sell" style={{ width: `${(stats.sellUsd / totalUsd) * 100}%` }} />
        </div>
      )}
      {totalUsd > 0 && (
        <div className="wf-bias-label">
          {netBull && <span style={{ color: '#22d3ee' }}>Whales net buying - institutional accumulation</span>}
          {netBear && <span style={{ color: '#f97316' }}>Whales net selling - institutional distribution</span>}
          {!netBull && !netBear && <span style={{ color: 'var(--txt3)' }}>Balanced whale flow - watching both sides</span>}
        </div>
      )}

      {/* Feed states */}
      {feed.length === 0 && status === 'connecting' && (
        <div style={{ padding: '10px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">Connecting to live trade feed…</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <SkeletonBar key={i} height={30} radius={8} style={{ opacity: 1 - i * 0.18 }} />
            ))}
          </div>
        </div>
      )}
      {feed.length === 0 && status === 'live' && (
        <div style={{ padding: '10px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">Watching for trades &gt; $50K…</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <SkeletonBar key={i} height={30} radius={8} style={{ opacity: 1 - i * 0.18 }} />
            ))}
          </div>
        </div>
      )}

      {/* Feed list */}
      <div className="wf-list">
        {feed.map(t => {
          const isBuy  = t.side === 'BUY';
          const isMega = t.usd >= MEGA_USD;
          const isBig  = t.usd >= BIG_USD;
          const accent = isBuy ? '#22d3ee' : '#f97316';
          const badge  = isMega ? 'MEGA' : isBig ? 'WHALE' : t.side;

          return (
            <div
              key={t.id}
              className={`wf-row${isBig ? ' wf-row-big' : ''}`}
              style={{ borderLeftColor: accent }}
            >
              <span className="wf-row-coin"  style={{ color: accent }}>{t.coin}</span>
              <span className={`wf-row-side wf-row-side-${isBuy ? 'buy' : 'sell'}`}>{badge}</span>
              <span className="wf-row-usd"   style={{ color: isBig ? accent : '#8e8e93' }}>
                {fmtUSD(t.usd)}
              </span>
              <span className="wf-row-price">${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              <span className="wf-row-time">{fmtTime(t.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
