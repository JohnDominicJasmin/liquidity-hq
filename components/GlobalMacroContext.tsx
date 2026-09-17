'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard } from './UpgradeGateModal';
import Tip from './Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

interface MacroData {
  // #1309 item 11: null (not a fallback number) means that feed's fetch
  // failed server-side - rendered as "unavailable" below, never as a
  // plausible-looking value that was never actually read.
  dxy: number | null;  dxyChg: number | null;
  vix: number | null;  vixChg: number | null;
  gold: number | null; goldChg: number | null;
  oil: number | null;  oilChg: number | null;
  tnx: number | null;  tnxChg: number | null;
  goldOilRatio: number | null;
  signal:       string;
  analysis:     string;
  implications: string;
  watchLevel:   string;
}

const CACHE_KEY = 'lhq_macro_context';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

type LoadState = MacroData | null | 'loading' | 'error' | 'unauth' | 'locked';

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
  const { user, loading: authLoading, entitlementStatus, entitlementsLoading } = useAuth();
  const [state,  setState]  = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState('');

  const fetchData = useCallback(async () => {
    setState('loading');
    try {
      // getAuthToken(), not a raw getSession() - #1165/#1166 bounded it. This
      // is mounted on /dashboard (DashboardTerminal, PerpSpotCard) and
      // /research; without the bound, a hung auth backend left this stuck on
      // its own 'loading' skeleton forever rather than reaching the visible
      // 'unauth'/'error' states below.
      const token = await getAuthToken();
      if (!token) { setState('unauth'); return; }

      const res  = await fetch('/api/macro-context', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as {
        dxy?: number | null; dxyChg?: number | null; vix?: number | null; vixChg?: number | null;
        gold?: number | null; goldChg?: number | null; oil?: number | null; oilChg?: number | null;
        tnx?: number | null; tnxChg?: number | null; goldOilRatio?: number | null;
        analysis?: string; error?: string;
      };

      /* PRO_REQUIRED is not a generic failure - #1171. Falling through to the
         'error' branch below would show a free user a raw error message
         where they should see the same LockedFeatureCard a signed-out
         visitor's own gate used to show before this route was reachable
         without one. Checked by value, not a separate `code` field - this
         route (like price-alerts) puts it in `error` itself. */
      if (!res.ok) {
        if (json.error === 'PRO_REQUIRED') { setState('locked'); return; }
        setErrMsg(json.error ?? ''); setState('error'); return;
      }

      const text = json.analysis ?? '';
      const signal      = parseMacroSection(text, 'MACRO_SIGNAL').replace(/[^A-Z_]/g, '');
      const analysis    = parseMacroSection(text, 'MACRO_ANALYSIS');
      const implications = parseMacroSection(text, 'CRYPTO_IMPLICATIONS');
      const watchLevel  = parseMacroSection(text, 'WATCH_LEVEL');

      const data: MacroData = {
        dxy:  json.dxy  ?? null, dxyChg:  json.dxyChg  ?? null,
        vix:  json.vix  ?? null, vixChg:  json.vixChg  ?? null,
        gold: json.gold ?? null, goldChg: json.goldChg ?? null,
        oil:  json.oil  ?? null, oilChg:  json.oilChg  ?? null,
        tnx:  json.tnx  ?? null, tnxChg:  json.tnxChg  ?? null,
        goldOilRatio: json.goldOilRatio ?? null,
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
    /* Gated on user, not entitled - #1171. This used to wait for the
       entitlements read to resolve `entitled` before firing at all, on the
       reasoning that fetching anyway "just burns a round trip" for a
       non-entitled user. That traded a real cost: entitled comes from a
       SEPARATE, separately-bounded fetch in AuthProvider (up to
       ENTITLEMENTS_FETCH_MS = 15s), so this component sat behind it doing
       nothing even though its own request doesn't need the answer - the
       server already 403s a non-entitled caller before spending anything
       (see the route's own comment), so the client-side gate was UX-only,
       not a security or cost requirement. Firing as soon as the session
       resolves (same timing GrokUsageProvider already uses) runs this
       concurrent with the entitlements fetch instead of sequential after
       it. The PRO_REQUIRED branch in fetchData above is what makes this
       safe to remove: a free user reaches the same LockedFeatureCard they
       always did, discovered from the server's actual answer instead of
       the client's own guess at it. */
    if (authLoading || !user) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: MacroData };
        if (Date.now() - ts < CACHE_TTL) { setState(data); return; }
      }
    } catch { /* ignore */ }
    fetchData();
  }, [authLoading, user, fetchData]);

  /* Accelerator, not a gate - the fix to the skeleton-flash concern raised
     on #1172's PR. The fetch above no longer waits for entitled before
     firing, but the entitlements resolve is still the FASTEST correct
     source of "this user is not entitled" whenever it lands before the
     fetch does - today's behaviour restated as a race instead of a
     dependency, not removed. Whichever of {this, the fetch's own
     PRO_REQUIRED} arrives first wins; the other is a no-op once state has
     moved past 'loading'.

     `entitlementsLoading`, not just `entitled` - entitled is `false` by
     DEFAULT while the read is still in flight (AuthProvider's own
     documented safe-default), so checking `!entitled` alone here would
     flash 'locked' at every Pro/Trial user for the entire entitlements
     window, the exact one-frame-wrong-plan-shape #1090 already burned this
     codebase on once for the badge. Waiting for entitlementsLoading to
     clear is what makes `entitled` a final answer instead of a guess.

     Also covers a real gap the state-driven render introduced: a
     genuinely signed-out visitor never has `user`, so the fetch effect
     above never runs and fetchData() never gets a chance to set 'locked'
     itself - before this effect existed, that left `state` stuck at its
     initial 'loading' forever. entitlementsLoading resolves to false
     immediately for `!user` (AuthProvider sets it directly, no fetch to
     wait for), so this effect covers signed-out visitors too, not just
     the free-but-signed-in case it was added for.

     `prev === 'loading' ? 'locked' : prev` - only fires from the initial
     state. Never stomps 'unauth' (a token-check timeout deserves its own
     message, not a paywall), 'error', already-'locked', or real data -
     the last of those cannot coexist with a confirmed not_entitled anyway (a
     200 body server-side already implies entitled), so the guard is a safety
     net, not a fix for a reachable conflict.

     Fires on a CONFIRMED not_entitled only, never on 'unknown' (#1119) - this
     accelerator is a GUESS at what the fetch's own PRO_REQUIRED check will
     say, made early to save the user a flash of the wrong UI. Guessing
     'locked' for 'unknown' would be exactly the guess the owner's #1119
     ruling forbids, and unlike the pre-#1119 default it would not even be
     self-correcting here in the failure case that matters most: the fetch
     above shares the same degraded backend that made entitlementStatus
     unknown in the first place, so it is not safe to assume its own real
     answer will arrive promptly to overwrite this guess. Leaving state on
     'loading' for 'unknown' is a hold, not a fix for the underlying backend
     problem - the fetch's own PRO_REQUIRED/success answer still resolves
     things whenever it lands. */
  useEffect(() => {
    if (authLoading || entitlementsLoading || entitlementStatus !== 'not_entitled') return;
    setState(prev => (prev === 'loading' ? 'locked' : prev));
  }, [authLoading, entitlementsLoading, entitlementStatus]);

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

      {state === 'locked' && (
        <LockedFeatureCard
          title={t('GLOBAL_MACRO_CONTEXT_TITLE')}
          description={t('GLOBAL_MACRO_CONTEXT_LOCKED_DESC')}
          onUnlock={() => router.push('/upgrade')}
        />
      )}
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
        // #1309 item 11: `value: null` renders as "unavailable" below,
        // never a fabricated number for a feed that failed to fetch.
        const rows: { id: string; label: string; value: string | null; chg: number; invertBullish?: boolean }[] = [
          { id: 'dxy',    label: t('GLOBAL_MACRO_CONTEXT_ROW_DXY'),      value: d.dxy  != null ? d.dxy.toFixed(2) : null, chg: d.dxyChg ?? 0, invertBullish: true },
          { id: 'vix',    label: t('GLOBAL_MACRO_CONTEXT_ROW_VIX'),      value: d.vix  != null ? d.vix.toFixed(1) : null, chg: d.vixChg ?? 0, invertBullish: true },
          { id: 'gold',   label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD'),     value: d.gold != null ? '$' + d.gold.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null, chg: d.goldChg ?? 0 },
          { id: 'oil',    label: t('GLOBAL_MACRO_CONTEXT_ROW_OIL'),      value: d.oil  != null ? '$' + d.oil.toFixed(1) : null, chg: d.oilChg ?? 0 },
          { id: 'tnx',    label: t('GLOBAL_MACRO_CONTEXT_ROW_10Y_YIELD'), value: d.tnx  != null ? d.tnx.toFixed(2) + '%' : null, chg: d.tnxChg ?? 0, invertBullish: true },
          { id: 'goldoil', label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD_OIL'), value: d.goldOilRatio != null ? d.goldOilRatio.toFixed(1) + 'x' : null, chg: 0 },
        ];
        return (
          <>
            {/* #656 item 4: five stacked sections (signal / grid / analysis /
                implications / watch level), each carrying its own 6-10px
                marginBottom or paddingTop. None of that content moves or
                shrinks - the Pro-feature gate and this full breakdown are
                both real, both kept, per the owner's "restyle to fit" ruling.
                Only the gaps between sections tighten, roughly by a third
                each. Six gaps compressed this way is where the height
                actually was, more than any single section. */}

            {/* Signal badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, marginBottom: 6, background: sm.bg, border: `0.5px solid ${sm.bdr}` }}>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: sm.col, letterSpacing: '0.05em' }}>{t(sm.labelKey)}</span>
            </div>

            {/* Data grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px', marginBottom: 8 }}>
              {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>{r.label}</span>
                  {/* #1309 item 11: r.value is null when this feed's fetch
                      failed server-side - shown as "unavailable", never a
                      fabricated number, and its % change is skipped too
                      (a change relative to a value that was never read). */}
                  {r.value != null ? (
                    <>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace' }}>{r.value}</span>
                      {r.chg !== 0 && (
                        <span style={{ fontSize: 'var(--fs-caption)', color: chgColor(r.chg, r.invertBullish), fontFamily: 'var(--font-mono), monospace' }}>{chgStr(r.chg)}</span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', fontStyle: 'italic' }}>{t('GLOBAL_MACRO_CONTEXT_ROW_UNAVAILABLE')}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Analysis */}
            {d.analysis && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginBottom: 6 }}>
                {d.analysis}
              </div>
            )}

            {/* Crypto implications */}
            {d.implications && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 5, marginBottom: 5 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--txt3)', marginBottom: 3 }}>{t('GLOBAL_MACRO_CONTEXT_IMPLICATIONS_TITLE')}</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{d.implications}</div>
              </div>
            )}

            {/* Watch level */}
            {d.watchLevel && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 5, marginBottom: 5 }}>
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
    </div>
  );
}
