'use client';
import { deadlineSignal } from '@/lib/deadlineSignal';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard } from './UpgradeGateModal';
import Tip from './Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { macroStampDate } from '@/lib/macroStamp';
import { useNow } from '@/lib/useNow';
import { ageLabel } from '@/lib/ageLabel';

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
  /** Each quote's own time (ms), so a weekend value says "Fri close" (#1651). Absent on a cached older payload. */
  asOf?: { dxy?: number | null; vix?: number | null; gold?: number | null; oil?: number | null; tnx?: number | null };
  signal:       string;
  analysis:     string;
  implications: string;
  watchLevel:   string;
}

const CACHE_KEY = 'lhq_macro_context';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/* 'error' means a read failed and there is NOTHING earlier to show; the card is then hidden and a retry runs (#1185 D13). Data already on screen, or in the browser copy, is kept instead. */
type LoadState = MacroData | null | 'loading' | 'error' | 'locked';

/* A failed read is tried again after 2 min, then 5, then every 10 (each success of the server is cached for 5 min, a failure is never cached). */
const RETRY_DELAYS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000];
/* The age of a kept copy is only said once it is older than this. */
const SHOW_AGE_AFTER_MS = 10 * 60_000;

/** The browser copy of the last good read, of ANY age (the 2 h limit only decides whether a fetch is needed, not whether the copy may be shown). */
function readCache(): { ts: number; data: MacroData } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { ts?: unknown; data?: MacroData };
    if (typeof p.ts !== 'number' || !p.data || typeof p.data.signal !== 'string') return null;
    return { ts: p.ts, data: p.data };
  } catch { return null; }
}

/* A copy with a feed missing is fresh for 15 minutes, not 2 hours: the next visit after that asks again instead of keeping the hole for 2 h (#1185 D14). */
const PARTIAL_CACHE_TTL = 15 * 60 * 1000;

/** All five feeds present. */
const isComplete = (d: MacroData) => d.dxy != null && d.vix != null && d.gold != null && d.oil != null && d.tnx != null;

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

