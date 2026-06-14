'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AuthGate from '@/components/AuthGate';
import { COINS } from '@/lib/marketStore';

type Status = 'loading' | 'configured' | 'not_configured';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = COINS;
const COIN_LABELS: Record<string, string> = Object.fromEntries(COINS.map(c => [c, c.toUpperCase()]));

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="tg-copy-box">
      <code className="tg-copy-code">{text}</code>
      <button className="tg-copy-btn" onClick={copy}>{copied ? '✓' : 'Copy'}</button>
    </div>
  );
}

export default function AlertsPage() {
  const [status, setStatus]         = useState<Status>('loading');
  const [testState, setTestState]   = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [testErr, setTestErr]       = useState('');
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done'>('idle');
  const [checkResult, setCheckResult] = useState<{ fired: string[]; rates?: Record<string, number | null> } | null>(null);

  // Muted alert groups
  const [muted, setMuted]               = useState<Set<string>>(new Set());
  const [muteErr, setMuteErr]           = useState('');

  // Alert history
  const [history, setHistory] = useState<{ label: string; ts: number }[]>([]);
  const histTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Price alerts state
  const [priceAlerts, setPriceAlerts]   = useState<PriceAlert[]>([]);
  const [paLoading, setPaLoading]       = useState(false);
  const [paCoin, setPaCoin]             = useState('btc');
  const [paPrice, setPaPrice]           = useState('');
  const [paDir, setPaDir]               = useState<'above' | 'below'>('above');
  const [paLabel, setPaLabel]           = useState('');
  const [paAdding, setPaAdding]         = useState(false);

  const fetchHistory = useCallback(() => {
    fetch('/api/telegram/history').then(r => r.json())
      .then(d => setHistory(d.fires ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setStatus('not_configured'));
    fetch('/api/alert-prefs').then(r => r.json())
      .then(d => setMuted(new Set<string>(d.muted ?? [])))
      .catch(() => {});
    fetchHistory();
    histTimerRef.current = setInterval(fetchHistory, 60_000);
    return () => { if (histTimerRef.current) clearInterval(histTimerRef.current); };
  }, [fetchHistory]);

  const toggleMute = async (key: string) => {
    const willMute = !muted.has(key);
    // Optimistic flip
    setMuted(prev => {
      const next = new Set(prev);
      if (willMute) next.add(key); else next.delete(key);
      return next;
    });
    setMuteErr('');
    try {
      const res = await fetch('/api/alert-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, muted: willMute }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? 'Save failed');
    } catch (e) {
      // Roll back
      setMuted(prev => {
        const next = new Set(prev);
        if (willMute) next.delete(key); else next.add(key);
        return next;
      });
      setMuteErr(e instanceof Error ? e.message : 'Save failed — is the muted_alerts table created?');
    }
  };

  const loadPriceAlerts = useCallback(async () => {
    setPaLoading(true);
    try {
      const res = await fetch('/api/price-alerts');
      const d   = await res.json();
      setPriceAlerts(d.alerts ?? []);
    } catch { /* skip */ }
    setPaLoading(false);
  }, []);

  useEffect(() => { loadPriceAlerts(); }, [loadPriceAlerts]);

  const addPriceAlert = async () => {
    if (!paPrice || isNaN(parseFloat(paPrice))) return;
    setPaAdding(true);
    try {
      await fetch('/api/price-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin: paCoin, target_price: parseFloat(paPrice), direction: paDir, label: paLabel }),
      });
      setPaPrice(''); setPaLabel('');
      window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'priceAlert' }));
      await loadPriceAlerts();
    } catch { /* skip */ }
    setPaAdding(false);
  };

  const deletePriceAlert = async (id: number) => {
    try {
      await fetch(`/api/price-alerts?id=${id}`, { method: 'DELETE' });
      setPriceAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* skip */ }
  };

  const sendTest = async () => {
    setTestState('sending'); setTestErr('');
    try {
      const res = await fetch('/api/telegram/test');
      const d   = await res.json();
      if (d.ok) { setTestState('ok'); setTimeout(() => setTestState('idle'), 3000); window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'telegram' })); }
      else { setTestState('err'); setTestErr(d.error ?? 'Unknown error'); }
    } catch { setTestState('err'); setTestErr('Network error'); }
  };

  const checkNow = async () => {
    setCheckState('checking'); setCheckResult(null);
    try {
      const res = await fetch('/api/telegram/alert');
      setCheckResult(await res.json());
    } catch { /* skip */ }
    setCheckState('done');
  };

  const CRON_URL = 'https://liquidity-hq.onrender.com/api/telegram/alert';

  /* Each toggle maps 1:1 to a server-side check in /api/telegram/alert.
     Muting a key stops that whole check from running. */
  const ALERT_GROUPS: { section: string; items: { key: string; dot: string; title: string; desc: string; grok: boolean }[] }[] = [
    { section: '💸 Funding', items: [
      { key: 'fr_extremes', dot: '#f87171', title: 'FR Extremes',       desc: '≥ 0.05% longs overcrowded (dump risk) · ≤ −0.03% shorts crowded (squeeze setup) · 4h cooldown', grok: false },
      { key: 'fr_flip',     dot: '#60a5fa', title: 'FR Direction Flip', desc: 'FR crosses zero (pos→neg or neg→pos) · fires on transition', grok: false },
    ]},
    { section: '📈 Momentum', items: [
      { key: 'rsi',        dot: '#fbbf24', title: 'RSI Alerts (1H)', desc: '> 78 overbought · < 22 oversold · 50-cross momentum shifts · 4–6h cooldowns', grok: false },
      { key: 'rapid_move', dot: '#fb923c', title: 'Rapid Moves',     desc: '±5% 1H candle · ±10% 4H candle · flash ±4% in 5 min · 30min–4h cooldowns', grok: true },
    ]},
    { section: '📊 Trend', items: [
      { key: 'ema_cross', dot: '#34d399', title: '200 EMA Cross (1H)', desc: 'Price reclaims (bullish) or loses (bearish) the major moving average · 12h cooldown', grok: true },
    ]},
    { section: '🐋 Flow', items: [
      { key: 'whales',   dot: '#a78bfa', title: 'Whale Trades',         desc: 'BTC >$5M · ETH >$2M · SOL >$1M · XRP/BNB >$750K · others >$500K · 30min cooldown', grok: true },
      { key: 'oi_spike', dot: '#fbbf24', title: 'OI Spike ±15% in 1h', desc: 'New money entering — big move building · 2h cooldown', grok: true },
      { key: 'cvd',      dot: '#34d399', title: 'CVD Divergence',       desc: 'Bullish: price down but buyers absorbing · Bearish: price up but sellers dominate · 1h cooldown', grok: false },
      { key: 'squeeze',  dot: '#f43f5e', title: 'Squeeze / Flush ≥ 70', desc: 'Crowd positioning extreme — squeeze score threshold hit · 4h cooldown', grok: true },
    ]},
    { section: '📰 News & Sentiment', items: [
      { key: 'news',               dot: '#f87171', title: 'Breaking News',        desc: 'Geopolitical / macro Finnhub headlines · 15min cooldown', grok: true },
      { key: 'fear_greed',         dot: '#f97316', title: 'Fear & Greed Extremes', desc: '≤ 15 extreme fear (accumulation zone) · ≥ 85 extreme greed (distribution) · 23h cooldown', grok: false },
      { key: 'sentiment_extremes', dot: '#f43f5e', title: 'Sentiment Extremes',    desc: 'F&G + BTC funding + BTC L/S ratio all at extremes simultaneously · 4h cooldown', grok: true },
    ]},
    { section: '🎯 Price & Summary', items: [
      { key: 'price_alerts',  dot: '#c084fc', title: 'Price Level Alerts', desc: 'Your saved price targets above · fires once then deactivates', grok: true },
      { key: 'daily_summary', dot: '#fbbf24', title: 'Daily 7am Summary',  desc: 'FR snapshot + F&G + active price alerts + LiquidityAI market outlook · once daily at 7am PHT', grok: true },
    ]},
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-header">
        <div className="mb-title">🔔 Telegram Alerts</div>
        <div className="mb-subtitle">Push alerts to your phone — funding, RSI, EMA cross, rapid moves, whales, news, OI, CVD, price levels</div>
      </div>

      {/* Status */}
      <div className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`tg-status-dot ${status === 'configured' ? 'tg-dot-on' : status === 'loading' ? 'tg-dot-loading' : 'tg-dot-off'}`} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
            {status === 'loading' ? 'Checking configuration…' : status === 'configured' ? 'Telegram connected' : 'Not configured — follow setup below'}
          </div>
          {status === 'not_configured' && (
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render environment variables.</div>
          )}
        </div>
      </div>

      {/* Price Alerts — requires sign-in */}
      <AuthGate
        title="Sign in to use Price Alerts"
        desc="Save price targets and get Telegram pings when they're hit. Free account required."
      >
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 12 }}>🎯 Price Alerts</div>

        {/* Add form */}
        <div className="pa-form">
          <select className="pa-select" value={paCoin} onChange={e => setPaCoin(e.target.value)}>
            {COIN_OPTIONS.map(c => <option key={c} value={c}>{COIN_LABELS[c]}</option>)}
          </select>
          <select className="pa-select" value={paDir} onChange={e => setPaDir(e.target.value as 'above' | 'below')}>
            <option value="above">↑ Above</option>
            <option value="below">↓ Below</option>
          </select>
          <input
            className="pa-input"
            type="number"
            placeholder="Price (e.g. 95000)"
            value={paPrice}
            onChange={e => setPaPrice(e.target.value)}
          />
          <input
            className="pa-input pa-input-label"
            type="text"
            placeholder="Note (optional)"
            value={paLabel}
            onChange={e => setPaLabel(e.target.value)}
          />
          <button
            className="tg-action-btn"
            onClick={addPriceAlert}
            disabled={paAdding || !paPrice}
          >
            {paAdding ? 'Adding…' : '+ Add Alert'}
          </button>
        </div>

        {/* Active alerts list */}
        {paLoading ? (
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 10 }}>Loading…</div>
        ) : priceAlerts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 10, padding: '10px 0', textAlign: 'center' }}>
            No price alerts set. Add one above.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {priceAlerts.map(alert => (
              <div key={alert.id} className="pa-row">
                <span className="pa-coin">{COIN_LABELS[alert.coin] ?? alert.coin.toUpperCase()}</span>
                <span className="pa-dir">{alert.direction === 'above' ? '↑' : '↓'}</span>
                <span className="pa-price">${parseFloat(String(alert.target_price)).toLocaleString()}</span>
                {alert.label && <span className="pa-note">{alert.label}</span>}
                <button className="pa-del" onClick={() => deletePriceAlert(alert.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10, lineHeight: 1.5 }}>
          Fires once when price crosses your target → LiquidityAI analysis included → alert deactivates automatically.
        </div>
      </div>
      </AuthGate>

      {/* Recently Fired History */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="lbl" style={{ margin: 0 }}>Recently Fired</div>
          {history.length > 0 && (
            <button
              style={{ fontSize: 10, color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={fetchHistory}
            >
              ↻ refresh
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--txt3)', padding: '10px 0', textAlign: 'center' }}>
            No alerts fired since last server start
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {history.slice(0, 15).map((f, i) => {
              const age = (Date.now() - f.ts) / 1000;
              const ago = age < 60 ? 'just now' : age < 3600 ? `${Math.floor(age / 60)}m ago` : age < 86400 ? `${Math.floor(age / 3600)}h ago` : `${Math.floor(age / 86400)}d ago`;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: i < Math.min(history.length, 15) - 1 ? '0.5px solid var(--bdr)' : 'none',
                  gap: 10,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--txt2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🔔 {f.label}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--txt3)', flexShrink: 0 }}>{ago}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--bdr)' }}>
          In-memory — resets on server restart · auto-refreshes every 60s
        </div>
      </div>

      {/* Test & Manual Check */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 12 }}>Test Connection</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={`tg-action-btn${testState === 'ok' ? ' tg-btn-ok' : testState === 'err' ? ' tg-btn-err' : ''}`}
            onClick={sendTest} disabled={testState === 'sending' || status !== 'configured'}>
            {testState === 'sending' ? 'Sending…' : testState === 'ok' ? '✓ Sent!' : testState === 'err' ? '✕ Failed' : 'Send Test Message'}
          </button>
          <button className={`tg-action-btn tg-btn-secondary`} onClick={checkNow} disabled={checkState === 'checking' || status !== 'configured'}>
            {checkState === 'checking' ? 'Checking…' : 'Check Alerts Now'}
          </button>
        </div>
        {testState === 'err' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{testErr}</div>}
        {checkState === 'done' && checkResult && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--txt2)', lineHeight: 1.7 }}>
            {checkResult.fired?.length === 0 ? '✓ No alert conditions active right now.' : `🔔 Fired: ${checkResult.fired.join(', ')}`}
          </div>
        )}
      </div>

      {/* Alert conditions — grouped, with per-group mute toggles */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Alert Conditions</div>
        <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
          Toggle off to mute a group — applies to the background cron too. 🤖 AI = includes LiquidityAI analysis.
        </div>
        {muteErr && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>
            ⚠ {muteErr}
          </div>
        )}
        {ALERT_GROUPS.map(group => (
          <div key={group.section} style={{ marginBottom: 6 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
              color: 'var(--txt3)', padding: '8px 0 4px', borderBottom: '0.5px solid var(--bdr)',
            }}>
              {group.section}
            </div>
            {group.items.map(c => {
              const isMuted = muted.has(c.key);
              return (
                <div key={c.key} className="tg-condition-row" style={{ opacity: isMuted ? 0.45 : 1, transition: 'opacity .15s' }}>
                  <span className="tg-cond-dot" style={{ background: isMuted ? 'var(--txt3)' : c.dot }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
                      {c.title}
                      {isMuted && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>MUTED</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{c.desc}</div>
                  </div>
                  {c.grok && <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>🤖 AI</span>}
                  <button
                    role="switch"
                    aria-checked={!isMuted}
                    aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${c.title}`}
                    className={`st-toggle${!isMuted ? ' on' : ''}`}
                    style={{ flexShrink: 0 }}
                    onClick={() => toggleMute(c.key)}
                  >
                    <span className="st-toggle-thumb" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {/* Confluence is a meta-behavior of the send pipeline — not muteable */}
        <div className="tg-condition-row" style={{ borderBottom: 'none' }}>
          <span className="tg-cond-dot" style={{ background: '#818cf8' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>Confluence Alert <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>ALWAYS ON</span></div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>2+ signals on the same coin in one run → single combined ping · LiquidityAI weighs all signals together</div>
          </div>
          <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>🤖 AI</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10, padding: '8px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          Monitored: all {COINS.length} coins — BTC · ETH · SOL · XRP · BNB · HYPE · NEAR · SUI · DOGE · AVAX · LINK · ADA · DOT · ATOM · WIF · PEPE · BONK
        </div>
      </div>

      {/* Setup guide */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 12 }}>Setup — 3 Steps</div>
        <div className="tg-step">
          <div className="tg-step-num">1</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Create a bot via BotFather</div>
            <ol className="tg-list">
              <li>Open Telegram → search <strong>@BotFather</strong></li>
              <li>Send <code>/newbot</code> → choose a name → copy the <strong>Bot Token</strong></li>
            </ol>
          </div>
        </div>
        <div className="tg-step">
          <div className="tg-step-num">2</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Get your Chat ID</div>
            <ol className="tg-list">
              <li>Message your bot any text</li>
              <li>Visit <code>api.telegram.org/bot&#123;TOKEN&#125;/getUpdates</code> → find <code>&quot;id&quot;: 123456789</code></li>
            </ol>
          </div>
        </div>
        <div className="tg-step" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <div className="tg-step-num">3</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Add to Render + create Supabase table</div>
            <ol className="tg-list">
              <li>Render → Environment → add <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code></li>
              <li>Supabase dashboard → SQL Editor → run:
                <CopyBox text={`CREATE TABLE price_alerts (id BIGSERIAL PRIMARY KEY, coin TEXT NOT NULL, target_price NUMERIC NOT NULL, direction TEXT NOT NULL, label TEXT DEFAULT '', active BOOLEAN DEFAULT TRUE, triggered_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE price_alerts DISABLE ROW LEVEL SECURITY; CREATE TABLE IF NOT EXISTS muted_alerts (key TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE muted_alerts DISABLE ROW LEVEL SECURITY;`} />
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Cron setup */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Enable Background Alerts</div>
        <p style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6, marginBottom: 12 }}>
          Set up a free cron at <a href="https://cron-job.org" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)' }}>cron-job.org</a> to
          ping the alert endpoint every 5 minutes:
        </p>
        <CopyBox text={CRON_URL} />
      </div>

      <div style={{ fontSize: 10, color: 'var(--txt3)', textAlign: 'center', marginBottom: 16 }}>
        In-memory cooldowns reset on server restart · keep UptimeRobot running to minimise restarts
      </div>
    </div>
  );
}
