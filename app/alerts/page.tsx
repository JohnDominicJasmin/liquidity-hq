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
import { STRUCTURE_TFS, structureOnKey } from '@/lib/structurePrefs';

interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; created_at: string }

const COIN_OPTIONS = COINS;
const COIN_LABELS: Record<string, string> = Object.fromEntries(COINS.map(c => [c, c.toUpperCase()]));

const ALERT_COIN_CAP = 10; // Alerts is a Pro-only feature - single cap, no free/pro split needed here

// EMA Buy/Sell Signal timeframes - same list Arena's own chart TF picker
// offers (app/arena/page.tsx), so a user's choice here always matches a
// timeframe they can actually go look at on the chart. Capped at
// ALERT_TF_CAP concurrently active, same shape as ALERT_COIN_CAP above.
const EMA_SIGNAL_TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
// STRUCTURE_TFS is imported, not redeclared: the cron only computes those two,
// so a local copy could drift into offering a toggle for an alert that can
// never fire. Not covered by ALERT_TF_CAP - that cap exists because eight EMA
// timeframes at once is unusable, and two is not eight.
const ALERT_TF_CAP = 3;
const DEFAULT_ON_TFS: readonly string[] = ['1h', '4h', '1d'];

// "This user has already been given defaults" markers. Stored as ordinary rows
// in the same table, under a `seeded:` prefix that entryMuteKeys() in the alert
// cron can never produce (it emits only <ruleKey>, coin:<c> and dir:<d>), so a
// marker can never be mistaken for a mute and silence a real alert.
const SEEDED_COINS    = 'seeded:coins';
const SEEDED_EMA_TFS  = 'seeded:ema_signal_tfs';

// Written after the defaults it marks. If some of those writes failed the user
// keeps a partial default set and is not re-seeded, which is the better of the
// two failures - the alternative is re-running the seed on every visit and
// re-muting choices the user has since made, which is the bug this fixes.
function markSeeded(token: string, marker: string): Promise<unknown> {
  return fetch('/api/alert-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: marker, muted: true }),
  }).catch(() => {});
}

// Connecting Telegram finishes OUTSIDE this page: the user sends the code to
// the bot, and the webhook writes telegram_chat_id server-side. Nothing pushes
// that back to the browser, so the page re-reads its own settings on a timer
// while it waits. Two minutes is long enough to open Telegram and press Start;
// past that the user gets a "check again" button instead of an endless poll.
const LINK_POLL_MS      = 3_000;
const LINK_POLL_MAX     = 40;
const LINK_CODE_TTL_SEC = 600;

