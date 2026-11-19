'use client';
import { useEffect, useState } from 'react';
import { StrategySignal, StrategyVerdict, SIGNAL_OLD_BARS } from '@/lib/useEMAStrategy';
import { CoinId } from '@/lib/marketStore';
import { currencyPrefix } from '@/lib/coins';
import { ROUND_TRIP_COST_PCT, TAKER_FEE_PCT, SLIPPAGE_PCT } from '@/lib/backtestEngine';
import { withAlpha } from '@/lib/color';
import { SkeletonBar } from '@/components/Skeleton';
import { activatable } from '@/lib/activatable';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import Link from 'next/link';
import { Lock } from '@/components/icons';
import { ProRow, useProLock } from '@/components/UpgradeGateModal';
import { signalLockCopy } from '@/lib/signalCoinGate';
import { phaseI18n } from '@/lib/emaPhaseI18n';
import { SHOW_PERFORMANCE_STATS } from '@/lib/flags';

const VERDICT_CONFIG: Record<StrategyVerdict, { label: string; labelKey: LabelKey | null; color: string; bg: string; border: string }> = {
  LONG_SETUP:     { label: '▲ LONG SETUP', labelKey: 'EMA_SIGNAL_V_LONG_SETUP',     color: 'var(--green-2)', bg: 'color-mix(in srgb, var(--green-2) 8%, transparent)',  border: 'color-mix(in srgb, var(--green-2) 25%, transparent)'  },
  SHORT_SETUP:    { label: '▼ SHORT SETUP', labelKey: 'EMA_SIGNAL_V_SHORT_SETUP',    color: 'var(--red)', bg: 'color-mix(in srgb, var(--red) 8%, transparent)', border: 'color-mix(in srgb, var(--red) 25%, transparent)' },
  TRENDING_LONG:  { label: '↗ TRENDING LONG', labelKey: 'EMA_SIGNAL_V_TRENDING_LONG',  color: 'var(--green-soft)', bg: 'color-mix(in srgb, var(--green-soft) 6%, transparent)', border: 'color-mix(in srgb, var(--green-soft) 20%, transparent)'  },
  TRENDING_SHORT: { label: '↘ TRENDING SHORT', labelKey: 'EMA_SIGNAL_V_TRENDING_SHORT', color: 'var(--red-soft)', bg: 'color-mix(in srgb, var(--red-soft) 6%, transparent)', border: 'color-mix(in srgb, var(--red-soft) 20%, transparent)'  },
  /* #6b7280 was 4.01:1 - the same grey-500 the econ calendar used for its
     (never-reachable) LOW bucket. FREEZE is a live signal state, not a
     placeholder, so it takes the AA-safe neutral. */
  FREEZE:         { label: '⏸ FREEZE', labelKey: 'EMA_SIGNAL_V_FREEZE',          color: 'var(--txt-dim)', bg: 'rgba(107,114,128,0.06)', border: 'rgba(107,114,128,0.2)'  },
  LOADING:        { label: '…', labelKey: null,                 color: 'var(--txt-dim)',    bg: 'transparent',             border: 'transparent'            },
};

/* The hook (lib/useEMAStrategy.ts) names each checklist row in English, and the same string goes into the AI prompt, so it is translated HERE for display and left alone there. A label not in this map shows as the hook wrote it. */
const COND_LABEL_KEYS: Record<string, LabelKey> = {
  '200 SMA Filter (Daily)': 'EMA_SIGNAL_COND_200SMA',
  'Counter-trend': 'EMA_SIGNAL_COND_COUNTER',
  'Ribbon Aligned': 'EMA_SIGNAL_COND_RIBBON',
  'Trend Signal (fast/slow cross)': 'EMA_SIGNAL_COND_CROSS',
  'Close vs EMA 50': 'EMA_SIGNAL_COND_CLOSE50',
  'Price in Value Zone': 'EMA_SIGNAL_COND_VALUE',
  'Funding Rate': 'EMA_SIGNAL_COND_FUNDING',
  'Open Interest Confirming': 'EMA_SIGNAL_COND_OI',
  'Volume Above MA': 'EMA_SIGNAL_COND_VOL',
  'WaveTrend Confirming': 'EMA_SIGNAL_COND_WT',
  'RSI Confirming': 'EMA_SIGNAL_COND_RSI',
  'SMA Confirming': 'EMA_SIGNAL_COND_SMA',
  'Bollinger Confirming': 'EMA_SIGNAL_COND_BOLL',
  'PSAR Confirming': 'EMA_SIGNAL_COND_PSAR',
  'MACD Confirming': 'EMA_SIGNAL_COND_MACD',
};

