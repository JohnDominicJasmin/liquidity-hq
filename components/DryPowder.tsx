'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard, EntitlementUnknownCard } from './UpgradeGateModal';
import Tip from './Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { lastGoodAge, readLastGood, writeLastGood } from '@/lib/lastGoodAge';

interface DPData {
  current:   number;
  prev30:    number;
  prev90:    number;
  series:    number[];
  signal:    string;
  narrative: string;
  keyLevel:  string;
  /** The AI text arrives separately from the numbers: 'loading' while it is being written, 'unavailable' when it timed out or failed. The numbers never wait for it. */
  analysis?: 'loading' | 'ready' | 'unavailable';
  /** The day (YYYY-MM-DD) of the text when it is not today's: shown as "From Nov 18". */
  from?: string;
}

const CACHE_KEY = 'lhq_dry_powder';
const CACHE_TTL = 4 * 60 * 60 * 1000;
/* The supply figures of the last successful read, kept at any age so a failed read shows them (with their age) instead of an error. */
const LAST_NUMBERS_KEY = 'lhq_dry_powder_last_numbers';

type LoadState = DPData | null | 'loading' | 'error' | 'unauth' | 'locked';

const SIGNAL_META: Record<string, { col: string; bg: string; bdr: string; icon: string }> = {
  EXPANDING:   { col: 'var(--green-2)', bg: 'rgba(52,211,153,0.10)',  bdr: 'rgba(52,211,153,0.3)',  icon: '↑' },
  CONTRACTING: { col: 'var(--red)', bg: 'rgba(248,113,113,0.10)', bdr: 'rgba(248,113,113,0.3)', icon: '↓' },
  NEUTRAL:     { col: 'var(--amber)', bg: 'rgba(251,191,36,0.10)',  bdr: 'rgba(251,191,36,0.3)',  icon: '→' },
};

