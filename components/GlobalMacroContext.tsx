'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard } from './UpgradeGateModal';
import Tip from './Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

interface MacroData {
  dxy: number;  dxyChg: number;
  vix: number;  vixChg: number;
  gold: number; goldChg: number;
  oil: number;  oilChg: number;
  tnx: number;  tnxChg: number;
  goldOilRatio: number;
  signal:       string;
  analysis:     string;
  implications: string;
  watchLevel:   string;
}

const CACHE_KEY = 'lhq_macro_context';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

type LoadState = MacroData | null | 'loading' | 'error' | 'unauth';

const SIGNAL_META: Record<string, { col: string; bg: string; bdr: string; labelKey: LabelKey }> = {
  RISK_ON:  { col: 'var(--green-2)', bg: 'rgba(52,211,153,0.10)',  bdr: 'rgba(52,211,153,0.3)',  labelKey: 'GLOBAL_MACRO_CONTEXT_SIGNAL_RISK_ON'  },
  RISK_OFF: { col: 'var(--red)', bg: 'rgba(248,113,113,0.10)', bdr: 'rgba(248,113,113,0.3)', labelKey: 'GLOBAL_MACRO_CONTEXT_SIGNAL_RISK_OFF' },
  NEUTRAL:  { col: 'var(--amber)', bg: 'rgba(251,191,36,0.10)',  bdr: 'rgba(251,191,36,0.3)',  labelKey: 'GLOBAL_MACRO_CONTEXT_SIGNAL_NEUTRAL'  },
};

