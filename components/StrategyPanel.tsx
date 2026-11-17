'use client';
/* The Arena strategy panel (#930, redesigned to the owner-approved artboards #1263).
 *
 * WHAT THIS OWNS. The indicator selection and nothing else. The consumers the selection feeds -
 * chart markers, QUICK, DEEP, ASK AI - live outside this component and read `selected` as a prop.
 * `onRun` is the seam.
 *
 * TWO SECTIONS, DELIBERATELY SEPARATE (the redesign). INDICATORS are the things a read weighs and a
 * trader picks: SMA, PSAR, MACD, Bollinger. CHART LAYERS are drawn on the chart and do NOT use an
 * indicator slot: the EMA ribbon, the RSI pane and GEX are always on, and S/R and Liquidation
 * clusters are real switches synced to the chart toolbar. RSI is a LAYER here, not a selectable
 * indicator - it is advisory and always drawn, so it is not in the selectable set (if a saved
 * selection still carries `RSI`, the page filters it out before it reaches this panel).
 *
 * PRO AND TRIAL ARE UNLIMITED (owner): every indicator can be on at once, with no counter. FREE is
 * one at a time - tapping another SWAPS it, and a persistent callout invites the upgrade. The limit
 * lives in lib/strategyRegistry.ts (`indicatorLimit`), Infinity for Pro, 1 for Free.
 *
 * STYLING LIVES IN globals.css, not here (rule 1 of #663 - a constant has no second design to serve).
 *
 * COPY IS HARDCODED ENGLISH, matching the rest of this file and the file it replaced; the plain-words
 * labels pass is a separate DB-driven change. The one exception is the params verdict note, which
 * carries the owner's exact wording through a real label key. */

import { useEffect, useRef, useState, startTransition } from 'react';
import { Lock } from '@/components/icons';
import { useAuth } from './AuthProvider';
import { SkeletonBar } from './Skeleton';
import StrategyCallBox from './StrategyCallBox';
import { STRATEGIES, findStrategy } from '@/lib/strategies';
import type { StrategySignalState } from '@/lib/useStrategySignal';
import { EntitlementUnknownCard } from './UpgradeGateModal';
import type { SettingsLoadStatus } from '@/lib/settings';
import { useLabels } from '@/lib/labels';
import {
  INDICATORS, STRATEGY_SETS, AUTO_SET_ID, CUSTOM_SET_ID,
  findIndicator, indicatorLimit, defaultParams, canRender, slottedIds, strategyPlanLabel,
  SELECTABLE_INDICATORS, SELECTABLE_INDICATOR_IDS,
  type IndicatorEntry, type ParamSpec, type OverlayState,
} from '@/lib/strategyRegistry';

/* The parameter box is COLLAPSED by default (the panel had to be shorter); once the visitor opens it, it stays open for the rest of the session (module memory, not stored). */
let paramsOpenForSession = false;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export type RunKind = 'quick' | 'deep' | 'ask';

