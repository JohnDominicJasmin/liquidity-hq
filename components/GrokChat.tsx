'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  useMarket, CoinId, COINS, computeSqueezeScore, classifyFunding,
} from '@/lib/marketStore';
import { getSessionName } from '@/lib/session';
import { useNews, GeoEvent } from '@/components/NewsProvider';
import { useAuth } from '@/components/AuthProvider';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { Warn } from '@/components/icons';
import { getSupabase } from '@/lib/supabase';
import { nextResetLocalTime } from '@/lib/resetTime';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  followUps?: string[];  // suggested follow-up question chips
}

interface SavedConvo {
  id: string;
  coin: CoinId;
  title: string;   // first user message, truncated
  messages: Msg[];
  ts: number;      // Date.now()
}

/* ── localStorage helpers ──────────────────────────────────────── */
const HIST_KEY   = 'grok-chat-history-v1';
const MAX_CONVOS = 40;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function loadHistory(): SavedConvo[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]'); } catch { return []; }
}
function persistHistory(convos: SavedConvo[]) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(convos.slice(0, MAX_CONVOS))); } catch {}
}
function relTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  const h = Math.floor(d / 3600000);
  const dy = Math.floor(d / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy < 7) return `${dy}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ── Auth token helper ─────────────────────────────────────────── */
async function getAuthToken(): Promise<string | undefined> {
  const sb = getSupabase();
  if (!sb) return undefined;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token;
}

/* ── Generate follow-up question chips via Grok (cheap — no search needed) ── */
async function generateFollowUps(response: string, coin: string, token?: string): Promise<string[]> {
  if (!response || !token) return [];
  try {
    const res = await fetch('/api/grok-chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        mode:       'chat',
        model:      'grok-4.3',
        max_tokens: 100,
        messages: [{
          role:    'user',
          content: `Based on this ${coin.toUpperCase()} trading analysis, write exactly 3 short follow-up questions a trader would ask next. Each question must be 4–8 words. Output ONLY the 3 questions, one per line, no numbering, no bullets, no extra text.\n\n${response.slice(0, 600)}`,
        }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    return text
      .split('\n')
      .map((q: string) => q.trim().replace(/^\d+[\.\)]\s*/, '').replace(/^[-•]\s*/, ''))
      .filter((q: string) => q.length > 5 && q.length < 100)
      .slice(0, 3);
  } catch { return []; }
}

/* ── Markdown renderer ─────────────────────────────────────────── */
function renderMd(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Citations [[1]](url)
  s = s.replace(/\[\[([^\]]+)\]\]\((https?:\/\/[^)]+)\)/g,
    (_, n, u) => `<sup><a href="${u}" target="_blank" rel="noopener">[${n}]</a></sup>`);
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  // Bare URLs
  s = s.replace(/(^|[\s(])((https?:\/\/)[^\s)]+)/g,
    (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  // Bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Headings
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');
  // Bullets
  s = s.replace(/^[-•]\s+(.+)$/gm, '&bull; $1');
  // Numbered list
  s = s.replace(/^\d+\.\s+(.+)$/gm, (_, i) => `&emsp;${i}`);
  // Newlines
  s = s.replace(/\n{2,}/g, '<br/><br/>');
  s = s.replace(/\n/g, '<br/>');
  return s;
}

/* ── Smart detectors ──────────────────────────────────────────── */

// Auto-enable live search when message clearly needs current web data
const SEARCH_TRIGGERS = [
  // Questions about why / what
  'why', 'what happened', 'happening', 'reason', 'cause', 'catalyst',
  // Time-anchored
  'today', 'right now', 'just now', 'recently', 'yesterday', 'this week', 'latest',
  // News / narrative
  'news', 'narrative', 'breaking', 'announcement',
  // People / institutions
  'trump', 'elon', 'powell', 'jerome', 'blackrock', 'saylor',
  // Macro events
  'fed', 'fomc', 'cpi', 'ppi', 'nfp', 'jobs', 'inflation', 'gdp',
  'rate cut', 'rate hike', 'interest rate', 'tariff', 'sanction',
  // Geo / political
  'war', 'conflict', 'russia', 'ukraine', 'china', 'japan', 'boj', 'yen',
  // Crypto-specific events
  'etf', 'sec', 'regulation', 'hack', 'exploit', 'halving',
  'binance', 'coinbase', 'bybit', 'okx',
  'liquidation', 'liquidated', 'whale',
  'dump', 'dumping', 'pump', 'pumping', 'crash', 'crashing', 'rally',
  'stablecoin', 'usdt', 'usdc',
];
function needsLiveSearch(text: string): boolean {
  const t = text.toLowerCase();
  return SEARCH_TRIGGERS.some(k => t.includes(k));
}

// Educational questions don't need the full market snapshot — saves ~350 tokens
const EDUCATIONAL_TRIGGERS = [
  'what is', 'what are', 'what does', 'explain', 'how does', 'how do',
  'define', 'meaning', 'tell me about', 'difference between', 'how to',
  'what\'s the difference', 'why do traders',
];
function isEducational(text: string): boolean {
  const t = text.toLowerCase();
  return EDUCATIONAL_TRIGGERS.some(k => t.includes(k));
}

/* ── Minimal context for educational questions (~20 tokens vs ~400) ── */
function buildMinimalCtx(
  store: ReturnType<typeof useMarket>['store'],
  coin: CoinId,
): string {
  const c = store.coins[coin];
  return [
    'You are an elite crypto trading analyst assistant embedded in Liquidity Hunter HQ.',
    'Answer concisely and directly. Flag uncertainty.',
    `Coin: ${coin.toUpperCase()}/USDT` + (c?.price ? ` · Price: $${c.price.toLocaleString()}` : ''),
  ].join('\n');
}

/* ── Quick prompts ─────────────────────────────────────────────── */
const QUICK = [
  'Full analysis now',
  'Best entry zone?',
  'Key risks?',
  'Where to set stop?',
  'Trade now or wait?',
  'Any whale activity?',
  'What are liq levels?',
  'Trend direction?',
];

/* ── System context builder ────────────────────────────────────── */
function buildSystemCtx(
  store: ReturnType<typeof useMarket>['store'],
  coin: CoinId,
  latestHeadlines: string[],
  geoEvents: GeoEvent[],
): string {
  const c   = store.coins[coin];
  const sq  = computeSqueezeScore(c);
  const fr  = c?.fundingRate != null ? classifyFunding(c.fundingRate) : null;
  const session = getSessionName(new Date());
  const ln  = (k: string, v: string) => `${k}: ${v}`;
  return [
    'You are an elite crypto derivatives trader and analyst assistant embedded in Liquidity Hunter HQ.',
    'The trader asks short, direct questions. Give concise, bullet-pointed, actionable answers.',
    'Flag when data is missing. Never invent numbers. Be honest about uncertainty.',
    '',
    `=== LIVE DATA — ${coin.toUpperCase()}/USDT ===`,
    ln('Price',         c?.price ? '$' + c.price.toLocaleString() : '—'),
    ln('24h Change',    c?.change != null ? (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%' : '—'),
    ln('High/Low',      c?.high && c?.low ? '$' + c.high.toLocaleString() + ' / $' + c.low.toLocaleString() : '—'),
    ln('RSI 15m/1h/4h/1D', [c?.rsi14, c?.rsi1h, c?.rsi4h, c?.rsiDaily].map(r => r?.toFixed(0) ?? '—').join(' / ')),
    ln('CVD Divergence',   c?.cvdDivergence
      ? c.cvdDivergence === 'bullish'
        ? 'BULLISH — price falling but net buying rising (smart money accumulating)'
        : 'BEARISH — price rising but net selling rising (distribution)'
      : 'None'),
    ln('MA20 (15m)',    c?.ma20 ? '$' + c.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'),
    ln('Vol ratio',     c?.volRatio ? c.volRatio.toFixed(2) + 'x' : '—'),
    ln('CVD (200)',     c?.cvd != null ? (c.cvd >= 0 ? '+' : '') + (c.cvd / 1000).toFixed(1) + 'K' : '—'),
    ln('Funding',       fr?.label ?? '—'),
    ln('Open Interest', c?.oi ? '$' + (c.oi / 1e9).toFixed(2) + 'B' : '—'),
    ln('Long/Short %',  c?.longRatio != null ? (c.longRatio * 100).toFixed(1) + '% / ' + ((c.shortRatio ?? 0) * 100).toFixed(1) + '%' : '—'),
    ln('Squeeze score', sq.score + '/100 — ' + sq.label),
    ln('Basis',         c?.perpPrice && c.price ? ((c.perpPrice - c.price) / c.price * 100).toFixed(4) + '%' : '—'),
    '',
    '=== EMA SIGNAL QUALITY FILTERS (apply before accepting any EMA cross signal) ===',
    'Before calling LONG or SHORT based on an EMA cross, ALL THREE of these filters must pass:',
    '1. EMA50 Slope: EMA50 must be trending in the signal direction over the last 5 bars (≥ 0.1% slope). Flat EMA50 = price is ranging = EMA cross is noise. Call FREEZE/FLAT instead.',
    '2. ATR Buffer: Price must close beyond EMA50 by at least 35% of ATR(14). A marginal 1-tick graze of EMA50 is not a confirmation — it will reverse. Only a meaningful body close clearing the buffer is valid.',
    '3. Ribbon Spread: EMA9 and EMA20 must be at least 0.3% of price apart. If the two lines are visually overlapping (tight spread), the ribbon is tangled = chop zone = the cross is noise. Call FREEZE/FLAT instead.',
    'If any filter fails → downgrade the signal: LONG → LEAN LONG, SHORT → LEAN SHORT, or FLAT if all fail.',
    'WaveTrend Confirming (Cipher B momentum, separate confirming layer — NOT a 4th mandatory filter): checks for a bullish/bearish divergence between price and the WaveTrend oscillator, or a recent cross from oversold/overbought agreeing with the signal direction. If it confirms, mention it as added confidence. If it does not confirm, do not auto-downgrade the signal — just note the momentum oscillator has not caught up yet, since it lags slightly behind the EMA cross by design.',
    ln('Order book',    c?.orderBidWalls ? 'Bids: ' + c.orderBidWalls.map(w => '$' + w.price.toLocaleString()).join(', ') : '—'),
    '',
    '=== MACRO ===',
    ln('Fear & Greed',      store.fng != null ? store.fng + ' (' + store.fngLabel + ')' : '—'),
    ln('BTC Dominance',     store.btcDom ? store.btcDom.toFixed(2) + '%' : '—'),
    ln('P/C Ratio',         store.btcPcRatio ? store.btcPcRatio.toFixed(2) : '—'),
    ln('Max Pain',          store.btcMaxPain ? '$' + store.btcMaxPain.toLocaleString() : '—'),
    ln('Stablecoin supply', store.stablecoinSupply ? '$' + store.stablecoinSupply.toFixed(1) + 'B' : '—'),
    ln('BTC ETF flow',      store.etfNetFlow != null ? (store.etfNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.etfNetFlow).toFixed(0) + 'M' : '—'),
    ln('ETH ETF flow',      store.ethEtfNetFlow != null ? (store.ethEtfNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.ethEtfNetFlow).toFixed(0) + 'M' : '—'),
    ln('Exchange net flow', store.btcExchangeNetFlow != null ? (store.btcExchangeNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.btcExchangeNetFlow).toFixed(1) + 'M' : '—'),
    ln('Google Trends',     store.googleTrendsBtc != null ? store.googleTrendsBtc + '/100' : '—'),
    ln('Session',           session),
    '',
    '=== LIVE NEWS FEED ===',
    latestHeadlines.length > 0
      ? latestHeadlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join('\n')
      : 'No alerts yet — use live search tools.',
    '',
    '=== GEOPOLITICAL EVENTS (last 12h) ===',
    geoEvents.length > 0
      ? geoEvents.slice(0, 5).map(g => `[${g.tag}] ${g.headline} (${g.timeStr})`).join('\n')
      : 'None detected — search X and web.',
    '',
    '=== SEARCH INSTRUCTIONS ===',
    'Use web_search and x_search proactively:',
    '1. WHY is the market moving right now — search "bitcoin price today why"',
    '2. Latest war/conflict/sanctions news affecting risk assets',
    '3. Fed, CPI, FOMC, Treasury statements (last 48h)',
    '4. Trump/White House crypto or tariff posts on X',
    '5. Exchange hacks, large liquidations, whale moves on X',
    'Always cite source and timestamp for significant findings.',
  ].join('\n');
}

/* ─────────────────────────────────────────────────────────────── */
export default function GrokChat() {
  const { store }                      = useMarket();
  const { latestHeadlines, geoEvents } = useNews();
  const { user }                       = useAuth();

  const [open,           setOpen]           = useState(false);
  const [expanded,       setExpanded]       = useState(false);
  const [liveSearch,     setLiveSearch]     = useState(false);
  const [histView,       setHistView]       = useState(false);
  const [coin,           setCoin]           = useState<CoinId>('btc');
  const [msgs,           setMsgs]           = useState<Msg[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [rateLimited,    setRateLimited]    = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { usage, setUsage }                 = useGrokUsage();

  /* conversation history */
  const [convos,     setConvos]     = useState<SavedConvo[]>([]);
  const currentIdRef                = useRef<string>(genId());

  const [fabVisible,    setFabVisible]    = useState(true);

  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const msgsRef        = useRef<HTMLDivElement>(null);
  const scrollTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Load history on mount ── */
  useEffect(() => { setConvos(loadHistory()); }, []);

  /* ── Hide FAB while scrolling (mobile only) ── */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onScroll = () => {
      if (!mq.matches || open) return;
      setFabVisible(false);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => setFabVisible(true), 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [open]);


  /* ── Auto-save current conversation whenever messages change ── */
  useEffect(() => {
    if (msgs.length === 0) return;
    const convo: SavedConvo = {
      id:       currentIdRef.current,
      coin,
      title:    msgs.find(m => m.role === 'user')?.content.slice(0, 50) ?? 'Chat',
      messages: msgs,
      ts:       Date.now(),
    };
    const updated = [convo, ...loadHistory().filter(c => c.id !== currentIdRef.current)];
    persistHistory(updated);
    setConvos(updated);
  }, [msgs, coin]);

  /* ── Scroll to bottom on new message ── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  /* ── Focus input when panel opens ── */
  useEffect(() => {
    if (open && !histView) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open, histView]);

  /* ── Send message ── */
  const sendMsg = useCallback(async (text: string, coinOverride?: CoinId) => {
    /* ── Auth gate: show login modal if not signed in ── */
    if (!user) {
      setOpen(true);
      setShowLoginModal(true);
      return;
    }

    const activeCoin = coinOverride ?? coin;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: Msg = { role: 'user', content: text, ts };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    setError('');
    setRateLimited(false);

    /* Get auth token for server-side proxy */
    const token = await getAuthToken();
    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

    try {
      // Auto-detect live search first — needed before context decision
      const autoSearch = !liveSearch && needsLiveSearch(text);
      const useSearch  = liveSearch || autoSearch;

      // Smart context: educational + no search = minimal (~20 tokens)
      // Anything with live search = full context so Grok can correlate web findings with live data
      const sysCtx = (isEducational(text) && !useSearch)
        ? buildMinimalCtx(store, activeCoin)
        : buildSystemCtx(store, activeCoin, latestHeadlines, geoEvents);

      // Cap at last 8 messages (4 pairs) — prevents token cost growing unbounded
      const apiMsgs  = history.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const messages = [{ role: 'system', content: sysCtx }, ...apiMsgs];

      let reply: string;

      if (useSearch) {
        // Live search ON → /api/grok-chat with mode:'search' (~$0.05–$0.15)
        const res = await fetch('/api/grok-chat', {
          method:  'POST',
          headers: reqHeaders,
          body:    JSON.stringify({
            mode:  'search',
            model: 'grok-4.3',
            input: messages,
            tools: [{ type: 'web_search' }, { type: 'x_search' }],
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (j?.code === 'AUTH_REQUIRED') { setShowLoginModal(true); setLoading(false); return; }
          if (j?.code === 'RATE_LIMIT') {
            const u = j.usage;
            if (u && usage) setUsage({ ...usage, ...u });
            setRateLimited(true);
            setError(`No live searches left today — resets at ${nextResetLocalTime()}.`);
            setLoading(false);
            return;
          }
          throw new Error(`${res.status} — ${j?.error ?? res.statusText}`);
        }
        if (j._usage && usage) setUsage({ ...usage, ...j._usage });
        reply = j.output?.find((o: { type: string }) => o.type === 'message')?.content?.[0]?.text ?? '(no response)';
      } else {
        // No search needed → /api/grok-chat with mode:'chat' (~$0.003)
        const res = await fetch('/api/grok-chat', {
          method:  'POST',
          headers: reqHeaders,
          body:    JSON.stringify({
            mode:       'chat',
            model:      'grok-4.3',
            messages,
            max_tokens: 600,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (j?.code === 'AUTH_REQUIRED') { setShowLoginModal(true); setLoading(false); return; }
          if (j?.code === 'RATE_LIMIT') {
            const u = j.usage;
            if (u && usage) setUsage({ ...usage, ...u });
            setRateLimited(true);
            setError(`No chat messages left today — resets at ${nextResetLocalTime()}.`);
            setLoading(false);
            return;
          }
          throw new Error(`${res.status} — ${j?.error ?? res.statusText}`);
        }
        if (j._usage && usage) setUsage({ ...usage, ...j._usage });
        reply = j.choices?.[0]?.message?.content ?? '(no response)';
      }
      const replyTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show reply immediately
      setMsgs(prev => [...prev, { role: 'assistant', content: reply, ts: replyTs }]);

      // Generate follow-up chips only for substantial responses (skip 1-liners)
      generateFollowUps(reply.length > 150 ? reply : '', activeCoin, token).then(followUps => {
        if (followUps.length > 0) {
          setMsgs(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], followUps };
            }
            return updated;
          });
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [msgs, coin, liveSearch, store, latestHeadlines, geoEvents, user, usage, setUsage]);

  /* ── Open-with-prompt event from Arena ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ coin: CoinId; prompt?: string }>;
      setCoin(ev.detail.coin);
      setOpen(true);
      setHistView(false);
      if (ev.detail.prompt) setTimeout(() => sendMsg(ev.detail.prompt!, ev.detail.coin), 200);
    };
    window.addEventListener('grok-chat', handler);
    return () => window.removeEventListener('grok-chat', handler);
  }, [sendMsg]);

  /* ── History actions ── */
  function newChat() {
    currentIdRef.current = genId();
    setMsgs([]);
    setError('');
    setHistView(false);
  }

  function loadConvo(c: SavedConvo) {
    currentIdRef.current = c.id;
    setCoin(c.coin);
    setMsgs(c.messages);
    setError('');
    setHistView(false);
  }

  function deleteConvo(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = convos.filter(c => c.id !== id);
    persistHistory(updated);
    setConvos(updated);
  }

  /* ── Misc ── */
  const handleSend   = () => { if (!input.trim() || loading) return; sendMsg(input.trim()); };
  const clearChat    = () => { setMsgs([]); setError(''); };
  const closeAll     = () => { setOpen(false); setExpanded(false); setHistView(false); setShowLoginModal(false); };
  const toggleExpand = () => setExpanded(v => !v);

  const searchRemaining = usage
    ? usage.search_limit - usage.search_used
    : null;

  /* ── Coin badge color ── */
  const COIN_COLORS: Record<string, string> = {
    btc: '#f7931a', eth: '#627eea', sol: '#9945ff',
    xrp: '#00aae4', bnb: '#f3ba2f', hype: '#a78bfa',
    near: '#00c08b', sui: '#6fbcf0',
  };

  return (
    <>
      {/* ── Backdrop (expanded only) ── */}
      {open && expanded && <div className="gchat-backdrop" onClick={closeAll} aria-hidden />}

      {/* ── Floating action button ── */}
      <button
        className={`gchat-fab${open ? ' gchat-fab-open' : ''}${!fabVisible ? ' gchat-fab-scrolling' : ''}`}
        onClick={() => { setOpen(v => !v); if (open) { setExpanded(false); setShowLoginModal(false); } }}
        title={open ? 'Close chat' : 'Ask Grok'}
        aria-label={open ? 'Close Grok chat' : 'Open Grok chat'}
      >
        {open ? (
          <span style={{ fontSize: 15, color: 'var(--txt3)' }}>✕</span>
        ) : (
          <>
            <span style={{ lineHeight: 0 }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" />
                <path d="M15.6 12.6C15.8 14 16.2 14.4 17.6 14.6 16.2 14.8 15.8 15.2 15.6 16.6 15.4 15.2 15 14.8 13.6 14.6 15 14.4 15.4 14 15.6 12.6Z" fill="currentColor" opacity="0.65" />
              </svg>
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'inherit' }}>Ask AI</span>
          </>
        )}
      </button>

      {/* ── Chat panel ── */}
      <div className={`gchat-panel${open ? ' gchat-open' : ''}${expanded ? ' gchat-expanded' : ''}`}>

        {/* ── Login modal overlay (shown when unauthenticated user tries to use Grok) ── */}
        {showLoginModal && (
          <div className="gchat-login-overlay">
            <button
              className="gchat-login-close"
              onClick={() => setShowLoginModal(false)}
              aria-label="Close"
            >✕</button>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>
              Sign in to use Grok
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt3)', lineHeight: 1.65, maxWidth: 240 }}>
              AI analysis uses API credits. Create a free account to unlock Grok chat and arena analysis.
            </div>
            <Link
              href="/login"
              className="auth-gate-btn"
              onClick={() => setShowLoginModal(false)}
            >
              Sign In
            </Link>
          </div>
        )}

        {/* Header */}
        <div className="gchat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {histView ? (
              <button className="gchat-icon-btn" onClick={() => setHistView(false)} title="Back to chat" style={{ fontSize: 16, padding: '2px 4px' }}>←</button>
            ) : null}
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>
              {histView ? 'Conversations' : 'LiquidityAI'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!histView && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className={`gchat-search-toggle${liveSearch ? ' on' : ''}`}
                    onClick={() => setLiveSearch(v => !v)}
                    title={liveSearch ? 'Live web+X search ON — click to turn off' : 'Search OFF — click to enable live web+X search'}
                  >
                    {liveSearch ? 'Live' : 'Fast'}
                  </button>
                  {searchRemaining !== null && (
                    <span style={{
                      fontSize: 11,
                      color: searchRemaining === 0 ? '#ff9a92' : searchRemaining === 1 ? '#f59e0b' : '#666',
                      opacity: liveSearch ? 1 : 0.5,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {searchRemaining === 0 ? '✕ None left' : searchRemaining === 1 ? <><Warn size={11} /> 1 left</> : `${searchRemaining} left`}
                    </span>
                  )}
                </div>
                {msgs.length > 0 && (
                  <button className="gchat-icon-btn" onClick={clearChat} title="Clear chat" aria-label="Clear chat">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </>
            )}
            {histView && (
              <button
                className="gchat-new-chat-btn"
                onClick={newChat}
                title="Start a new chat"
              >
                + New
              </button>
            )}
            <button
              className={`gchat-icon-btn${histView ? ' gchat-hist-active' : ''}`}
              onClick={() => setHistView(v => !v)}
              title={histView ? 'Back to chat' : 'Conversation history'}
              aria-label={histView ? 'Back to chat' : 'Conversation history'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button
              className="gchat-icon-btn"
              onClick={toggleExpand}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? '⊡' : '⊞'}
            </button>
            <button className="gchat-icon-btn" onClick={closeAll} title="Close">✕</button>
          </div>
        </div>

        {/* ════ HISTORY VIEW ════ */}
        {histView ? (
          <div className="gchat-hist-view">
            {convos.length === 0 ? (
              <div className="gchat-hist-empty">
                <div style={{ fontSize: 13, color: 'var(--txt3)' }}>No saved conversations yet</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>Conversations are saved automatically</div>
                <button className="gchat-new-chat-btn" style={{ marginTop: 16, padding: '8px 20px' }} onClick={newChat}>
                  + Start a new chat
                </button>
              </div>
            ) : (
              <div className="gchat-hist-list">
                {convos.map(c => (
                  <div
                    key={c.id}
                    className={`gchat-hist-item${c.id === currentIdRef.current ? ' gchat-hist-item-active' : ''}`}
                    onClick={() => loadConvo(c)}
                  >
                    <span
                      className="gchat-hist-coin"
                      style={{ background: COIN_COLORS[c.coin] + '22', color: COIN_COLORS[c.coin], borderColor: COIN_COLORS[c.coin] + '44' }}
                    >
                      {c.coin.toUpperCase()}
                    </span>
                    <div className="gchat-hist-body">
                      <div className="gchat-hist-title">{c.title}</div>
                      <div className="gchat-hist-meta">
                        {c.messages.length} messages · {relTime(c.ts)}
                      </div>
                    </div>
                    <button
                      className="gchat-hist-del"
                      onClick={(e) => deleteConvo(c.id, e)}
                      title="Delete conversation"
                      aria-label="Delete conversation"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ════ CHAT VIEW ════ */
          <>
            {/* Coin selector */}
            <div className="gchat-coins">
              {COINS.map(c => (
                <button
                  key={c}
                  className={`gchat-coin${c === coin ? ' on' : ''}`}
                  onClick={() => { if (c !== coin) { newChat(); setCoin(c); } }}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Rate-limit / error status bar — sits between coins and messages, not in chat stream */}
            {error && (
              <div style={{ padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,154,146,0.06)', lineHeight: 1.6 }}>
                <div style={{ fontSize: 11, color: '#ff9a92', display: 'flex', alignItems: 'center', gap: 5 }}><Warn size={12} /> {error}</div>
                {rateLimited && (
                  <Link href="/upgrade" style={{ fontSize: 11, color: '#b8aeff', textDecoration: 'underline' }}>
                    Upgrade to Pro for higher limits →
                  </Link>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="gchat-msgs" ref={msgsRef}>
              {msgs.length === 0 && (
                <div className="gchat-empty">
                  <div style={{ marginBottom: 8, lineHeight: 0, color: 'var(--accent)' }}>
                    <svg width="32" height="32" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" />
                      <path d="M15.6 12.6C15.8 14 16.2 14.4 17.6 14.6 16.2 14.8 15.8 15.2 15.6 16.6 15.4 15.2 15 14.8 13.6 14.6 15 14.4 15.4 14 15.6 12.6Z" fill="currentColor" opacity="0.65" />
                    </svg>
                  </div>
                  {user ? (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#a0a0a0' }}>Ask anything about</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#b8aeff', margin: '2px 0 6px' }}>
                        {coin.toUpperCase()}/USDT
                      </div>
                      <div style={{ fontSize: 11, color: '#444' }}>
                        {liveSearch ? 'Live search ON' : 'Fast mode · toggle Live for web search'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt3)' }}>Sign in to use LiquidityAI</div>
                      <button
                        style={{ marginTop: 10, fontSize: 12, color: '#b8aeff', background: 'none', border: '0.5px solid #b8aeff44', borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}
                        onClick={() => setShowLoginModal(true)}
                      >
                        Sign In →
                      </button>
                    </>
                  )}
                </div>
              )}

              {msgs.map((m, i) => (
                <div key={i} className={`gchat-msg gchat-msg-${m.role}`}>
                  {m.role === 'assistant' && (
                    <div className="gchat-grok-label">GROK · {m.ts}</div>
                  )}

                  {/* Bubble */}
                  {m.role === 'assistant' ? (
                    <div
                      className="gchat-bubble"
                      dangerouslySetInnerHTML={{ __html: renderMd(m.content) }}
                    />
                  ) : (
                    <div className="gchat-bubble">{m.content}</div>
                  )}

                  {m.role === 'user' && (
                    <div className="gchat-user-ts">{m.ts}</div>
                  )}

                  {/* Follow-up question chips — appear below each assistant response */}
                  {m.role === 'assistant' && m.followUps && m.followUps.length > 0 && !loading && (
                    <div className="gchat-followup-row">
                      {m.followUps.map((q, qi) => (
                        <button
                          key={qi}
                          className="gchat-followup-chip"
                          onClick={() => sendMsg(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="gchat-msg gchat-msg-assistant">
                  <div className="gchat-grok-label">GROK · thinking</div>
                  <div className="gchat-bubble gchat-thinking">
                    <span className="gchat-dot" />
                    <span className="gchat-dot" />
                    <span className="gchat-dot" />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Quick prompts */}
            <div className="gchat-quick-row">
              {QUICK.map(q => (
                <button
                  key={q}
                  className="gchat-quick"
                  onClick={() => !loading && sendMsg(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="gchat-input-row">
              <textarea
                ref={inputRef}
                className="gchat-input"
                aria-label="Ask LiquidityAI"
                rows={1}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder={user ? `Ask about ${coin.toUpperCase()}…` : 'Sign in to use LiquidityAI'}
                disabled={loading}
              />
              <button
                className="gchat-send"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                title="Send"
              >↑</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
