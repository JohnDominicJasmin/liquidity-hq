'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarket, classifyFunding, CoinId, computeSqueezeScore, computeFibLevels } from '@/lib/marketStore';
import { buildPrompt, callGrok, GrokResult, GrokContext } from '@/lib/grok';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';
import SetupScanner from '@/components/SetupScanner';
import ConfluenceScorer from '@/components/ConfluenceScorer';
import GrokSignalChart from '@/components/GrokSignalChart';

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

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'];
const GROK_API_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';

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
  const [selectedCoin, setSelectedCoin] = useState<CoinId>('btc');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GrokResult | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistItem[]>([]);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
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
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
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
      rsi1h, rsi4h, cvd, basis, fibNearest, orderWalls, squeezeScore,
      pcRatio, maxPain, btcGex,
      exchangeNetFlow, stablecoinFlow, googleTrends, liqLevels, btcDomTrend,
      pocLine, dxyLine, spxLine, goldLine,
      cbPremium, vwap, oiTrend, takerRatio, crossExchangeFunding,
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
      setDetailIdx(null); // collapse any open detail when new result comes in
      setHistory(h => [{
        signal: res.signal,
        confidence: res.confidence,
        coin: ctx.coin,
        time: new Date().toLocaleTimeString(),
        entry: res.entry,
        reasoning: res.reasoning,
        session: ctx.session,
      }, ...h].slice(0, 10));
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

      {/* Run signal + Ask Grok — side by side, auto width */}
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button className="arena-fire-btn" disabled={loading} onClick={fire}
          style={{ width: 'auto', marginBottom: 0 }}>
          {loading ? '⚡ Thinking...' : '⚡ Run Full Signal'}
        </button>
        <button
          className="arena-ask-grok-btn"
          style={{ width: 'auto', marginBottom: 0 }}
          onClick={() => window.dispatchEvent(new CustomEvent('grok-chat', {
            detail: {
              coin: selectedCoin,
              prompt: `Give me a complete analysis of ${selectedCoin.toUpperCase()}/USDT right now. What's the trend, key levels, directional bias, best entry if any, and should I trade or wait?`,
            },
          }))}
        >
          💬 Ask Grok
        </button>
      </div>

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
            <div className="arena-reasoning-text"><ReasoningText text={result.reasoning} /></div>
          </div>
        </div>
      )}

      {/* ── DATA CONTEXT (collapsible) ── */}
      <div className="arena-context" style={{ marginTop: 8 }}>
        <div
          className="arena-context-title"
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ctxOpen ? 8 : 0 }}
          onClick={() => setCtxOpen(v => !v)}
        >
          <span>
            {selectedCoin.toUpperCase()} · {[ctx.rsi14, ctx.rsi1h, ctx.rsi4h, ctx.cvd, ctx.basis, ctx.orderWalls, ctx.pcRatio, ctx.exchangeNetFlow, ctx.cbPremium, ctx.vwap, ctx.oiTrend, ctx.takerRatio, ctx.btcGex].filter(v => v !== '—' && v !== 'Calculating…').length + 21} signals loaded
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
      <ConfluenceScorer coin={selectedCoin} onRunSignal={(coin) => { setSelectedCoin(coin); }} />

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
