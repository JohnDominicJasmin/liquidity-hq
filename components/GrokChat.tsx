'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  useMarket, CoinId, COINS, computeSqueezeScore, classifyFunding,
} from '@/lib/marketStore';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews, GeoEvent } from '@/components/NewsProvider';

const GROK_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';

interface Msg { role: 'user' | 'assistant'; content: string; ts: string; }

/** Minimal markdown → HTML for chat bubbles.
 *  Handles: **bold**, *italic*, [text](url), [[n]](url), bullet lists, headings, newlines.
 *  Uses DOMParser-safe escaping — no XSS risk from trusted LLM output.
 */
function renderMd(raw: string): string {
  // Escape HTML entities first
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Citations: [[1]](url) or [[1, 2]](url) → superscript link
  s = s.replace(/\[\[([^\]]+)\]\]\((https?:\/\/[^)]+)\)/g,
    (_, num, url) => `<sup><a href="${url}" target="_blank" rel="noopener">[${num}]</a></sup>`);

  // Normal links: [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_, text, url) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);

  // Bare URLs
  s = s.replace(/(^|[\s(])((https?:\/\/)[^\s)]+)/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // *italic* (not already inside **)
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // ### Headings → bold line
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');

  // Bullet lines: "- item" or "• item"
  s = s.replace(/^[-•]\s+(.+)$/gm, '&bull; $1');

  // Numbered list: "1. item"
  s = s.replace(/^\d+\.\s+(.+)$/gm, (_, item) => `&emsp;${item}`);

  // Double newline → paragraph break
  s = s.replace(/\n{2,}/g, '<br/><br/>');
  // Single newline → line break
  s = s.replace(/\n/g, '<br/>');

  return s;
}

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

