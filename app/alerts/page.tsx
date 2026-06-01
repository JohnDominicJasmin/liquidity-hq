'use client';
import { useState, useEffect } from 'react';

type Status = 'loading' | 'configured' | 'not_configured';

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="tg-copy-box">
      <code className="tg-copy-code">{text}</code>
      <button className="tg-copy-btn" onClick={copy}>{copied ? '✓' : 'Copy'}</button>
    </div>
  );
}

export default function AlertsPage() {
  const [status, setStatus]       = useState<Status>('loading');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [testErr, setTestErr]     = useState('');
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done'>('idle');
  const [checkResult, setCheckResult] = useState<{ fired: string[]; rates: Record<string, number | null> } | null>(null);

  useEffect(() => {
    fetch('/api/telegram/status')
      .then(r => r.json())
      .then(d => setStatus(d.configured ? 'configured' : 'not_configured'))
      .catch(() => setStatus('not_configured'));
  }, []);

  const sendTest = async () => {
    setTestState('sending');
    setTestErr('');
    try {
      const res = await fetch('/api/telegram/test');
      const d   = await res.json();
      if (d.ok) {
        setTestState('ok');
        setTimeout(() => setTestState('idle'), 3000);
      } else {
        setTestState('err');
        setTestErr(d.error ?? 'Unknown error');
      }
    } catch {
      setTestState('err');
      setTestErr('Network error');
    }
  };

  const checkNow = async () => {
    setCheckState('checking');
    setCheckResult(null);
    try {
      const res = await fetch('/api/telegram/alert');
      const d   = await res.json();
      setCheckResult(d);
      setCheckState('done');
    } catch {
      setCheckState('done');
    }
  };

  const CRON_URL = 'https://liquidity-hq.onrender.com/api/telegram/alert';

  return (
    <div>
      {/* Header */}
      <div className="mb-header">
        <div className="mb-title">🔔 Telegram Alerts</div>
        <div className="mb-subtitle">
          Push alerts to your phone — funding extremes, squeeze setups, and more
        </div>
      </div>

      {/* Status badge */}
      <div className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`tg-status-dot ${status === 'configured' ? 'tg-dot-on' : status === 'loading' ? 'tg-dot-loading' : 'tg-dot-off'}`} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
            {status === 'loading'       ? 'Checking configuration…'
            : status === 'configured'   ? 'Telegram connected'
            : 'Not configured — follow setup below'}
          </div>
          {status === 'not_configured' && (
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
              Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your Render environment variables.
            </div>
          )}
        </div>
      </div>

      {/* ── Step-by-step setup ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 12 }}>Setup — 3 Steps</div>

        {/* Step 1 */}
        <div className="tg-step">
          <div className="tg-step-num">1</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Create a bot via BotFather</div>
            <ol className="tg-list">
              <li>Open Telegram → search <strong>@BotFather</strong></li>
              <li>Send <code>/newbot</code></li>
              <li>Choose any name (e.g. <em>LiquidityHQ</em>)</li>
              <li>BotFather gives you a <strong>Bot Token</strong> — copy it</li>
            </ol>
          </div>
        </div>

        {/* Step 2 */}
        <div className="tg-step">
          <div className="tg-step-num">2</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Get your Chat ID</div>
            <ol className="tg-list">
              <li>Search for your new bot in Telegram and send it any message</li>
              <li>Open this URL in your browser (replace TOKEN):
                <CopyBox text={`https://api.telegram.org/bot{TOKEN}/getUpdates`} />
              </li>
              <li>Find <code>"chat":{'{'}...,"id": 123456789{'}'}</code> — that number is your Chat ID</li>
            </ol>
          </div>
        </div>

        {/* Step 3 */}
        <div className="tg-step" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <div className="tg-step-num">3</div>
          <div className="tg-step-body">
            <div className="tg-step-title">Add env vars in Render</div>
            <ol className="tg-list">
              <li>Go to your Render dashboard → <strong>liquidity-hq</strong> → <strong>Environment</strong></li>
              <li>Add these two variables:
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <CopyBox text="TELEGRAM_BOT_TOKEN" />
                  <CopyBox text="TELEGRAM_CHAT_ID" />
                </div>
              </li>
              <li>Click <strong>Save Changes</strong> → Render will auto-redeploy</li>
            </ol>
          </div>
        </div>
      </div>

      {/* ── Test & Manual Check ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 12 }}>Test Connection</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className={`tg-action-btn${testState === 'ok' ? ' tg-btn-ok' : testState === 'err' ? ' tg-btn-err' : ''}`}
            onClick={sendTest}
            disabled={testState === 'sending' || status !== 'configured'}
          >
            {testState === 'sending' ? 'Sending…'
            : testState === 'ok'     ? '✓ Message sent!'
            : testState === 'err'    ? '✕ Failed'
            : 'Send Test Message'}
          </button>
          <button
            className={`tg-action-btn tg-btn-secondary${checkState === 'checking' ? ' disabled' : ''}`}
            onClick={checkNow}
            disabled={checkState === 'checking' || status !== 'configured'}
          >
            {checkState === 'checking' ? 'Checking…' : 'Check Alerts Now'}
          </button>
        </div>
        {testState === 'err' && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{testErr}</div>
        )}
        {checkState === 'done' && checkResult && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--txt2)', lineHeight: 1.7 }}>
            {checkResult.fired.length === 0
              ? '✓ No alert conditions active right now.'
              : `🔔 Fired: ${checkResult.fired.join(', ')}`}
            <div style={{ marginTop: 6, color: 'var(--txt3)' }}>
              Live rates: {Object.entries(checkResult.rates)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k.toUpperCase()} ${(v! >= 0 ? '+' : '') + v}%`)
                .join(' · ')}
            </div>
          </div>
        )}
      </div>

      {/* ── Active alert conditions ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Active Alert Conditions</div>
        <div className="tg-condition-row">
          <span className="tg-cond-dot" style={{ background: '#f87171' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
              Funding Rate ≥ 0.05% on any coin
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
              Longs Overcrowded — Dump Risk · 4h cooldown per coin
            </div>
          </div>
        </div>
        <div className="tg-condition-row" style={{ borderBottom: 'none' }}>
          <span className="tg-cond-dot" style={{ background: '#34d399' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
              Funding Rate ≤ −0.03% on any coin
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
              Shorts Crowded — Squeeze Setup · 4h cooldown per coin
            </div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10, padding: '8px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          Monitored coins: BTC · ETH · SOL · XRP · BNB · HYPE · NEAR
        </div>
      </div>

      {/* ── Cron setup ── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>Enable Background Alerts (when app is closed)</div>
        <p style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6, marginBottom: 12 }}>
          Alerts only fire when the server is pinged. Set up a free external cron to ping
          the alert endpoint every 5 minutes — you&apos;ll then get Telegram messages even
          while sleeping.
        </p>

        <div className="tg-step" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <div className="tg-step-num">→</div>
          <div className="tg-step-body">
            <div className="tg-step-title">
              <a href="https://cron-job.org" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)', textDecoration: 'none' }}>
                cron-job.org
              </a>
              {' '}(free, no credit card)
            </div>
            <ol className="tg-list">
              <li>Create a free account at cron-job.org</li>
              <li>New cronjob → URL:
                <CopyBox text={CRON_URL} />
              </li>
              <li>Schedule: <strong>Every 5 minutes</strong></li>
              <li>Save — done. You now get push alerts 24/7.</li>
            </ol>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--txt3)', textAlign: 'center', marginBottom: 16, lineHeight: 1.6 }}>
        Cooldown resets on server restart. Keep UptimeRobot pinging the app to minimise restarts.
      </div>
    </div>
  );
}