function fmt(n: number | null, decimals = 2): string {
  if (n == null || isNaN(n)) return '-';
  if (n >= 10000)  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)      return n.toFixed(Math.max(decimals, 3));
  if (n >= 0.001)  return n.toFixed(6);
  return n.toFixed(8);
}

function fireExplain(prompt: string, coin: CoinId) {
  // #1631 (owner 2026-10-21, applied here by PM): fill the question in and wait for Send - a click spends no AI use.
  window.dispatchEvent(new CustomEvent('grok-chat', { detail: { coin, prompt, prefillOnly: true } }));
}

function buildSignalPrompt(signal: StrategySignal, coin: CoinId, tf: string, cfg: { label: string }): string {
  const passing = signal.conditions.filter(c => c.pass === true);
  const failing  = signal.conditions.filter(c => c.pass === false);
  const condLines = [
    ...passing.map(c => `  ✓ ${c.label}: ${c.detail}`),
    ...failing.map(c  => `  ✗ ${c.label}: ${c.detail}`),
  ].join('\n');
  const sltp = signal.sl && signal.tp
    ? `Stop loss: ${currencyPrefix(coin)}${fmt(signal.sl)} · Take profit: ${currencyPrefix(coin)}${fmt(signal.tp)}`
    : '';

  return [
    `Explain this ${coin.toUpperCase()} trading signal to me like I'm a beginner. Use plain English - no jargon.`,
    '',
    `Coin: ${coin.toUpperCase()} · Timeframe: ${tf.toUpperCase()}`,
    `Signal: ${cfg.label}`,
    `What's happening: ${signal.phase}`,
    `Conditions: ${passing.length} passing, ${failing.length} failing out of ${signal.conditions.length}`,
    condLines,
    sltp,
    '',
    'Answer these 3 things simply:',
    '1. What is this signal actually telling me about the market right now?',
    '2. Should I buy, sell, or wait - and exactly why?',
    '3. What would need to change for this to become a clear entry?',
  ].filter(Boolean).join('\n');
}

function buildConditionPrompt(label: string, pass: boolean | null, detail: string, coin: CoinId, tf: string): string {
  const status = pass === true ? 'PASSING' : pass === false ? 'FAILING' : 'NOT YET RELEVANT';
  return [
    `Explain the "${label}" condition to me in plain English. I'm new to trading - avoid jargon.`,
    '',
    `Coin: ${coin.toUpperCase()} · Timeframe: ${tf.toUpperCase()}`,
    `Status: ${status}`,
    `Current value: ${detail}`,
    '',
    'Answer these 3 things:',
    `1. What does "${label}" mean in simple terms?`,
    '2. Why does this condition matter before entering a trade?',
    `3. What does the current status (${status.toLowerCase()}) tell me - should I act or wait?`,
  ].join('\n');
}

interface Props { signal: StrategySignal; tf?: string; coin?: CoinId; aboveCeiling?: boolean }

/* The signal coin gate's locked state (lib/signalCoinGate.ts): in place of the verdict, the checklist and the levels. */
/* FREE: no row of its own - the name joins the page's one "With Pro:" row (owner, 2026-11-17). */
function FreeLockedSignal({ coin }: { coin?: string }) {
  const { t } = useLabels();
  const lock = useProLock(t('EMA_SIGNAL_LOCKED_LINE', { coin: (coin ?? '').toUpperCase() }));
  if (!lock.ready || !lock.leader) return null;
  return <ProRow names={lock.names} onOpen={lock.open} />;
}

