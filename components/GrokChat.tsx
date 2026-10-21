'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  useMarket, CoinId, COINS, computeSqueezeScore, classifyFunding, BINANCE_SYMS, BYBIT_SYMS,
} from '@/lib/marketStore';
import { getSessionName } from '@/lib/session';
import { useNews, GeoEvent } from '@/components/NewsProvider';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { Warn } from '@/components/icons';
import { getAuthToken } from '@/lib/supabase';
import { nextResetLocalTime } from '@/lib/resetTime';
import { withAlpha } from '@/lib/color';
import { computeSectorRotation } from '@/lib/sectorRotation';
import { latestStructureSignal, describeStructureSignal } from '@/lib/priceAction';
import { needsLiveSearch, quotaLabel } from '@/lib/searchTriggers';
import { describeSelection } from '@/lib/strategyRegistry';
import { fetchBybitKlinesRetry } from '@/lib/bybitKlines';
import CoinMultiSelect from './CoinMultiSelect';
import { activatable } from '@/lib/activatable';
import { PAGE_COIN_EVENT, currentPageCoin } from '@/lib/pageCoin';

// A 429 from /api/grok-chat can mean the caller's own daily cap OR the
// app-wide circuit breaker (AI_GLOBAL_DAILY_MAX) - the server already words
// each case correctly (lib/aiUsage.ts rateLimitMessage), so use its message
// rather than assuming the personal cap. This used to hardcode "No chat
// messages left today", which told a user their quota was gone while the
// usage meter beside it still showed quota remaining.
// The reset time only makes sense for a personal cap; a breaker trip clears
// when overall load drops, not at midnight, and its message says so itself.
function rateLimitText(serverMsg: unknown, fallback: string): string {
  if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  return `${fallback} - resets at ${nextResetLocalTime()}.`;
}

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

/* Both options stay on screen (#383). The old control was a single pill showing
 * one word, which left the user to work out whether "Live" was the state or the
 * action - and it was styled lighter than the coin chips 8px below it, so it did
 * not read as interactive at all. */
const MODES = [
  { id: 'fast', live: false, label: 'Fast', title: 'Fast - answers from data already loaded. Spends your daily chat messages.' },
  { id: 'live', live: true,  label: 'Live', title: 'Live - searches the web and X. Spends your daily live searches.' },
] as const;

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

/* Follow-up chips come from the SAME answer now (#1631 E): the server asks for a FOLLOW-UPS block and splits it off
   (lib/chatPrompt.ts). This used to be a second /api/grok-chat call after every answer - a second chat credit and xAI charge. */

