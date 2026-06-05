'use client';
import { useState, useEffect, useCallback } from 'react';
import AuthGate from '@/components/AuthGate';

type Status = 'loading' | 'configured' | 'not_configured';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui'];
const COIN_LABELS: Record<string, string> = { btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP', bnb: 'BNB', hype: 'HYPE', near: 'NEAR', sui: 'SUI' };

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

  // Price alerts state
  const [priceAlerts, setPriceAlerts]   = useState<PriceAlert[]>([]);
  const [paLoading, setPaLoading]       = useState(false);
  const [paCoin, setPaCoin]             = useState('btc');
  const [paPrice, setPaPrice]           = useState('');
  const [paDir, setPaDir]               = useState<'above' | 'below'>('above');
  const [paLabel, setPaLabel]           = useState('');
  const [paAdding, setPaAdding]         = useState(false);

  useEffect(() => {
    fetch('/api/telegram/status').then(r => r.json())
      .then(d => setStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setStatus('not_configured'));
  }, []);

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
      if (d.ok) { setTestState('ok'); setTimeout(() => setTestState('idle'), 3000); }
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

  const CONDITIONS = [
    { dot: '#f87171', title: 'FR ≥ 0.05%',           desc: 'Longs Overcrowded — Dump Risk · 4h cooldown', grok: false },
    { dot: '#34d399', title: 'FR ≤ −0.03%',           desc: 'Shorts Crowded — Squeeze Setup · 4h cooldown', grok: false },
    { dot: '#60a5fa', title: 'FR Direction Flip',      desc: 'FR crosses zero (pos→neg or neg→pos) · fires on transition', grok: false },
    { dot: '#fbbf24', title: '1H RSI > 78',            desc: 'Overbought — Exhaustion Risk · 4h cooldown', grok: false },
    { dot: '#60a5fa', title: '1H RSI < 22',            desc: 'Oversold — Bounce Setup · 4h cooldown', grok: false },
    { dot: '#a78bfa', title: 'Whale Trade',            desc: 'BTC >$5M · ETH >$2M · SOL >$1M · XRP/BNB >$750K · NEAR/SUI >$500K · 30min cooldown', grok: true },
    { dot: '#f87171', title: 'Breaking News',          desc: 'Geopolitical / macro Finnhub headlines · 15min cooldown', grok: true },
    { dot: '#fbbf24', title: 'OI Spike ±15% in 1h',   desc: 'New money entering — big move building · 2h cooldown', grok: true },
    { dot: '#34d399', title: 'CVD Bullish Divergence', desc: 'Price down but buyers absorbing — accumulation signal · 1h cooldown', grok: false },
    { dot: '#f87171', title: 'CVD Bearish Divergence', desc: 'Price up but sellers dominate — fake pump signal · 1h cooldown', grok: false },
    { dot: '#c084fc', title: 'Price Level Alert',      desc: 'User-set price targets · fires once then deactivates', grok: true },
    { dot: '#34d399', title: 'RSI 50 Cross ↑ (1H)',    desc: 'RSI crosses above 50 — bullish momentum shift · 6h cooldown', grok: false },
    { dot: '#f87171', title: 'RSI 50 Cross ↓ (1H)',    desc: 'RSI crosses below 50 — bearish momentum shift · 6h cooldown', grok: false },
    { dot: '#34d399', title: '200 EMA Cross ↑ (1H)',   desc: 'Price reclaims major moving average — bullish · 12h cooldown', grok: true },
    { dot: '#f87171', title: '200 EMA Cross ↓ (1H)',   desc: 'Price loses major moving average — bearish · 12h cooldown', grok: true },
    { dot: '#fb923c', title: 'Rapid Move ±5% (1H)',    desc: 'Momentum surge or flash dump in one 1H candle · 2h cooldown', grok: true },
    { dot: '#fb923c', title: 'Rapid Move ±10% (4H)',   desc: 'Major momentum candle on 4H — trend move · 4h cooldown', grok: true },
    { dot: '#f97316', title: 'Flash Move ±4% (5m)',    desc: 'Stop cascade or news flash — extreme 5-min move · 30min cooldown', grok: true },
    { dot: '#818cf8', title: 'Confluence Alert',        desc: '2+ signals same coin in one run → single combined ping · LiquidityAI weighs all signals together', grok: true },
    { dot: '#f87171', title: 'Fear & Greed ≤15',        desc: 'Extreme fear — contrarian accumulation zone · 23h cooldown', grok: false },
    { dot: '#f97316', title: 'Fear & Greed ≥85',        desc: 'Extreme greed — distribution zone · 23h cooldown', grok: false },
    { dot: '#fbbf24', title: 'Daily 7am Summary',       desc: 'FR snapshot + F&G + active price alerts + LiquidityAI market outlook · fires once daily at 7am PHT', grok: true },
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

      {/* Active conditions */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Active Alert Conditions</div>
        {CONDITIONS.map((c, i) => (
          <div key={i} className="tg-condition-row" style={{ borderBottom: i === CONDITIONS.length - 1 ? 'none' : undefined }}>
            <span className="tg-cond-dot" style={{ background: c.dot }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{c.title}</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{c.desc}</div>
            </div>
            {c.grok && <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>🤖 AI</span>}
          </div>
        ))}
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10, padding: '8px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          Monitored: BTC · ETH · SOL · XRP · BNB · HYPE · NEAR · SUI
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
                <CopyBox text={`CREATE TABLE price_alerts (id BIGSERIAL PRIMARY KEY, coin TEXT NOT NULL, target_price NUMERIC NOT NULL, direction TEXT NOT NULL, label TEXT DEFAULT '', active BOOLEAN DEFAULT TRUE, triggered_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()); ALTER TABLE price_alerts DISABLE ROW LEVEL SECURITY;`} />
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
