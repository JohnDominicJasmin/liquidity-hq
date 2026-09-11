'use client';
/* The Arena strategy panel (#930), built from the owner-approved layout.
 *
 * WHAT THIS IS NOT, YET. It owns the selection and nothing else. The four
 * consumers the selection eventually feeds - chart overlays, QUICK, DEEP and
 * ASK AI - are a separate change on purpose: one selection driving a chart and
 * three AI actions is the part that goes wrong quietly, and it should not land
 * inside a layout diff. `onRun` is the seam.
 *
 * STYLING LIVES IN globals.css, not here. This renders only under the terminal
 * design, so by rule 1 of #663 a constant has no second design to serve and
 * belongs in a stylesheet. Worth stating because the file is NOT named
 * `*Terminal.tsx`, so __tests__/terminalOnlyConstants.test.mts does not sweep it
 * - that test's own header warns that a terminal-only component under another
 * name is silently exempt. It is exempt by name and compliant by choice.
 *
 * COPY IS HARDCODED ENGLISH AND THAT IS TEMPORARY. The approved design also
 * replaces trader jargon with plain language ("Crowded long" over "+0.0132%"),
 * which is a labels change - useLabels(), DB-driven - and is being filed
 * separately. Adding keys here would put them in lib/labelDefaults.en.json,
 * which `npm run labels:regen` rewrites wholesale, so they would not survive.
 */

import { useState, useMemo, useId } from 'react';
import { useAuth } from './AuthProvider';
import { useDesignMode } from './DesignModeProvider';
import {
  GROUPS, GROUP_LABEL, INDICATORS, STRATEGY_SETS,
  AUTO_SET_ID, CUSTOM_SET_ID,
  byGroup, findIndicator, indicatorLimit, defaultParams, canRender,
  type IndicatorEntry, type ParamSpec,
} from '@/lib/strategyRegistry';

export type RunKind = 'quick' | 'deep' | 'ask';

interface Props {
  /** The current selection. CONTROLLED, and that is the point of this change:
   *  the chart, QUICK, DEEP and ASK AI all need to know what is selected, and
   *  three of those live outside this component. State that two consumers read
   *  belongs above both of them. */
  selected: readonly string[];
  onSelectedChange: (next: readonly string[]) => void;
  /** Per-indicator edited parameter values, keyed by indicator id then param
   *  key. CONTROLLED, same reasoning as `selected` (#1008): the chart is the
   *  other consumer, and it lives outside this component. An indicator with
   *  no entry here yet falls back to `defaultParams`. */
  params: Record<string, Record<string, string | number | boolean>>;
  onParamsChange: (next: Record<string, Record<string, string | number | boolean>>) => void;
  /** Fired when a run button is pressed. The page owns what running means.
   *  Required, not optional (#996): QUICK/DEEP/ASK AI are the panel's own
   *  reason to have run buttons at all, and an optional prop called as
   *  `onRun?.(...)` is a well-formed no-op when nothing is passed - no type
   *  error, no runtime error, just three dead buttons, which is exactly how
   *  this went unnoticed until QA hit it by hand. Required turns a future
   *  instance of the same mistake into a compile error instead. */
  onRun: (kind: RunKind, selection: readonly string[]) => void;
}

