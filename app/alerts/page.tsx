'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AuthGate from '@/components/AuthGate';
import UpgradeGateModal, { LockedFeatureCard } from '@/components/UpgradeGateModal';
import { Warn } from '@/components/icons';
import { COINS } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { utcHourToLocalTime } from '@/lib/resetTime';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import AlertOutcomes from '@/components/AlertOutcomes';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = COINS;
const COIN_LABELS: Record<string, string> = Object.fromEntries(COINS.map(c => [c, c.toUpperCase()]));

const ALERT_COIN_CAP = 20; // Alerts is a Pro-only feature - single cap, no free/pro split needed here

export default function AlertsPage() {
  const { user, isPro } = useAuth();
  const { settings, loading: settingsLoading, update } = useSettings();
  const [upgradeGate, setUpgradeGate] = useState<string | null>(null);

  // utcHourToLocalTime() uses the runtime's own timezone (toLocaleTimeString with
  // no explicit zone), so it renders different text on the server (container's
  // UTC clock) than the client's first hydration pass (viewer's local timezone) -
  // a text-mismatch hydration error (React #418). Seed with a fixed UTC label
  // (identical on server and the client's first paint), then swap to the real
  // localized time once mounted - no flash, no mismatch.
  const [dailySummaryLocalTime, setDailySummaryLocalTime] = useState('07:00 UTC');
  useEffect(() => { setDailySummaryLocalTime(utcHourToLocalTime(7)); }, []);

  // Derived from settings - no separate API call needed
  const isConnected = !settingsLoading && !!settings.telegram_chat_id;

  const [testState, setTestState]   = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [testErr, setTestErr]       = useState('');
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done' | 'err'>('idle');
  const [checkResult, setCheckResult] = useState<{ fired: string[]; note?: string } | null>(null);
  const [checkErr, setCheckErr]       = useState('');

  // Wizard state
  const [chatIdInput, setChatIdInput] = useState('');
  const [detecting, setDetecting]     = useState(false);
  const [detectError, setDetectError] = useState('');
  const [detected, setDetected]       = useState(false);
  const [botUsername, setBotUsername]   = useState<string | null>(null);
  const [webhookOk, setWebhookOk]       = useState(true);
  const [saveState, setSaveState]     = useState<'idle' | 'saving' | 'saved'>('idle');

  // Muted alert groups
  const [muted, setMuted]   = useState<Set<string>>(new Set());
  const [muteErr, setMuteErr] = useState('');
  const [coinCapMsg, setCoinCapMsg] = useState('');
  const [coinSearch, setCoinSearch] = useState('');

  // Alert history
  const [history, setHistory] = useState<{ label: string; ts: number }[]>([]);
  const histTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Price alerts
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [paLoading, setPaLoading]     = useState(false);
  const [paCoin, setPaCoin]           = useState('btc');
  const [paPrice, setPaPrice]         = useState('');
  const [paDir, setPaDir]             = useState<'above' | 'below'>('above');
  const [paLabel, setPaLabel]         = useState('');
  const [paAdding, setPaAdding]       = useState(false);
  const [paError, setPaError]         = useState('');

  const fetchHistory = useCallback(() => {
    fetch('/api/telegram/history').then(r => r.json())
      .then(d => setHistory(d.fires ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/telegram/bot-info').then(r => r.json())
      .then(d => { setBotUsername(d.username ?? null); setWebhookOk(d.webhook_ok !== false); })
      .catch(() => {});
    getAuthToken().then(token => {
      if (!token) return;
      fetch('/api/alert-prefs', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setMuted(new Set<string>(d.muted ?? [])))
        .catch(() => {});
    });
    fetchHistory();
    histTimerRef.current = setInterval(fetchHistory, 60_000);
    return () => { if (histTimerRef.current) clearInterval(histTimerRef.current); };
  }, [fetchHistory]);

  // Sync input from saved settings when they load
  useEffect(() => {
    if (settings.telegram_chat_id) setChatIdInput(settings.telegram_chat_id);
  }, [settings.telegram_chat_id]);

  const getAuthToken = async (): Promise<string | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const toggleMute = async (key: string) => {
    const willMute = !muted.has(key);
    setMuted(prev => { const n = new Set(prev); willMute ? n.add(key) : n.delete(key); return n; });
    setMuteErr('');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/alert-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ key, muted: willMute }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? 'Save failed');
    } catch (e) {
      setMuted(prev => { const n = new Set(prev); willMute ? n.delete(key) : n.add(key); return n; });
      setMuteErr(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const toggleCoin = (c: string) => {
    const key = `coin:${c}`;
    const isOff = muted.has(key);
    if (isOff) {
      const onCount = COINS.filter(x => !muted.has(`coin:${x}`)).length;
      if (onCount >= ALERT_COIN_CAP) {
        setCoinCapMsg(
          onCount > ALERT_COIN_CAP
            ? `You have ${onCount} coins on, above the ${ALERT_COIN_CAP}-coin limit - turn some off before adding another.`
            : `Limit reached (${ALERT_COIN_CAP}/${ALERT_COIN_CAP} coins) - turn one off to add another.`
        );
        return;
      }
    }
    setCoinCapMsg('');
    toggleMute(key);
  };

  const loadPriceAlerts = useCallback(async () => {
    setPaLoading(true);
    try {
      const token = await getAuthToken();
      const d = await fetch('/api/price-alerts', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(r => r.json());
      setPriceAlerts(d.alerts ?? []);
    } catch { /* skip */ }
    setPaLoading(false);
  }, []);

  useEffect(() => { loadPriceAlerts(); }, [loadPriceAlerts]);

  const addPriceAlert = async () => {
    if (!paPrice || isNaN(parseFloat(paPrice))) return;
    setPaAdding(true);
    setPaError('');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/price-alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ coin: paCoin, target_price: parseFloat(paPrice), direction: paDir, label: paLabel }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to add alert');
      setPaPrice(''); setPaLabel('');
      window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'priceAlert' }));
      await loadPriceAlerts();
    } catch (e) {
      setPaError(e instanceof Error ? e.message : 'Failed to add alert');
    }
    setPaAdding(false);
  };

  const deletePriceAlert = async (id: number) => {
    setPaError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/price-alerts?id=${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to remove alert');
      setPriceAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      setPaError(e instanceof Error ? e.message : 'Failed to remove alert');
    }
  };

  const sendTest = async () => {
    setTestState('sending'); setTestErr('');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/telegram/test', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json();
      if (d.ok) {
        setTestState('ok');
        setTimeout(() => setTestState('idle'), 3000);
        window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'telegram' }));
      } else {
        setTestState('err'); setTestErr(d.error ?? 'Unknown error');
      }
    } catch { setTestState('err'); setTestErr('Network error'); }
  };

  const detectChatId = async () => {
    setDetecting(true); setDetectError(''); setDetected(false);
    try {
      const res = await fetch('/api/telegram/detect');
      const d = await res.json();
      if (d.ok && d.chat_id) {
        setChatIdInput(d.chat_id);
        setDetected(true);
        try { await navigator.clipboard.writeText(d.chat_id); } catch { /* no clipboard access */ }
      } else {
        setDetectError(d.error ?? 'Could not detect. Send /start to the bot first.');
      }
    } catch { setDetectError('Network error'); }
    setDetecting(false);
  };

  const saveChatId = async () => {
    if (!chatIdInput.trim()) return;
    setSaveState('saving');
    update({ telegram_chat_id: chatIdInput.trim() });
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  };

  const checkNow = async () => {
    setCheckState('checking'); setCheckResult(null); setCheckErr('');
    try {
      const res = await fetch('/api/telegram/alert', { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const d = await res.json();
      setCheckResult(d);
      setCheckState('done');
    } catch (e) {
      setCheckErr(e instanceof Error ? e.message : 'Request failed');
      setCheckState('err');
    }
  };

  const botLink = botUsername ? `https://t.me/${botUsername}` : null;
  const botLabel = botUsername ? `@${botUsername}` : 'LiquidityHQ Bot';

  const ALERT_GROUPS: { section: string; items: { key: string; dot: string; title: string; desc: string; grok: boolean }[] }[] = [
    { section: 'Trading Signals', items: [
      { key: 'ema_setup', dot: '#4ade80', title: 'Entry Signal - EMA Ribbon Setup (4H)', desc: 'Potential LONG or SHORT entry: price pulls into the EMA 9–20 value zone with trend, ribbon spread, and funding aligned · includes stop loss and take profit levels · 6h cooldown', grok: true },
      { key: 'ema_setup_1h', dot: '#4ade80', title: 'Entry Signal - EMA Ribbon Setup (1H)', desc: 'Same EMA ribbon value-zone setup, checked on the 1H chart · includes stop loss and take profit levels · 2h cooldown', grok: true },
      { key: 'ema_setup_30m', dot: '#4ade80', title: 'Entry Signal - EMA Ribbon Setup (30M)', desc: 'Same EMA ribbon value-zone setup, checked on the 30M chart for faster-moving entries · includes stop loss and take profit levels · 1h cooldown', grok: true },
      { key: 'ema_setup_15m', dot: '#4ade80', title: 'Entry Signal - EMA Ribbon Setup (15M)', desc: 'Same EMA ribbon value-zone setup, checked on the 15M chart for the fastest entries · includes stop loss and take profit levels · 30min cooldown', grok: true },
    ]},
    { section: 'Momentum', items: [
      { key: 'rsi',        dot: '#fbbf24', title: 'RSI (1H)', desc: '> 78 overbought · < 22 oversold · 4h cooldown', grok: false },
      { key: 'rapid_move', dot: '#fb923c', title: 'Rapid Moves',     desc: '±5% 1H candle · ±10% 4H candle · flash ±4% in 5 min · 30min–4h cooldowns', grok: true },
    ]},
    { section: 'Trend', items: [
      { key: 'ema_cross', dot: '#34d399', title: '200 EMA Cross (1H)', desc: 'Price reclaims (bullish) or loses (bearish) the major moving average · 12h cooldown', grok: true },
    ]},
    { section: 'Flow', items: [
      { key: 'whales',   dot: '#1a7aff', title: 'Whale Trades',        desc: 'BTC >$5M · ETH >$2M · SOL >$1M · XRP/BNB >$750K · others >$500K · 30min cooldown', grok: true },
      { key: 'oi_spike', dot: '#fbbf24', title: 'Open Interest Spike ±15% / 1h', desc: 'New money entering - big move building · 2h cooldown', grok: true },
      { key: 'cvd',      dot: '#34d399', title: 'CVD Divergence',      desc: 'Bullish: price down but buyers absorbing · Bearish: price up but sellers dominate · 1h cooldown', grok: false },
      { key: 'squeeze',  dot: '#f43f5e', title: 'Squeeze / Flush ≥ 70', desc: 'Crowd positioning extreme - squeeze score threshold hit · 4h cooldown', grok: true },
      { key: 'distribution', dot: '#f97316', title: 'Distribution - Big Players Taking Profit', desc: 'Coin still up on the day but sellers hit into strength, open interest unwinds, whales lean out, retail keeps paying funding · fires at score ≥ 70 · 4h cooldown', grok: true },
    ]},
    { section: 'News & Sentiment', items: [
      { key: 'news',               dot: '#f87171', title: 'Breaking News',         desc: 'Geopolitical / macro Finnhub headlines · 15min cooldown', grok: true },
      { key: 'fear_greed',         dot: '#f97316', title: 'Fear & Greed Extremes', desc: '≤ 15 extreme fear · ≥ 85 extreme greed · 23h cooldown', grok: false },
      { key: 'sentiment_extremes', dot: '#f43f5e', title: 'Sentiment Extremes',    desc: 'F&G + BTC funding + BTC L/S ratio all at extremes simultaneously · 4h cooldown', grok: true },
    ]},
    { section: 'Price & Summary', items: [
      { key: 'price_alerts',  dot: '#9ba4ff', title: 'Price Level Alerts', desc: 'Your saved price targets · fires once then deactivates', grok: true },
      { key: 'daily_summary', dot: '#fbbf24', title: `Daily ${dailySummaryLocalTime} Summary`, desc: `FR snapshot + F&G + active price alerts + LiquidityAI outlook · once daily at ${dailySummaryLocalTime}`, grok: true },
    ]},
  ];

  const stepStyle: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 16 };
  const numStyle: React.CSSProperties = {
    width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 1,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-header">
        <h1 className="mb-title">Telegram Alerts</h1>
        <div className="mb-subtitle">Real-time push alerts to your phone - funding, momentum, whale flow, sentiment, and price levels</div>
      </div>

      <AlertOutcomes />

      {/* ── Telegram: Pro gate ──
          AUTH-3 fix: this used to show the upsell banner ABOVE a fully-
          rendered Connect Telegram wizard, just dimmed to 0.4 opacity with
          pointer-events:none - a dead, unusable form sitting right under an
          upgrade pitch. Free users now get a single locked-feature card
          (same component/pattern as Arena's other Pro-gated cards) instead
          of a form they can look at but not touch. */}
      {user && !isPro ? (
        <LockedFeatureCard
          title="Connect Telegram"
          description="Push alerts for funding rate extremes, RSI signals, open interest spikes, whale moves, and price levels - sent directly to Telegram."
          onUnlock={() => setUpgradeGate('Telegram Alerts')}
        />
      ) : (
      /* ── Telegram Quick-Connect Wizard ──────────────────────────────── */
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="lbl" style={{ margin: 0 }}>Connect Telegram</div>
          {settingsLoading ? (
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>Loading…</span>
          ) : isConnected ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: '#34d399',
              background: '#34d39914', border: '0.5px solid #34d39944',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
              Connected
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: '#f87171',
              background: 'transparent', border: '0.5px solid var(--bdr)',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
              Not connected
            </span>
          )}
        </div>

        {isConnected ? (
          /* ── Connected state ── */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>
                Chat ID:&nbsp;
                <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-caption)' }}>
                  {settings.telegram_chat_id}
                </code>
              </span>
              <button
                style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                onClick={() => { update({ telegram_chat_id: '' }); setChatIdInput(''); setSaveState('idle'); }}
              >
                Change
              </button>
            </div>
            <button
              className={`tg-action-btn${testState === 'ok' ? ' tg-btn-ok' : testState === 'err' ? ' tg-btn-err' : ''}`}
              onClick={sendTest}
              disabled={testState === 'sending'}
            >
              {testState === 'sending' ? 'Sending…' : testState === 'ok' ? '✓ Message sent!' : testState === 'err' ? '✕ Failed' : 'Send Test Message'}
            </button>
            {testState === 'err' && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{testErr}</div>}
          </div>
        ) : (
          /* ── Wizard ── */
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 18, lineHeight: 1.6 }}>
              Get trading alerts straight to your phone. Takes 30 seconds.
            </div>

            {!webhookOk && (
              <div style={{
                fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 14, padding: '8px 12px',
                background: '#f8717114', borderRadius: 6, border: '0.5px solid #f8717144',
              }}>
                <Warn /> Bot webhook registration failed - the bot may not reply to /start. Try refreshing, or enter your Chat ID manually below.
              </div>
            )}

            {/* Step 1 */}
            <div style={stepStyle}>
              <div style={numStyle}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
                  Open the bot on Telegram
                </div>
                {botLink ? (
                  <a
                    href={botLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 'var(--fs-caption)', fontWeight: 600, color: '#fff',
                      background: 'linear-gradient(135deg, #0088cc 0%, #229ed9 100%)',
                      padding: '8px 16px', borderRadius: 8, textDecoration: 'none',
                    }}
                  >
                    Open {botLabel} →
                  </a>
                ) : (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>Search <strong>LiquidityHQ</strong> on Telegram</div>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div style={stepStyle}>
              <div style={numStyle}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>
                  Send&nbsp;
                  <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-caption)' }}>
                    /start
                  </code>
                  &nbsp;in the chat
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                  The bot replies with your <strong style={{ color: 'var(--txt2)' }}>Chat ID</strong> - copy that number.
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ ...stepStyle, marginBottom: 0 }}>
              <div style={numStyle}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 10 }}>
                  Connect your Chat ID
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="pa-input"
                    aria-label="Telegram Chat ID"
                    placeholder="e.g. 123456789"
                    value={chatIdInput}
                    onChange={e => { setChatIdInput(e.target.value); setDetected(false); setDetectError(''); }}
                    style={{ flex: 1, minWidth: 110 }}
                  />
                  <button
                    className="tg-action-btn tg-btn-secondary"
                    onClick={detectChatId}
                    disabled={detecting}
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {detecting ? '↺ Detecting…' : detected ? '✓ Detected' : '↺ Auto-detect'}
                  </button>
                </div>
                {detected && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: '#34d399', marginBottom: 8 }}>
                    ✓ Chat ID detected and copied to clipboard
                  </div>
                )}
                {detectError && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 8 }}>{detectError}</div>
                )}
                <button
                  className="tg-action-btn"
                  onClick={saveChatId}
                  disabled={!chatIdInput.trim() || saveState === 'saving'}
                  style={{ width: '100%' }}
                >
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Connected!' : 'Save & Connect'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Price Alerts ─────────────────────────────────────────────────── */}
      <AuthGate
        title="Sign in to use Price Alerts"
        desc="Save price targets and get Telegram pings when they're hit. Free account required."
      >
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>Price Alerts</div>
          <div className="pa-form">
            <select className="pa-select" aria-label="Coin" value={paCoin} onChange={e => setPaCoin(e.target.value)}>
              {COIN_OPTIONS.map(c => <option key={c} value={c}>{COIN_LABELS[c]}</option>)}
            </select>
            <select className="pa-select" aria-label="Alert direction" value={paDir} onChange={e => setPaDir(e.target.value as 'above' | 'below')}>
              <option value="above">↑ Above</option>
              <option value="below">↓ Below</option>
            </select>
            <input
              className="pa-input" aria-label="Alert price" type="number" placeholder="Price (e.g. 95000)"
              value={paPrice} onChange={e => setPaPrice(e.target.value)}
            />
            <input
              className="pa-input pa-input-label" aria-label="Alert note" type="text" placeholder="Note (optional)"
              value={paLabel} onChange={e => setPaLabel(e.target.value)}
            />
            <button className="tg-action-btn" onClick={addPriceAlert} disabled={paAdding || !paPrice}>
              {paAdding ? 'Adding…' : '+ Add Alert'}
            </button>
          </div>
          {paError && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{paError}</div>}
          {paLoading ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 10 }}>Loading…</div>
          ) : priceAlerts.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 8 }}>
              <div className="empty-state-title">No price alerts</div>
              <div className="empty-state-sub">Add a coin, direction, and target above to get started.</div>
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
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 10, lineHeight: 1.5 }}>
            Fires once when price crosses your target → LiquidityAI analysis included → alert deactivates automatically.
          </div>
        </div>
      </AuthGate>

      {/* ── Recently Fired ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="lbl" style={{ margin: 0 }}>Recently Fired</div>
          {history.length > 0 && (
            <button
              style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={fetchHistory}
            >
              ↻ refresh
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No alerts fired yet</div>
            <div className="empty-state-sub">Alerts fire once when price crosses your target - history appears here.</div>
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
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.label}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', flexShrink: 0 }}>{ago}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--bdr)' }}>
          Auto-refreshes every 60s
        </div>
      </div>

      {/* ── Manual Check ─────────────────────────────────────────────────── */}
      {isConnected && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>Manual Check</div>
          <button
            className={`tg-action-btn tg-btn-secondary${checkState === 'err' ? ' tg-btn-err' : ''}`}
            onClick={checkNow}
            disabled={checkState === 'checking'}
          >
            {checkState === 'checking' ? 'Checking…' : checkState === 'err' ? '✕ Failed - retry?' : 'Check Alerts Now'}
          </button>
          {checkState === 'done' && checkResult && (
            <div style={{ marginTop: 10, fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.7 }}>
              {checkResult.fired?.length === 0
                ? `✓ No conditions active right now.${checkResult.note ? ` (${checkResult.note})` : ''}`
                : `Fired: ${checkResult.fired.join(', ')}`}
            </div>
          )}
          {checkState === 'err' && (
            <div style={{ marginTop: 8, fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>
              {checkErr || 'Request timed out - server may be cold starting. Try again in 30s.'}
            </div>
          )}
        </div>
      )}

      {/* ── Alert Conditions ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Alert Conditions</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 10 }}>
          Toggle off to mute. <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.05em', color: '#1a7aff', background: 'rgba(26,122,255,0.1)', border: '0.5px solid rgba(26,122,255,0.25)', padding: '2px 6px', borderRadius: 4 }}>AI</span> = includes LiquidityAI analysis.
        </div>
        {muteErr && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 8 }}>{muteErr}</div>}
        {ALERT_GROUPS.map(group => (
          <div key={group.section} style={{ marginBottom: 6 }}>
            <div style={{
              fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
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
                    <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)' }}>
                      {c.title}
                      {isMuted && <span style={{ marginLeft: 6, fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>MUTED</span>}
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>{c.desc}</div>
                  </div>
                  {c.grok && <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.05em', color: '#1a7aff', background: 'rgba(26,122,255,0.1)', border: '0.5px solid rgba(26,122,255,0.25)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>AI</span>}
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
        <div className="tg-condition-row" style={{ borderBottom: 'none' }}>
          <span className="tg-cond-dot" style={{ background: '#818cf8' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)' }}>
              Confluence Alert <span style={{ marginLeft: 4, fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>ALWAYS ON</span>
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>
              2+ signals on the same coin in one run → single combined ping · LiquidityAI weighs all signals together
            </div>
          </div>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.05em', color: '#1a7aff', background: 'rgba(26,122,255,0.1)', border: '0.5px solid rgba(26,122,255,0.25)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>AI</span>
        </div>
        {/* ── Signal direction filter ── */}
        <div style={{ marginTop: 10, padding: '10px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>
            Signal Direction
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8 }}>
            Silence one side of directional signals (entry setups, 200 EMA crosses, squeeze/flush warnings).
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([['dir:long', 'Long signals', '#4ade80'], ['dir:short', 'Short signals', '#f87171']] as const).map(([key, label, col]) => {
              const off = muted.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleMute(key)}
                  role="switch"
                  aria-checked={!off}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                    fontSize: 'var(--fs-caption)', fontWeight: 600,
                    background: off ? 'var(--bg2)' : withAlpha(col, '14'),
                    border: `0.5px solid ${off ? 'var(--bdr)' : withAlpha(col, '55')}`,
                    color: off ? 'var(--txt3)' : col,
                    transition: 'all .15s',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: off ? 'var(--txt3)' : col }} />
                  {label}{off ? ' - muted' : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Alert coin selection ── */}
        <div style={{ marginTop: 12, padding: '10px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>
            {(() => {
              const onCount = COINS.filter(c => !muted.has(`coin:${c}`)).length;
              return onCount > ALERT_COIN_CAP
                ? `Alert Coins - ${onCount} on (limit ${ALERT_COIN_CAP} - turn some off)`
                : `Alert Coins - ${onCount}/${ALERT_COIN_CAP} on`;
            })()}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8 }}>
            Tap a coin to stop all alerts for it, including which coins the EMA Ribbon Setup entry signals scan. Your saved price alerts are not affected.
          </div>
          {coinCapMsg && (
            <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 8 }}>
              {coinCapMsg}
            </div>
          )}
          <input
            className="acoin-search"
            placeholder="Search coins..."
            value={coinSearch}
            onChange={e => setCoinSearch(e.target.value)}
            aria-label="Search alert coins"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COINS.filter(c => c.includes(coinSearch.trim().toLowerCase())).map(c => {
              const off = muted.has(`coin:${c}`);
              const badgeCol = coinBadgeColor(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCoin(c)}
                  aria-pressed={!off}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                    fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.03em',
                    fontFamily: 'var(--font-mono), monospace',
                    background: off ? 'transparent' : 'var(--accent-bg)',
                    border: `0.5px solid ${off ? 'var(--bdr)' : 'var(--accent-bdr)'}`,
                    color: off ? 'var(--txt3)' : 'var(--accent-2)',
                    textDecoration: off ? 'line-through' : 'none',
                    transition: 'all .15s',
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: off ? 'var(--txt3)' : badgeCol }} />
                  {c.toUpperCase()}
                </button>
              );
            })}
            {coinSearch.trim() && !COINS.some(c => c.includes(coinSearch.trim().toLowerCase())) && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>No coins match &quot;{coinSearch}&quot;</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center', marginBottom: 16 }}>
        Cooldown timers may occasionally reset after routine maintenance - you might see a rare duplicate alert
      </div>

      <UpgradeGateModal
        open={upgradeGate !== null}
        onClose={() => setUpgradeGate(null)}
        feature={upgradeGate ?? undefined}
      />
    </div>
  );
}
