'use client';
import { useState, useEffect } from 'react';
import { useMarket, classifyFunding, CoinId } from '@/lib/marketStore';
import { buildPrompt, callGrok, GrokResult, GrokContext } from '@/lib/grok';
import { getPHT, getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype'];
const KEY_STORE = 'lhq_arena_key';

interface HistItem { signal: string; confidence: number; coin: string; time: string; }

export default function Arena() {
  const { store } = useMarket();
  const { latestHeadlines } = useNews();
  const [selectedCoin, setSelectedCoin] = useState<CoinId>('btc');
  const [apiKey, setApiKey] = useState('');
  const [keyStatus, setKeyStatus] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GrokResult | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loadingMsg, setLoadingMsg] = useState('');

  useEffect(() => {
    const k = localStorage.getItem(KEY_STORE) || '';
    setHasKey(!!k);
  }, []);

  const saveKey = () => {
    const k = apiKey.trim();
    if (!k) { setKeyStatus('Enter your xAI API key first'); return; }
    localStorage.setItem(KEY_STORE, k);
    setApiKey('');
    setHasKey(true);
    setKeyStatus('✓ Key saved. Ready to hunt.');
  };

  const gatherContext = (): GrokContext => {
    const coin = store.coins[selectedCoin];
    const pht = getPHT();
    const session = getSessionName(pht);
    const clusters = '—'; // no cluster access here — future enhancement

    return {
      coin: selectedCoin.toUpperCase() + '/USDT',
      price: coin?.price ? '$' + coin.price.toLocaleString() : '—',
      change24h: coin?.change != null ? (coin.change >= 0 ? '+' : '') + coin.change.toFixed(2) + '%' : '—',
      fundingRate: coin?.fundingRate != null ? classifyFunding(coin.fundingRate).label : '—',
      openInterest: coin?.oi != null ? '$' + (coin.oi / 1e9).toFixed(2) + 'B' : '—',
      fearGreed: store.fng != null ? store.fng + ' (' + store.fngLabel + ')' : '—',
      btcDominance: store.btcDom != null ? store.btcDom.toFixed(2) + '%' : '—',
      session,
      clusters,
      news: latestHeadlines.length > 0 ? latestHeadlines.slice(0, 6).join(' | ') : 'No recent alerts',
    };
  };

  const fire = async () => {
    const key = localStorage.getItem(KEY_STORE) || '';
    if (!key) { setKeyStatus('⚠ Save your xAI API key first'); return; }
    setLoading(true);
    setError('');
    setResult(null);

    const msgs = ['Grok is reading the liquidity map...', 'Analyzing cluster positions...', 'Checking session and macro context...', 'Formulating the hunt thesis...'];
    let mi = 0;
    setLoadingMsg(msgs[mi]);
    const msgTimer = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 2000);

    try {
      const ctx = gatherContext();
      const prompt = buildPrompt(ctx);
      const res = await callGrok(key, prompt);
      setResult(res);
      const item: HistItem = { signal: res.signal, confidence: res.confidence, coin: ctx.coin, time: new Date().toLocaleTimeString() };
      setHistory(h => [item, ...h].slice(0, 8));

      /* save to Supabase if configured */
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        getSupabase()!.from('signals').insert({
          coin: ctx.coin, signal: res.signal, confidence: res.confidence,
          entry_zone: res.entry, reasoning: res.reasoning, session: ctx.session,
        }).then(() => {});
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      clearInterval(msgTimer);
      setLoading(false);
    }
  };

  const ctx = gatherContext();

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8' }}>AI Arena</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#252040', color: '#b8aeff', border: '0.5px solid #4a3f80', letterSpacing: '.05em' }}>GROK-3</span>
        </div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>News-based signal engine — LONG / SHORT / FLAT</div>
      </div>

      {/* API Key */}
      <div className="arena-key-row">
        <input
          className="arena-key-input"
          type="password"
          placeholder="xAI Grok API key (stored locally)"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveKey()}
        />
        <button className="arena-key-save" onClick={saveKey}>Save key</button>
      </div>
      {keyStatus && <div style={{ fontSize: 12, color: hasKey ? '#7de0a4' : '#f5cc7a', marginBottom: 10 }}>{keyStatus}</div>}

      {!hasKey && (
        <div className="arena-no-key">
          <div className="arena-no-key-icon">🔑</div>
          <div className="arena-no-key-title">xAI API key required</div>
          <div className="arena-no-key-sub">Enter your Grok API key above to enable the signal engine. Keys are stored only in your browser localStorage — never sent to any server.</div>
        </div>
      )}

      {/* Coin selector */}
      <div className="arena-coin-row">
        {COINS.map(c => (
          <button key={c} className={`arena-coin-btn${selectedCoin === c ? ' sel' : ''}`} onClick={() => setSelectedCoin(c)}>
            {c.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Live context */}
      <div className="arena-context">
        <div className="arena-context-title">Live context being sent to Grok</div>
        {[
          ['Coin', ctx.coin], ['Price', ctx.price], ['24h Change', ctx.change24h],
          ['Funding', ctx.fundingRate], ['Open Interest', ctx.openInterest],
          ['Fear & Greed', ctx.fearGreed], ['BTC Dom', ctx.btcDominance],
          ['Session', ctx.session],
          ['News feed', ctx.news.slice(0, 80) + (ctx.news.length > 80 ? '…' : '')],
        ].map(([k, v]) => (
          <div key={k} className="arena-context-row">
            <span className="arena-context-key">{k}</span>
            <span className="arena-context-val">{v}</span>
          </div>
        ))}
      </div>

      <button className="arena-fire-btn" disabled={loading || !hasKey} onClick={fire}>
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
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#444', marginBottom: 8 }}>Signal history</div>
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
