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

import { useState, useMemo } from 'react';
import { useAuth } from './AuthProvider';
import {
  GROUPS, GROUP_LABEL, INDICATORS, STRATEGY_SETS,
  AUTO_SET_ID, CUSTOM_SET_ID,
  byGroup, findIndicator, indicatorLimit, defaultParams,
  type IndicatorEntry, type ParamSpec,
} from '@/lib/strategyRegistry';

export type RunKind = 'quick' | 'deep' | 'ask';

interface Props {
  /** Fired with the current selection. Wiring the consumers is the next change. */
  onRun?: (kind: RunKind, selection: readonly string[]) => void;
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

export default function StrategyPanel({ onRun }: Props) {
  const { entitled } = useAuth();
  const limit = indicatorLimit(Boolean(entitled));

  const [setId, setSetId] = useState<string>(AUTO_SET_ID);
  /* An ORDERED list, not a Set. The chip badge shows the position in the
     selection, which the artifact draws as 1 and 2 - so order is data, and a
     Set would throw it away. */
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [params, setParams] = useState<Record<string, Record<string, string | number | boolean>>>({});
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
    setSelected(next);
    setFocused(next[0] ?? null);
  };

  const toggle = (entry: IndicatorEntry) => {
    setSelected(prev => {
      if (prev.includes(entry.id)) {
        const next = prev.filter(id => id !== entry.id);
        setFocused(next[next.length - 1] ?? null);
        return next;
      }
      if (prev.length >= limit) return prev;
      setFocused(entry.id);
      return [...prev, entry.id];
    });
    /* Touching a chip makes it a custom set on its own. Requiring the dropdown
       to be changed first would make the obvious gesture do nothing. */
    setSetId(CUSTOM_SET_ID);
    setDropped(0);
  };

  const groups = useMemo(() => GROUPS.map(g => ({ id: g, entries: byGroup(g) })), []);
  const isAuto = setId === AUTO_SET_ID && selected.length === 0;

  return (
    <div className="strat-panel">
      <div className="strat-head">
        <span>Strategy</span>
        <span className="strat-aux">{entitled ? 'PRO' : `FREE · ${limit}`}</span>
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
                const blocked = !on && atLimit;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`strat-chip${on ? ' on' : ''}${blocked ? ' blocked' : ''}`}
                    aria-pressed={on}
                    /* A chip past the limit stays focusable and says why. Making
                       it `disabled` would drop it out of the tab order and leave
                       a keyboard user unable to find out what stopped them. */
                    onClick={() => toggle(entry)}
                    title={blocked ? `Deselect one first - ${limit} at a time` : undefined}
                  >
                    {on && <span className="strat-n" aria-hidden="true">{pos + 1}</span>}
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

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
                onChange={v => setParams(prev => ({
                  ...prev,
                  [focusedEntry.id]: { ...paramsFor(focusedEntry), [spec.key]: v },
                }))}
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
          <button type="button" className="strat-btn pri" onClick={() => onRun?.('quick', selected)}>QUICK</button>
          <button type="button" className="strat-btn" onClick={() => onRun?.('deep', selected)}>DEEP</button>
          <button type="button" className="strat-btn" onClick={() => onRun?.('ask', selected)}>ASK AI</button>
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