function parseDPSection(text: string, key: string): string {
  const keys = ['SIGNAL', 'NARRATIVE', 'KEY_LEVEL'];
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function fmt(n: number) {
  return '$' + (n / 1e9).toFixed(1) + 'B';
}

function chgPct(current: number, prev: number) {
  const pct = ((current - prev) / prev) * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const W = 120; const H = 28;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const rising = series[series.length - 1] >= series[0];
  const col    = rising ? 'var(--green-2)' : 'var(--red)';
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

export default function DryPowder() {
  const { t } = useLabels();
  const router = useRouter();
  const { user, entitlementStatus, entitlementsLoading, retryEntitlements, loading: authLoading } = useAuth();
  /* THE PLAN IS NOT KNOWN YET, SO NO LOCKED CARD (#1651, QA: a Pro account saw the "With Pro" upsell for 0.3-0.8 s on the first visit). `entitlementStatus` reads 'not_entitled' while the subscription row is still loading, so the locked card is only for a CONFIRMED not-entitled (the same pattern as HypothesisTracker / TradeJournal / Alerts). */
  const planResolving = authLoading || (!!user && entitlementsLoading);
  const startedRef = useRef(false);
  const [state, setState]    = useState<LoadState>('loading');
  /* Set while the figures on screen are the saved ones from an earlier read, because this read failed: when they were read. */
  const [savedTs, setSavedTs] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setState('loading');
    setSavedTs(null);
    /* A failed read shows the last good figures with their age; only a visitor with none sees the error line. */
    const showSavedOrError = () => {
      const saved = readLastGood<DPData>(LAST_NUMBERS_KEY);
      if (saved && typeof saved.v.current === 'number' && saved.v.current > 0) {
        setState({ ...saved.v, signal: '', narrative: '', keyLevel: '', analysis: 'unavailable' });
        setSavedTs(saved.ts);
        return;
      }
      setState('error');
    };
    try {
      // getAuthToken(), not a raw getSession() - #1168.
      const token = await getAuthToken();
      if (!token) { setState('unauth'); return; }

      const headers = { Authorization: `Bearer ${token}` };
      /* TWO REQUESTS, STARTED TOGETHER: the supply figures (about a second, no AI) and the AI text (up to 25 s on the server). The card shows the figures as soon as they arrive and fills the text in after. */
      const askAi = () => fetch('/api/dry-powder', { headers }).then(r => r.json().then(j => ({ ok: r.ok, status: r.status, json: j as { analysis?: string; error?: string; pending?: boolean; from?: string } }))).catch(() => null);
      const aiReq = askAi();
      const res  = await fetch('/api/dry-powder?part=numbers', { headers });
      const json = await res.json() as {
        current?: number; prev30?: number; prev90?: number;
        series?: number[]; error?: string; from?: string;
      };

      // Entitlement can lapse while the tab is still open (a trial ending
      // mid-session), so treat the server's Pro gate as the source of truth
      // and fall back to the same locked card the render path below shows.
      if (res.status === 403 && json.error === 'PRO_REQUIRED') { setState('locked'); return; }

      /* The figures are not a reading unless the answer carries them: a missing field used to default to 0 and print "$0.0B" and a NaN change. */
      if (!res.ok || typeof json.current !== 'number' || typeof json.prev30 !== 'number' || typeof json.prev90 !== 'number') { showSavedOrError(); return; }

      const nums: DPData = {
        current:   json.current,
        prev30:    json.prev30,
        prev90:    json.prev90,
        series:    json.series  ?? [],
        signal: '', narrative: '', keyLevel: '', analysis: 'loading',
        /* Saved figures carry their day (#1651): shown with it, whether or not the text arrives. */
        ...(json.from ? { from: json.from } : {}),
      };
      setState(nums);
      writeLastGood(LAST_NUMBERS_KEY, nums);

      let ai = await aiReq;
      /* The text is written once a day by the server (lib/dryPowderAnalysis.ts). Before the first one exists the answer is "pending"; the card keeps its loading state, asks once more after a pause, and only then says it is unavailable. */
      if (ai?.json.pending) { await new Promise(r => setTimeout(r, 20_000)); ai = await askAi(); }
      /* Still pending after the pause: nothing was ever stored yet. The summary is left out (the figures stay, no skeleton and no failure line); the next visit finds the text. */
      if (ai?.json.pending) {
        setState(prev => (typeof prev === 'object' && prev !== null ? { ...prev, analysis: 'unavailable' } : prev));
        return;
      }
      if (!ai || !ai.ok || !ai.json.analysis) {
        setState(prev => (typeof prev === 'object' && prev !== null ? { ...prev, analysis: 'unavailable' } : prev));
        return;
      }
      const text = ai.json.analysis;
      const data: DPData = {
        ...nums,
        signal:    parseDPSection(text, 'SIGNAL'),
        narrative: parseDPSection(text, 'NARRATIVE'),
        keyLevel:  parseDPSection(text, 'KEY_LEVEL'),
        analysis: 'ready',
        ...(ai.json.from ? { from: ai.json.from } : {}),
      };
      setState(prev => (typeof prev === 'object' && prev !== null ? data : prev));
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
      } catch { /* ignore */ }
    } catch {
      showSavedOrError();
    }
  }, []);

  useEffect(() => {
    // Wait for the role to resolve, and skip entirely for a non-entitled
    // user - this is Pro-gated server-side (403 PRO_REQUIRED), so fetching
    // anyway just burns a round trip to show the locked-card branch below.
    // 'unknown' skips too (#1119): we can't confirm access, and the round
    // trip would 403 anyway if it turns out they really aren't entitled.
    /* SENT AS SOON AS AUTH IS KNOWN, NOT AFTER THE PLAN (QA L103, #1651: the request left 2.1-4.9 s after navigation because it waited for the entitlement): the server answers 403 PRO_REQUIRED to a non-Pro account (handled below as the locked state), so a Pro visit starts its read at once. A CONFIRMED non-Pro or unknown plan still does not fetch. Once per mount. */
    if (authLoading) return;
    if (!entitlementsLoading && entitlementStatus !== 'entitled') return;
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: DPData };
        if (Date.now() - ts < CACHE_TTL && (data.analysis === undefined || data.analysis === 'ready')) { setState(data); return; }
      }
    } catch { /* ignore */ }
    fetchData();
  }, [authLoading, entitlementStatus, entitlementsLoading, fetchData]);

  const signalKey = typeof state === 'object' && state !== null
    ? (state.signal.match(/^(EXPANDING|CONTRACTING|NEUTRAL)/)?.[1] ?? 'NEUTRAL')
    : 'NEUTRAL';
  const sm = SIGNAL_META[signalKey] ?? SIGNAL_META.NEUTRAL;

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Header */}
      <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 2 }}>
        <Tip width={320} text={t('DRY_POWDER_TOOLTIP')}>
          {t('DRY_POWDER_TITLE')}
        </Tip>
      </div>

      {!authLoading && entitlementStatus === 'unknown' ? (
        <EntitlementUnknownCard title={t('DRY_POWDER_TITLE')} onRetry={retryEntitlements} />
      ) : (!planResolving && entitlementStatus !== 'entitled') || state === 'locked' ? (
        <LockedFeatureCard
          title={t('DRY_POWDER_TITLE')}
          description={t('DRY_POWDER_LOCKED_DESC')}
          onUnlock={() => router.push('/upgrade')}
        />
      ) : (
      <>
      {state === 'loading' && (
        <div style={{ padding: '4px 0' }} role="status" aria-live="polite">
          <span className="sr-only">{t('DRY_POWDER_LOADING_SR')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: 4 }}>
            <SkeletonBar width={90} height={20} radius={5} />
            <SkeletonBar width={120} height={20} radius={4} />
          </div>
          <SkeletonBar width={80} height={18} radius={20} style={{ marginBottom: 8 }} />
          <SkeletonBar height={11} radius={4} style={{ marginBottom: 6 }} />
          <SkeletonBar width="70%" height={11} radius={4} />
        </div>
      )}

      {state === 'unauth' && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '8px 0' }}>{t('DRY_POWDER_SIGN_IN')}</div>
      )}

      {state === 'error' && (
        <div style={{ padding: '8px 0' }}>
          {/* Always the translated line, never the server's or the runtime's own text ("TypeError: Failed to fetch"). Translating here rather than in the
              fetch callback keeps `t` out of that callback's dependencies. */}
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 6 }}>{t('DRY_POWDER_FETCH_FAILED')}</div>
          <button
            onClick={fetchData}
            style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
          >
            {t('DRY_POWDER_RETRY')}
          </button>
        </div>
      )}

      {typeof state === 'object' && state !== null && (() => {
        const d = state;
        const chg30 = chgPct(d.current, d.prev30);
        const chg30Up = d.current >= d.prev30;
        return (
          <>
            {/* Supply stats + sparkline row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace', lineHeight: 1 }}>
                    {fmt(d.current)}
                  </span>
                  <span style={{
                    fontSize: 'var(--fs-caption)', fontWeight: 700, fontFamily: 'var(--font-mono), monospace',
                    color: chg30Up ? 'var(--green-2)' : 'var(--red)',
                  }}>
                    {t('DRY_POWDER_30D_CHANGE', { pct: chg30 })}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>
                  {t('DRY_POWDER_90D_AGO', { value: fmt(d.prev90), pct: chgPct(d.current, d.prev90) })}
                </div>
              </div>
              <Sparkline series={d.series} />
            </div>

            {/* Signal badge (from the AI text, so only once it has arrived) */}
            {d.analysis !== 'loading' && d.analysis !== 'unavailable' && <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 20, marginBottom: 8,
              background: sm.bg, border: `0.5px solid ${sm.bdr}`,
            }}>
              {/* #1200: decorative - signalKey below already carries this in words. */}
              <span aria-hidden="true" style={{ fontSize: 'var(--fs-caption)', color: sm.col }}>{sm.icon}</span>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: sm.col, letterSpacing: '0.04em' }}>
                {signalKey}
              </span>
            </div>}

            {d.analysis === 'loading' && (
              <div role="status" aria-live="polite" data-testid="dry-powder-analysis-loading">
                <span className="sr-only">{t('DRY_POWDER_ANALYSIS_LOADING_SR')}</span>
                <SkeletonBar height={11} radius={4} style={{ marginBottom: 6 }} />
                <SkeletonBar width="70%" height={11} radius={4} />
              </div>
            )}
            {/* 'unavailable' draws nothing: the figures above stand alone, no failure line. */}

            {d.from && (
              <div data-testid="dry-powder-from" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 4 }}>
                {t('DRY_POWDER_FROM_DATE', { date: new Date(`${d.from}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) })}
              </div>
            )}

            {/* Narrative */}
            {d.narrative && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginBottom: d.keyLevel ? 8 : 0 }}>
                {d.narrative}
              </div>
            )}

            {/* Key level */}
            {d.keyLevel && (
              <div style={{
                fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2,
                paddingTop: 6, borderTop: '0.5px solid var(--bdr)',
              }}>
                <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>{t('DRY_POWDER_WATCH_LABEL')}</span>
                {d.keyLevel}
              </div>
            )}

            {savedTs != null && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 6 }}>{lastGoodAge(savedTs, t)}</div>
            )}

            {/* Refresh button */}
            <button
              onClick={fetchData}
              style={{
                display: 'block', marginTop: 8,
                fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent',
                border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
              }}
            >
              {t('DRY_POWDER_REFRESH')}
            </button>
          </>
        );
      })()}
      </>
      )}
    </div>
  );
}
