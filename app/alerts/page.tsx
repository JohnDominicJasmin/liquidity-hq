'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AuthGate from '@/components/AuthGate';
import UpgradeGateModal, { LockedFeatureCard } from '@/components/UpgradeGateModal';
import { Warn, CoinStack } from '@/components/icons';
import { COINS } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { utcHourToLocalTime } from '@/lib/resetTime';
import { withAlpha } from '@/lib/color';
import AlertOutcomes from '@/components/AlertOutcomes';
import CoinMultiSelect from '@/components/CoinMultiSelect';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = COINS;
const COIN_LABELS: Record<string, string> = Object.fromEntries(COINS.map(c => [c, c.toUpperCase()]));

const ALERT_COIN_CAP = 10; // Alerts is a Pro-only feature - single cap, no free/pro split needed here

// EMA Buy/Sell Signal timeframes - same list Arena's own chart TF picker
// offers (app/arena/page.tsx), so a user's choice here always matches a
// timeframe they can actually go look at on the chart. Capped at
// ALERT_TF_CAP concurrently active, same shape as ALERT_COIN_CAP above.
const EMA_SIGNAL_TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
const ALERT_TF_CAP = 3;
const DEFAULT_ON_TFS: readonly string[] = ['1h', '4h', '1d'];

export default function AlertsPage() {
  const { t } = useLabels();
  const { user, entitled } = useAuth();
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
  const [tfCapMsg, setTfCapMsg] = useState('');

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

  const fetchHistory = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    if (!token) { setHistory([]); return; }
    fetch('/api/telegram/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
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
        .then(async d => {
          const mutedList: string[] = d.muted ?? [];
          setMuted(new Set<string>(mutedList));
          // No coin prefs saved yet (brand-new user) - default to btc/eth/sol only,
          // not every coin, by seeding the rest as muted server-side.
          if (!mutedList.some(k => k.startsWith('coin:'))) {
            const toMute = COINS.filter(c => !['btc', 'eth', 'sol'].includes(c));
            await Promise.all(toMute.map(c =>
              fetch('/api/alert-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ key: `coin:${c}`, muted: true }),
              }).catch(() => {})
            ));
            setMuted(prev => { const n = new Set(prev); toMute.forEach(c => n.add(`coin:${c}`)); return n; });
          }
          // Same pattern for the EMA Buy/Sell Signal timeframe picker - a
          // brand-new user (no ema_signal_ keys at all yet) starts with
          // DEFAULT_ON_TFS active and the rest pre-muted, rather than all 8
          // (which would blow past ALERT_TF_CAP the moment they're seen).
          if (!mutedList.some(k => k.startsWith('ema_signal_'))) {
            const toMuteTf = EMA_SIGNAL_TFS.filter(tf => !DEFAULT_ON_TFS.includes(tf));
            await Promise.all(toMuteTf.map(tf =>
              fetch('/api/alert-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ key: `ema_signal_${tf}`, muted: true }),
              }).catch(() => {})
            ));
            setMuted(prev => { const n = new Set(prev); toMuteTf.forEach(tf => n.add(`ema_signal_${tf}`)); return n; });
          }
        })
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
      if (!d.ok) throw new Error(d.error ?? t('ALERTS_SAVE_FAILED'));
    } catch (e) {
      setMuted(prev => { const n = new Set(prev); willMute ? n.delete(key) : n.add(key); return n; });
      setMuteErr(e instanceof Error ? e.message : t('ALERTS_SAVE_FAILED'));
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
            ? t('ALERTS_COIN_CAP_OVER_MSG', { onCount, cap: ALERT_COIN_CAP })
            : t('ALERTS_COIN_CAP_REACHED_MSG', { cap: ALERT_COIN_CAP })
        );
        return;
      }
    }
    setCoinCapMsg('');
    toggleMute(key);
  };

  const toggleTf = (tf: string) => {
    const key = `ema_signal_${tf}`;
    const isOff = muted.has(key);
    if (isOff) {
      const onCount = EMA_SIGNAL_TFS.filter(x => !muted.has(`ema_signal_${x}`)).length;
      if (onCount >= ALERT_TF_CAP) {
        setTfCapMsg(
          onCount > ALERT_TF_CAP
            ? t('ALERTS_TF_CAP_OVER_MSG', { onCount, cap: ALERT_TF_CAP })
            : t('ALERTS_TF_CAP_REACHED_MSG', { cap: ALERT_TF_CAP })
        );
        return;
      }
    }
    setTfCapMsg('');
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
      if (!res.ok) throw new Error(d.error ?? t('ALERTS_ADD_ALERT_FAILED'));
      setPaPrice(''); setPaLabel('');
      window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'priceAlert' }));
      await loadPriceAlerts();
    } catch (e) {
      setPaError(e instanceof Error ? e.message : t('ALERTS_ADD_ALERT_FAILED'));
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
      if (!res.ok) throw new Error(d.error ?? t('ALERTS_REMOVE_ALERT_FAILED'));
      setPriceAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      setPaError(e instanceof Error ? e.message : t('ALERTS_REMOVE_ALERT_FAILED'));
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
        setTestState('err'); setTestErr(d.error ?? t('ALERTS_UNKNOWN_ERROR'));
      }
    } catch { setTestState('err'); setTestErr(t('ALERTS_NETWORK_ERROR')); }
  };

  const detectChatId = async () => {
    setDetecting(true); setDetectError(''); setDetected(false);
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/telegram/detect', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json();
      if (d.ok && d.chat_id) {
        setChatIdInput(d.chat_id);
        setDetected(true);
        try { await navigator.clipboard.writeText(d.chat_id); } catch { /* no clipboard access */ }
      } else {
        setDetectError(d.error ?? t('ALERTS_DETECT_FAILED'));
      }
    } catch { setDetectError(t('ALERTS_NETWORK_ERROR')); }
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
      if (!res.ok) throw new Error(t('ALERTS_SERVER_ERROR', { status: res.status }));
      const d = await res.json();
      setCheckResult(d);
      setCheckState('done');
    } catch (e) {
      setCheckErr(e instanceof Error ? e.message : t('ALERTS_CHECK_REQUEST_FAILED'));
      setCheckState('err');
    }
  };

  const botLink = botUsername ? `https://t.me/${botUsername}` : null;
  const botLabel = botUsername ? `@${botUsername}` : t('ALERTS_BOT_FALLBACK_NAME');

  const ALERT_GROUPS: { section: string; items: { key: string; dot: string; title: string; desc: string }[] }[] = [
    { section: t('ALERTS_SECTION_MOMENTUM'), items: [
      { key: 'rsi',        dot: '#fbbf24', title: t('ALERTS_RSI_TITLE'), desc: t('ALERTS_RSI_DESC') },
      { key: 'rapid_move', dot: '#fb923c', title: t('ALERTS_RAPID_MOVES_TITLE'),     desc: t('ALERTS_RAPID_MOVES_DESC') },
    ]},
    { section: t('ALERTS_SECTION_FLOW'), items: [
      { key: 'whales',   dot: '#1a7aff', title: t('ALERTS_WHALES_TITLE'),        desc: t('ALERTS_WHALES_DESC') },
      { key: 'oi_spike', dot: '#fbbf24', title: t('ALERTS_OI_SPIKE_TITLE'), desc: t('ALERTS_OI_SPIKE_DESC') },
      { key: 'cvd',      dot: '#34d399', title: t('ALERTS_CVD_TITLE'),      desc: t('ALERTS_CVD_DESC') },
      { key: 'squeeze',  dot: '#f43f5e', title: t('ALERTS_SQUEEZE_TITLE'), desc: t('ALERTS_SQUEEZE_DESC') },
      { key: 'distribution', dot: '#f97316', title: t('ALERTS_DISTRIBUTION_TITLE'), desc: t('ALERTS_DISTRIBUTION_DESC') },
    ]},
    { section: t('ALERTS_SECTION_NEWS_SENTIMENT'), items: [
      { key: 'news',               dot: '#f87171', title: t('ALERTS_NEWS_TITLE'),         desc: t('ALERTS_NEWS_DESC') },
      { key: 'fear_greed',         dot: '#f97316', title: t('ALERTS_FEAR_GREED_TITLE'), desc: t('ALERTS_FEAR_GREED_DESC') },
      { key: 'sentiment_extremes', dot: '#f43f5e', title: t('ALERTS_SENTIMENT_EXTREMES_TITLE'),    desc: t('ALERTS_SENTIMENT_EXTREMES_DESC') },
    ]},
    { section: t('ALERTS_SECTION_PRICE_SUMMARY'), items: [
      { key: 'price_alerts',  dot: '#9ba4ff', title: t('ALERTS_PRICE_LEVEL_TITLE'), desc: t('ALERTS_PRICE_LEVEL_DESC') },
      { key: 'daily_summary', dot: '#fbbf24', title: t('ALERTS_DAILY_SUMMARY_TITLE', { time: dailySummaryLocalTime }), desc: t('ALERTS_DAILY_SUMMARY_DESC', { time: dailySummaryLocalTime }) },
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
        <h1 className="mb-title">{t('ALERTS_PAGE_TITLE')}</h1>
        <div className="mb-subtitle">{t('ALERTS_PAGE_SUBTITLE')}</div>
      </div>

      <AlertOutcomes />

      {/* ── Telegram: Pro gate ──
          AUTH-3 fix: this used to show the upsell banner ABOVE a fully-
          rendered Connect Telegram wizard, just dimmed to 0.4 opacity with
          pointer-events:none - a dead, unusable form sitting right under an
          upgrade pitch. Free users now get a single locked-feature card
          (same component/pattern as Arena's other Pro-gated cards) instead
          of a form they can look at but not touch. */}
      {!entitled ? (
        <LockedFeatureCard
          title={t('ALERTS_CONNECT_TELEGRAM_TITLE')}
          description={t('ALERTS_LOCKED_FEATURE_DESC')}
          onUnlock={() => setUpgradeGate(t('ALERTS_UPGRADE_GATE_FEATURE_LABEL'))}
        />
      ) : (
      /* ── Telegram Quick-Connect Wizard ──────────────────────────────── */
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="lbl" style={{ margin: 0 }}>{t('ALERTS_CONNECT_TELEGRAM_TITLE')}</div>
          {settingsLoading ? (
            <SkeletonBar width={70} height={12} />
          ) : isConnected ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: '#34d399',
              background: '#34d39914', border: '0.5px solid #34d39944',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
              {t('ALERTS_STATUS_CONNECTED')}
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: '#f87171',
              background: 'transparent', border: '0.5px solid var(--bdr)',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
              {t('ALERTS_STATUS_NOT_CONNECTED')}
            </span>
          )}
        </div>

        {isConnected ? (
          /* ── Connected state ── */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>
                {t('ALERTS_CHAT_ID_LABEL')}&nbsp;
                <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-caption)' }}>
                  {settings.telegram_chat_id}
                </code>
              </span>
              <button
                style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                onClick={() => { update({ telegram_chat_id: '' }); setChatIdInput(''); setSaveState('idle'); }}
              >
                {t('ALERTS_CHANGE_BUTTON')}
              </button>
            </div>
            <button
              className={`tg-action-btn${testState === 'ok' ? ' tg-btn-ok' : testState === 'err' ? ' tg-btn-err' : ''}`}
              onClick={sendTest}
              disabled={testState === 'sending'}
            >
              {testState === 'sending' ? t('ALERTS_TEST_SENDING') : testState === 'ok' ? t('ALERTS_TEST_SENT_OK') : testState === 'err' ? t('ALERTS_TEST_FAILED') : t('ALERTS_SEND_TEST_BUTTON')}
            </button>
            {testState === 'err' && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{testErr}</div>}
          </div>
        ) : (
          /* ── Wizard ── */
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 18, lineHeight: 1.6 }}>
              {t('ALERTS_WIZARD_INTRO')}
            </div>

            {!webhookOk && (
              <div style={{
                fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 14, padding: '8px 12px',
                background: '#f8717114', borderRadius: 6, border: '0.5px solid #f8717144',
              }}>
                <Warn /> {t('ALERTS_WEBHOOK_FAILED_WARNING')}
              </div>
            )}

            {/* Step 1 */}
            <div style={stepStyle}>
              <div style={numStyle}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
                  {t('ALERTS_STEP1_TITLE')}
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
                    {t('ALERTS_OPEN_BOT_BUTTON', { bot: botLabel })}
                  </a>
                ) : (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ALERTS_SEARCH_BOT_PRE')} <strong>{t('ALERTS_SEARCH_BOT_BOLD')}</strong> {t('ALERTS_SEARCH_BOT_POST')}</div>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div style={stepStyle}>
              <div style={numStyle}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>
                  {t('ALERTS_STEP2_SEND_PRE')}&nbsp;
                  <code style={{ background: 'var(--bg2)', padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-caption)' }}>
                    /start
                  </code>
                  &nbsp;{t('ALERTS_STEP2_SEND_POST')}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                  {t('ALERTS_STEP2_HINT_PRE')} <strong style={{ color: 'var(--txt2)' }}>{t('ALERTS_STEP2_HINT_BOLD')}</strong> {t('ALERTS_STEP2_HINT_POST')}
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ ...stepStyle, marginBottom: 0 }}>
              <div style={numStyle}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 10 }}>
                  {t('ALERTS_STEP3_TITLE')}
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="pa-input"
                    aria-label={t('ALERTS_CHAT_ID_ARIA')}
                    placeholder={t('ALERTS_CHAT_ID_PLACEHOLDER')}
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
                    {detecting ? t('ALERTS_DETECT_DETECTING') : detected ? t('ALERTS_DETECT_DETECTED') : t('ALERTS_DETECT_AUTO')}
                  </button>
                </div>
                {detected && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: '#34d399', marginBottom: 8 }}>
                    {t('ALERTS_DETECT_SUCCESS_MSG')}
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
                  {saveState === 'saving' ? t('ALERTS_SAVE_SAVING') : saveState === 'saved' ? t('ALERTS_SAVE_CONNECTED') : t('ALERTS_SAVE_CONNECT_BUTTON')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Price Alerts ─────────────────────────────────────────────────── */}
      <AuthGate
        title={t('ALERTS_AUTHGATE_TITLE')}
        desc={t('ALERTS_AUTHGATE_DESC')}
      >
        {!entitled ? (
          /* Price alerts are delivered over Telegram, which the alert cron
             only sends to Pro/trial users. Creation used to be open to
             everyone, so a free user's alert saved and then silently never
             fired. Lock it up front instead - same pattern as the Telegram
             card above - and the API enforces it too (PRO_REQUIRED). */
          <LockedFeatureCard
            title={t('ALERTS_PRICE_ALERTS_LABEL')}
            description={t('ALERTS_PRICE_LOCKED_DESC')}
            onUnlock={() => setUpgradeGate(t('ALERTS_PRICE_ALERTS_LABEL'))}
          />
        ) : (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>{t('ALERTS_PRICE_ALERTS_LABEL')}</div>
          <div className="pa-form">
            <select className="pa-select" aria-label={t('ALERTS_COIN_ARIA')} value={paCoin} onChange={e => setPaCoin(e.target.value)}>
              {COIN_OPTIONS.map(c => <option key={c} value={c}>{COIN_LABELS[c]}</option>)}
            </select>
            <select className="pa-select" aria-label={t('ALERTS_DIRECTION_ARIA')} value={paDir} onChange={e => setPaDir(e.target.value as 'above' | 'below')}>
              <option value="above">{t('ALERTS_DIR_ABOVE_OPTION')}</option>
              <option value="below">{t('ALERTS_DIR_BELOW_OPTION')}</option>
            </select>
            <input
              className="pa-input" aria-label={t('ALERTS_PRICE_ARIA')} type="number" placeholder={t('ALERTS_PRICE_PLACEHOLDER')}
              value={paPrice} onChange={e => setPaPrice(e.target.value)}
            />
            <input
              className="pa-input pa-input-label" aria-label={t('ALERTS_NOTE_ARIA')} type="text" placeholder={t('ALERTS_NOTE_PLACEHOLDER')}
              value={paLabel} onChange={e => setPaLabel(e.target.value)}
            />
            <button className="tg-action-btn" onClick={addPriceAlert} disabled={paAdding || !paPrice}>
              {paAdding ? t('ALERTS_ADDING') : t('ALERTS_ADD_ALERT_BUTTON')}
            </button>
          </div>
          {paError && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{paError}</div>}
          {paLoading ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 10 }}>{t('ALERTS_LOADING')}</div>
          ) : priceAlerts.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 8 }}>
              <div className="empty-state-title">{t('ALERTS_NO_PRICE_ALERTS_TITLE')}</div>
              <div className="empty-state-sub">{t('ALERTS_NO_PRICE_ALERTS_SUB')}</div>
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
            {t('ALERTS_PRICE_ALERT_FOOTER')}
          </div>
        </div>
        )}
      </AuthGate>

      {/* ── Recently Fired ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="lbl" style={{ margin: 0 }}>{t('ALERTS_RECENTLY_FIRED_LABEL')}</div>
          {history.length > 0 && (
            <button
              style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={fetchHistory}
            >
              {t('ALERTS_REFRESH_BUTTON')}
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('ALERTS_NO_HISTORY_TITLE')}</div>
            <div className="empty-state-sub">{t('ALERTS_NO_HISTORY_SUB')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {history.slice(0, 15).map((f, i) => {
              const age = (Date.now() - f.ts) / 1000;
              const ago = age < 60 ? t('ALERTS_AGO_JUST_NOW') : age < 3600 ? t('ALERTS_AGO_MINUTES', { n: Math.floor(age / 60) }) : age < 86400 ? t('ALERTS_AGO_HOURS', { n: Math.floor(age / 3600) }) : t('ALERTS_AGO_DAYS', { n: Math.floor(age / 86400) });
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
          {t('ALERTS_AUTO_REFRESH_NOTE')}
        </div>
      </div>

      {/* ── Manual Check ─────────────────────────────────────────────────── */}
      {isConnected && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 12 }}>{t('ALERTS_MANUAL_CHECK_LABEL')}</div>
          <button
            className={`tg-action-btn tg-btn-secondary${checkState === 'err' ? ' tg-btn-err' : ''}`}
            onClick={checkNow}
            disabled={checkState === 'checking'}
          >
            {checkState === 'checking' ? t('ALERTS_CHECKING') : checkState === 'err' ? t('ALERTS_CHECK_FAILED_RETRY') : t('ALERTS_CHECK_NOW_BUTTON')}
          </button>
          {checkState === 'done' && checkResult && (
            <div style={{ marginTop: 10, fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.7 }}>
              {checkResult.fired?.length === 0
                ? `${t('ALERTS_NO_CONDITIONS_ACTIVE')}${checkResult.note ? ` (${checkResult.note})` : ''}`
                : t('ALERTS_FIRED_LIST', { list: checkResult.fired.join(', ') })}
            </div>
          )}
          {checkState === 'err' && (
            <div style={{ marginTop: 8, fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>
              {checkErr || t('ALERTS_CHECK_TIMEOUT_FALLBACK')}
            </div>
          )}
        </div>
      )}

      {/* ── Alert Conditions ─────────────────────────────────────────────── */}
      {/* Locked state already shown once, above (Telegram card) - repeating
          the same "Unlock Pro" pitch here read as a hard sell, not a second
          real gate. Free/signed-out users just don't see this section at all. */}
      {entitled && (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>{t('ALERTS_CONDITIONS_LABEL')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 10 }}>
          {t('ALERTS_MUTE_HINT_PREFIX')}
        </div>
        {muteErr && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 8 }}>{muteErr}</div>}

        {/* ── Alert coin selection - first, because it scopes everything below it:
            every condition further down only ever fires for the coins picked
            here, so asking "which coins?" before "which conditions?" matches
            the actual order of the decision. ── */}
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '0.5px solid var(--bdr)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <CoinStack size={15} style={{ color: 'var(--accent-2)', flexShrink: 0 }} />
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)' }}>
              {(() => {
                const onCount = COINS.filter(c => !muted.has(`coin:${c}`)).length;
                return onCount > ALERT_COIN_CAP
                  ? t('ALERTS_COINS_OVER_LIMIT', { onCount, cap: ALERT_COIN_CAP })
                  : t('ALERTS_COINS_COUNT', { onCount, cap: ALERT_COIN_CAP });
              })()}
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8 }}>
            {t('ALERTS_COIN_SELECTION_DESC')}
          </div>
          {coinCapMsg && (
            <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 8 }}>
              {coinCapMsg}
            </div>
          )}
          <CoinMultiSelect
            value={COINS.filter(c => !muted.has(`coin:${c}`))}
            onChange={next => {
              const nextSet: Set<string> = new Set(next);
              const curSet: Set<string>  = new Set(COINS.filter(c => !muted.has(`coin:${c}`)));
              for (const c of next) if (!curSet.has(c)) toggleCoin(c);
              for (const c of COINS) if (curSet.has(c) && !nextSet.has(c)) toggleCoin(c);
            }}
            previewCount={7}
          />
        </div>

        {/* ── EMA Buy/Sell Signal - real chart-parity signal, capped timeframe picker ── */}
        <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '0.5px solid var(--bdr)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span className="tg-cond-dot" style={{ background: '#4ade80' }} />
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)' }}>{t('ALERTS_EMA_SIGNAL_TITLE')}</div>
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8, paddingLeft: 14 }}>
            {t('ALERTS_EMA_SIGNAL_DESC')}
          </div>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4, paddingLeft: 14 }}>
            {(() => {
              const onCount = EMA_SIGNAL_TFS.filter(tf => !muted.has(`ema_signal_${tf}`)).length;
              return onCount > ALERT_TF_CAP
                ? t('ALERTS_TF_OVER_LIMIT', { onCount, cap: ALERT_TF_CAP })
                : t('ALERTS_TF_COUNT', { onCount, cap: ALERT_TF_CAP });
            })()}
          </div>
          {tfCapMsg && (
            <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 8, paddingLeft: 14 }}>
              {tfCapMsg}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 14 }}>
            {EMA_SIGNAL_TFS.map(tf => {
              const off = muted.has(`ema_signal_${tf}`);
              return (
                <button
                  key={tf}
                  onClick={() => toggleTf(tf)}
                  aria-pressed={!off}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 12px', borderRadius: 7, cursor: 'pointer',
                    fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.03em',
                    fontFamily: 'var(--font-mono), monospace',
                    background: off ? 'transparent' : 'var(--accent-bg)',
                    border: `0.5px solid ${off ? 'var(--bdr)' : 'var(--accent-bdr)'}`,
                    color: off ? 'var(--txt3)' : 'var(--accent-2)',
                    textDecoration: off ? 'line-through' : 'none',
                    transition: 'all .15s',
                  }}
                >
                  {tf.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

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
                      {isMuted && <span style={{ marginLeft: 6, fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>{t('ALERTS_MUTED_BADGE')}</span>}
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>{c.desc}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!isMuted}
                    aria-label={`${isMuted ? t('ALERTS_UNMUTE_VERB') : t('ALERTS_MUTE_VERB')} ${c.title}`}
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
              {t('ALERTS_CONFLUENCE_ALERT_TITLE')} <span style={{ marginLeft: 4, fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.05em' }}>{t('ALERTS_ALWAYS_ON_BADGE')}</span>
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>
              {t('ALERTS_CONFLUENCE_ALERT_DESC')}
            </div>
          </div>
        </div>
        {/* ── Signal direction filter ── */}
        <div style={{ marginTop: 10, padding: '10px 0 0', borderTop: '0.5px solid var(--bdr)' }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>
            {t('ALERTS_SIGNAL_DIRECTION_LABEL')}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8 }}>
            {t('ALERTS_SIGNAL_DIRECTION_DESC')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([['dir:long', t('ALERTS_DIR_LONG_LABEL'), '#4ade80'], ['dir:short', t('ALERTS_DIR_SHORT_LABEL'), '#f87171']] as const).map(([key, label, col]) => {
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
                  {label}{off ? ` ${t('ALERTS_MUTED_SUFFIX')}` : ''}
                </button>
              );
            })}
          </div>
        </div>

      </div>
      )}

      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center', marginBottom: 16 }}>
        {t('ALERTS_COOLDOWN_FOOTER_NOTE')}
      </div>

      <UpgradeGateModal
        open={upgradeGate !== null}
        onClose={() => setUpgradeGate(null)}
        feature={upgradeGate ?? undefined}
      />
    </div>
  );
}
