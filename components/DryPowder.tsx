'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard } from './UpgradeGateModal';
import Tip from './Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

interface DPData {
  current:   number;
  prev30:    number;
  prev90:    number;
  series:    number[];
  signal:    string;
  narrative: string;
  keyLevel:  string;
}

const CACHE_KEY = 'lhq_dry_powder';
const CACHE_TTL = 4 * 60 * 60 * 1000;

type LoadState = DPData | null | 'loading' | 'error' | 'unauth' | 'locked';

const SIGNAL_META: Record<string, { col: string; bg: string; bdr: string; icon: string }> = {
  EXPANDING:   { col: '#34d399', bg: 'rgba(52,211,153,0.10)',  bdr: 'rgba(52,211,153,0.3)',  icon: '↑' },
  CONTRACTING: { col: '#f87171', bg: 'rgba(248,113,113,0.10)', bdr: 'rgba(248,113,113,0.3)', icon: '↓' },
  NEUTRAL:     { col: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bdr: 'rgba(251,191,36,0.3)',  icon: '→' },
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
  const col    = rising ? '#34d399' : '#f87171';
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

export default function DryPowder() {
  const { t } = useLabels();
  const router = useRouter();
  const { entitled, loading: authLoading } = useAuth();
  const [state, setState]    = useState<LoadState>('loading');
  const [errMsg, setErrMsg]  = useState('');

  const fetchData = useCallback(async () => {
    setState('loading');
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      if (!token) { setState('unauth'); return; }

      const res  = await fetch('/api/dry-powder', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as {
        current?: number; prev30?: number; prev90?: number;
        series?: number[]; analysis?: string; error?: string;
      };

      // Entitlement can lapse while the tab is still open (a trial ending
      // mid-session), so treat the server's Pro gate as the source of truth
      // and fall back to the same locked card the render path below shows.
      if (res.status === 403 && json.error === 'PRO_REQUIRED') { setState('locked'); return; }

      if (!res.ok) { setErrMsg(json.error ?? t('DRY_POWDER_FETCH_FAILED')); setState('error'); return; }

      const signal    = parseDPSection(json.analysis ?? '', 'SIGNAL');
      const narrative = parseDPSection(json.analysis ?? '', 'NARRATIVE');
      const keyLevel  = parseDPSection(json.analysis ?? '', 'KEY_LEVEL');

      const data: DPData = {
        current:   json.current ?? 0,
        prev30:    json.prev30  ?? 0,
        prev90:    json.prev90  ?? 0,
        series:    json.series  ?? [],
        signal, narrative, keyLevel,
      };
      setState(data);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
      } catch { /* ignore */ }
    } catch (e) {
      setErrMsg(String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    // Wait for the role to resolve, and skip entirely for a non-entitled
    // user - this is Pro-gated server-side (403 PRO_REQUIRED), so fetching
    // anyway just burns a round trip to show the locked-card branch below.
    if (authLoading || !entitled) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: DPData };
        if (Date.now() - ts < CACHE_TTL) { setState(data); return; }
      }
    } catch { /* ignore */ }
    fetchData();
  }, [authLoading, entitled, fetchData]);

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

      {(!authLoading && !entitled) || state === 'locked' ? (
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
          <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 6 }}>{errMsg}</div>
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
                    color: chg30Up ? '#34d399' : '#f87171',
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

            {/* Signal badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 20, marginBottom: 8,
              background: sm.bg, border: `0.5px solid ${sm.bdr}`,
            }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: sm.col }}>{sm.icon}</span>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: sm.col, letterSpacing: '0.04em' }}>
                {signalKey}
              </span>
            </div>

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