function buildSystemCtx(
  store: ReturnType<typeof useMarket>['store'],
  coin: CoinId,
  latestHeadlines: string[],
  geoEvents: GeoEvent[],
): string {
  const c  = store.coins[coin];
  const sq = computeSqueezeScore(c);
  const fr = c?.fundingRate != null ? classifyFunding(c.fundingRate) : null;
  const pht = getPHT();
  const session = getSessionName(pht);

  const line = (k: string, v: string) => `${k}: ${v}`;

  return [
    'You are an elite crypto derivatives trader and analyst assistant embedded in Liquidity Hunter HQ.',
    'The trader asks short, direct questions. Give concise, bullet-pointed, actionable answers.',
    'Flag when data is missing. Never invent numbers. Be honest about uncertainty.',
    '',
    `=== LIVE DATA — ${coin.toUpperCase()}/USDT ===`,
    line('Price', c?.price ? '$' + c.price.toLocaleString() : '—'),
    line('24h Change', c?.change != null ? (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + '%' : '—'),
    line('High/Low', c?.high && c?.low ? '$' + c.high.toLocaleString() + ' / $' + c.low.toLocaleString() : '—'),
    line('RSI 15m/1h/4h', [c?.rsi14, c?.rsi1h, c?.rsi4h].map(r => r?.toFixed(0) ?? '—').join(' / ')),
    line('MA20 (15m)', c?.ma20 ? '$' + c.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'),
    line('Vol ratio', c?.volRatio ? c.volRatio.toFixed(2) + 'x' : '—'),
    line('CVD (200 trades)', c?.cvd != null ? (c.cvd >= 0 ? '+' : '') + (c.cvd / 1000).toFixed(1) + 'K' : '—'),
    line('Funding rate', fr?.label ?? '—'),
    line('Open Interest', c?.oi ? '$' + (c.oi / 1e9).toFixed(2) + 'B' : '—'),
    line('Long/Short %', c?.longRatio != null ? (c.longRatio * 100).toFixed(1) + '% / ' + ((c.shortRatio ?? 0) * 100).toFixed(1) + '%' : '—'),
    line('Squeeze score', sq.score + '/100 — ' + sq.label),
    line('Basis (perp vs spot)', c?.perpPrice && c.price ? ((c.perpPrice - c.price) / c.price * 100).toFixed(4) + '%' : '—'),
    line('Order book', c?.orderBidWalls ? 'Bids: ' + c.orderBidWalls.map(w => '$' + w.price.toLocaleString()).join(', ') : '—'),
    '',
    '=== MACRO ===',
    line('Fear & Greed', store.fng != null ? store.fng + ' (' + store.fngLabel + ')' : '—'),
    line('BTC Dominance', store.btcDom ? store.btcDom.toFixed(2) + '%' : '—'),
    line('P/C Ratio', store.btcPcRatio ? store.btcPcRatio.toFixed(2) : '—'),
    line('Max Pain', store.btcMaxPain ? '$' + store.btcMaxPain.toLocaleString() : '—'),
    line('Stablecoin supply', store.stablecoinSupply ? '$' + store.stablecoinSupply.toFixed(1) + 'B' : '—'),
    line('BTC ETF flow', store.etfNetFlow != null ? (store.etfNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.etfNetFlow).toFixed(0) + 'M' : '—'),
    line('ETH ETF flow', store.ethEtfNetFlow != null ? (store.ethEtfNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.ethEtfNetFlow).toFixed(0) + 'M' : '—'),
    line('Exchange net flow', store.btcExchangeNetFlow != null ? (store.btcExchangeNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.btcExchangeNetFlow).toFixed(1) + 'M' : '—'),
    line('Google Trends', store.googleTrendsBtc != null ? store.googleTrendsBtc + '/100' : '—'),
    line('Session', session),
    '',
    '=== LIVE NEWS FEED (Finnhub + CryptoPanic) ===',
    latestHeadlines.length > 0
      ? latestHeadlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join('\n')
      : 'No alerts yet — use your live search tools to find latest news.',
    '',
    '=== GEOPOLITICAL EVENTS (last 12h) ===',
    geoEvents.length > 0
      ? geoEvents.slice(0, 5).map(g => `[${g.tag}] ${g.headline} (${g.timeStr})`).join('\n')
      : 'None detected locally — search X and web for current war/sanctions/tariff news.',
    '',
    '=== SEARCH INSTRUCTIONS ===',
    'You have web_search and x_search tools. Use them proactively to find:',
    '1. WHY is BTC/crypto pumping or dumping RIGHT NOW — search "bitcoin price today why" and "crypto market news"',
    '2. Latest war, conflict, sanctions, or geopolitical news affecting risk assets',
    '3. Fed, CPI, FOMC, Treasury statements from last 48h',
    '4. Trump/White House crypto or tariff posts on X in last 48h',
    '5. Any exchange hacks, large liquidations, whale moves on X',
    'Always cite the source and timestamp when you find something significant.',
  ].join('\n');
}

export default function GrokChat() {
  const { store } = useMarket();
  const { latestHeadlines, geoEvents } = useNews();
  const [open,    setOpen]    = useState(false);
  const [coin,    setCoin]    = useState<CoinId>('btc');
  const [msgs,    setMsgs]    = useState<Msg[]>([]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  /* scroll to bottom on new message */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  /* focus input when opened */
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const sendMsg = useCallback(async (text: string, coinOverride?: CoinId) => {
    const activeCoin = coinOverride ?? coin;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg: Msg = { role: 'user', content: text, ts };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const sysCtx = buildSystemCtx(store, activeCoin, latestHeadlines, geoEvents);
      const inputArr = [
        { role: 'system', content: sysCtx },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          input: inputArr,
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(`${res.status} — ${j?.error ?? res.statusText}`);
      }

      const data = await res.json();
      const msgItem = data.output?.find((o: { type: string }) => o.type === 'message');
      const reply: string = msgItem?.content?.[0]?.text ?? '(no response)';
      const replyTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMsgs(prev => [...prev, { role: 'assistant', content: reply, ts: replyTs }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [msgs, coin, store, latestHeadlines, geoEvents]);

  /* listen for open-with-prompt events from Arena */
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ coin: CoinId; prompt?: string }>;
      setCoin(ev.detail.coin);
      setOpen(true);
      if (ev.detail.prompt) {
        setTimeout(() => sendMsg(ev.detail.prompt!, ev.detail.coin), 200);
      }
    };
    window.addEventListener('grok-chat', handler);
    return () => window.removeEventListener('grok-chat', handler);
  }, [sendMsg]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    sendMsg(input.trim());
  };

  const clearChat = () => { setMsgs([]); setError(''); };

  return (
    <>
      {/* ── Floating action button ── */}
      <button
        className={`gchat-fab${open ? ' gchat-fab-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={open ? 'Close chat' : 'Ask Grok'}
        aria-label={open ? 'Close Grok chat' : 'Open Grok chat'}
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* ── Chat panel ── */}
      <div className={`gchat-panel${open ? ' gchat-open' : ''}`}>

        {/* Header */}
        <div className="gchat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8' }}>Grok Chat</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
              background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em',
            }}>LIVE X</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {msgs.length > 0 && (
              <button className="gchat-icon-btn" onClick={clearChat} title="Clear chat">🗑</button>
            )}
            <button className="gchat-icon-btn" onClick={() => setOpen(false)} title="Close">✕</button>
          </div>
        </div>

        {/* Coin selector */}
        <div className="gchat-coins">
          {COINS.map(c => (
            <button
              key={c}
              className={`gchat-coin${c === coin ? ' on' : ''}`}
              onClick={() => setCoin(c)}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="gchat-msgs">
          {msgs.length === 0 && (
            <div className="gchat-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a0a0a0' }}>Ask anything about</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#b8aeff', margin: '2px 0 6px' }}>
                {coin.toUpperCase()}/USDT
              </div>
              <div style={{ fontSize: 11, color: '#444' }}>
                Live market data · X search · web search
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={`gchat-msg gchat-msg-${m.role}`}>
              {m.role === 'assistant' && (
                <div className="gchat-grok-label">GROK · {m.ts}</div>
              )}
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
          <input
            ref={inputRef}
            className="gchat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder={`Ask about ${coin.toUpperCase()}…`}
            disabled={loading}
            maxLength={500}
          />
          <button
            className="gchat-send"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            title="Send"
          >
            ↑
          </button>
        </div>

      </div>
    </>
  );
}
