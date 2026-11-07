'use client';
/* The teaching panel: for one detected pattern, what the shape is and what traders watch for.
 *
 * The owner's ask: "for an extreme beginner, a tooltip below or beside the chart showing a picture
 * of what a bull flag is, what it is, and the expected action - with an option to close it and not
 * show again."
 *
 * ── TWO THINGS IN THAT ASK ARE DELIBERATELY NOT BUILT AS STATED ─────────────────────────────────
 *
 * "EXPECTED ACTION" IS NOT HERE. An expected action is a recommendation however it is worded, and
 * PRODUCT.md rule 1 forbids it. What replaces it is `_WATCH`: what traders WATCH FOR, which is a
 * statement about trader behaviour and is true and checkable.
 *
 *     OK   "traders watch whether price breaks the upper line of the drift"
 *     NOT  "bull flags usually resolve upward"
 *
 * "NOT SHOW AGAIN" IS A REPLAYABLE COLLAPSE, NOT A PERMANENT HIDE, because the owner removed
 * permanent dismissal himself. `components/PageHint.tsx` records it: *"#1113 (owner option 4): the
 * hint is now REPLAYABLE. Dismissing it no longer removes it for good - it collapses to a small "?"
 * affordance that reopens it, so the "I skipped it and now I'm lost" case has a way back."* For a
 * teaching panel that reasoning is stronger than it was for a page hint: whoever dismisses "what is
 * a bull flag" is exactly who needs it next week. Raised with him rather than decided quietly.
 *
 * ── THE SPACE IS RESERVED BEFORE THE DISMISSAL STATE IS KNOWN, AND THAT IS NOT A NICETY ─────────
 *
 * Three states, not two, copied from `PageHint` for the reason its own comment gives: it used to
 * insert ~62px after paint, which was about 7% of /scanner's layout shift. This panel sits BELOW
 * the chart, so on a phone it is under the fold with the chart above it - the worst place to insert
 * height late.
 *
 * **#1987 shipped in v2026.11.07 specifically to stop Arena shifting as it loads**, taking /arena's
 * CLS from a failing 0.146 to passing under 0.1. A panel that appears once localStorage resolves
 * puts that straight back. So `'pending'` renders at full height with `visibility: hidden` - the
 * panel fades into space that was already there, or the space collapses once, for a returning
 * visitor who is scrolling past anyway.
 *
 * ── WHAT IT WILL NOT SAY ────────────────────────────────────────────────────────────────────────
 *
 * No reliability ranking between shapes. Two independent null models disagree flatly about which
 * pattern is the commonest false positive - under one, two-rail shapes never occur in noise; under
 * the other they are the most frequent thing in it. The disagreement is in the GENERATORS, not the
 * detector (see `lib/chartPatterns.ts`). So telling a beginner that channels are trustworthy and
 * trend lines less so would teach an artefact of one random-walk generator as a fact about markets.
 * No "more reliable", no "stronger signal", no rate.
 */
import { useState, useEffect } from 'react';
import { useLabels } from '@/lib/labels';
import CloseIcon from '@/components/CloseIcon';
import { illustrationFor } from '@/components/patterns/PatternIllustration';
import type { PatternType } from '@/lib/chartPatterns';

interface Props {
  type: PatternType;
  /** Shown so the reader knows which chart this describes; never used to vary the copy. */
  timeframe: string;
}

/** The three keys per pattern, written out rather than built from the type at runtime.
 *
 *  SPELLED OUT ON PURPOSE. `PATTERN_${type.toUpperCase()}_NAME` compiles to `string`, which `t()`
 *  rejects - and that rejection is the feature: `t` is typed against `lib/labelKeys.ts`, so a key
 *  that does not exist is a BUILD error rather than a blank space on screen. A template literal
 *  would hand that guarantee back for four saved lines.
 *
 *  Only the patterns that can be produced appear here. Wedges and triangles are unreachable while a
 *  channel's second rail is derived (see `lib/chartPatterns.ts`), so they have no keys and no copy -
 *  writing copy for a shape nothing can detect is how a changelog ends up describing a feature that
 *  does not exist. */