export default function GlobalMacroContext({ frame = false }: { frame?: boolean } = {}) {
  const { t } = useLabels();
  const router = useRouter();
  const { user, loading: authLoading, entitlementStatus, entitlementsLoading } = useAuth();
  const [state,  setState]  = useState<LoadState>('loading');
  /* When the data on screen is an earlier copy (a refresh failed or is still out), the time it was read. */
  const [staleTs, setStaleTs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(60_000);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const fetchRef = useRef<(() => void) | null>(null);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    /* Data already on screen stays while a refresh runs; only an empty card shows the loading rows. */
    setState(prev => (typeof prev === 'object' && prev !== null ? prev : 'loading'));
    /* A failed read: the last good copy of ANY age, or what is already on screen, or - with nothing at all - a hidden card. Then a retry; never failure text. */
    const fail = () => {
      const c = readCache();
      if (c) { setState(c.data); setStaleTs(c.ts); }
      else setState(prev => (typeof prev === 'object' && prev !== null ? prev : 'error'));
      const delay = RETRY_DELAYS_MS[Math.min(failuresRef.current, RETRY_DELAYS_MS.length - 1)];
      failuresRef.current += 1;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => { fetchRef.current?.(); }, delay);
    };
    try {
      // getAuthToken(), not a raw getSession() - #1165/#1166 bounded it. This
      // is mounted on /dashboard (DashboardTerminal, PerpSpotCard) and
      // /research; without the bound, a hung auth backend left this stuck on
      // its own 'loading' skeleton forever rather than reaching the visible
      // retry/cached states below.
      const token = await getAuthToken();
      /* No token inside its bound is a failed read for a user who IS signed in, never a "sign in" prompt (#1185 D15): cached read or retry. */
      if (!token) { fail(); return; }

      const res  = await fetch('/api/macro-context', { headers: { Authorization: `Bearer ${token}` }, signal: deadlineSignal(20_000) });
      const json = await res.json() as {
        asOf?: MacroData['asOf'];
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
        fail(); return;
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
        asOf: json.asOf,
        signal, analysis, implications, watchLevel,
      };
      setState(data);
      setStaleTs(null);
      failuresRef.current = 0;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      /* A copy with a feed missing never replaces a complete one: the older complete copy stays the last good value. */
      const prior = readCache();
      if (isComplete(data) || !prior || !isComplete(prior.data)) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
      }
    } catch {
      fail();
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchRef.current = () => { void fetchData(); }; }, [fetchData]);
  useEffect(() => () => { if (retryRef.current) clearTimeout(retryRef.current); }, []);

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
    const c = readCache();
    if (c && Date.now() - c.ts < (isComplete(c.data) ? CACHE_TTL : PARTIAL_CACHE_TTL)) { setState(c.data); setStaleTs(null); return; }
    /* An older copy is on screen at once, with its age, while the new read is out. */
    if (c) { setState(c.data); setStaleTs(c.ts); }
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
     state. Never stomps 'error' (a token-check timeout is a failed read,
     not a paywall), already-'locked', or real data -
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

  /* Nothing to show and nothing earlier to keep: the card is hidden (with its frame on the dashboard), not a failure line. It comes back when a retry lands. */
  if (state === 'error') return null;

  const body = (
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
          {/* The read is built by an AI call on the server and can take a while: say so (honest progress) instead of a bare skeleton. Same 20 px row as the pill it replaces, so nothing moves. */}
          <div style={{ height: 20, marginBottom: 10, fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: '20px' }}>{t('GLOBAL_MACRO_CONTEXT_PREPARING')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 8px', marginBottom: 10 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <SkeletonBar key={i} height={28} radius={4} />
            ))}
          </div>
          <SkeletonBar height={11} radius={4} style={{ marginBottom: 6 }} />
          <SkeletonBar width="80%" height={11} radius={4} />
        </div>
      )}
      {typeof state === 'object' && state !== null && (() => {
        const d = state;
        // #1309 item 11: `value: null` renders as "unavailable" below,
        // never a fabricated number for a feed that failed to fetch.
        const allRows: { id: string; label: string; value: string | null; chg: number; invertBullish?: boolean; asOf?: number | null }[] = [
          { id: 'dxy',    label: t('GLOBAL_MACRO_CONTEXT_ROW_DXY'),      value: d.dxy  != null ? d.dxy.toFixed(2) : null, chg: d.dxyChg ?? 0, invertBullish: true },
          { id: 'vix',    label: t('GLOBAL_MACRO_CONTEXT_ROW_VIX'),      value: d.vix  != null ? d.vix.toFixed(1) : null, chg: d.vixChg ?? 0, invertBullish: true },
          { id: 'gold',   label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD'),     value: d.gold != null ? '$' + d.gold.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null, chg: d.goldChg ?? 0 },
          { id: 'oil',    label: t('GLOBAL_MACRO_CONTEXT_ROW_OIL'),      value: d.oil  != null ? '$' + d.oil.toFixed(1) : null, chg: d.oilChg ?? 0 },
          { id: 'tnx',    label: t('GLOBAL_MACRO_CONTEXT_ROW_10Y_YIELD'), value: d.tnx  != null ? d.tnx.toFixed(2) + '%' : null, chg: d.tnxChg ?? 0, invertBullish: true },
          { id: 'goldoil', label: t('GLOBAL_MACRO_CONTEXT_ROW_GOLD_OIL'), value: d.goldOilRatio != null ? d.goldOilRatio.toFixed(1) + 'x' : null, chg: 0 },
        ];
        /* A feed that did not arrive is left out, not drawn as "Unavailable" (#1185 D14). */
        const rows = allRows.filter(r => r.value != null);
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
              {rows.map(r => {
                const stampDate = r.value != null ? macroStampDate(d.asOf?.[r.id as keyof NonNullable<MacroData['asOf']>], Date.now()) : null;
                return (
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
                      {stampDate && <span data-testid="macro-stamp" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('MACRO_STRIP_CLOSE_STAMP', { day: stampDate.toLocaleDateString(undefined, { weekday: 'short' }) })}</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt3)', fontStyle: 'italic' }}>{t('GLOBAL_MACRO_CONTEXT_ROW_UNAVAILABLE')}</span>
                  )}
                </div>
                );
              })}
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

            <button onClick={fetchData} disabled={refreshing} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: 'none', cursor: refreshing ? 'default' : 'pointer', padding: 0 }}>
              {t('GLOBAL_MACRO_CONTEXT_REFRESH_BUTTON')}
            </button>
            {staleTs != null && now - staleTs > SHOW_AGE_AFTER_MS && (
              <span data-testid="macro-age" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{' · '}{ageLabel(now - staleTs, t)}</span>
            )}
          </>
        );
      })()}
    </div>
  );
  return frame ? <div className="macro-rail-card">{body}</div> : body;
}
