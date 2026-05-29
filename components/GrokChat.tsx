'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  useMarket, CoinId, COINS, computeSqueezeScore, classifyFunding,
} from '@/lib/marketStore';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews, GeoEvent } from '@/components/NewsProvider';

const GROK_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';

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

/* ── Generate follow-up question chips via Grok ────────────────── */
async function generateFollowUps(response: string, coin: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.x.ai/v1/responses', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
      body: JSON.stringify({
        model: 'grok-4.3',
        input: [{
          role:    'user',
          content: `Based on this ${coin.toUpperCase()} trading analysis, write exactly 3 short follow-up questions a trader would ask next. Each question must be 4–8 words. Output ONLY the 3 questions, one per line, no numbering, no bullets, no extra text.\n\n${response.slice(0, 600)}`,
        }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text: string = data.output?.find((o: { type: string }) => o.type === 'message')?.content?.[0]?.text ?? '';
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
  const session = getSessionName(getPHT());
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
    ln('RSI 15m/1h/4h', [c?.rsi14, c?.rsi1h, c?.rsi4h].map(r => r?.toFixed(0) ?? '—').join(' / ')),
    ln('MA20 (15m)',    c?.ma20 ? '$' + c.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'),
    ln('Vol ratio',     c?.volRatio ? c.volRatio.toFixed(2) + 'x' : '—'),
    ln('CVD (200)',     c?.cvd != null ? (c.cvd >= 0 ? '+' : '') + (c.cvd / 1000).toFixed(1) + 'K' : '—'),
    ln('Funding',       fr?.label ?? '—'),
    ln('Open Interest', c?.oi ? '$' + (c.oi / 1e9).toFixed(2) + 'B' : '—'),
    ln('Long/Short %',  c?.longRatio != null ? (c.longRatio * 100).toFixed(1) + '% / ' + ((c.shortRatio ?? 0) * 100).toFixed(1) + '%' : '—'),
    ln('Squeeze score', sq.score + '/100 — ' + sq.label),
    ln('Basis',         c?.perpPrice && c.price ? ((c.perpPrice - c.price) / c.price * 100).toFixed(4) + '%' : '—'),
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

  const [open,       setOpen]       = useState(false);
  const [expanded,   setExpanded]   = useState(false);
  const [liveSearch, setLiveSearch] = useState(false);
  const [histView,   setHistView]   = useState(false);
  const [coin,       setCoin]       = useState<CoinId>('btc');
  const [msgs,       setMsgs]       = useState<Msg[]>([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  /* conversation history */
  const [convos,     setConvos]     = useState<SavedConvo[]>([]);
  const currentIdRef                = useRef<string>(genId());

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const msgsRef   = useRef<HTMLDivElement>(null);

  /* ── Load history on mount ── */
  useEffect(() => { setConvos(loadHistory()); }, []);

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
    const activeCoin = coinOverride ?? coin;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: Msg = { role: 'user', content: text, ts };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    setError('');

    try {
      const sysCtx  = buildSystemCtx(store, activeCoin, latestHeadlines, geoEvents);
      const apiMsgs = history.map(m => ({ role: m.role, content: m.content }));
      const inputArr = [{ role: 'system', content: sysCtx }, ...apiMsgs];

      const res = await fetch('https://api.x.ai/v1/responses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
        body:    JSON.stringify({
          model: 'grok-4.3',
          input: inputArr,
          ...(liveSearch && { tools: [{ type: 'web_search' }, { type: 'x_search' }] }),
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`${res.status} — ${j?.error ?? res.statusText}`);
      }

      const data    = await res.json();
      const msgItem = data.output?.find((o: { type: string }) => o.type === 'message');
      const reply   = msgItem?.content?.[0]?.text ?? '(no response)';
      const replyTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show reply immediately
      setMsgs(prev => [...prev, { role: 'assistant', content: reply, ts: replyTs }]);

      // Generate follow-up chips in background (non-blocking)
      generateFollowUps(reply, activeCoin).then(followUps => {
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
  }, [msgs, coin, liveSearch, store, latestHeadlines, geoEvents]);

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
  const closeAll     = () => { setOpen(false); setExpanded(false); setHistView(false); };
  const toggleExpand = () => setExpanded(v => !v);

  /* ── Coin badge color ── */
  const COIN_COLORS: Record<string, string> = {
    btc: '#f7931a', eth: '#627eea', sol: '#9945ff',
    xrp: '#00aae4', bnb: '#f3ba2f', hype: '#a78bfa',
    near: '#00c08b', zec: '#f4b728',
  };

  return (
    <>
      {/* ── Backdrop (expanded only) ── */}
      {open && expanded && <div className="gchat-backdrop" onClick={closeAll} aria-hidden />}

      {/* ── Floating action button ── */}
      <button
        className={`gchat-fab${open ? ' gchat-fab-open' : ''}`}
        onClick={() => { setOpen(v => !v); if (open) setExpanded(false); }}
        title={open ? 'Close chat' : 'Ask Grok'}
        aria-label={open ? 'Close Grok chat' : 'Open Grok chat'}
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* ── Chat panel ── */}
      <div className={`gchat-panel${open ? ' gchat-open' : ''}${expanded ? ' gchat-expanded' : ''}`}>

        {/* Header */}
        <div className="gchat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {histView ? (
              <button className="gchat-icon-btn" onClick={() => setHistView(false)} title="Back to chat" style={{ fontSize: 16, padding: '2px 4px' }}>←</button>
            ) : null}
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8' }}>
              {histView ? 'Conversations' : 'Grok Chat'}
            </span>
            {!histView && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em',
              }}>LIVE X</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!histView && (
              <>
                <button
                  className={`gchat-search-toggle${liveSearch ? ' on' : ''}`}
                  onClick={() => setLiveSearch(v => !v)}
                  title={liveSearch ? 'Live search ON' : 'Live search OFF'}
                >
                  🌐 {liveSearch ? 'Live' : 'Off'}
                </button>
                {msgs.length > 0 && (
                  <button className="gchat-icon-btn" onClick={clearChat} title="Clear chat">🗑</button>
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
            >
              🕐
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
                <div style={{ fontSize: 28, marginBottom: 8 }}>🕐</div>
                <div style={{ fontSize: 13, color: '#606060' }}>No saved conversations yet</div>
                <div style={{ fontSize: 11, color: '#383838', marginTop: 4 }}>Conversations are saved automatically</div>
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
                    >
                      🗑
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

            {/* Messages */}
            <div className="gchat-msgs" ref={msgsRef}>
              {msgs.length === 0 && (
                <div className="gchat-empty">
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#a0a0a0' }}>Ask anything about</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#b8aeff', margin: '2px 0 6px' }}>
                    {coin.toUpperCase()}/USDT
                  </div>
                  <div style={{ fontSize: 11, color: '#444' }}>
                    Live data · {liveSearch ? '🌐 X + web search ON' : '🌐 search off — toggle to enable'}
                  </div>
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

              {error && (
                <div style={{ fontSize: 11, color: '#ff9a92', padding: '4px 14px', marginBottom: 4 }}>
                  ⚠ {error}
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
                placeholder={`Ask about ${coin.toUpperCase()}…`}
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