const COPY = {
  bull_flag: ['PATTERN_BULL_FLAG_NAME', 'PATTERN_BULL_FLAG_WHAT', 'PATTERN_BULL_FLAG_WATCH'],
  bear_flag: ['PATTERN_BEAR_FLAG_NAME', 'PATTERN_BEAR_FLAG_WHAT', 'PATTERN_BEAR_FLAG_WATCH'],
  channel_rising: ['PATTERN_CHANNEL_RISING_NAME', 'PATTERN_CHANNEL_RISING_WHAT', 'PATTERN_CHANNEL_RISING_WATCH'],
  channel_falling: ['PATTERN_CHANNEL_FALLING_NAME', 'PATTERN_CHANNEL_FALLING_WHAT', 'PATTERN_CHANNEL_FALLING_WATCH'],
  range: ['PATTERN_RANGE_NAME', 'PATTERN_RANGE_WHAT', 'PATTERN_RANGE_WATCH'],
  line_support: ['PATTERN_LINE_SUPPORT_NAME', 'PATTERN_LINE_SUPPORT_WHAT', 'PATTERN_LINE_SUPPORT_WATCH'],
  line_resistance: ['PATTERN_LINE_RESISTANCE_NAME', 'PATTERN_LINE_RESISTANCE_WHAT', 'PATTERN_LINE_RESISTANCE_WATCH'],
} as const satisfies Partial<Record<PatternType, readonly [string, string, string]>>;

export default function PatternPanel({ type, timeframe }: Props) {
  const storageKey = `lhq_hint_pattern_${type}`;
  const [state, setState] = useState<'pending' | 'show' | 'collapsed'>('pending');
  const { t } = useLabels();
  const illustration = illustrationFor(type);
  const copy = COPY[type as keyof typeof COPY] ?? null;

  useEffect(() => {
    try {
      setState(localStorage.getItem(storageKey) ? 'collapsed' : 'show');
    } catch {
      /* Private windows and blocked site data throw on read. Showing is the safe default: a
         beginner seeing the explanation twice costs nothing, and not seeing it costs the feature. */
      setState('show');
    }
  }, [storageKey]);

  function dismiss() {
    try { localStorage.setItem(storageKey, '1'); } catch { /* same as above, non-fatal */ }
    setState('collapsed');
  }

  /* NO MARKER WRITE ON REOPEN, matching PageHint: reopening is for this session, and the next visit
     still starts collapsed rather than re-showing the full panel unprompted. */
  function reopen() { setState('show'); }

  /* NO COPY MEANS NO PANEL. A pattern with no entry in COPY is one this layer cannot explain, and
     an empty bordered box where a picture and an explanation were promised is worse than nothing.
     Checked before the collapsed branch so a reopener cannot appear for a panel that has no body. */
  if (!copy) return null;

  if (state === 'collapsed') {
    return (
      <button
        type="button"
        data-pattern-panel={type}
        onClick={reopen}
        aria-label={t('PATTERN_PANEL_REOPEN_LABEL')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)',
          borderRadius: 8, padding: '4px 10px', marginTop: 12, cursor: 'pointer',
          color: 'var(--accent)', fontSize: 'var(--fs-caption)', fontWeight: 700,
          minHeight: 24,
        }}
      >
        <span style={{
          fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)',
          background: 'var(--accent-bg)', borderRadius: '50%', width: 16, height: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>?</span>
        {t('PATTERN_PANEL_REOPEN_LABEL')}
      </button>
    );
  }

  return (
    /* data-pattern-panel marks the root in BOTH states, so a layout check can find it and ask what
       its parent does with it - the #1487 lesson PageHint records, where a hint inside the
       dashboard's grid silently took a column track. */
    <div data-pattern-panel={type} style={{
      visibility: state === 'pending' ? 'hidden' : 'visible',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      background: 'var(--accent-bg)',
      border: '0.5px solid var(--accent-bdr)',
      borderRadius: 10,
      padding: '12px 14px',
      marginTop: 12,
    }}>
      {illustration && (
        /* Fixed box so the drawing never reflows the text beside it, and `color` set HERE so every
           stroke inside follows it - the illustration itself knows no colour at all. */
        <div style={{ width: 96, height: 58, flexShrink: 0, color: 'var(--accent)' }}>
          {illustration}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>
          {t(copy[0])}
          <span style={{ color: 'var(--txt3)', fontWeight: 600 }}>{` · ${timeframe}`}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.55 }}>
          {t(copy[1])}
        </div>
        {/* The watch line is the one that replaces "expected action", so it is visually distinct
            from the description without being styled as a call to action. */}
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginTop: 5 }}>
          {t(copy[2])}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('PATTERN_PANEL_DISMISS_LABEL')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--txt3)', padding: 0, flexShrink: 0,
          /* 44x44 hit area that does not make the panel taller: the negative margins reach into the
             box's own padding, so the button occupies 24px of the row (WCAG 2.2 SC 2.5.8's minimum)
             and the rest of its target overlaps padding rather than text. Same geometry as
             PageHint's x, which took it from the trial banner on the owner's instruction. */
          width: 44, height: 44, margin: '-12px -14px -12px -6px',
          borderRadius: 8,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      ><CloseIcon /></button>
    </div>
  );
}