function parseMacroSection(text: string, key: string): string {
  const keys = ['MACRO_SIGNAL', 'MACRO_ANALYSIS', 'CRYPTO_IMPLICATIONS', 'WATCH_LEVEL'];
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function chgColor(chg: number, invertBullish = false) {
  const pos = invertBullish ? chg < 0 : chg > 0;
  if (Math.abs(chg) < 0.05) return 'var(--txt3)';
  return pos ? 'var(--green-2)' : 'var(--red)';
}

function chgStr(chg: number) {
  return (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
}

export default function GlobalMacroContext() {
  const { t } = useLabels();
  const router = useRouter();
  const { entitled, loading: authLoading } = useAuth();
  const [state,  setState]  = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState('');

  const fetchData = useCallback(async () => {
    setState('loading');
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      if (!token) { setState('unauth'); return; }

      const res  = await fetch('/api/macro-context', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as {
        dxy?: number; dxyChg?: number; vix?: number; vixChg?: number;
        gold?: number; goldChg?: number; oil?: number; oilChg?: number;
        tnx?: number; tnxChg?: number; goldOilRatio?: number;
        analysis?: string; error?: string;
      };

      if (!res.ok) { setErrMsg(json.error ?? ''); setState('error'); return; }

      const text = json.analysis ?? '';
      const signal      = parseMacroSection(text, 'MACRO_SIGNAL').replace(/[^A-Z_]/g, '');
      const analysis    = parseMacroSection(text, 'MACRO_ANALYSIS');
      const implications = parseMacroSection(text, 'CRYPTO_IMPLICATIONS');
      const watchLevel  = parseMacroSection(text, 'WATCH_LEVEL');

      const data: MacroData = {
        dxy:  json.dxy  ?? 0, dxyChg:  json.dxyChg  ?? 0,
        vix:  json.vix  ?? 0, vixChg:  json.vixChg  ?? 0,
        gold: json.gold ?? 0, goldChg: json.goldChg ?? 0,
        oil:  json.oil  ?? 0, oilChg:  json.oilChg  ?? 0,
        tnx:  json.tnx  ?? 0, tnxChg:  json.tnxChg  ?? 0,
        goldOilRatio: json.goldOilRatio ?? 0,
        signal, analysis, implications, watchLevel,
      };
      setState(data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
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
        const { ts, data } = JSON.parse(raw) as { ts: number; data: MacroData };
        if (Date.now() - ts < CACHE_TTL) { setState(data); return; }
      }
    } catch { /* ignore */ }
    fetchData();
  }, [authLoading, entitled, fetchData]);

  const signalKey = typeof state === 'object' && state !== null
    ? (state.signal.match(/^(RISK_ON|RISK_OFF|NEUTRAL)/)?.[1] ?? 'NEUTRAL')
    : 'NEUTRAL';
  const sm = SIGNAL_META[signalKey] ?? SIGNAL_META.NEUTRAL;

  return (
    <div>
      <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 4 }}>
        <Tip width={320} text={t('GLOBAL_MACRO_CONTEXT_TOOLTIP')}>
          {t('GLOBAL_MACRO_CONTEXT_TITLE')}
        </Tip>
      </div>

      {!authLoading && !entitled ? (
        <LockedFeatureCard
          title={t('GLOBAL_MACRO_CONTEXT_TITLE')}
          description={t('GLOBAL_MACRO_CONTEXT_LOCKED_DESC')}
          onUnlock={() => router.push('/upgrade')}
        />
      ) : (
      <>
      {state === 'loading' && (
        <div style={{ padding: '4px 0' }} role="status" aria-live="polite">
          <span className="sr-only">{t('GLOBAL_MACRO_CONTEXT_FETCHING_SR')}</span>
          <SkeletonBar width={90} height={20} radius={20} style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 8px', marginBottom: 10 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <SkeletonBar key={i} height={28} radius={4} />
            ))}
          </div>
          <SkeletonBar height={11} radius={4} style={{ marginBottom: 6 }} />
          <SkeletonBar width="80%" height={11} radius={4} />
        </div>
      )}
      {state === 'unauth' && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '8px 0' }}>{t('GLOBAL_MACRO_CONTEXT_SIGNIN_PROMPT')}</div>
      )}
      {state === 'error' && (
        <div style={{ padding: '8px 0' }}>
          {/* Empty errMsg means the server gave no message of its own, so the
              generic label stands in. Translating here rather than in the fetch
              callback keeps `t` out of that callback's dependencies - it had to
              be omitted there, which froze the message to first-render's
              language and left it stale after a locale switch. */}
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginBottom: 6 }}>{errMsg || t('GLOBAL_MACRO_CONTEXT_FETCH_FAILED')}</div>
          <button onClick={fetchData} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>{t('GLOBAL_MACRO_CONTEXT_RETRY')}</button>
        </div>
      )}

      {typeof state === 'object' && state !== null && (() => {
        const d = state;
        const rows: { id: string; label: string; value: string; chg: number; invertBullish?: boolean }[] = [
          { id: 'dxy',    label: t('GLOBAL_MACRO_CONTEXT_ROW_DXY'),      value: d.dxy.toFixed(2),  chg: d.dxyChg,  invertBullish: true },
          { id: 'vix',    label: t('GLOBAL_MACRO_CONTEXT_ROW_VIX'),      value: d.vix.toFixed(1),  chg: d.vixChg,  invertBullish: true },
          { id: 'gold',   label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD'),     value: '$' + d.gold.toLocaleString('en-US', { maximumFractionDigits: 0 }), chg: d.goldChg },
          { id: 'oil',    label: t('GLOBAL_MACRO_CONTEXT_ROW_OIL'),      value: '$' + d.oil.toFixed(1),  chg: d.oilChg  },
          { id: 'tnx',    label: t('GLOBAL_MACRO_CONTEXT_ROW_10Y_YIELD'), value: d.tnx.toFixed(2) + '%',  chg: d.tnxChg, invertBullish: true },
          { id: 'goldoil', label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD_OIL'), value: d.goldOilRatio.toFixed(1) + 'x', chg: 0 },
        ];
        return (
          <>
            {/* Signal badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, marginBottom: 8, background: sm.bg, border: `0.5px solid ${sm.bdr}` }}>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: sm.col, letterSpacing: '0.05em' }}>{t(sm.labelKey)}</span>
            </div>

            {/* Data grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px', marginBottom: 10 }}>
              {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>{r.label}</span>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace' }}>{r.value}</span>
                  {r.chg !== 0 && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: chgColor(r.chg, r.invertBullish), fontFamily: 'var(--font-mono), monospace' }}>{chgStr(r.chg)}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Analysis */}
            {d.analysis && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginBottom: 8 }}>
                {d.analysis}
              </div>
            )}

            {/* Crypto implications */}
            {d.implications && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 7, marginBottom: 6 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--txt3)', marginBottom: 4 }}>{t('GLOBAL_MACRO_CONTEXT_IMPLICATIONS_TITLE')}</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{d.implications}</div>
              </div>
            )}

            {/* Watch level */}
            {d.watchLevel && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', fontWeight: 600 }}>{t('GLOBAL_MACRO_CONTEXT_WATCH_LABEL')}</span>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{d.watchLevel}</span>
              </div>
            )}

            <button onClick={fetchData} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {t('GLOBAL_MACRO_CONTEXT_REFRESH_BUTTON')}
            </button>
          </>
        );
      })()}
      </>
      )}
    </div>
  );
}