interface Props {
  /** The signed-in visitor's plan is still being read: chips and the strategy menu are disabled, and nothing is applied or saved from a click (a Pro account would otherwise be treated as Free and have its saved selection cut). */
  planChecking?: boolean;
  /** What each chart overlay is doing right now, from strategyRegistry's overlayStates() - the same values the chart draws from.
   *  Absent = every layer reads as always on. */
  overlays?: Record<'EMA_RIBBON' | 'RSI' | 'SR' | 'LIQ_CLUSTERS' | 'GEX', OverlayState>;
  /** Flip the chart's S/R or Liq layer: the same switch as the chart toolbar. */
  /* S/R and Liq clusters are Pro on coins outside BTC/ETH/SOL (owner, 2026-11-17): their chips show the lock and a tap opens the page's upgrade prompt. */
  layersLocked?: boolean;
  onOverlayToggle?: (id: 'EMA_RIBBON' | 'RSI' | 'SR' | 'LIQ_CLUSTERS') => void;
  /** Whether the caller's saved selection has been read (or confirmed absent). Until 'ready',
   *  `selected` is not the user's real answer, so no click may persist over it (#1246/#1347). */
  status: SettingsLoadStatus;
  /** Retry for the 'error' state - SettingsProvider's refresh(). */
  onRetry: () => Promise<void>;
  /** The current selection, CONTROLLED (the chart, QUICK, DEEP, ASK all read it). Ordered, not a Set. */
  selected: readonly string[];
  onSelectedChange: (next: readonly string[]) => void;
  /** Per-indicator edited parameters, CONTROLLED (#1008). */
  params: Record<string, Record<string, string | number | boolean>>;
  onParamsChange: (next: Record<string, Record<string, string | number | boolean>>) => void;
  /** Fired when a run button is pressed. Required (#996). */
  onRun: (kind: RunKind, selection: readonly string[]) => void;
  /* The run row's gating, from the SAME object the page's top Quick / Deep / Ask buttons read - one source of truth, so a locked coin or a used-up allowance looks the same in both places. */
  runGate?: Record<RunKind, { locked: boolean; disabled: boolean; title?: string }>;
  /** Whether a read is already in flight - disables the run buttons (#1309 item 24). */
  /** The saved Arena strategy id (lib/strategies), or null. An unknown id is treated as none by the caller. The menu's value is DERIVED from this and `selected`: a known id shows that strategy, no id with chips on shows Custom, nothing shows Let the read choose. */
  strategy: string | null;
  /** The menu was changed: 'auto', 'custom' or a strategy id. The caller writes arena_strategy and strategy_selection together, in one save. */
  onStrategyPick: (id: string) => void;
  /** The picked strategy's live call (closed candles), shown in the call box under the menu. */
  strategyState: StrategySignalState;
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
        <select className="strat-pv" value={String(value)} disabled={readOnly} aria-label={spec.label} onChange={e => onChange(e.target.value)}>
          {spec.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (spec.kind === 'bool') {
    return (
      <div className="strat-prow">
        <span>{spec.label}</span>
        <input className="strat-pv" type="checkbox" checked={Boolean(value)} disabled={readOnly} aria-label={spec.label} onChange={e => onChange(e.target.checked ? 1 : 0)} />
      </div>
    );
  }
  return (
    <div className="strat-prow">
      <span>{spec.label}</span>
      <input
        className="strat-pv" type="number" inputMode="numeric" value={String(value)}
        min={spec.min} max={spec.max} step={spec.kind === 'float' ? spec.step : (spec.step ?? 1)}
        disabled={readOnly} aria-label={spec.label} onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* A CHART LAYERS chip (EMA ribbon, RSI, S/R, Liq clusters): a real role="switch" button synced to the chart. Display only (owner, 2026-11-17).
   `unavailable` (a coin with no such layer) shows an off, disabled chip rather than hiding it. */
function LayerChip({ name, on, unavailable, locked = false, onToggle }: { name: string; on: boolean; unavailable: boolean; locked?: boolean; onToggle: () => void }) {
  const { t } = useLabels();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={unavailable}
      className={`strat-layer-chip${on && !locked ? ' on' : ''}${locked ? ' arena-deep-locked' : ''}`}
      title={unavailable ? t('STRATEGY_PANEL_LAYER_UNAVAILABLE') : undefined}
      onClick={onToggle}
    >
      {locked && <Lock size={10} aria-hidden="true" style={{ marginRight: 3, verticalAlign: '-1px' }} />}
      {name}
    </button>
  );
}

export default function StrategyPanel({ planChecking = false, layersLocked = false, overlays, onOverlayToggle, status, onRetry, selected, onSelectedChange, params, onParamsChange, onRun, runGate, strategy, onStrategyPick, strategyState }: Props) {
  const loaded = status === 'ready';
  const { user, loading: authLoading, entitlementStatus, retryEntitlements } = useAuth();
  const planLabel = strategyPlanLabel({ signedIn: !!user, authLoading, entitlementStatus });
  const entitled = entitlementStatus === 'entitled';
  const entitlementUnknown = entitlementStatus === 'unknown';
  const { t } = useLabels();

  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };

  const limit = indicatorLimit(entitled);
  const pickedStrategy = findStrategy(strategy);
  /* THE CALL BOX'S FIRST-PAINT RESERVE ENDS WITH THE ANSWER. `<html data-strat="1">` (components/RootDocument.tsx) reserves the box's height from a cached saved strategy; once the settings have loaded and no strategy is
     picked (none was saved, or the visitor chose "Let the read choose" / Custom), the reserve is removed so it never leaves an empty band. A visitor's own pick is not a layout shift. */
  useEffect(() => {
    if (loaded && !pickedStrategy) {
      document.documentElement.removeAttribute('data-strat');
      /* ...and the signed-in reserve (globals.css, data-sess without data-strat) ends too: this account has no saved strategy. */
      document.documentElement.setAttribute('data-strat-none', '1');
    }
  }, [loaded, pickedStrategy]);
  /* 'Custom' picked with no chip on has nothing else to derive it from, so it is remembered here: without it the menu fell back to 'Let the read choose' the moment it was picked. */
  const [customPicked, setCustomPicked] = useState(false);
  const setId = pickedStrategy ? pickedStrategy.id : (selected.length > 0 || customPicked) ? CUSTOM_SET_ID : AUTO_SET_ID;
  /* Which indicator's parameters the box shows. One box, not one per selection; with several ON, a small segmented row in the box picks whose. */
  const [focused, setFocused] = useState<string | null>(null);
  /* OPTIMISTIC CHIP STATE. A tap flips the chip on THIS render; the parent (chart markers, EMA filter, AI context, the settings save) catches up in a transition. `pending` is dropped as soon as
     the parent's `selected` matches it, or after 1.2 s if the parent refused the change (plan still loading), so a refused tap cannot leave a chip lying about its state. */
  const [pending, setPending] = useState<readonly string[] | null>(null);
  useEffect(() => { if (pending && sameList(pending, selected)) setPending(null); }, [pending, selected]);
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPending(null), 1200);
    return () => clearTimeout(id);
  }, [pending]);
  const shown = pending ?? selected;

  const paramsFor = (entry: IndicatorEntry) => params[entry.id] ?? defaultParams(entry);
  const paramEntries = SELECTABLE_INDICATORS.filter(e => shown.includes(e.id) && e.paramSchema.length > 0);
  const focusedEntry = paramEntries.find(e => e.id === focused) ?? paramEntries[paramEntries.length - 1];
  const used = slottedIds(shown).length;
  /* The box OPENS and CLOSES with a height transition (grid rows 0fr to 1fr), so it keeps showing the last indicator while it closes instead of snapping empty. */
  const lastParamEntry = useRef<IndicatorEntry | undefined>(undefined);
  if (focusedEntry) lastParamEntry.current = focusedEntry;
  const boxEntry = focusedEntry ?? lastParamEntry.current;
  const [paramsOpen, setParamsOpenState] = useState(paramsOpenForSession);
  const setParamsOpen = (v: boolean) => { paramsOpenForSession = v; setParamsOpenState(v); };
  const boxOpen = !!focusedEntry && paramsOpen;

  /* THE ONE STRATEGY MENU (owner, 2026-11-14, option A). The caller writes the saved strategy AND the chips in one save; here only the params focus follows. */
  const applySet = (id: string) => {
    if (!loaded) return;
    setCustomPicked(id === CUSTOM_SET_ID);
    onStrategyPick(id);
    const chip = findStrategy(id)?.chips.find(c => SELECTABLE_INDICATOR_IDS.has(c));
    if (chip) setFocused(chip);   // a strategy that reads a chip shows its parameters; otherwise the chips and the focus stay exactly as they were
  };

  /* A TAP ALWAYS TOGGLES. (#1027 used to make a tap on a not-focused ON chip only re-focus its params, so with two on a tap looked dead; params are now picked in the params box.) */
  const toggle = (entry: IndicatorEntry) => {
    if (!loaded || !canRender(entry)) return;
    let next: readonly string[];
    if (shown.includes(entry.id)) {
      next = shown.filter(id => id !== entry.id);
    } else if (entitled || used < limit) {
      next = [...shown, entry.id];
      setFocused(entry.id);
    } else {
      /* FREE, AT THE CAP: tap-to-SWAP, not refuse (the redesign). The new pick replaces the old one,
         which is the obvious gesture for a one-at-a-time control - refusing it made the chip look
         dead. `limit` is 1 on Free, so the new selection is exactly this one indicator. */
      next = [entry.id];
      setFocused(entry.id);
    }
    setPending(next);
    startTransition(() => onSelectedChange(next));
  };

  const layer = (id: 'EMA_RIBBON' | 'RSI' | 'SR' | 'LIQ_CLUSTERS' | 'GEX'): OverlayState => overlays?.[id] ?? 'always';
  const isAuto = loaded && setId === AUTO_SET_ID && shown.length === 0;

  return (
    <div className="strat-panel">
      <div className="strat-head">
        <span>{t('STRAT_CARD_TITLE')}</span>
        {/* #1119: 'unknown' must not read as a confident plan tier. */}
        <span className="strat-aux" title={entitlementStatus === 'unknown' ? t('STRATEGY_PANEL_PLAN_UNVERIFIED') : undefined}>
          {planLabel.plan === 'signed_out' ? t('STRATEGY_PANEL_PLAN_SIGNED_OUT') : planLabel.head}
        </span>
      </div>

      {entitlementUnknown ? (
        <EntitlementUnknownCard title={t('STRATEGY_PANEL_INDICATORS_TITLE')} onRetry={retryEntitlements} />
      ) : (
      <>
      <div className="strat-sect">
        <select className="strat-sel" data-testid="strategy-set-select" value={setId} disabled={!loaded || planChecking} aria-label={t('STRATEGY_PANEL_SECTION_SET')} onChange={e => applySet(e.target.value)}>
          {STRATEGY_SETS.filter(s => s.id === AUTO_SET_ID).map(s => <option key={s.id} value={s.id}>{t('STRATEGY_PANEL_SET_AUTO')}</option>)}
          {STRATEGIES.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
          {STRATEGY_SETS.filter(s => s.id === CUSTOM_SET_ID).map(s => <option key={s.id} value={s.id}>{t('STRATEGY_PANEL_SET_CUSTOM')}</option>)}
        </select>
        {/* THE CALL BOX'S HOST. A visitor whose saved strategy is stored on this browser has this box's whole height reserved from the FIRST paint (`html[data-strat="1"]`, set before paint by
            components/RootDocument.tsx, sized in globals.css), because the saved strategy arrives from settings 1-2 s later and the box mounted then, pushing the Indicators section 256 px (QA gate, IN+SAVED 1280). */}
        <div className="strat-call-host">
          {pickedStrategy && <StrategyCallBox def={pickedStrategy} state={strategyState} />}
        </div>
      </div>

      <div className="strat-sect">
        <div className="strat-lbl" title={!planChecking && entitled ? t('STRATEGY_PANEL_NOTE_PRO') : undefined}>
          <span>{t('STRATEGY_PANEL_SECTION_INDICATORS')}</span>
          {/* Pro/trial: how many are on, no "of N" - there is no cap. Free: the one-at-a-time rule. */}
          {loaded && (
            entitled
              ? <span className="strat-count">{t('STRATEGY_PANEL_ON_COUNT', { n: used })}</span>
              : !planChecking && <span className="strat-count">{t('STRATEGY_PANEL_FREE_LIMIT')}</span>
          )}
        </div>

        {/* Pro note vs Free note, from the artboard. The Pro line is now TRUE (the read receives the
            selected indicators' values, #1631/#2161). */}
        {loaded && planChecking && (
          <p className="strat-ind-note">{t('ARENA_PLAN_CHECKING')}</p>
        )}

        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="status" aria-live="polite">
            <span className="sr-only">{t('STRATEGY_PANEL_LOADING_SAVED')}</span>
            {[0, 1, 2].map(i => <SkeletonBar key={i} height={40} radius={8} style={{ opacity: 1 - i * 0.18 }} />)}
          </div>
        )}

        {status === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }} role="alert">
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>{t('STRATEGY_PANEL_LOAD_FAILED')}</span>
            <button
              onClick={handleRetry} disabled={retrying}
              style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 4, padding: '2px 8px', cursor: retrying ? 'default' : 'pointer', opacity: retrying ? 0.6 : 1 }}
            >
              {retrying ? t('STRATEGY_PANEL_RETRYING') : t('SETTINGS_SAVE_RETRY_BUTTON')}
            </button>
          </div>
        )}

        {loaded && (
          <div className="strat-ind-wrap">
          <div className="strat-ind-grid">
            {SELECTABLE_INDICATORS.map(entry => {
              const on = shown.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`strat-ind-chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={planChecking}
                  data-testid={`strategy-indicator-${entry.id}`}
                  title={entry.blurbKey ? t(entry.blurbKey) : undefined}
                  aria-describedby={entry.blurbKey ? `strat-desc-${entry.id}` : undefined}
                  onClick={() => toggle(entry)}
                >
                  <span className="strat-ind-box" aria-hidden="true">
                    {on && (
                      <svg className="strat-ind-check" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>
                    )}
                  </span>
                  <span className="strat-ind-text">
                    <span className="strat-ind-name">{entry.label}</span>
                    {/* The one-line blurb is NOT drawn (the panel had to be shorter): it is the chip's title (hover) and its accessible description, same label key. */}
                    {entry.blurbKey && <span id={`strat-desc-${entry.id}`} className="sr-only">{t(entry.blurbKey)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
        )}

        {/* The Free "Want more at once? See Pro" line is gone (owner, 2026-11-17: fewer upsell texts); the Free cap is already stated by the "1 at a time" count above. */}

        {isAuto && (
          <div className="strat-auto">{t('STRATEGY_PANEL_AUTO_NOTE')}</div>
        )}

        {focusedEntry && (
          <button type="button" className="strat-edit-link" aria-expanded={paramsOpen} onClick={() => setParamsOpen(!paramsOpen)}
            title={planChecking ? undefined : entitled ? t('STRATEGY_PANEL_PARAMS_VERDICT_NOTE') : t('STRATEGY_PANEL_FREE_DEFAULTS')}>
            {t('STRATEGY_PANEL_EDIT_SETTINGS')}
            <svg className="strat-edit-chevron" data-open={paramsOpen ? 'true' : 'false'} width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5l4 4 4-4" /></svg>
          </button>
        )}

        {/* THE PARAMS BOX opens and closes smoothly and only when an indicator with parameters is on; the chips above never move. Closed, it is inert and hidden from assistive tech. */}
        <div className={`strat-params-slot${boxOpen ? ' open' : ''}`} aria-hidden={boxOpen ? undefined : true} inert={!boxOpen}>
          <div className="strat-params-clip">
            {boxEntry && (
              <div className="strat-params">
                <div className="strat-params-h">
                  {paramEntries.length > 1 ? (
                    <div className="strat-seg" role="group" aria-label="Edit parameters for">
                      {paramEntries.map(e => (
                        <button key={e.id} type="button" className={`strat-seg-b${e.id === boxEntry.id ? ' on' : ''}`} aria-pressed={e.id === boxEntry.id} onClick={() => setFocused(e.id)}>{e.label}</button>
                      ))}
                    </div>
                  ) : boxEntry.label}
                </div>
                {boxEntry.paramSchema.map(spec => (
                  <ParamRow
                    key={spec.key}
                    spec={spec}
                    value={paramsFor(boxEntry)[spec.key]}
                    readOnly={!entitled}
                    onChange={v => onParamsChange({ ...params, [boxEntry.id]: { ...paramsFor(boxEntry), [spec.key]: v } })}
                  />
                ))}
                {/* The plan footnote ("Defaults on free" / "Chart line only...") is the "Edit settings" link's tooltip now, and is never set while the plan is still being read. */}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CHART LAYERS: drawn on the chart on every plan, never using an indicator slot. */}
      {loaded && (
        <div className="strat-sect">
          {/* "Drawn on the chart. They don't count as indicators." moved to the section label's title (the panel had to be shorter). */}
          {/* The always-on layers line is the section label's tooltip now (the panel had to be shorter). */}
          <div className="strat-lbl" title={t('STRATEGY_PANEL_LAYERS_ALWAYS_LINE')}><span>{t('STRATEGY_PANEL_SECTION_LAYERS')}</span></div>
          <div className="strat-layers">
            <LayerChip name={t('STRATEGY_PANEL_LAYER_EMA_SHORT')} on={layer('EMA_RIBBON') !== 'off'} unavailable={false} onToggle={() => onOverlayToggle?.('EMA_RIBBON')} />
            <LayerChip name={t('STRATEGY_PANEL_LAYER_RSI_SHORT')} on={layer('RSI') !== 'off'} unavailable={false} onToggle={() => onOverlayToggle?.('RSI')} />
            <LayerChip name={t('STRATEGY_PANEL_LAYER_SR_SHORT')} on={layer('SR') === 'on' || layer('SR') === 'always'} locked={layersLocked} unavailable={layer('SR') === 'none'} onToggle={() => onOverlayToggle?.('SR')} />
            <LayerChip name={t('STRATEGY_PANEL_LAYER_LIQ_SHORT')} on={layer('LIQ_CLUSTERS') === 'on' || layer('LIQ_CLUSTERS') === 'always'} locked={layersLocked} unavailable={layer('LIQ_CLUSTERS') === 'none' && !layersLocked} onToggle={() => onOverlayToggle?.('LIQ_CLUSTERS')} />
          </div>
        </div>
      )}
      </>
      )}

      <div className="strat-sect">
        <div className="strat-lbl"><span>{t('STRATEGY_PANEL_SECTION_RUN')}</span></div>
        <div className="strat-actions">
          {([['quick', 'QUICK', 'pri'], ['deep', 'DEEP', ''], ['ask', 'ASK AI', '']] as const).map(([kind, text, cls]) => {
            const g = runGate?.[kind];
            const locked = !!g?.locked;
            return (
              <button
                key={kind}
                type="button"
                className={`strat-btn${cls && !locked ? ' ' + cls : ''}${locked ? ' arena-deep-locked' : ''}`}
                disabled={g?.disabled ?? false}
                title={g?.title}
                onClick={() => onRun(kind, selected)}
              >
                {locked && <Lock size={10} aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }} />}
                {text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Exported for the unit test: the registry and the limit together decide what a tier may hold,
 *  checkable without rendering React. On Free (limit 1) a second pick swaps rather than stacks;
 *  Pro is unlimited. */
export function nextSelection(prev: readonly string[], id: string, limit: number): readonly string[] {
  if (prev.includes(id)) return prev.filter(x => x !== id);
  if (slottedIds([id]).length > 0 && slottedIds(prev).length >= limit) {
    /* At the cap with a one-slot limit (Free): swap to the new pick rather than refuse. For limit > 1
       this keeps the old refuse-at-cap behaviour. */
    return limit === 1 ? [id] : prev;
  }
  return [...prev, id];
}

export { INDICATORS };