export default function AlertsPage() {
  const { t } = useLabels();
  const { user, entitled, loading: authLoading } = useAuth();
  const { settings, loading: settingsLoading, refresh: refreshSettings } = useSettings();
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

  // Connect-Telegram state. The chat ID is never typed here any more - the
  // user proves the chat is theirs by sending a one-time code to the bot.
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [webhookOk, setWebhookOk]     = useState(true);
  const [linkCode, setLinkCode]       = useState<{ code: string; deepLink: string | null } | null>(null);
  const [linkSecondsLeft, setLinkSecondsLeft] = useState(0);
  const [linkIssuing, setLinkIssuing]   = useState(false);
  const [linkError, setLinkError]       = useState('');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [codeCopied, setCodeCopied]     = useState(false);
  const [disconnecting, setDisconnecting]   = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  // Muted alert groups.
  //
  // `muted` is an inverted model - a coin or timeframe is ON when it is ABSENT
  // from this set - so the empty initial value does not mean "nothing loaded
  // yet", it means "everything is on". Rendering the pickers against it before
  // the real preferences arrive therefore showed all 8 timeframes and all
  // coins active, complete with an "over limit" warning, and then snapped to
  // the true selection once the fetch landed. On a cold server that misread
  // was on screen for around five seconds.
  //
  // mutedLoaded is what the pickers actually gate on. It flips only after the
  // fetch AND any first-visit seeding writes have settled, because a brand-new
  // user gets two corrections, not one: the fetch returns an empty list, then
  // the seeding step mutes everything outside the defaults. Waiting for both
  // means the user sees one honest state instead of two wrong ones.
  const [muted, setMuted]   = useState<Set<string>>(new Set());
  const [mutedLoaded, setMutedLoaded] = useState(false);
  const [muteErr, setMuteErr] = useState('');
  const [coinCapMsg, setCoinCapMsg] = useState('');
  const [tfCapMsg, setTfCapMsg] = useState('');

  // Price alerts
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [paLoading, setPaLoading]     = useState(false);
  const [paCoin, setPaCoin]           = useState('btc');
  const [paPrice, setPaPrice]         = useState('');
  const [paDir, setPaDir]             = useState<'above' | 'below'>('above');
  const [paLabel, setPaLabel]         = useState('');
  const [paAdding, setPaAdding]       = useState(false);
  const [paError, setPaError]         = useState('');

  // Declared before the effects that call it. It used to live further down, so
  // the mount effect below closed over a const declared later - what
  // react-hooks/immutability means by "accessed before it is declared". It only
  // worked because effects run after the component body has finished; nothing
  // about the code said so. It closes over nothing but the imported
  // getSupabase, so hoisting it is free.
  const getAuthToken = async (): Promise<string | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  };

  useEffect(() => {
    fetch('/api/telegram/bot-info').then(r => r.json())
      .then(d => { setBotUsername(d.username ?? null); setWebhookOk(d.webhook_ok !== false); })
      .catch(() => {});
    getAuthToken().then(token => {
      // Signed out: there are no preferences to wait for, and the pickers are
      // not reachable anyway. Release the gate so a signed-out visitor is not
      // left looking at skeletons forever.
      if (!token) { setMutedLoaded(true); return; }
      fetch('/api/alert-prefs', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(async d => {
          const mutedList: string[] = d.muted ?? [];
          setMuted(new Set<string>(mutedList));
          const seeded = new Set(mutedList);
          // Seeding is gated on an explicit marker rather than on "this user has
          // no coin:/ema_signal_ rows", because those two conditions are not the
          // same thing. Turning a key ON deletes its row (see /api/alert-prefs
          // POST), so a user who switched every coin on has zero coin: rows -
          // identical to a brand-new user - and the old row-count test re-muted
          // all but three of them on their next visit. Same for timeframes. The
          // marker is written once and never removed, so "already configured"
          // stays true no matter what the user later turns on or off.
          if (!seeded.has(SEEDED_COINS)) {
            const toMute = COINS.filter(c => !['btc', 'eth', 'sol'].includes(c));
            await Promise.all(toMute.map(c =>
              fetch('/api/alert-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ key: `coin:${c}`, muted: true }),
              }).catch(() => {})
            ));
            await markSeeded(token, SEEDED_COINS);
            setMuted(prev => {
              const n = new Set(prev);
              toMute.forEach(c => n.add(`coin:${c}`));
              n.add(SEEDED_COINS);
              return n;
            });
          }
          // Same pattern, same marker fix, for the EMA Buy/Sell Signal
          // timeframe picker - a brand-new user starts with DEFAULT_ON_TFS
          // active and the rest pre-muted, rather than all 8 (which would blow
          // past ALERT_TF_CAP the moment they're seen).
          if (!seeded.has(SEEDED_EMA_TFS)) {
            const toMuteTf = EMA_SIGNAL_TFS.filter(tf => !DEFAULT_ON_TFS.includes(tf));
            await Promise.all(toMuteTf.map(tf =>
              fetch('/api/alert-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ key: `ema_signal_${tf}`, muted: true }),
              }).catch(() => {})
            ));
            await markSeeded(token, SEEDED_EMA_TFS);
            setMuted(prev => {
              const n = new Set(prev);
              toMuteTf.forEach(tf => n.add(`ema_signal_${tf}`));
              n.add(SEEDED_EMA_TFS);
              return n;
            });
          }
          // No seeding step for market structure. Those keys are opt-IN
          // (structure_on_<tf>, see lib/structurePrefs.ts): absence already
          // means off, everywhere, without anyone having to open this page.
          // There used to be a block here that wrote structure_<tf> mute rows
          // for anyone who had none - which is how the feature shipped OFF in
          // the UI and ON in the cron, since the cron never waits for a page
          // load. It also silently re-muted anyone who turned both timeframes
          // on, because turning a key on deletes its row, leaving them
          // indistinguishable from a brand-new user on the next visit.
        })
        .catch(() => {})
        // Runs after the seeding awaits above, so the pickers unblock on the
        // final state rather than the intermediate one. On failure it still
        // fires: a user who cannot reach the API should get the pickers back
        // (defaulting to everything-on, as before) rather than a permanent
        // skeleton.
        .finally(() => setMutedLoaded(true));
    });
  }, []);

  // ── Waiting for the user to finish in Telegram ──────────────────────────
  // Re-read settings on a timer while a code is outstanding: the webhook, not
  // this page, writes telegram_chat_id, so polling is the only way to notice.
  useEffect(() => {
    if (!linkCode) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (attempts > LINK_POLL_MAX) {
        clearInterval(id);
        setPollExhausted(true);
        return;
      }
      refreshSettings();
    }, LINK_POLL_MS);
    return () => clearInterval(id);
  }, [linkCode, refreshSettings]);

  // Countdown on the outstanding code, so "expired" is visible rather than a
  // silent failure the next time the user sends it.
  useEffect(() => {
    if (!linkCode) return;
    const id = setInterval(() => setLinkSecondsLeft(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [linkCode]);

  // Connection landed - drop the code panel and show the connected state.
  useEffect(() => {
    if (isConnected && linkCode) {
      setLinkCode(null);
      setPollExhausted(false);
      setLinkSecondsLeft(0);
    }
  }, [isConnected, linkCode]);

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

  // No cap check: only two timeframes exist for this rule, so there is nothing
  // to protect the user from.
  //
  // Inverted against every other toggle on this page. toggleMute() writes the
  // key when it is absent and deletes it when present; for an opt-in key that
  // reads as "write the row = turn the alert ON", which is exactly what we
  // want, but it means `muted.has(structureOnKey(tf))` is the ENABLED state
  // here, not the muted one. See lib/structurePrefs.ts.
  const toggleStructureTf = (tf: string) => toggleMute(structureOnKey(tf));

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

  // Ask the server for a one-time code. The user hands it to the bot, the bot
  // webhook writes the chat ID - the browser never supplies it, which is the
  // whole point (see supabase/migrations/20260807j_telegram_link_codes.sql).
  const requestLinkCode = async () => {
    setLinkIssuing(true);
    setLinkError('');
    setPollExhausted(false);
    setCodeCopied(false);
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/telegram/link-code', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json() as { code?: string; expires_in_seconds?: number; deep_link?: string | null };
      if (!res.ok || !d.code) throw new Error('link code failed');
      setLinkCode({ code: d.code, deepLink: d.deep_link ?? null });
      setLinkSecondsLeft(d.expires_in_seconds ?? LINK_CODE_TTL_SEC);
    } catch {
      setLinkError(t('ALERTS_CONNECT_FAILED'));
    }
    setLinkIssuing(false);
  };

  const copyStartCommand = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(`/start ${linkCode.code}`);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2500);
    } catch { /* no clipboard access - the code is on screen anyway */ }
  };

  const disconnectTelegram = async () => {
    setDisconnecting(true);
    setDisconnectError('');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/telegram/link-code', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json() as { ok?: boolean };
      if (!res.ok || !d.ok) throw new Error('disconnect failed');
      await refreshSettings();
      setTestState('idle');
      setTestErr('');
    } catch {
      setDisconnectError(t('ALERTS_DISCONNECT_FAILED'));
    }
    setDisconnecting(false);
  };

  // Hits /api/alerts/preview, NOT the alert cron. This used to call
  // /api/telegram/alert directly, which stopped working the moment the cron
  // routes were made fail-closed - a browser has no cron secret, so every
  // press returned 401 and the button showed nothing but its own failure
  // state. The preview route answers for this user only, sends nothing, and
  // mutates nothing (see the note at the top of that file for why touching the
  // cron's dedup state would be worse than the dead button).
  const checkNow = async () => {
    setCheckState('checking'); setCheckResult(null); setCheckErr('');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/alerts/preview', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // Pro gate, not a failure. Without this the button reports the server's
        // error code as if the request had broken - and fixing the route's
        // label alone would have made that read "PRO_REQUIRED", which is worse
        // than the "Pro required" it replaced. Same locked-state handling as
        // DryPowder, HypothesisTracker and TradeJournal.
        if (res.status === 403 && d.error === 'PRO_REQUIRED') {
          setCheckState('idle');
          setUpgradeGate(t('ALERTS_UPGRADE_GATE_FEATURE_LABEL'));
          return;
        }
        throw new Error(d.error ?? t('ALERTS_SERVER_ERROR', { status: res.status }));
      }
      setCheckResult(await res.json());
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
      { key: 'rsi',        dot: 'var(--amber)', title: t('ALERTS_RSI_TITLE'), desc: t('ALERTS_RSI_DESC') },
      { key: 'rapid_move', dot: 'var(--orange)', title: t('ALERTS_RAPID_MOVES_TITLE'),     desc: t('ALERTS_RAPID_MOVES_DESC') },
    ]},
    { section: t('ALERTS_SECTION_FLOW'), items: [
      { key: 'whales',   dot: '#1a7aff', title: t('ALERTS_WHALES_TITLE'),        desc: t('ALERTS_WHALES_DESC') },
      { key: 'oi_spike', dot: 'var(--amber)', title: t('ALERTS_OI_SPIKE_TITLE'), desc: t('ALERTS_OI_SPIKE_DESC') },
      { key: 'cvd',      dot: 'var(--green-2)', title: t('ALERTS_CVD_TITLE'),      desc: t('ALERTS_CVD_DESC') },
      { key: 'squeeze',  dot: '#f43f5e', title: t('ALERTS_SQUEEZE_TITLE'), desc: t('ALERTS_SQUEEZE_DESC') },
      { key: 'distribution', dot: '#f97316', title: t('ALERTS_DISTRIBUTION_TITLE'), desc: t('ALERTS_DISTRIBUTION_DESC') },
    ]},
    { section: t('ALERTS_SECTION_NEWS_SENTIMENT'), items: [
      { key: 'news',               dot: 'var(--red)', title: t('ALERTS_NEWS_TITLE'),         desc: t('ALERTS_NEWS_DESC') },
      { key: 'fear_greed',         dot: '#f97316', title: t('ALERTS_FEAR_GREED_TITLE'), desc: t('ALERTS_FEAR_GREED_DESC') },
      { key: 'sentiment_extremes', dot: '#f43f5e', title: t('ALERTS_SENTIMENT_EXTREMES_TITLE'),    desc: t('ALERTS_SENTIMENT_EXTREMES_DESC') },
    ]},
    { section: t('ALERTS_SECTION_PRICE_SUMMARY'), items: [
      { key: 'price_alerts',  dot: '#9ba4ff', title: t('ALERTS_PRICE_LEVEL_TITLE'), desc: t('ALERTS_PRICE_LEVEL_DESC') },
      { key: 'daily_summary', dot: 'var(--amber)', title: t('ALERTS_DAILY_SUMMARY_TITLE', { time: dailySummaryLocalTime }), desc: t('ALERTS_DAILY_SUMMARY_DESC', { time: dailySummaryLocalTime }) },
    ]},
  ];

  const stepStyle: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 16 };
  const numStyle: React.CSSProperties = {
    width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-solid)',
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
      {!authLoading && !entitled ? (
        <LockedFeatureCard
          title={t('ALERTS_CONNECT_TELEGRAM_TITLE')}
          description={t('ALERTS_LOCKED_FEATURE_DESC')}
          onUnlock={() => setUpgradeGate(t('ALERTS_UPGRADE_GATE_FEATURE_LABEL'))}
        />
      ) : (
      /* ── Connect Telegram ───────────────────────────────────────────────
          One-time code, not a pasted chat ID: the user sends the code to the
          bot and the webhook writes the chat ID server-side. See
          supabase/migrations/20260807j_telegram_link_codes.sql for why the
          old paste-your-chat-ID form had to go. */
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="lbl" style={{ margin: 0 }}>{t('ALERTS_CONNECT_TELEGRAM_TITLE')}</div>
          {settingsLoading ? (
            <SkeletonBar width={70} height={12} />
          ) : isConnected ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: 'var(--green-2)',
              background: '#34d39914', border: '0.5px solid #34d39944',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 5px #34d399' }} />
              {t('ALERTS_STATUS_CONNECTED')}
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              padding: '3px 9px', borderRadius: 20, color: 'var(--red)',
              background: 'transparent', border: '0.5px solid var(--bdr)',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />
              {t('ALERTS_STATUS_NOT_CONNECTED')}
            </span>
          )}
        </div>

        {isConnected ? (
          /* ── Connected state ──
              The chat ID itself is deliberately not shown: the user never
              supplied it and never needs it, and printing it back only
              teaches people it is a value worth copying around. */
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', marginBottom: 14, lineHeight: 1.6 }}>
              {t('ALERTS_CONNECTED_DESC')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className={`tg-action-btn${testState === 'ok' ? ' tg-btn-ok' : testState === 'err' ? ' tg-btn-err' : ''}`}
                onClick={sendTest}
                disabled={testState === 'sending'}
              >
                {testState === 'sending' ? t('ALERTS_TEST_SENDING') : testState === 'ok' ? t('ALERTS_TEST_SENT_OK') : testState === 'err' ? t('ALERTS_TEST_FAILED') : t('ALERTS_SEND_TEST_BUTTON')}
              </button>
              <button
                className="tg-action-btn tg-btn-secondary"
                onClick={disconnectTelegram}
                disabled={disconnecting}
              >
                {disconnecting ? t('ALERTS_DISCONNECTING') : t('ALERTS_DISCONNECT_BUTTON')}
              </button>
            </div>
            {testState === 'err' && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{testErr}</div>}
            {disconnectError && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{disconnectError}</div>}
          </div>
        ) : (
          /* ── Not connected ── */
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 16, lineHeight: 1.6 }}>
              {t('ALERTS_WIZARD_INTRO')}
            </div>

            {!webhookOk && (
              <div style={{
                fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 14, padding: '8px 12px',
                background: '#f8717114', borderRadius: 6, border: '0.5px solid #f8717144',
              }}>
                <Warn /> {t('ALERTS_CONNECT_WEBHOOK_WARNING')}
              </div>
            )}

            {!linkCode ? (
              <>
                <button
                  className="tg-action-btn"
                  onClick={requestLinkCode}
                  disabled={linkIssuing}
                  style={{ width: '100%' }}
                >
                  {linkIssuing ? t('ALERTS_CONNECT_PREPARING') : t('ALERTS_CONNECT_TELEGRAM_TITLE')}
                </button>
                {linkError && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{linkError}</div>
                )}
              </>
            ) : (
              <div>
                {linkCode.deepLink && (
                  <div style={{ marginBottom: 14 }}>
                    <a
                      href={linkCode.deepLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff',
                        background: 'linear-gradient(135deg, #0088cc 0%, #229ed9 100%)',
                        padding: '10px 18px', borderRadius: 8, textDecoration: 'none',
                      }}
                    >
                      {t('ALERTS_CONNECT_OPEN_TELEGRAM')}
                    </a>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 8, lineHeight: 1.6 }}>
                      {t('ALERTS_CONNECT_DEEP_LINK_HINT')}
                    </div>
                  </div>
                )}

                {/* Manual path - the only path when the bot username isn't
                    configured server-side, a fallback otherwise. */}
                <div style={{
                  paddingTop: linkCode.deepLink ? 14 : 0,
                  borderTop: linkCode.deepLink ? '0.5px solid var(--bdr)' : 'none',
                }}>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 12 }}>
                    {linkCode.deepLink ? t('ALERTS_CONNECT_MANUAL_FALLBACK') : t('ALERTS_CONNECT_MANUAL_ONLY')}
                  </div>

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
                            fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--accent-2)',
                            textDecoration: 'underline',
                          }}
                        >
                          {t('ALERTS_OPEN_BOT_BUTTON', { bot: botLabel })}
                        </a>
                      ) : (
                        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                          {t('ALERTS_SEARCH_BOT_PRE')} <strong>{t('ALERTS_SEARCH_BOT_BOLD')}</strong> {t('ALERTS_SEARCH_BOT_POST')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ ...stepStyle, marginBottom: 0 }}>
                    <div style={numStyle}>2</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
                        {t('ALERTS_CONNECT_SEND_MESSAGE')}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <code style={{
                          background: 'var(--bg2)', padding: '7px 12px', borderRadius: 6,
                          fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.06em',
                          fontFamily: 'var(--font-mono), monospace', color: 'var(--txt)',
                          border: '0.5px solid var(--bdr)',
                        }}>
                          /start {linkCode.code}
                        </code>
                        <button
                          className="tg-action-btn tg-btn-secondary"
                          onClick={copyStartCommand}
                          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                        >
                          {codeCopied ? t('ALERTS_CONNECT_COPIED') : t('ALERTS_CONNECT_COPY_BUTTON')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expiry + waiting state */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--bdr)' }}>
                  {linkSecondsLeft > 0 ? (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                      {t('ALERTS_CONNECT_EXPIRES_IN', {
                        time: `${Math.floor(linkSecondsLeft / 60)}:${String(linkSecondsLeft % 60).padStart(2, '0')}`,
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>
                      {t('ALERTS_CONNECT_CODE_EXPIRED')}
                    </div>
                  )}

                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', marginTop: 6, lineHeight: 1.6 }}>
                    {pollExhausted ? t('ALERTS_CONNECT_STILL_WAITING') : t('ALERTS_CONNECT_WAITING')}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {pollExhausted && (
                      <button className="tg-action-btn tg-btn-secondary" onClick={() => refreshSettings()}>
                        {t('ALERTS_CONNECT_CHECK_AGAIN')}
                      </button>
                    )}
                    <button
                      className="tg-action-btn tg-btn-secondary"
                      onClick={requestLinkCode}
                      disabled={linkIssuing}
                    >
                      {linkIssuing ? t('ALERTS_CONNECT_PREPARING') : t('ALERTS_CONNECT_NEW_CODE_BUTTON')}
                    </button>
                  </div>

                  {linkError && (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 8 }}>{linkError}</div>
                  )}

                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 10, lineHeight: 1.6 }}>
                    {t('ALERTS_CONNECT_SECURITY_NOTE')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── Price Alerts ─────────────────────────────────────────────────── */}
      <AuthGate
        title={t('ALERTS_AUTHGATE_TITLE')}
        desc={t('ALERTS_AUTHGATE_DESC')}
      >
        {!authLoading && !entitled ? (
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


      {/* ── Manual Check ─────────────────────────────────────────────────── */}
      {isConnected && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 4 }}>{t('ALERTS_MANUAL_CHECK_LABEL')}</div>
          {/* States the scope. Without it "No conditions active right now"
              reads as a claim about every alert type, when this only covers
              the two rules with per-coin/timeframe settings on this page. */}
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 10, lineHeight: 1.6 }}>
            {t('ALERTS_MANUAL_CHECK_DESC')}
          </div>
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
              {/* Held back until prefs load - an unloaded `muted` reads as
                  "every coin on", which briefly rendered a false over-limit
                  warning. */}
              {!mutedLoaded ? <SkeletonBar width={110} height={10} /> : (() => {
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
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 8 }}>
              {coinCapMsg}
            </div>
          )}
          {/* Same reasoning as the timeframe chips: an unloaded `muted` makes
              this render every coin as selected before correcting itself. */}
          {!mutedLoaded ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COINS.slice(0, 7).map(c => <SkeletonBar key={c} width={62} height={26} radius={7} />)}
            </div>
          ) : (
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
          )}
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
            {/* Same gate as the coin counter above: before prefs land this read
                "8 on (limit 3 - turn some off)", which is the bug being fixed. */}
            {!mutedLoaded ? <SkeletonBar width={130} height={10} /> : (() => {
              const onCount = EMA_SIGNAL_TFS.filter(tf => !muted.has(`ema_signal_${tf}`)).length;
              return onCount > ALERT_TF_CAP
                ? t('ALERTS_TF_OVER_LIMIT', { onCount, cap: ALERT_TF_CAP })
                : t('ALERTS_TF_COUNT', { onCount, cap: ALERT_TF_CAP });
            })()}
          </div>
          {tfCapMsg && (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 8, paddingLeft: 14 }}>
              {tfCapMsg}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 14 }}>
            {/* Placeholder chips rather than real ones while prefs load. The
                chips are the part the user actually watched flip: all 8 lit,
                then five of them switching off a few seconds later. */}
            {!mutedLoaded && EMA_SIGNAL_TFS.map(tf => (
              <SkeletonBar key={tf} width={52} height={26} radius={7} />
            ))}
            {mutedLoaded && EMA_SIGNAL_TFS.map(tf => {
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

        {/* Market structure - a price-only read that runs alongside the EMA
            rule and never feeds into it. Its own dot colour (the same sky blue
            the Arena chart uses for bullish structure) so the two are visibly
            different systems here as well as on the chart. */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="tg-cond-dot" style={{ background: '#38bdf8' }} />
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)' }}>
              {t('ALERTS_STRUCTURE_TITLE')}
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8, paddingLeft: 14 }}>
            {t('ALERTS_STRUCTURE_DESC')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 14 }}>
            {STRUCTURE_TFS.map(tf => {
              // Opt-in: the row's presence is ON, so `off` is its absence.
              const off = !muted.has(structureOnKey(tf));
              return (
                <button
                  key={tf}
                  onClick={() => toggleStructureTf(tf)}
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
            {([['dir:long', t('ALERTS_DIR_LONG_LABEL'), 'var(--green)'], ['dir:short', t('ALERTS_DIR_SHORT_LABEL'), 'var(--red)']] as const).map(([key, label, col]) => {
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