function LockedSignal({ lock, coin }: { lock: 'signed_out' | 'free'; coin?: string }) {
  const { t } = useLabels();
  const base = signalLockCopy(lock);
  // Free and trial: labelled in every language (#1596). The signed-out line is unchanged.
  /* FREE: one line, no button (owner, 2026-11-17): "EMA signals for HYPE - Pro" with the lock icon. Signed out keeps its sign-up link. */
  if (lock === 'free') return <FreeLockedSignal coin={coin} />;
  const copy = base;
  return (
    <div data-testid="signal-locked" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '0.5px solid var(--bdr)', background: 'var(--bg2)' }}>
      <Lock size={14} style={{ color: 'var(--txt3)' }} />
      <span style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)' }}>{copy.text}</span>
      <Link href={copy.href} data-testid="signal-locked-link" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 14px', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 'var(--fs-label)', fontWeight: 700, textDecoration: 'none' }}>{copy.cta}</Link>
    </div>
  );
}

export default function EMASignal({ signal, tf = '4h', coin, aboveCeiling = false }: Props) {
  const { t } = useLabels();

  /* A SKELETON THAT NEVER ENDS IS NOT A STATE (PM audit 2026-11-17: the card sat on its skeleton when the candle feed failed or hung). After 20 s of loading for the same coin and timeframe the badge says Unavailable; a signal
     arriving later replaces it. Hooks sit above the early returns below. */
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  useEffect(() => {
    setLoadingTooLong(false);
    if (!signal.loading) return;
    const id = setTimeout(() => setLoadingTooLong(true), 20_000);
    return () => clearTimeout(id);
  }, [signal.loading, coin, tf]);

  /* ABOVE THE ANALYSIS CEILING (#1263): the chart is on a weekly or monthly timeframe, which the EMA
     signal, the AI read and Draw Structure do not operate at (owner's scope: those stay <= 1d). The
     panel says so rather than showing a 1d verdict under a weekly chart - the same honesty the rest
     of this page applies to a reading it does not have. Placed before every other branch because none of them apply at this timeframe. */
  if (aboveCeiling) {
    return (
      <div data-testid="signal-above-ceiling" style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>{t('EMA_SIGNAL_TITLE')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.5 }}>
          {t('EMA_SIGNAL_ABOVE_CEILING', { tf: tf.toUpperCase() })}
        </div>
      </div>
    );
  }
  const v   = signal.verdict;
  const isSetup = v === 'LONG_SETUP' || v === 'SHORT_SETUP';
  // Downgrade the badge instead of the entry itself - testing showed that filtering
  // entry timing (a Choppiness Index gate, a range-position gate) doesn't fix a
  // genuinely weak track record, because a real EMA50 breakout confirmation is always
  // near the edge of its own recent range by definition. What DOES help: not showing
  // a confident-looking SETUP badge when this coin+timeframe has recently lost more
  // than it's won.
  const weak = isSetup && signal.weakEdge;
  /* `cfg.label` stays ENGLISH: it is what the AI prompt below is built from. What the reader sees is `shownLabel`, in their language. */
  const cfg = weak
    ? { label: `${VERDICT_CONFIG[v].label} · WEAK EDGE`, color: 'var(--amber)', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)' }
    : VERDICT_CONFIG[v];
  const vKey = VERDICT_CONFIG[v].labelKey;
  const shownLabel = vKey ? (weak ? `${t(vKey)} · ${t('EMA_SIGNAL_WEAK_EDGE')}` : t(vKey)) : cfg.label;
  const canExplain = coin && !signal.loading && signal.verdict !== 'LOADING' && !signal.signalLock;
  /* The phase line is built in English (the AI prompt reads that string); the card shows it in the reader's language, and falls back to the English for a sentence the map does not know. */
  const ph = phaseI18n(signal.phase);
  const shownPhase = ph ? `${t(ph.key, ph.params)}${ph.counterSuffix ? ` - ${t('EMA_PHASE_COUNTER_SUFFIX')}` : ''}` : signal.phase;

  /* Locked coin: the verdict, checklist, levels, pending setup and record are replaced by the lock; the ribbon values stay. */
  if (signal.signalLock) {
    return (
      <div style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 8 }}>{t('EMA_SIGNAL_TITLE')}</div>
        <LockedSignal lock={signal.signalLock} coin={coin} />
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_FAST_AVG')} <b style={{ color: 'var(--amber)' }}>{currencyPrefix(coin)}{fmt(signal.ema9_4h)}</b></span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_MID_AVG')} <b style={{ color: 'var(--accent-2)' }}>{currencyPrefix(coin)}{fmt(signal.ema20_4h ?? null)}</b></span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_SLOW_AVG')} <b style={{ color: 'var(--txt2)' }}>{currencyPrefix(coin)}{fmt(signal.ema50_4h ?? null)}</b></span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg1)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 10,
    }}>
      {/* Header. It WRAPS when it must (QA, 320 px: the right-hand pair of chips, "MIXED" and "TRENDING SHORT", is 224 px of nowrap text beside a title that cannot shrink below its longest word, so
          the row ended at x = 348 on a 320 px screen and the whole page scrolled sideways; 360 px and up are unaffected because nothing wraps there). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10, gap: 10 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 3 }}>
            {t('EMA_SIGNAL_TITLE')}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
            {t('EMA_SIGNAL_SUBTITLE', { tf: tf.toUpperCase() })}
            {/* ONE VERDICT CHIP, NOT TWO (#1185, PM 2026-11-17): the choppiness reading used to sit beside the verdict as a second chip ("MIXED" next to "TRENDING SHORT"), which read as two contradicting verdicts. It is a quiet note under the title now, with the same tooltip. */}
            {!signal.loading && signal.chopRegime && (() => {
              const label = signal.chopRegime === 'choppy' ? t('EMA_SIGNAL_CHOP_CHOPPY') : signal.chopRegime === 'trending' ? t('EMA_SIGNAL_CHOP_TRENDING') : t('EMA_SIGNAL_CHOP_MIXED');
              const tipKey: LabelKey = signal.chopRegime === 'choppy' ? 'EMA_SIGNAL_CHOP_TIP_CHOPPY' : signal.chopRegime === 'trending' ? 'EMA_SIGNAL_CHOP_TIP_TRENDING' : 'EMA_SIGNAL_CHOP_TIP_MIXED';
              return <span data-testid="ema-chop-note" title={t(tipKey, { index: String(signal.chopIndex?.toFixed(0) ?? '-'), tf: tf.toUpperCase() })} style={{ cursor: 'default' }}> · {t('EMA_SIGNAL_CHOP_LINE', { state: label })}</span>;
            })()}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: '100%' }}>
          <span style={{
            fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.04em',
            padding: '4px 12px', borderRadius: 20,
            color: cfg.color, background: cfg.bg, border: `0.5px solid ${cfg.border}`,
            whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center',
          }}>
            {signal.loading ? (
              loadingTooLong ? t('STATE_UNAVAILABLE') : (
              <>
                <SkeletonBar width={44} height={12} radius={6} />
                <span className="sr-only">{t('ARENA_SCANNER_LOADING_TITLE')}</span>
              </>
              )
            ) : shownLabel}
          </span>
        </div>
      </div>

      {/* Phase */}
      {!signal.loading && signal.verdict !== 'LOADING' && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', marginBottom: 10, lineHeight: 1.4 }}>
          {shownPhase}
        </div>
      )}

      {/* HOW OLD THE SIGNAL IS (#1583/#1541, PM's ruling 2026-11-11: every figure carries its age).
          The verdict above describes the ribbon's SIDE, which holds for as long as the ribbon does -
          so the card could read as a current call while the signal behind it fired weeks earlier
          (QA's example: bnb 4h, a short from five weeks back). Bars rather than a date, because
          that is the unit the chart and the strategy are in, and a date invites the reader to work
          out the gap themselves.

          Past SIGNAL_OLD_BARS it says so in amber. Below it, the age alone is the honest statement -
          calling a 12-bar-old signal "recent" would be a judgement the threshold does not support. */}
      {!signal.loading && signal.verdict !== 'LOADING' && signal.signalBarsAgo != null && signal.signalDir && (
        <div style={{
          fontSize: 'var(--fs-caption)', marginBottom: 10, lineHeight: 1.4,
          color: signal.signalBarsAgo >= SIGNAL_OLD_BARS ? 'var(--amber)' : 'var(--txt3)',
        }}>
          {signal.signalBarsAgo >= SIGNAL_OLD_BARS
            ? t('EMA_SIGNAL_AGE_OLD', { dir: signal.signalDir, bars: String(signal.signalBarsAgo) })
            : t('EMA_SIGNAL_AGE', { dir: signal.signalDir, bars: String(signal.signalBarsAgo) })}
        </div>
      )}

      {/* #985 gap 1: honest-labels, precisely scoped to what actually
          happened THIS render, not what a selected indicator is capable of.
          #997 (RSI, advisory-only) could truthfully say the call never
          moves. Now that SMA can gate it, "the call doesn't move" would be
          false exactly when it just did, and "your selection can move this"
          would overclaim on every render where it simply agreed with the
          ribbon and changed nothing - two different wrong claims, so this
          branches on verdictChangedBySelection rather than picking one
          sentence for every state. Absent entirely when nothing is
          selected - the unpersonalised case has nothing to disclose. */}
      {!signal.loading && signal.verdict !== 'LOADING' && signal.selectionLabel && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-micro)', color: 'var(--amber)',
          marginBottom: 10, lineHeight: 1.4,
        }}>
          <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
          {signal.verdictChangedBySelection ? (
            <span>{t('EMA_SIGNAL_SEL_CHANGED', { selection: signal.selectionLabel ?? '', coin: coin ? coin.toUpperCase() : t('EMA_SIGNAL_THIS_COIN') })}</span>
          ) : (
            <span>{t('EMA_SIGNAL_SEL_WEIGHED', { selection: signal.selectionLabel ?? '' })}</span>
          )}
        </div>
      )}

      {/* MARKERS, SEPARATELY FROM THE VERDICT (#1263/#985). Keyed on markersFilteredBySelection, NOT
          selectionLabel: an RSI-only selection sets a label (RSI is weighed in the read) but filters
          no markers (RSI is advisory and never participates), so keying this on the label would claim
          a filtering that did not happen. Says the same thing the chart caption does, from the panel. */}
      {!signal.loading && signal.verdict !== 'LOADING' && signal.markersFilteredBySelection && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-micro)', color: 'var(--txt2)',
          marginBottom: 10, lineHeight: 1.4,
        }}>
          <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--txt3)', flexShrink: 0 }} />
          <span>{t('EMA_SIGNAL_MARKERS_FILTERED')}</span>
        </div>
      )}

      {/* Conditions grid - each chip clickable to explain */}
      {signal.conditions.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 5,
          marginBottom: isSetup ? 10 : 0,
        }}>
          {signal.conditions.map((c, i) => {
            const pass = c.pass;
            const condLabel = (l: string) => { const k = COND_LABEL_KEYS[l]; return k ? t(k) : l; };
            /* --green-fg for the PASS text, not --green-2 (#738). The row is a
               7% wash of its own signal colour, and in terminal light --green
               (#14702c) on that wash measures 4.66 by token arithmetic, 4.41
               rendered - QA's figure, seven of these on /arena. --green-fg is
               6.29 there and aliases --green in the other three contexts, so
               nothing else moves.
               `col` also feeds the row's border via withAlpha(col,'22'), which
               is a 13% line rather than text, so it is unaffected by the swap
               in every practical sense.
               RED IS LEFT ALONE, and measured rather than assumed: --red on
               its 7% wash is 6.84 / 5.75 / 4.89 / 5.92 across the four
               contexts. It passes. --red-fg would raise the worst to 7.50,
               but tokenising a passing colour to match a pattern is exactly
               what dropped .scan-badge from 4.85 to 4.47 on this issue's
               sibling - so it needs its own measurement and its own decision,
               not this commit. */
            /* An amber caution row (counter-trend): not a pass and not a fail, so it takes neither green nor red. */
            const warn = c.warn === true;
            const col  = warn ? 'var(--amber)' : pass === true ? 'var(--green-fg)' : pass === false ? 'var(--red)' : 'var(--txt-dim)';
            const bg   = warn ? 'color-mix(in srgb, var(--amber) 8%, transparent)' : pass === true ? 'color-mix(in srgb, var(--green-2) 7%, transparent)' : pass === false ? 'color-mix(in srgb, var(--red) 7%, transparent)' : 'rgba(255,255,255,0.02)';
            const icon = warn ? '!' : pass === true ? '✓' : pass === false ? '✗' : '-';
            return (
              /* #939: the explain action was click-only. Spread conditionally -
                 a row that cannot explain must not advertise a role or take
                 focus, or the keyboard tab order fills with dead stops. */
              <div
                key={i}
                title={canExplain ? t('EMA_SIGNAL_COND_EXPLAIN_TITLE', { label: condLabel(c.label) }) : (c.detailKey ? t(c.detailKey, c.detailVars) : c.detail)}
                {...(canExplain
                  ? activatable(() => fireExplain(buildConditionPrompt(c.label, c.pass, c.detail, coin!, tf), coin!))
                  : {})}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 6,
                  background: bg, border: `0.5px solid ${withAlpha(col, '22')}`,
                  cursor: canExplain ? 'pointer' : 'default',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (canExplain) (e.currentTarget as HTMLDivElement).style.opacity = '0.75'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
              >
                <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: col, flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 'var(--fs-caption)', color: warn ? 'var(--txt2)' : pass === null ? 'var(--txt-dim)' : 'var(--txt2)', lineHeight: 1.2 }}>
                  {warn ? (c.detailKey ? t(c.detailKey) : c.detail) : condLabel(c.label)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* SL / TP - only for actionable setups */}
      {isSetup && signal.sl && signal.tp && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap',
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          border: '0.5px solid var(--bdr)',
          borderRadius: 7,
        }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginRight: 4 }}>{t('EMA_SIGNAL_LEVELS')}</span>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--red)' }}>
            {t('EMA_SIGNAL_SL_LINE', { price: `${currencyPrefix(coin)}${fmt(signal.sl)}` })}
          </span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--txt-dim)' }}>·</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>
            {t('EMA_SIGNAL_ENTRY_LINE', { price: `${currencyPrefix(coin)}${fmt(signal.ema20_4h)}` })}
          </span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--txt-dim)' }}>·</span>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--green-2)' }}>
            {t('EMA_SIGNAL_TP_LINE', { price: `${currencyPrefix(coin)}${fmt(signal.tp)}` })}
          </span>
        </div>
      )}

      {/* EMA values strip */}
      {!signal.loading && signal.ema9_4h != null && (
        <div style={{
          display: 'flex', gap: 14, flexWrap: 'wrap',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '0.5px solid var(--bdr)',
        }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_FAST_AVG')} <b style={{ color: 'var(--amber)' }}>{currencyPrefix(coin)}{fmt(signal.ema9_4h)}</b></span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_MID_AVG')} <b style={{ color: 'var(--accent-2)' }}>{currencyPrefix(coin)}{fmt(signal.ema20_4h ?? null)}</b></span>
          {/* --txt2, not #f97316 (#638). This was the only literal in a row
              whose three siblings all use tokens, and a literal chosen against
              a dark ground: it measures 2.59:1 on terminal light and fails in
              the current design's light theme too - older than the redesign,
              which makes it older rather than acceptable.
              --txt2 clears AA in all four combinations - current dark 5.03,
              current light 9.15, terminal dark 5.62, terminal light 5.56.
              Not the EMA-50 line's colour on purpose: terminal already paints
              that line #5e646b (KLineProChart's TERMINAL_EMA_COLOR), a
              border-weight grey that fails as text on dark, and there is no
              governed orange in the terminal palette at all - #614 established
              that. */}
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_SLOW_AVG')} <b style={{ color: 'var(--txt2)' }}>{currencyPrefix(coin)}{fmt(signal.ema50_4h ?? null)}</b></span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('EMA_SIGNAL_DAILY_TREND')} <b style={{ color: 'var(--accent)' }}>{currencyPrefix(coin)}{fmt(signal.sma200_1d ?? null)}</b></span>
        </div>
      )}

      {/* A setup still holding its persistence check, as text and not as a marker (owner, 2026-10-07): nothing is drawn on the
          chart until the signal is confirmed, and then it is drawn at the candle where it confirmed. Plain English like the rows
          around it. */}
      {!signal.loading && signal.pendingSetup && (
        <div data-testid="pending-setup" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 8 }}>
          {signal.pendingSetup.dir === 'long' ? t('EMA_SIGNAL_PENDING_BUY') : t('EMA_SIGNAL_PENDING_SELL')} <b style={{ color: 'var(--txt2)' }}>{t('EMA_SIGNAL_HELD_OF', { held: String(Math.min(signal.pendingSetup.held, signal.pendingSetup.need)), need: String(signal.pendingSetup.need) })}</b> {t('EMA_SIGNAL_CANDLES_HELD')}
        </div>
      )}

      {/* Recent record - every signal in the loaded history, backtest fill rules. Hidden while SHOW_PERFORMANCE_STATS is off (owner, 2026-10-16, #1574). */}
      {SHOW_PERFORMANCE_STATS && !signal.loading && signal.recentStats && (
        <div
          title={`Outcome of every signal this strategy fired in the loaded candle history for this coin and timeframe, simulated with the backtest fill rules: entry once the whipsaw hold confirms, stop at the 50 EMA buffer, take profit at 2 to 1. Net of an estimated ${ROUND_TRIP_COST_PCT.toFixed(2)}% round-trip cost (${TAKER_FEE_PCT}% taker fee + ${SLIPPAGE_PCT}% slippage, each side) - not gross.`}
          style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 8, cursor: 'default' }}
        >
          Recent record ({tf.toUpperCase()}):{' '}
          <b style={{ color: 'var(--txt2)' }}>
            {signal.recentStats.wins} wins / {signal.recentStats.losses} losses
          </b>
          {' · '}
          <b style={{ color: signal.recentStats.netR >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
            {signal.recentStats.netR >= 0 ? '+' : ''}{signal.recentStats.netR.toFixed(1)}R
          </b>
          {signal.recentStats.open > 0 ? ` · ${signal.recentStats.open} open` : ''}
        </div>
      )}

      {/* Explain This Signal button */}
      {canExplain && (
        <button
          onClick={() => fireExplain(buildSignalPrompt(signal, coin!, tf, cfg), coin!)}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '7px 0',
            /* Derived from --accent-2, was rgba(90,163,255,...) (#647/#648).
               Written as an rgb() triplet, so a `5aa3ff` grep misses it -
               the same disguise as the rgba(248,113,113,...) tints in #641,
               and the reason QA's selectors were worth more than the hex
               list both times. Terminal aliases --accent-2 to var(--accent)
               in both themes, so token users already followed a theme change
               and this literal did not. --accent-2 IS #5aa3ff at :root, so
               the current design is byte-identical. */
            background: 'color-mix(in srgb, var(--accent-2) 6%, transparent)',
            border: '0.5px solid color-mix(in srgb, var(--accent-2) 20%, transparent)',
            borderRadius: 7,
            fontSize: 'var(--fs-caption)',
            fontWeight: 600,
            color: 'var(--accent-2)',
            cursor: 'pointer',
            letterSpacing: '.02em',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-2) 12%, transparent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-2) 6%, transparent)'; }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" /></svg>
            {t('EMA_SIGNAL_EXPLAIN')}
          </span>
        </button>
      )}

      {signal.error && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 6 }}>
          {/* #1024 - was the raw exception/message, unlike AbsorptionDetector/
              MarketStructure (translated label only) or OnChainScore (known
              sentinels get labels, only a genuinely unrecognized error falls
              through raw). useEMAStrategy has exactly one known sentinel
              ('INSUFFICIENT_DATA') and otherwise sets `String(err)` from a
              caught exception - never a clean server message - so unlike
              OnChainScore, the fallback here is also translated, not raw. */}
          {signal.error === 'INSUFFICIENT_DATA' ? t('EMA_SIGNAL_INSUFFICIENT_DATA') : t('EMA_SIGNAL_FAILED')}
        </div>
      )}
    </div>
  );
}
