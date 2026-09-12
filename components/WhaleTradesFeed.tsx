'use client';
import { useEffect, useRef, useState } from 'react';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import { nextSource, stableEnoughToSwitchBack, connectTimedOut } from '@/lib/exchangeFailover';

/* ── Binance futures combined aggTrade stream, Bybit publicTrade on failover ──
   #1059: client-side failover - a browser that cannot reach Binance (blocked
   region, 451/403, refused handshake) gets the same trades from Bybit instead
   of a feed that silently stops. Server-side egress failover is #1077, a
   separate scope on purpose. None of these 7 coins are Bybit's 1000x-prefixed
   symbols (see lib/coins.ts bybitPriceFactor), so usd = price * qty is correct
   unscaled on either exchange - no factor to apply here. */
const COIN_IDS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'near', 'sui'] as const;

const BN_SYMBOLS = COIN_IDS.map(c => BINANCE_SYMS[c].toLowerCase());
const BN_COIN_MAP: Record<string, string> = Object.fromEntries(
  COIN_IDS.map(c => [BINANCE_SYMS[c].toLowerCase(), c.toUpperCase()])
);
const BN_STREAMS = BN_SYMBOLS.map(s => `${s}@aggTrade`).join('/');
const BN_WS_URL  = `wss://fstream.binance.com/stream?streams=${BN_STREAMS}`;

const BB_SYM_MAP: Record<string, string> = Object.fromEntries(
  COIN_IDS.map(c => [BYBIT_SYMS[c], c.toUpperCase()])
);
const BB_TOPICS = COIN_IDS.map(c => `publicTrade.${BYBIT_SYMS[c]}`);