function ParamRow({ spec, value, readOnly, onChange }: {
  spec: ParamSpec;
  value: string | number | boolean;
  readOnly: boolean;
  onChange: (v: string | number) => void;
}) {
  if (spec.kind === 'enum') {
    return (
      <div className="strat-prow">
        <span>{spec.label}</span>
        <select
          className="strat-pv"
          value={String(value)}
          disabled={readOnly}
          aria-label={spec.label}
          onChange={e => onChange(e.target.value)}
        >
          {spec.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (spec.kind === 'bool') {
    return (
      <div className="strat-prow">
        <span>{spec.label}</span>
        <input
          className="strat-pv"
          type="checkbox"
          checked={Boolean(value)}
          disabled={readOnly}
          aria-label={spec.label}
          onChange={e => onChange(e.target.checked ? 1 : 0)}
        />
      </div>
    );
  }
  return (
    <div className="strat-prow">
      <span>{spec.label}</span>
      <input
        className="strat-pv"
        type="number"
        inputMode="numeric"
        value={String(value)}
        min={spec.min}
        max={spec.max}
        step={spec.kind === 'float' ? spec.step : (spec.step ?? 1)}
        disabled={readOnly}
        aria-label={spec.label}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function StrategyPanel({ selected, onSelectedChange, params, onParamsChange, onRun }: Props) {
  const { entitlementStatus } = useAuth();
  const entitled = entitlementStatus === 'entitled';
  const design = useDesignMode();
  const limitNoteId = useId();
  const limit = indicatorLimit(entitled);

  const [setId, setSetId] = useState<string>(AUTO_SET_ID);
  /* `selected` is a prop now, not state - see Props. It is still an ORDERED
     list rather than a Set: the chip badge shows the position in the selection,
     which the artifact draws as 1 and 2, so order is data and a Set would throw
     it away. */
  /* `params` is a prop too, as of #1008 - see Props. */
  /* Which indicator's parameters the box is showing. The artifact draws one
     params box, not one per selected indicator. */
  const [focused, setFocused] = useState<string | null>(null);
  /* How many of a preset's indicators this tier could not take. Shown, never
     silent: dropping two of three without saying so is worse than the error
     this truncation exists to avoid. */
  const [dropped, setDropped] = useState(0);

  const paramsFor = (entry: IndicatorEntry) => params[entry.id] ?? defaultParams(entry);
  const focusedEntry = focused ? findIndicator(focused) : undefined;
  const atLimit = selected.length >= limit;

  const applySet = (id: string) => {
    setSetId(id);
    const preset = STRATEGY_SETS.find(s => s.id === id);
    if (!preset || id === CUSTOM_SET_ID) { setDropped(0); return; }
    /* A preset can name more indicators than this tier may combine. Truncate
       rather than refuse - a free user picking "Liquidity Sweep" made a
       reasonable choice, and erroring at them about a limit they did not set
       punishes them for the tier. But say so: see `dropped`. */
    const next = preset.indicators.slice(0, limit);
    setDropped(preset.indicators.length - next.length);
    onSelectedChange(next);
    setFocused(next[0] ?? null);
  };

  const toggle = (entry: IndicatorEntry) => {
    /* An entry that cannot draw is not selectable. Accepting the click and
       doing nothing is the silent-failure shape this project has spent a day
       arguing against - it would look exactly like a working chip. */
    if (!canRender(entry)) return;
    if (selected.includes(entry.id)) {
      /* #1027 - with 2+ selected, clicking an EARLIER chip meant "show its
         params again", not "remove it". The two gestures only look the same
         with exactly one selected (where the clicked chip is always already
         the focused one, so this branch and the old unconditional-remove
         behavior agree). Only deselect when re-clicking the chip that is
         ALREADY showing its params - the explicit "I'm done with this one"
         gesture - otherwise just bring its params back into view. */
      if (focused !== entry.id) {
        setFocused(entry.id);
      } else {
        const next = selected.filter(id => id !== entry.id);
        setFocused(next[next.length - 1] ?? null);
        onSelectedChange(next);
      }
    } else if (selected.length < limit) {
      setFocused(entry.id);
      onSelectedChange([...selected, entry.id]);
    }
    /* Touching a chip makes it a custom set on its own. Requiring the dropdown
       to be changed first would make the obvious gesture do nothing. */
    setSetId(CUSTOM_SET_ID);
    setDropped(0);
  };

  const groups = useMemo(() => GROUPS.map(g => ({ id: g, entries: byGroup(g) })), []);
  const isAuto = setId === AUTO_SET_ID && selected.length === 0;

  /* SELF-GATED, and this is a fix rather than a flourish. The first version
     mounted unconditionally in `app/arena/page.tsx`'s shared rail and relied on
     the CSS being terminal-scoped to hide it. Scoped CSS hides the STYLING; the
     component still rendered under the current design as a wall of unstyled
     text - "StrategyFREE · 1", the chip labels run together with no spacing -
     pushing the rest of the rail down. QA found it; my own test step said "the
     rail should look exactly as it did before" and I read it as satisfied.

     THE GENERAL SHAPE, because this will happen again: scoping the STYLES to a
     design while leaving the MOUNT ungated is CSS that knows about a boundary
     the component does not. It is the same split that produced the dead
     `*-term-wrap` rules - a stylesheet carrying a design decision that the tree
     it styles has never heard of. If a component belongs to one design, the
     component should be the thing that knows it.

     Gated HERE rather than at the call site, which is where the equivalent
     split lives on /dashboard. That file swaps the whole page, so one `if` at
     the top covers it. This is one panel inside a tree both designs share, so a
     call-site gate protects exactly one mount and the next one reintroduces
     the bug. A component that cannot render in the wrong design cannot be
     mounted into it by mistake. */
  if (design !== 'terminal') return null;

  return (
    <div className="strat-panel">
      <div className="strat-head">
        <span>Strategy</span>
        {/* #1119: 'unknown' must not read as a confident "FREE" - that is
            exactly the false assertion the owner's ruling forbids, on the one
            line in this file that names a plan tier instead of just
            disabling something. Hardcoded English, same as the rest of this
            file's copy (see the file-header comment on why). */}
        <span className="strat-aux" title={entitlementStatus === 'unknown' ? "Couldn't verify your plan" : undefined}>
          {entitled ? 'PRO' : entitlementStatus === 'unknown' ? '···' : `FREE · ${limit}`}
        </span>
      </div>

      <div className="strat-sect">
        <div className="strat-lbl">
          <span>Strategy set</span>
          {entitled && <span className="strat-cap">Edit · Save as</span>}
        </div>
        <select
          className="strat-sel"
          value={setId}
          aria-label="Strategy set"
          onChange={e => applySet(e.target.value)}
        >
          {STRATEGY_SETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="strat-sect">
        <div className="strat-lbl">
          <span>Indicators</span>
          {/* The ceiling is visible before it is reached rather than announced
              as a rejection afterwards. */}
          <span className="strat-cap">{selected.length} of {limit}</span>
        </div>

        {groups.map(({ id, entries }) => (
          <div key={id} className="strat-grp">
            <div className="strat-gname">{GROUP_LABEL[id]}</div>
            <div className="strat-chips">
              {entries.map(entry => {
                const pos = selected.indexOf(entry.id);
                const on = pos >= 0;
                const usable = canRender(entry);
                const blocked = usable && !on && atLimit;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`strat-chip${on ? ' on' : ''}${blocked ? ' blocked' : ''}${usable ? '' : ' notyet'}`}
                    aria-pressed={usable ? on : undefined}
                    aria-disabled={usable ? undefined : true}
                    /* The reason is in the NAME, not a title. A dimmed chip that
                       announces identically to a working one is the mouse-only
                       `title` problem again, one screen over - and `title` is
                       what clobbered every blocked chip's name on #959. */
                    /* "Not available yet" reads as a plan question - upgrade
                       and it appears. It never does: canRender is keyed on
                       `source`, not on entitlement, so this is identical on
                       every plan. Naming that explicitly here too, not just
                       in the visible note, since a screen reader user only
                       ever gets this string. */
                    aria-label={usable ? undefined : `${entry.label} - not wired up to the chart yet, same on every plan`}
                    /* The reason is a DESCRIPTION, and it points at the visible
                       line below rather than at hidden text or a `title`.

                       NO `title` HERE, and that is a fix rather than a
                       simplification. QA measured it live: with `title` on this
                       button, every blocked chip's accessible NAME came back as
                       "Deselect one first - 3 at a time" instead of "Ichimoku",
                       for all of them alike. Isolated in both directions on the
                       running page - removing `title` from one chip restored
                       its name; removing `aria-describedby` from another and
                       leaving `title` did not. So `title` was clobbering
                       name-from-content, and the first fix traded "the keyboard
                       learns nothing" for "the keyboard cannot tell the chips
                       apart". Second gap, not a closed one.

                       A description does not participate in the name, so this
                       shape cannot repeat the trade. */
                    aria-describedby={blocked ? limitNoteId : undefined}
                    /* A chip past the limit stays focusable. Making it
                       `disabled` would drop it out of the tab order and leave a
                       keyboard user unable to find out what stopped them. */
                    onClick={() => toggle(entry)}
                  >
                    {on && <span className="strat-n" aria-hidden="true">{pos + 1}</span>}
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* VISIBLE, not screen-reader-only, and only while it is true.

            The first version hid this text and left a `title` for mouse users,
            which is two channels carrying one sentence and one of them
            clobbering the chip names. One visible line serves everybody: a
            sighted mouse user reads it without hovering, and it is what the
            blocked chips point their description at.

            One element for every blocked chip rather than one each - the
            sentence is identical, and twenty copies of it in the accessibility
            tree is its own defect. */}
        {/* One line for the dimmed chips, visible rather than hidden, for the
            same reason the limit note is: a sighted user should not have to
            hover to find out why a third of the list is greyed out.

            "Not available yet" was the original wording and it is wrong in a
            freemium panel: sitting next to the PRO/FREE tag above, a Free
            reader takes it as "upgrade to unlock" and a Pro reader takes it
            as "something's broken, I paid for this". Neither is true -
            canRender is keyed on `source` (whether the indicator is wired
            into the chart at all), not on entitlement, so it is identical
            for every plan. Saying so directly removes the misread instead
            of relying on the reader not to make it. */}
        <div className="strat-notyet-note">
          Dimmed indicators aren&apos;t wired up to the chart yet - same on every plan.
        </div>

        {atLimit && (
          <div id={limitNoteId} className="strat-limit" role="status">
            {`Deselect one first - ${limit} at a time`}
          </div>
        )}

        {isAuto && (
          <div className="strat-auto">
            The read picks the indicators that fit this coin and timeframe.
          </div>
        )}

        {dropped > 0 && (
          <div className="strat-trunc" role="status">
            {/* Tier-neutral wording on purpose. The limit is 1 on free and 3 on
                Pro, and a preset can outgrow either - saying "free" here would
                be wrong for a Pro user the first time a four-indicator set
                exists. */}
            {dropped === 1
              ? `1 indicator in this set is beyond your limit - showing the first ${limit}.`
              : `${dropped} indicators in this set are beyond your limit - showing the first ${limit}.`}
          </div>
        )}

        {focusedEntry && focusedEntry.paramSchema.length > 0 && (
          <div className="strat-params">
            <div className="strat-params-h">{focusedEntry.label}</div>
            {focusedEntry.paramSchema.map(spec => (
              <ParamRow
                key={spec.key}
                spec={spec}
                value={paramsFor(focusedEntry)[spec.key]}
                /* Free keeps the defaults and can see them. Hiding the values
                   would make the tier difference look like missing data. */
                readOnly={!entitled}
                onChange={v => onParamsChange({
                  ...params,
                  [focusedEntry.id]: { ...paramsFor(focusedEntry), [spec.key]: v },
                })}
              />
            ))}
            {!entitled && <div className="strat-ro">Defaults on free · editable on Pro</div>}
          </div>
        )}
      </div>

      <div className="strat-sect">
        <div className="strat-lbl"><span>Run the read</span></div>
        <div className="strat-actions">
          {/* Never gated on a selection. Zero indicators is the default state and
              all three actions work in it - that is what "let the read choose"
              means. */}
          <button type="button" className="strat-btn pri" onClick={() => onRun('quick', selected)}>QUICK</button>
          <button type="button" className="strat-btn" onClick={() => onRun('deep', selected)}>DEEP</button>
          <button type="button" className="strat-btn" onClick={() => onRun('ask', selected)}>ASK AI</button>
        </div>
      </div>
    </div>
  );
}

/** Exported for the unit test: the registry and the limit together decide what a
 *  tier may hold, and that rule should be checkable without rendering React. */
export function nextSelection(prev: readonly string[], id: string, limit: number): readonly string[] {
  if (prev.includes(id)) return prev.filter(x => x !== id);
  if (prev.length >= limit) return prev;
  return [...prev, id];
}

export { INDICATORS };