/* ── Markdown renderer ─────────────────────────────────────────── */
function renderMd(raw: string): string {
  // Escaping quotes here (not just &/</>) matters because this runs BEFORE
  // the link-detection regexes below build `href="${u}"` attributes straight
  // from captured URL text - search-mode responses can incorporate content
  // from arbitrary web pages/X posts, and an unescaped `"` in a captured URL
  // breaks out of the attribute (e.g. `.../x" onmouseover="...`), letting
  // that external content run its own script in this DOM. &quot; renders
  // identically to a literal " for any plain text this touches, so this is
  // safe for the non-URL cases too.
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

// Educational questions don't need the full market snapshot - saves ~350 tokens
const EDUCATIONAL_TRIGGERS = [
  'what is', 'what are', 'what does', 'explain', 'how does', 'how do',
  'define', 'meaning', 'tell me about', 'difference between', 'how to',
  'what\'s the difference', 'why do traders',
];
function isEducational(text: string): boolean {
  const t = text.toLowerCase();
  return EDUCATIONAL_TRIGGERS.some(k => t.includes(k));
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

/* ── Chat context: DATA only (#1631 E) ─────────────────────────────
   The system prompt is written on the server (lib/chatPrompt.ts) from these values; the browser no longer sends instructions. Labels that
   our own code derives (squeeze, funding class, sector rotation, structure, session) travel as short strings; the server bounds every field. */
function buildChatContext(
  store: ReturnType<typeof useMarket>['store'],
  coin: CoinId,
  latestHeadlines: string[],
  geoEvents: GeoEvent[],
  structureLine: string,
  selection: string | null,
) {
  const c  = store.coins[coin];
  const sq = computeSqueezeScore(c);
  const fr = c?.fundingRate != null ? classifyFunding(c.fundingRate) : null;
  return {
    coin,
    price: c?.price, change: c?.change, high: c?.high, low: c?.low,
    rsi: [c?.rsi14, c?.rsi1h, c?.rsi4h, c?.rsiDaily].map(r => (typeof r === 'number' ? r : null)),
    cvdDivergence: c?.cvdDivergence ?? undefined,
    ma20: c?.ma20, volRatio: c?.volRatio, cvd: c?.cvd,
    funding: fr?.label,
    oi: c?.oi, longRatio: c?.longRatio, shortRatio: c?.shortRatio,
    squeeze: sq.score + '/100 - ' + sq.label,
    basisPct: c?.perpPrice && c.price ? (c.perpPrice - c.price) / c.price * 100 : undefined,
    bidWalls: c?.orderBidWalls?.map(w => w.price),
    fng: store.fng ?? undefined, fngLabel: store.fngLabel, btcDom: store.btcDom || undefined,
    btcPcRatio: store.btcPcRatio || undefined, btcMaxPain: store.btcMaxPain || undefined,
    stablecoinSupply: store.stablecoinSupply || undefined,
    stablecoinChg30d: store.stablecoinChg30d ?? undefined,
    etfNetFlow: store.etfNetFlow ?? undefined, ethEtfNetFlow: store.ethEtfNetFlow ?? undefined,
    btcExchangeNetFlow: store.btcExchangeNetFlow ?? undefined,
    sectorRotation: computeSectorRotation(store, coin).line,
    structure: structureLine,
    session: getSessionName(new Date()),
    headlines: latestHeadlines.slice(0, 8),
    geo: geoEvents.slice(0, 5).map(g => `[${g.tag}] ${g.headline} (${g.timeStr})`),
    selection: selection || undefined,
  };
}

/* ─────────────────────────────────────────────────────────────── */
export default function GrokChat() {
  const { store }                      = useMarket();
  const { latestHeadlines, geoEvents } = useNews();
  const { user, loading: authLoading } = useAuth();
  const { settings, settingsLoadStatus } = useSettings();

  const [open,           setOpen]           = useState(false);
  const [expanded,       setExpanded]       = useState(false);
  const [liveSearch,     setLiveSearch]     = useState(false);
  const [histView,       setHistView]       = useState(false);
  const [coin,           setCoin]           = useState<CoinId>('btc');
  /* #1631 E: the coin of the page the trader is on - Arena announces its own ('page-coin' event), elsewhere it is the shared store's
     selected coin (Dashboard). A chat that opens with no conversation yet follows it, so a question asked on the XRP page is about XRP
     (it used to start on BTC whatever the page showed, and a Pro user spent a credit on the wrong coin). A coin chosen explicitly - the
     Ask AI event, a loaded conversation, the dropdown - is kept until the panel closes, and an ongoing conversation keeps its coin. */
  const [pageCoin,       setPageCoin]       = useState<CoinId | null>(null);
  const coinPinnedRef = useRef(false);
  useEffect(() => {
    const take = (c: string | null) => setPageCoin(c && (COINS as readonly string[]).includes(c) ? (c as CoinId) : null);
    const onPageCoin = (e: Event) => take((e as CustomEvent<{ coin: string | null }>).detail?.coin ?? null);
    window.addEventListener(PAGE_COIN_EVENT, onPageCoin);
    // QA's review of #1665: on a hard load Arena can announce before this listener exists - read the last announcement too.
    take(currentPageCoin());
    return () => window.removeEventListener(PAGE_COIN_EVENT, onPageCoin);
  }, []);
  /* #985 gap 2: seeded from the account's saved settings on mount (#1347
     item 18), then kept aligned by a live 'strategy-selection-changed' event
     Arena fires on every change, and by the 'grok-chat' open event when it
     explicitly carries one (item 3) - not just captured once at open. Read
     fresh into the system context on every sendMsg call, so a mid-
     conversation change reaches the very next turn without resending
     anything into the visible transcript. */
  const [chatSelection,  setChatSelection]  = useState<readonly string[]>([]);
  /* #1347 item 18: this component has no direct settings access other than
     the mount-seed effect below - before this, a session that never visited
     Arena had chatSelection stuck at [] forever, regardless of what the
     account actually had saved. The seed only WRITES when nothing else has
     yet (checks the ref); the two live paths (the listener below and the
     open-event handler) always write unconditionally when they fire and
     mark the ref too, so "whoever writes first owns the value" - a live
     change arriving before the slower settings read resolves must not be
     overwritten once that read finally lands. */
  const chatSelectionSeededRef = useRef(false);
  useEffect(() => {
    if (settingsLoadStatus !== 'ready' || chatSelectionSeededRef.current) return;
    chatSelectionSeededRef.current = true;
    setChatSelection(settings.strategy_selection ?? []);
  }, [settingsLoadStatus, settings.strategy_selection]);
  // Structure read needs candles, which this component otherwise has no reason
  // to hold. Fetched once per coin selection rather than per message - the
  // answer only changes on a new hourly close, so re-fetching on every send
  // would be pure waste.
  const [structureLine,  setStructureLine]  = useState('-');
  const [msgs,           setMsgs]           = useState<Msg[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [rateLimited,    setRateLimited]    = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { usage, setUsage }                 = useGrokUsage();

  const msgCountRef = useRef(0);
  useEffect(() => { msgCountRef.current = msgs.length; }, [msgs]);
  const effectivePageCoin = pageCoin ?? store.selectedCoin;
  useEffect(() => {
    if (!open) { coinPinnedRef.current = false; return; }
    if (coinPinnedRef.current || msgCountRef.current > 0 || !effectivePageCoin) return;
    setCoin(effectivePageCoin);
  }, [open, effectivePageCoin]);

  /* ── Quotas ────────────────────────────────────────────────────────────
   * Derived, never stored. `liveActive` is the mode that will ACTUALLY be
   * used: selecting Live cannot survive the search quota running out, and
   * deriving that (rather than resetting the state in an effect) keeps the
   * request path and the control from ever disagreeing. */
  const searchRemaining = usage ? usage.search_limit - usage.search_used : null;
  const chatRemaining   = usage ? usage.chat_limit   - usage.chat_used   : null;
  const searchExhausted = searchRemaining !== null && searchRemaining <= 0;
  const liveActive      = liveSearch && !searchExhausted;

  /* conversation history */
  const [convos,     setConvos]     = useState<SavedConvo[]>([]);
  const currentIdRef                = useRef<string>(genId());

  const [fabVisible,    setFabVisible]    = useState(true);

  /* The string the badge should PRICE, when it is not the one in the box (#382).
   *
   * Three call sites send text the user never typed - the `grok-chat` window
   * event (EMASignal, arena, the news feed), follow-up chips and suggested
   * chips. The badge priced `input`, which is empty on all three, so it showed
   * the CHAT pool while the request billed the SEARCH pool. A user clicking a
   * chip we wrote, reading "40 messages left", spent one of ten searches. */
  const [pendingText,  setPendingText]  = useState<string | null>(null);
  const modeRefs       = useRef<(HTMLButtonElement | null)[]>([]);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const msgsRef        = useRef<HTMLDivElement>(null);
  const scrollTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Load history on mount ── */
  useEffect(() => { setConvos(loadHistory()); }, []);

  /* ── Latest market-structure break for the selected coin ──
     Only runs while the panel is open: this is the one piece of chat context
     that costs a network request, and fetching it for a closed panel would be
     a request per coin switch that nobody ever reads. Fails silently to '-',
     which the server's prompt renders as "no data" rather than inventing a read. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const bn = BINANCE_SYMS[coin] as string | undefined;
        const by = BYBIT_SYMS[coin] as string | undefined;
        let raw: (string | number)[][];
        if (bn) {
          const r = await fetch(`/api/market/klines?source=binance&symbol=${bn}&interval=1h&limit=300`);
          if (!r.ok) throw new Error('binance');
          raw = await r.json();
        } else if (by) {
          // #1080: retry shared with every other Bybit-klines caller (see
          // lib/bybitKlines.ts). Exhaustion throws into the existing catch
          // below, same as the old !r.ok check did - setStructureLine('-')
          // already handles it, matching this effect's own "fails silently
          // to '-'" design.
          const d = await fetchBybitKlinesRetry(by, '60', 300);
          if (d === null) throw new Error('bybit');
          raw = [...(d.result?.list ?? [])].reverse();
        } else return;
        if (cancelled) return;
        const candles = raw.map(k => ({
          timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
          low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
        }));
        setStructureLine(describeStructureSignal(latestStructureSignal(candles)));
      } catch {
        if (!cancelled) setStructureLine('-');
      }
    })();
    return () => { cancelled = true; };
  }, [coin, open]);

  /* ── Hide FAB while scrolling (mobile only) ── */
  /* `open` is read through a ref rather than a dependency (#326).
   *
   * This effect used to depend on [open], and its cleanup clears the pending
   * restore timer. So if `open` changed during the 400ms the FAB was hidden,
   * the restore was cancelled and `fabVisible` stayed false - leaving the
   * button at opacity 0 with pointer-events none until the user happened to
   * scroll again. It reads as the Ask AI button being gone.
   *
   * Not hypothetical: the `grok-chat` custom event below opens the panel
   * programmatically, so `open` can flip while the user is mid-scroll and has
   * not touched the FAB at all.
   *
   * With a ref the listener is installed once and the timer is only cleared on
   * unmount, when the state is being discarded anyway. */
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onScroll = () => {
      if (!mq.matches || openRef.current) return;
      setFabVisible(false);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => setFabVisible(true), 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, []);

  /* Closing the panel always restores the FAB. Belt and braces alongside the
   * ref above: whatever else happened, the button must be reachable once the
   * thing it opens is shut. */
  useEffect(() => { if (!open) setFabVisible(true); }, [open]);


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
    // #1342: wait for auth to resolve before deciding. Branching on `!user`
    // alone bounced a signed-in user to the login modal if a send (or the
    // auto-open `grok-chat` event) landed in the token-resolve window - the same
    // "not yet known treated as a definite no" defect as runStrategy (#1335).
    if (authLoading) return;
    if (!user) {
      setOpen(true);
      setShowLoginModal(true);
      return;
    }

    // Price what is actually being sent, before anything can clear the box.
    setPendingText(text);

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
      // Auto-detect live search first - needed before context decision
      const autoSearch = !liveActive && needsLiveSearch(text);
      const useSearch  = liveActive || autoSearch;

      /* #1631 E: the browser sends DATA (the context below) and the conversation; /api/grok-chat writes the system prompt
         (lib/chatPrompt.ts). An educational question with no search gets the short prompt (minimal), as before. #985 gap 2: the
         selection is read fresh on every turn. */
      const context = buildChatContext(store, activeCoin, latestHeadlines, geoEvents, structureLine, describeSelection(chatSelection));
      // Cap at last 8 messages (4 pairs) - prevents token cost growing unbounded
      const apiMsgs = history.slice(-8).map(m => ({ role: m.role, content: m.content }));

      // Live search → mode:'search' (web + X, the search pool); otherwise mode:'chat' (no tools, the chat pool). Same answer shape.
      const res = await fetch('/api/grok-chat', {
        method:  'POST',
        headers: reqHeaders,
        body:    JSON.stringify({
          mode:       useSearch ? 'search' : 'chat',
          context,
          minimal:    isEducational(text) && !useSearch,
          messages:   apiMsgs,
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
          setError(rateLimitText(j?.error, useSearch ? 'No live searches left today' : 'No chat messages left today'));
          setLoading(false);
          return;
        }
        throw new Error(`${res.status} - ${j?.error ?? res.statusText}`);
      }
      if (j._usage && usage) setUsage({ ...usage, ...j._usage });
      const reply: string = typeof j.text === 'string' && j.text ? j.text : '(no response)';
      const replyTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      /* Follow-up chips come with the answer (no second call, #1631 E), and as before only on a substantial answer, not a one-liner. */
      const followUps: string[] = reply.length > 150 && Array.isArray(j.followUps)
        ? j.followUps.filter((q: unknown): q is string => typeof q === 'string').slice(0, 3)
        : [];
      setMsgs(prev => [...prev, { role: 'assistant', content: reply, ts: replyTs, ...(followUps.length ? { followUps } : {}) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setPendingText(null);
    }
  }, [msgs, coin, liveActive, store, latestHeadlines, geoEvents, user, authLoading, usage, setUsage, chatSelection]);

  /* ── Open-with-prompt event from Arena ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ coin?: string; prompt?: string; selection?: readonly string[] }>;
      /* QA's review of #1665: the opener's coin is checked like the page coin. The server now refuses a coin it does not track (400), so a
         future opener sending 'bitcoin' or 'BTCUSDT' would have shown that error in the chat; such a coin is ignored and the chat keeps its
         own (the page's, or the one already open). */
      const evCoin = typeof ev.detail.coin === 'string' && (COINS as readonly string[]).includes(ev.detail.coin) ? (ev.detail.coin as CoinId) : undefined;
      if (evCoin) { coinPinnedRef.current = true; setCoin(evCoin); }
      // #1347 item 3: `?? []` used to run unconditionally, so an opener that
      // never carries a selection (EMASignal.tsx, app/news/page.tsx - both
      // dispatch with no `selection` field at all) wiped out whatever
      // chatSelection the live listener below had already correctly set
      // from Arena. "This opener doesn't know about the selection" and
      // "the trader has selected nothing" are different facts; only write
      // when the event explicitly carries one, and mark the seed ref so a
      // still-pending mount-seed (item 18) doesn't later overwrite this
      // fresher value with an account's on-disk one.
      if (ev.detail.selection !== undefined) {
        chatSelectionSeededRef.current = true;
        setChatSelection(ev.detail.selection);
      }
      setOpen(true);
      setHistView(false);
      if (ev.detail.prompt) setTimeout(() => sendMsg(ev.detail.prompt!, evCoin), 200);
    };
    window.addEventListener('grok-chat', handler);
    return () => window.removeEventListener('grok-chat', handler);
  }, [sendMsg]);

  /* #985 gap 2: kept aligned, not just seeded. Arena fires this on every
     strategySelection change, mount-time included, so a conversation open
     when the trader changes indicators reasons from the new set on its very
     next turn - not the set the panel had when the chat was opened. Listens
     unconditionally (this component is always mounted, per AppShell) rather
     than only while the panel is open, since the selection can change before
     the panel is ever opened for this session too. Marks the seed ref
     (#1347 item 18) for the same reason the open-event handler above does -
     a live change always wins over a slower settings read that hasn't
     resolved yet. */
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ selection: readonly string[] }>;
      chatSelectionSeededRef.current = true;
      setChatSelection(ev.detail.selection);
    };
    window.addEventListener('strategy-selection-changed', handler);
    return () => window.removeEventListener('strategy-selection-changed', handler);
  }, []);

  /* ── History actions ── */
  function newChat() {
    currentIdRef.current = genId();
    setMsgs([]);
    setError('');
    setHistView(false);
  }

  function loadConvo(c: SavedConvo) {
    currentIdRef.current = c.id;
    coinPinnedRef.current = true;
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
  // Refs, not selector strings: __tests__/testIdParity counts the literal data-testid text in the source.
  const panelRef    = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  /* #1309 item 3 (R-32): the chat panel had no Escape. Closes the login overlay first if it is up, then the
     panel, and puts focus back on the launcher. Only when the key came from inside the panel or the panel is
     the expanded full-screen one - a page-level Escape must not close a side panel the user is not in. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const fromPanel = !!(e.target instanceof Node && panelRef.current?.contains(e.target));
      if (!fromPanel && !expanded) return;
      if (showLoginModal) { setShowLoginModal(false); return; }
      setOpen(false); setExpanded(false); setHistView(false);
      launcherRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, expanded, showLoginModal]);

  /* ── Mode + the quota it spends ────────────────────────────────────────
   * The counter follows the SELECTED mode, because that is the quota the next
   * message actually bills (#382). It used to read `search` in both modes and
   * only dim to 0.5 opacity in Fast - so a user with searches exhausted but 40
   * chat messages left was told "None left". The meter and the limiter
   * (grok-chat/route.ts:117) now read the same field. */
  /* EFFECTIVE mode, not the selected one. Fast silently escalates to search
   * when the text trips SEARCH_TRIGGERS, so following the toggle alone would
   * still misreport the cost of exactly the messages that prompted #382 -
   * "why is BTC down today" spends a search from Fast. `needsLiveSearch` is a
   * pure local substring match, so this is free and needs no network. */
  /* `pendingText` wins while a send is in flight - it is the string the route
     will bill. Falls back to the box, which is correct for typed messages. */
  const pricedText      = pendingText ?? input;
  const willSearch      = liveActive || needsLiveSearch(pricedText);
  const activeRemaining = willSearch ? searchRemaining : chatRemaining;
  const counterText     = activeRemaining === null
    ? null
    : activeRemaining <= 0
      ? `${quotaLabel(activeRemaining, willSearch)} · resets ${nextResetLocalTime()}`
      : quotaLabel(activeRemaining, willSearch);

  const selectMode = (live: boolean) => {
    if (live && searchExhausted) return;
    setLiveSearch(live);
    modeRefs.current[live ? 1 : 0]?.focus();
  };

  /* Two options, so any arrow key moves to the other one - the radiogroup
   * pattern's expected keyboard behaviour. */
  const onModeKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    selectMode(!liveActive);
  };

  /* ── Coin badge color ── */
  const COIN_COLORS: Record<string, string> = {
    btc: '#f7931a', eth: '#627eea', sol: '#9945ff',
    xrp: '#00aae4', bnb: '#f3ba2f', hype: '#5aa3ff',
    near: '#00c08b', sui: '#6fbcf0',
  };

  return (
    <>
      {/* ── Backdrop (expanded only) ── */}
      {open && expanded && <div className="gchat-backdrop" onClick={closeAll} aria-hidden />}

      {/* ── Floating action button ──
          Hidden via CSS (.gchat-fab-open) while the panel is open, so the
          panel's own header ✕ is the single close control instead of two
          redundant ones on screen at once (item #18). onClick still toggles
          for the mini-panel case, but the button is unclickable (and
          invisible) while open, so that path is effectively unreachable. */}
      <button
        ref={launcherRef}
        data-testid="grok-launcher"
        className={`gchat-fab${open ? ' gchat-fab-open' : ''}${!fabVisible ? ' gchat-fab-scrolling' : ''}`}
        onClick={() => { setOpen(v => !v); if (open) { setExpanded(false); setShowLoginModal(false); } }}
        title="Ask Grok"
        aria-label="Open Grok chat"
      >
        <span style={{ lineHeight: 0 }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" />
            <path d="M15.6 12.6C15.8 14 16.2 14.4 17.6 14.6 16.2 14.8 15.8 15.2 15.6 16.6 15.4 15.2 15 14.8 13.6 14.6 15 14.4 15.4 14 15.6 12.6Z" fill="currentColor" opacity="0.65" />
          </svg>
        </span>
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '0.05em', color: 'inherit' }}>Ask AI</span>
      </button>

      {/* ── Chat panel ── */}
      {/* inert while closed. The panel is hidden with opacity:0 and
          pointer-events:none, neither of which removes anything from the tab
          order - so 65 focusable controls inside it sat ahead of the page's own
          navigation. The first nine Tab presses on /dashboard landed on quick-
          reply buttons in an invisible chat panel. inert removes the subtree
          from both the tab order and the accessibility tree in one attribute,
          which is exactly the semantics opacity:0 was being asked to imply. */}
      <div
        ref={panelRef}
        className={`gchat-panel${open ? ' gchat-open' : ''}${expanded ? ' gchat-expanded' : ''}`}
        data-testid="grok-panel"
        inert={!open}
        aria-hidden={!open}
      >

        {/* ── Login modal overlay (shown when unauthenticated user tries to use Grok) ── */}
        {showLoginModal && (
          <div className="gchat-login-overlay">
            <button
              className="gchat-login-close"
              onClick={() => setShowLoginModal(false)}
              aria-label="Close"
            >✕</button>
            <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)' }}>
              Sign in to use Grok
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', lineHeight: 1.65, maxWidth: 240 }}>
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
              <button className="gchat-icon-btn" onClick={() => setHistView(false)} title="Back to chat" aria-label="Back to chat" style={{ fontSize: '1rem', padding: '2px 4px' }}>←</button>
            ) : null}
            <span style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)' }}>
              {histView ? 'Conversations' : 'LiquidityAI'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!histView && (
              <>
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
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? '⊡' : '⊞'}
            </button>
            <button className="gchat-icon-btn" onClick={closeAll} title="Close" aria-label="Close">✕</button>
          </div>
        </div>

        {/* ════ HISTORY VIEW ════ */}
        {histView ? (
          <div className="gchat-hist-view">
            {convos.length === 0 ? (
              <div className="gchat-hist-empty">
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)' }}>No saved conversations yet</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 4 }}>Conversations are saved automatically</div>
                <button className="gchat-new-chat-btn" style={{ marginTop: 16, padding: '8px 20px' }} onClick={newChat}>
                  + Start a new chat
                </button>
              </div>
            ) : (
              <div className="gchat-hist-list">
                {convos.map(c => (
                  /* #939: loading a past conversation was click-only, so the
                     whole history was unreachable from the keyboard. role and
                     tabIndex rather than a <button> because the row carries a
                     delete <button> of its own.

                     aria-label is not decoration here, it is required BECAUSE
                     of that delete button (QA on #942). Without an explicit
                     name, accname computes the row's name from its subtree,
                     which includes the delete button's own
                     aria-label="Delete conversation" - so the row announced as
                     "BTC, <title>, 5 messages · 2h ago, Delete conversation",
                     ending on the label of a DIFFERENT action. Naming the row
                     explicitly stops the subtree walk. */
                  <div
                    key={c.id}
                    className={`gchat-hist-item${c.id === currentIdRef.current ? ' gchat-hist-item-active' : ''}`}
                    aria-label={`${c.coin.toUpperCase()} - ${c.title}`}
                    {...activatable(() => loadConvo(c))}
                  >
                    <span
                      className="gchat-hist-coin"
                      style={{ background: withAlpha(COIN_COLORS[c.coin], '22'), color: COIN_COLORS[c.coin], borderColor: withAlpha(COIN_COLORS[c.coin], '44') }}
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
            {/* #995: was three stacked strings (mode pill row, quota counter,
                an escalation note up to "No searches left · resets 4:00 PM"
                long) crammed into a flex item sharing .gchat-header's row
                with the title and icon buttons. At panel width that has room
                for "48 messages" but not "48 messages left", so the note
                wrapped - and align-items: center on a row whose middle child
                had just grown taller lifted the pill above the header's own
                title. Same squeeze #746 already solved once in this exact
                panel for the coin row: give it the full panel width as its
                own strip instead of a shared one. */}
            <div className="gchat-meta-strip">
              <div className="gchat-meta-row">
                <div className="gchat-mode" role="radiogroup" aria-label="Response mode" onKeyDown={onModeKeys}>
                  {MODES.map((m, i) => {
                    const selected = m.live === liveActive;
                    const disabled = m.live && searchExhausted;
                    return (
                      <button
                        key={m.id}
                        ref={el => { modeRefs.current[i] = el; }}
                        role="radio"
                        aria-checked={selected}
                        aria-disabled={disabled || undefined}
                        tabIndex={selected ? 0 : -1}
                        data-testid={`grok-mode-${m.id}`}
                        className={`gchat-mode-opt${m.live ? ' live' : ''}${selected ? ' on' : ''}${disabled ? ' off' : ''}`}
                        onClick={() => selectMode(m.live)}
                        title={disabled ? `No searches left - resets ${nextResetLocalTime()}` : m.title}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                {counterText && (
                  <span
                    data-testid="grok-mode-count"
                    className={`gchat-mode-count${activeRemaining !== null && activeRemaining <= 0 ? ' zero' : ''}`}
                  >
                    {activeRemaining === 1 && <Warn size={10} />}
                    {counterText}
                  </span>
                )}
              </div>
              {/* The escalation the user never consented to. Fast spends a
                  SEARCH when the text trips a trigger word, so say it while
                  the message is still editable rather than after the 429. */}
              {!liveActive && willSearch && (
                <span className="gchat-mode-note" data-testid="grok-auto-search">
                  This question uses a live search
                </span>
              )}
              {/* Why the Live half is dead. A control that is present and
                  explains itself beats one that silently refuses. */}
              {searchExhausted && !liveActive && !willSearch && (
                <span className="gchat-mode-note">No searches left · resets {nextResetLocalTime()}</span>
              )}
            </div>
            {/* DROPDOWN ONLY (#746). Owner: "this coin selection it should be
                a searchable dropdown not a horizontal list of coin selection."

                An earlier version of this kept six quick buttons beside the
                dropdown, on a relay that turned out to describe the ARENA
                page's category tabs rather than this control - so the owner
                had approved keeping buttons that were never at risk. The
                governing sentence is the one above, and it rules the row out.

                It was also the wrong shape on its own evidence: six buttons
                plus a ~100px trigger did not fit, .gchat-coins had
                `overflow-x: auto; scrollbar-width: none`, and the owner's
                screenshot showed BNB clipped and HYPE off-screen behind a
                scroll with no scrollbar. That is #745's defect - content
                reachable only by a scroll nobody knows exists - in the panel
                filed to remove it. Deleting the row dissolves it rather than
                patching it, and hands the trigger the full width. */}
            <div className="gchat-coinbar">
              <CoinMultiSelect
                single
                value={[coin]}
                onChange={next => {
                  const c = next[0] as CoinId | undefined;
                  if (c && c !== coin) { newChat(); coinPinnedRef.current = true; setCoin(c); }
                }}
              />
            </div>

            {/* Rate-limit / error status bar - sits between coins and messages, not in chat stream */}
            {error && (
              <div style={{ padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,154,146,0.06)', lineHeight: 1.6 }}>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red-soft)', display: 'flex', alignItems: 'center', gap: 5 }}><Warn size={12} /> {error}</div>
                {rateLimited && (
                  <Link href="/upgrade" style={{ fontSize: 'var(--fs-caption)', color: 'var(--accent-2)', textDecoration: 'underline' }}>
                    Upgrade to Pro for higher limits →
                  </Link>
                )}
              </div>
            )}

            {/* Messages */}
            {/* WCAG 2.2 SC 4.1.3 Status Messages (AA). A reply streams in here
                and was never announced - a screen reader user asked a question
                and had no way to know an answer had arrived, or whether the
                model was still thinking.

                `polite`, not `assertive`: the reply arrives token by token, and
                assertive would interrupt the user on every chunk. Polite waits
                for a pause, which is what you want for a streaming answer.

                aria-atomic="false" so only the newly added text is read rather
                than the whole conversation being re-announced on each update -
                the difference between "here is the new sentence" and "here is
                everything again" once a thread is a few messages long. */}
            <div
              className="gchat-msgs"
              data-testid="grok-messages"
              ref={msgsRef}
              role="log"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions text"
            >
              {msgs.length === 0 && (
                <div className="gchat-empty">
                  <div style={{ marginBottom: 8, lineHeight: 0, color: 'var(--accent)' }}>
                    <svg width="32" height="32" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" />
                      <path d="M15.6 12.6C15.8 14 16.2 14.4 17.6 14.6 16.2 14.8 15.8 15.2 15.6 16.6 15.4 15.2 15 14.8 13.6 14.6 15 14.4 15.4 14 15.6 12.6Z" fill="currentColor" opacity="0.65" />
                    </svg>
                  </div>
                  {/* #1342: while auth is still resolving, show a spinner - not the
                      "Sign in" branch, which would flash at a signed-in user whose
                      token hasn't landed yet (same class as runStrategy #1335). */}
                  {authLoading ? (
                    <span className="login-spinner" aria-label="Loading" />
                  ) : user ? (
                    <>
                      <div style={{ fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--txt-dim)' }}>Ask anything about</div>
                      <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--accent-2)', margin: '2px 0 6px' }}>
                        {coin.toUpperCase()}/USDT
                      </div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
                        {liveActive ? 'Live search ON' : 'Fast mode · toggle Live for web search'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--txt3)' }}>Sign in to use LiquidityAI</div>
                      <button
                        /* Border derived from the same token as the text
                           (#647): it was `#5aa3ff44`, the current design's
                           --accent-2 as a literal, on an element whose colour
                           already used var(--accent-2). Token for the text,
                           literal for the border, one element - the exact
                           pattern #641 closed on the market-structure badge.
                           withAlpha keeps 0x44, and --accent-2 IS #5aa3ff at
                           :root, so the current design is unchanged; terminal
                           aliases it to var(--accent) and now follows. */
                        style={{ marginTop: 10, fontSize: 'var(--fs-caption)', color: 'var(--accent-2)', background: 'none', border: `0.5px solid ${withAlpha('var(--accent-2)', '44')}`, borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}
                        onClick={() => setShowLoginModal(true)}
                        /* Named for what it DOES, not for what it is (#846).
                           This read "Sign In →", the same words as
                           `.usage-auth-link` on /arena - and the two do
                           different things: that one is a <Link> to /login,
                           this one opens a modal in place. Two controls with
                           one name on the same screen is a coin flip for anyone
                           navigating by name rather than by position.
                           aria-label as well as visible text, so the accessible
                           name is right regardless of how a checker computes
                           it. */
                        aria-label="Sign in to chat"
                      >
                        Sign in to chat →
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

                  {/* Follow-up question chips - appear below each assistant response */}
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
            <div className="hscroll-fade-outer">
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
              <div className="hscroll-fade hscroll-fade-panel" />
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
                aria-label="Send"
              >↑</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
