'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarket, classifyFunding, CoinId, computeSqueezeScore, computeFibLevels } from '@/lib/marketStore';
import { buildPrompt, callGrok, GrokResult, GrokContext } from '@/lib/grok';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'];
const GROK_API_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';

interface HistItem { signal: string; confidence: number; coin: string; time: string; }

export default function Arena() {
  const { store } = useMarket();
  const { latestHeadlines, econEvents } = useNews();
  const [selectedCoin, setSelectedCoin] = useState<CoinId>('btc');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GrokResult | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const notifCooldown = useRef<Set<string>>(new Set());

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

    /* Macro */
    const oilPrice = store.oilPrice != null ? '$' + store.oilPrice.toFixed(2) + '/bbl' : '—';
    const bonds10y = store.bonds10y != null ? store.bonds10y.toFixed(3) + '%' : '—';

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
      rsi1h, rsi4h, cvd, basis, fibNearest, orderWalls, squeezeScore,
      pcRatio, maxPain, exchangeNetFlow, stablecoinFlow, googleTrends, liqLevels, btcDomTrend,
    };
  };

  const fire = async () => {
    setLoading(true); setError(''); setResult(null);
    const msgs = [
      'Grok is reading technicals and multi-TF RSI...',
      'Searching X for Trump posts & crypto news...',
      'Checking ETF flows, options, liquidation levels...',
      'Analysing CVD, order book, squeeze score...',
      'Formulating the hunt thesis...',
    ];
    let mi = 0;
    setLoadingMsg(msgs[mi]);
    const msgTimer = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 2000);
    try {
      const ctx = gatherContext();
      const res = await callGrok(GROK_API_KEY, buildPrompt(ctx));
      setResult(res);
      setHistory(h => [{ signal: res.signal, confidence: res.confidence, coin: ctx.coin, time: new Date().toLocaleTimeString() }, ...h].slice(0, 8));
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        getSupabase()!.from('signals').insert({
          coin: ctx.coin, signal: res.signal, confidence: res.confidence,
          entry_zone: res.entry, reasoning: res.reasoning, session: ctx.session,
        }).then(() => {});
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      clearInterval(msgTimer); setLoading(false);
    }
  };

  const ctx = gatherContext();
  const sq = computeSqueezeScore(store.coins[selectedCoin]);

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8' }}>AI Arena</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em' }}>GROK-4.3 + LIVE X</span>
        </div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>29-signal engine — technicals · derivatives · options · macro · ETF · on-chain · social → LONG / SHORT / FLAT</div>
      </div>

      {/* Coin selector + notification bell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
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

      {/* Squeeze score bar */}
      <div className="arena-squeeze-card">
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

      {/* Live context panel — collapsible */}
      <div className="arena-context" style={{ marginBottom: 14 }}>
        <div
          className="arena-context-title"
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ctxOpen ? 8 : 0 }}
          onClick={() => setCtxOpen(v => !v)}
        >
          <span>
            {selectedCoin.toUpperCase()} · {[ctx.rsi14, ctx.rsi1h, ctx.rsi4h, ctx.cvd, ctx.basis, ctx.orderWalls, ctx.pcRatio, ctx.exchangeNetFlow].filter(v => v !== '—').length + 21} signals loaded
          </span>
          <span style={{ fontSize: 9, color: '#444' }}>{ctxOpen ? '▲ hide' : '▼ show context'}</span>
        </div>
        {ctxOpen && [
          ['Coin', ctx.coin], ['Price', ctx.price], ['24h Δ', ctx.change24h],
          ['RSI 15m', ctx.rsi14], ['RSI 1h', ctx.rsi1h], ['RSI 4h', ctx.rsi4h],
          ['MA20 (15m)', ctx.ma20], ['vs MA20', ctx.priceVsMA],
          ['Vol Ratio', ctx.volRatio], ['CVD', ctx.cvd],
          ['L/S Ratio', ctx.longShortRatio], ['Squeeze', squeezeToLine(sq)],
          ['Funding', ctx.fundingRate], ['Open Interest', ctx.openInterest],
          ['Basis', ctx.basis], ['Fib Level', ctx.fibNearest],
          ['Order Walls', ctx.orderWalls.length > 55 ? ctx.orderWalls.slice(0, 55) + '…' : ctx.orderWalls],
          ['P/C Ratio', ctx.pcRatio], ['Max Pain', ctx.maxPain],
          ['Oil (CL=F)', ctx.oilPrice], ['10Y Yield', ctx.bonds10y],
          ['ETF Flows', ctx.etfFlows],
          ['Exch. Flow', ctx.exchangeNetFlow],
          ['Stablecoin', ctx.stablecoinFlow],
          ['G. Trends', ctx.googleTrends],
          ['Liq Levels', ctx.liqLevels],
          ['Fear & Greed', ctx.fearGreed], ['BTC Dom', ctx.btcDomTrend],
          ['X / Social', 'Grok searches X live'],
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

      <button className="arena-fire-btn" disabled={loading} onClick={fire}>
        {loading ? '⚡ Grok is thinking...' : '⚡ Run Grok Signal'}
      </button>

      {loading && (
        <div className="arena-loading">
          <div className="arena-loading-dots">···</div>
          <div className="arena-loading-text">{loadingMsg}</div>
        </div>
      )}

      {error && <div className="arena-err">{error}</div>}

      {result && (
        <div className={`arena-signal-card sig-${result.signal.toLowerCase()}`}>
          <div className="arena-sig-top">
            <div>
              <div className="arena-sig-pair">{ctx.coin}</div>
              <div className="arena-sig-time">{new Date().toLocaleTimeString()}</div>
            </div>
            <span className={`arena-sig-badge badge-${result.signal.toLowerCase()}`}>
              {result.signal === 'LONG' ? '▲ LONG' : result.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
            </span>
          </div>
          <div className="arena-sig-stats">
            <div className="arena-stat"><div className="arena-stat-label">Confidence</div><div className="arena-stat-val">{result.confidence}%</div></div>
            <div className="arena-stat"><div className="arena-stat-label">Entry Zone</div><div className="arena-stat-val" style={{ fontSize: 12 }}>{result.entry}</div></div>
            <div className="arena-stat"><div className="arena-stat-label">Session</div><div className="arena-stat-val" style={{ fontSize: 12 }}>{ctx.session}</div></div>
          </div>
          <div className="arena-conf-bar">
            <div className="arena-conf-fill" style={{
              width: result.confidence + '%',
              background: result.signal === 'LONG' ? '#7de0a4' : result.signal === 'SHORT' ? '#ff9a92' : '#606060',
            }} />
          </div>
          <div className="arena-reasoning">
            <div className="arena-reasoning-title">Reasoning</div>
            <div className="arena-reasoning-text">{result.reasoning}</div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#444', marginBottom: 8 }}>Session history</div>
          {history.map((h, i) => (
            <div key={i} className="arena-hist-item">
              <div className="arena-hist-left">
                <span className={`arena-hist-badge tag ${h.signal === 'LONG' ? 'tg' : h.signal === 'SHORT' ? 'tr' : 'tp'}`}>
                  {h.signal === 'LONG' ? '▲ LONG' : h.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
                </span>
                <div>
                  <div className="arena-hist-pair">{h.coin}</div>
                  <div className="arena-hist-time">{h.time}</div>
                </div>
              </div>
              <div className="arena-hist-conf">{h.confidence}%</div>
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