const BN_MAX_RETRIES = 5;       // same shape as MarketProvider's ticker WS failover
const BN_RETRY_WHILE_ON_BB_MS = 60_000; // how often to re-try Binance while parked on Bybit
// PR #1228 / QA's hysteresis ask: Binance must stay open this long before a
// switch back commits, so a Binance connection that opens then drops within
// a second or two doesn't bounce the feed between exchanges on every blip.
const BN_STABLE_MS = 3_000;
// PR #1228 review (PM/DevOps): a connect attempt this old without an onopen
// is treated as failed even if neither onerror nor onclose ever fires - a
// blackholed connection (dropped packets, no TCP RST) can otherwise leave
// the feed dead for as long as the OS's own TCP timeout, far longer than a
// user should wait for a failover that already exists.
const BN_CONNECT_TIMEOUT_MS = 10_000;

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
  const { t } = useLabels();
  const [feed,     setFeed]     = useState<WhaleTrade[]>([]);
  const [stats,    setStats]    = useState<Stats>({ buyUsd: 0, sellUsd: 0, count: 0 });
  const [status,   setStatus]   = useState<'connecting' | 'live' | 'error'>('connecting');
  const [source,   setSource]   = useState<'binance' | 'bybit'>('binance');
  const [msgCount, setMsgCount] = useState(0);
  const historyRef = useRef<WhaleTrade[]>([]);
  const msgRef     = useRef(0);

  function rebuildStats(history: WhaleTrade[]) {
    const cutoff = Date.now() - STATS_WIN;
    const win    = history.filter(trade => trade.ts >= cutoff);
    setStats({
      buyUsd:  win.filter(trade => trade.side === 'BUY').reduce((s, trade) => s + trade.usd, 0),
      sellUsd: win.filter(trade => trade.side === 'SELL').reduce((s, trade) => s + trade.usd, 0),
      count:   win.length,
    });
  }

  function addTrade(coin: string, side: 'BUY' | 'SELL', usd: number, price: number) {
    if (usd < MIN_USD || !isFinite(usd)) return;
    msgRef.current += 1;
    if (msgRef.current % 50 === 0) setMsgCount(msgRef.current);
    const trade: WhaleTrade = { id: ++idCtr, coin, side, usd, price, ts: Date.now() };
    historyRef.current = [...historyRef.current, trade].slice(-2000);
    rebuildStats(historyRef.current);
    setFeed(prev => [trade, ...prev].slice(0, FEED_MAX));
  }

  useEffect(() => {
    let alive = true;
    let bnWs: WebSocket | null = null;
    let bbWs: WebSocket | null = null;
    let bnRetries = 0;
    let bbHostIdx = 0;
    let bbRetryTimer: ReturnType<typeof setInterval> | null = null;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    let active: 'binance' | 'bybit' = 'binance';

    function connectBN() {
      if (!alive) return;
      const ws = new WebSocket(BN_WS_URL);
      bnWs = ws;
      const attemptStartedAt = Date.now();
      // #1228 review: onerror, onclose and the connect timeout below all
      // reach the same failure path, and must count as ONE failure, not up
      // to three - a real close typically follows error, and the timeout
      // must not double-fire once one of the others already has.
      let settled = false;

      const timeoutTimer = setTimeout(() => {
        if (settled || !connectTimedOut(attemptStartedAt, Date.now(), BN_CONNECT_TIMEOUT_MS)) return;
        settled = true;
        try { ws.close(); } catch { /* */ }
        handleFailure();
      }, BN_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (settled) return;
        clearTimeout(timeoutTimer);
        if (!alive) return;
        bnRetries = 0;
        setStatus('live');
        if (active !== 'bybit') { active = 'binance'; return; }
        // Recovering from Bybit - don't commit the switch back immediately
        // (PR #1228 hysteresis ask). Bybit keeps running until Binance has
        // proven stable for BN_STABLE_MS; a drop before then just cancels
        // the pending switch and leaves Bybit as the active source.
        const openedAt = Date.now();
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          confirmTimer = null;
          if (!alive || bnWs !== ws) return; // this socket is no longer current
          if (!stableEnoughToSwitchBack(openedAt, Date.now(), BN_STABLE_MS)) return;
          active = 'binance';
          setSource('binance');
          if (bbRetryTimer) { clearInterval(bbRetryTimer); bbRetryTimer = null; }
          if (bbWs) { const old = bbWs; bbWs = null; try { old.close(); } catch { /* */ } }
        }, BN_STABLE_MS);
      };
      // #1228 review: onerror used to only call ws.close() and hope onclose
      // followed. Confirmed live (this PR's own review) that a browser can
      // fire error without ever following it with close - so error now
      // drives the failure path directly, guarded by `settled` the same way
      // the timeout is, rather than depending on a second event that may
      // never come.
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        try { ws.close(); } catch { /* */ }
        handleFailure();
      };
      ws.onclose = () => {
        if (settled) return; // error or the timeout already handled this attempt
        settled = true;
        clearTimeout(timeoutTimer);
        handleFailure();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          const d   = msg?.data;
          if (d?.e !== 'aggTrade') return;
          const price  = parseFloat(d.p);
          const qty    = parseFloat(d.q);
          const symbol = ((d.s ?? '') as string).toLowerCase();
          const coin   = BN_COIN_MAP[symbol] ?? symbol.replace('usdt', '').toUpperCase();
          /* m = true → buyer is maker → aggressor was a SELLER (market sell)
             m = false → buyer is taker → aggressor was a BUYER  (market buy) */
          const side: 'BUY' | 'SELL' = d.m ? 'SELL' : 'BUY';
          addTrade(coin, side, price * qty, price);
        } catch { /* ignore parse errors */ }
      };

      function handleFailure() {
        if (!alive) return;
        setStatus('error');
        if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        bnRetries++;
        // #1059: Binance exhausted its retries - fail over to Bybit for the
        // same coins rather than leaving the feed dead. Keep retrying Binance
        // in the background so a recovered connection can take back over.
        const decided = nextSource(active, bnRetries, BN_MAX_RETRIES);
        if (decided === 'bybit') {
          if (active !== 'bybit') {
            active = 'bybit';
            setSource('bybit');
            connectBB();
            if (!bbRetryTimer) {
              bbRetryTimer = setInterval(() => { bnRetries = 0; connectBN(); }, BN_RETRY_WHILE_ON_BB_MS);
            }
          }
          // else: already parked on Bybit - the background bbRetryTimer owns
          // the next attempt, so don't also fast-retry here.
          return;
        }
        setTimeout(connectBN, 2000 * bnRetries);
      }
    }

    function connectBB() {
      if (!alive || active !== 'bybit') return;
      // bytick.com is Bybit's alternative domain - same failover host pattern
      // as LiqFeed.tsx's connectBB, which this mirrors.
      const host = bbHostIdx % 2 === 0
        ? 'wss://stream.bybit.com/v5/public/linear'
        : 'wss://stream.bytick.com/v5/public/linear';
      const ws = new WebSocket(host);
      bbWs = ws;
      ws.onopen = () => {
        if (!alive) return;
        setStatus('live');
        ws.send(JSON.stringify({ op: 'subscribe', args: BB_TOPICS }));
      };
      ws.onerror = () => { try { ws.close(); } catch { /* */ } };
      ws.onclose = () => {
        // Torn down deliberately by connectBN's onopen once Binance recovers -
        // `active` already flipped back before that close(), so this must not
        // reconnect a fallback that is no longer wanted.
        if (!alive || active !== 'bybit') return;
        setStatus('error');
        bbHostIdx++;
        setTimeout(connectBB, 5000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.op === 'subscribe') return; // subscription ack, not a trade
          if (!msg.topic?.startsWith('publicTrade.') || !Array.isArray(msg.data)) return;
          msg.data.forEach((d: Record<string, string>) => {
            const price = parseFloat(d.p ?? '0');
            const qty   = parseFloat(d.v ?? '0');
            const coin  = BB_SYM_MAP[d.s ?? ''] ?? (d.s ?? '').replace('USDT', '');
            // Bybit's S is the TAKER's own side directly - Buy/Sell, no
            // maker-flag inversion the way Binance's `m` needs.
            const side: 'BUY' | 'SELL' = d.S === 'Buy' ? 'BUY' : 'SELL';
            addTrade(coin, side, price * qty, price);
          });
        } catch { /* ignore parse errors */ }
      };
    }

    connectBN();
    const iv = setInterval(() => rebuildStats(historyRef.current), 30_000);
    return () => {
      alive = false;
      clearInterval(iv);
      if (bbRetryTimer) clearInterval(bbRetryTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
      try { bnWs?.close(); } catch { /* */ }
      try { bbWs?.close(); } catch { /* */ }
    };
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
            <Tip text={t('WHALE_TRADES_FEED_TOOLTIP')}>{t('WHALE_TRADES_FEED_TITLE')}</Tip>
          </span>
          <span className={`wf-dot wf-dot-${status}`} title={source === 'bybit' ? `${status} - bybit` : status} />
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('WHALE_TRADES_FEED_ALL_MARKETS')} {msgCount > 0 ? t('WHALE_TRADES_FEED_MSG_COUNT', { count: msgCount }) : t('WHALE_TRADES_FEED_WAITING')}
          {/* #1059: honest label - a silent failover must say which exchange a trade came from */}
          {source === 'bybit' && <> {t('WHALE_TRADES_FEED_BYBIT_FALLBACK')}</>}
        </span>
      </div>

      {/* Stats bar */}
      <div className="wf-stats">
        <div className="wf-stat">
          <span className="wf-stat-lbl">{t('WHALE_TRADES_FEED_STAT_BUYS')}</span>
          <span className="wf-stat-val" style={{ color: 'var(--green)' }}>{fmtUSD(stats.buyUsd)}</span>
        </div>
        <div className="wf-stat-sep" />
        <div className="wf-stat" style={{ textAlign: 'center' }}>
          <span className="wf-stat-lbl">{t('WHALE_TRADES_FEED_STAT_NET_FLOW')}</span>
          <span className="wf-stat-val" style={{ color: netFlow >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {netFlow >= 0 ? '+' : ''}{fmtUSD(Math.abs(netFlow))}
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', marginLeft: 3 }}>
              {netFlow >= 0 ? '↑' : '↓'}
            </span>
          </span>
        </div>
        <div className="wf-stat-sep" />
        <div className="wf-stat" style={{ textAlign: 'right' }}>
          <span className="wf-stat-lbl">{t('WHALE_TRADES_FEED_STAT_SELLS')}</span>
          <span className="wf-stat-val" style={{ color: 'var(--red)' }}>{fmtUSD(stats.sellUsd)}</span>
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
          {netBull && <span style={{ color: 'var(--green)' }}>{t('WHALE_TRADES_FEED_BIAS_NET_BUY')}</span>}
          {netBear && <span style={{ color: 'var(--red)' }}>{t('WHALE_TRADES_FEED_BIAS_NET_SELL')}</span>}
          {!netBull && !netBear && <span style={{ color: 'var(--txt3)' }}>{t('WHALE_TRADES_FEED_BIAS_BALANCED')}</span>}
        </div>
      )}

      {/* Feed states */}
      {feed.length === 0 && status === 'connecting' && (
        <div style={{ padding: '10px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">{t('WHALE_TRADES_FEED_SR_CONNECTING')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <SkeletonBar key={i} height={30} radius={8} style={{ opacity: 1 - i * 0.18 }} />
            ))}
          </div>
        </div>
      )}
      {feed.length === 0 && status === 'live' && (
        <div style={{ padding: '10px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">{t('WHALE_TRADES_FEED_SR_WATCHING')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <SkeletonBar key={i} height={30} radius={8} style={{ opacity: 1 - i * 0.18 }} />
            ))}
          </div>
        </div>
      )}

      {/* Feed list */}
      <div className="wf-list">
        {feed.map(trade => {
          const isBuy  = trade.side === 'BUY';
          const isMega = trade.usd >= MEGA_USD;
          const isBig  = trade.usd >= BIG_USD;
          const accent = isBuy ? 'var(--green)' : 'var(--red)';
          const badge  = isMega ? t('WHALE_TRADES_FEED_BADGE_MEGA') : isBig ? t('WHALE_TRADES_FEED_BADGE_WHALE') : trade.side;

          return (
            <div
              key={trade.id}
              className={`wf-row${isBig ? ' wf-row-big' : ''}`}
              style={{ borderLeftColor: accent }}
            >
              <span className="wf-row-coin"  style={{ color: accent }}>{trade.coin}</span>
              <span className={`wf-row-side wf-row-side-${isBuy ? 'buy' : 'sell'}`}>{badge}</span>
              <span className="wf-row-usd"   style={{ color: isBig ? accent : 'var(--txt-dim)' }}>
                {fmtUSD(trade.usd)}
              </span>
              <span className="wf-row-price">${trade.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              <span className="wf-row-time">{fmtTime(trade.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
