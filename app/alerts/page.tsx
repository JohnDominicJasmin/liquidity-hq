'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AuthGate from '@/components/AuthGate';
import { COINS } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = COINS;
const COIN_LABELS: Record<string, string> = Object.fromEntries(COINS.map(c => [c, c.toUpperCase()]));

export default function AlertsPage() {
  const { settings, loading: settingsLoading, update } = useSettings();

  // Derived from settings — no separate API call needed
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
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [saveState, setSaveState]     = useState<'idle' | 'saving' | 'saved'>('idle');

  // Muted alert groups
  const [muted, setMuted]   = useState<Set<string>>(new Set());
  const [muteErr, setMuteErr] = useState('');

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

  const fetchHistory = useCallback(() => {
    fetch('/api/telegram/history').then(r => r.json())
      .then(d => setHistory(d.fires ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/telegram/bot-info').then(r => r.json())
      .then(d => setBotUsername(d.username ?? null))
      .catch(() => {});
    fetch('/api/alert-prefs').then(r => r.json())
      .then(d => setMuted(new Set<string>(d.muted ?? [])))
      .catch(() => {});
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
      const res = await fetch('/api/alert-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, muted: willMute }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? 'Save failed');
    } catch (e) {
      setMuted(prev => { const n = new Set(prev); willMute ? n.delete(key) : n.add(key); return n; });
      setMuteErr(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const loadPriceAlerts = useCallback(async () => {
    setPaLoading(true);
    try { const d = await fetch('/api/price-alerts').then(r => r.json()); setPriceAlerts(d.alerts ?? []); }
    catch { /* skip */ }
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
    { section: '💸 Funding', items: [
      { key: 'fr_extremes', dot: '#f87171', title: 'FR Extremes',       desc: '≥ 0.05% longs overcrowded · ≤ −0.03% shorts crowded · 4h cooldown', grok: false },
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
      { key: 'news',               dot: '#f87171', title: 'Breaking News',         desc: 'Geopolitical / macro Finnhub headlines · 15min cooldown', grok: true },
      { key: 'fear_greed',         dot: '#f97316', title: 'Fear & Greed Extremes', desc: '≤ 15 extreme fear · ≥ 85 extreme greed · 23h cooldown', grok: false },
      { key: 'sentiment_extremes', dot: '#f43f5e', title: 'Sentiment Extremes',    desc: 'F&G + BTC funding + BTC L/S ratio all at extremes simultaneously · 4h cooldown', grok: true },
    ]},
    { section: '🎯 Price & Summary', items: [
      { key: 'price_alerts',  dot: '#c084fc', title: 'Price Level Alerts', desc: 'Your saved price targets · fires once then deactivates', grok: true },
      { key: 'daily_summary', dot: '#fbbf24', title: 'Daily 7am Summary',  desc: 'FR snapshot + F&G + active price alerts + LiquidityAI outlook · once daily at 7am PHT', grok: true },
    ]},
  ];

  const stepStyle: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 16 };
  const numStyle: React.CSSProperties = {
    width: 24, height: 24, borderRadius: '50%', background: '#7c3aed',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, marginTop: 1,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-header">
        <div className="mb-title">🔔 Telegram Alerts</div>
        <div className="mb-subtitle">Push alerts to your phone — funding, RSI, EMA cross, rapid moves, whales, news, OI, CVD, price levels</div>
      </div>

      {/* ── Telegram Quick-Connect Wizard ──────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="lbl" style={{ margin: 0 }}>📱 Connect Telegram</div>
          {settingsLoading ? (
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Loading…</span>
          ) : isConnected ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: '#34d399',
              background: '#34d39914', border: '0.5px solid #34d39944',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
              Connected
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
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
              <span style={{ fontSize: 12, color: 'var(--txt2)' }}>
                Chat ID:&nbsp;
                <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                  {settings.telegram_chat_id}
                </code>
              </span>
              <button
                style={{ fontSize: 11, color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
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
            {testState === 'err' && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{testErr}</div>}
          </div>
        ) : (
          /* ── Wizard ── */
          <div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 18, lineHeight: 1.6 }}>
              Get trading alerts straight to your phone. Takes 30 seconds.
            </div>

            {/* Step 1 */}
            <div style={stepStyle}>
              <div style={numStyle}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
                  Open the bot on Telegram
                </div>
                {botLink ? (
                  <a
                    href={botLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, color: '#fff',
                      background: 'linear-gradient(135deg, #0088cc 0%, #229ed9 100%)',
                      padding: '8px 16px', borderRadius: 8, textDecoration: 'none',
                    }}
                  >
                    Open {botLabel} →
                  </a>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Search <strong>LiquidityHQ</strong> on Telegram</div>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div style={stepStyle}>
              <div style={numStyle}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>
                  Send&nbsp;
                  <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                    /start
                  </code>
                  &nbsp;in the chat
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                  The bot replies with your <strong style={{ color: 'var(--txt2)' }}>Chat ID</strong> — copy that number.
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ ...stepStyle, marginBottom: 0 }}>
              <div style={numStyle}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)', marginBottom: 10 }}>
                  Connect your Chat ID
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="pa-input"
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
                  <div style={{ fontSize: 11, color: '#34d399', marginBottom: 8 }}>
                    ✓ Chat ID detected and copied to clipboard
                  </div>
                )}
                {detectError && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{detectError}</div>
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

      {/* ── Price Alerts ─────────────────────────────────────────────────── */}
      <AuthGate
        title="Sign in to use Price Alerts"
        desc="Save price targets and get Telegram pings when they're hit. Free account required."
      >
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>🎯 Price Alerts</div>
          <div className="pa-form">
            <select className="pa-select" value={paCoin} onChange={e => setPaCoin(e.target.value)}>
              {COIN_OPTIONS.map(c => <option key={c} value={c}>{COIN_LABELS[c]}</option>)}
            </select>
            <select className="pa-select" value={paDir} onChange={e => setPaDir(e.target.value as 'above' | 'below')}>
              <option value="above">↑ Above</option>
              <option value="below">↓ Below</option>
            </select>
            <input
              className="pa-input" type="number" placeholder="Price (e.g. 95000)"
              value={paPrice} onChange={e => setPaPrice(e.target.value)}
            />
            <input
              className="pa-input pa-input-label" type="text" placeholder="Note (optional)"
              value={paLabel} onChange={e => setPaLabel(e.target.value)}
            />
            <button className="tg-action-btn" onClick={addPriceAlert} disabled={paAdding || !paPrice}>
              {paAdding ? 'Adding…' : '+ Add Alert'}
            </button>
          </div>
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

      {/* ── Recently Fired ───────────────────────────────────────────────── */}
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

      {/* ── Manual Check ─────────────────────────────────────────────────── */}
      {isConnected && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>Manual Check</div>
          <button
            className={`tg-action-btn tg-btn-secondary${checkState === 'err' ? ' tg-btn-err' : ''}`}
            onClick={checkNow}
            disabled={checkState === 'checking'}
          >
            {checkState === 'checking' ? 'Checking…' : checkState === 'err' ? '✕ Failed — retry?' : 'Check Alerts Now'}
          </button>
          {checkState === 'done' && checkResult && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt2)', lineHeight: 1.7 }}>
              {checkResult.fired?.length === 0
                ? `✓ No conditions active right now.${checkResult.note ? ` (${checkResult.note})` : ''}`
                : `🔔 Fired: ${checkResult.fired.join(', ')}`}
            </div>
          )}
          {checkState === 'err' && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>
              {checkErr || 'Request timed out — server may be cold starting. Try again in 30s.'}
            </div>
          )}
        </div>
      )}

      {/* ── Alert Conditions ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Alert Conditions</div>
        <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
          Toggle off to mute a group. 🤖 AI = includes LiquidityAI analysis.
        </div>
        {muteErr && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>⚠ {muteErr}</div>}
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
        <div className="tg-condition-row" style={{ borderBottom: 'none' }}>
          <span className="tg-cond-dot" style={{ background: '#818cf8' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
              Confluence Alert <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>ALWAYS ON</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
              2+ signals on the same coin in one run → single combined ping · LiquidityAI weighs all signals together
            </div>
          </div>
          <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>🤖 AI</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10, padding: '8px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          Monitored: all {COINS.length} coins — BTC · ETH · SOL · XRP · BNB · HYPE · NEAR · SUI · DOGE · AVAX · LINK · ADA · DOT · ATOM · WIF · PEPE · BONK
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--txt3)', textAlign: 'center', marginBottom: 16 }}>
        In-memory cooldowns reset on server restart · keep UptimeRobot running to minimise restarts
      </div>
    </div>
  );
}
