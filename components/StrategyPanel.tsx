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

import { useState } from 'react';
import Link from 'next/link';
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

export type RunKind = 'quick' | 'deep' | 'ask';

interface Props {
  /** What each chart overlay is doing right now, from strategyRegistry's overlayStates() - the same values the chart draws from.
   *  Absent = every layer reads as always on. */
  overlays?: Record<'EMA_RIBBON' | 'SR' | 'LIQ_CLUSTERS' | 'GEX', OverlayState>;
  /** Flip the chart's S/R or Liq layer: the same switch as the chart toolbar. */
  onOverlayToggle?: (id: 'SR' | 'LIQ_CLUSTERS') => void;
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
  /** Whether a read is already in flight - disables the run buttons (#1309 item 24). */
  running?: boolean;
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

/* One always-on CHART LAYERS row: a name and a right-aligned status word, no control. */
function LayerRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="strat-layer">
      <span className="strat-layer-name">{name}</span>
      <span className="strat-layer-state">{status}</span>
    </div>
  );
}

/* A CHART LAYERS switch (S/R, Liq): a real role="switch" button synced to the chart toolbar.
   `unavailable` (a coin with no such layer) shows an off, disabled switch rather than hiding it. */
function LayerSwitch({ name, on, unavailable, onToggle }: { name: string; on: boolean; unavailable: boolean; onToggle: () => void }) {
  const { t } = useLabels();
  return (
    <div className="strat-layer">
      <span className="strat-layer-name">{name}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        disabled={unavailable}
        className={`strat-switch${on ? ' on' : ''}`}
        title={unavailable ? t('STRATEGY_PANEL_LAYER_UNAVAILABLE') : undefined}
        onClick={onToggle}
      >
        <span className="strat-switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function StrategyPanel({ overlays, onOverlayToggle, status, onRetry, selected, onSelectedChange, params, onParamsChange, onRun, running = false, strategy, onStrategyPick, strategyState }: Props) {
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
  const setId = pickedStrategy ? pickedStrategy.id : selected.length > 0 ? CUSTOM_SET_ID : AUTO_SET_ID;
  /* Which indicator's parameters the box shows. One box, not one per selection. */
  const [focused, setFocused] = useState<string | null>(null);

  const paramsFor = (entry: IndicatorEntry) => params[entry.id] ?? defaultParams(entry);
  const focusedEntry = focused ? findIndicator(focused) : undefined;
  const used = slottedIds(selected).length;

  /* THE ONE STRATEGY MENU (owner, 2026-11-14, option A). The caller writes the saved strategy AND the chips in one save; here only the params focus follows. */
  const applySet = (id: string) => {
    if (!loaded) return;
    onStrategyPick(id);
    const def = findStrategy(id);
    setFocused(def ? (def.chips.find(c => SELECTABLE_INDICATOR_IDS.has(c)) ?? null) : null);
  };

  const toggle = (entry: IndicatorEntry) => {
    if (!loaded || !canRender(entry)) return;
    if (selected.includes(entry.id)) {
      /* #1027: with 2+ on, clicking an earlier chip re-shows its params; only the chip already
         showing its params deselects. With Pro unlimited this is the common path. */
      if (focused !== entry.id && selected.length > 1) { setFocused(entry.id); return; }
      const next = selected.filter(id => id !== entry.id);
      setFocused(next[next.length - 1] ?? null);
      onSelectedChange(next);
      return;
    }
    if (entitled || used < limit) {
      setFocused(entry.id);
      onSelectedChange([...selected, entry.id]);
      return;
    }
    /* FREE, AT THE CAP: tap-to-SWAP, not refuse (the redesign). The new pick replaces the old one,
       which is the obvious gesture for a one-at-a-time control - refusing it made the chip look
       dead. `limit` is 1 on Free, so the new selection is exactly this one indicator. */
    setFocused(entry.id);
    onSelectedChange([entry.id]);
  };

  const layer = (id: 'EMA_RIBBON' | 'SR' | 'LIQ_CLUSTERS' | 'GEX'): OverlayState => overlays?.[id] ?? 'always';
  const isAuto = loaded && setId === AUTO_SET_ID && selected.length === 0;

  return (
    <div className="strat-panel">
      <div className="strat-head">
        <span>Strategy</span>
        {/* #1119: 'unknown' must not read as a confident plan tier. */}
        <span className="strat-aux" title={entitlementStatus === 'unknown' ? "Couldn't verify your plan" : undefined}>
          {planLabel.head}
        </span>
      </div>

      {entitlementUnknown ? (
        <EntitlementUnknownCard title="Strategy indicators" onRetry={retryEntitlements} />
      ) : (
      <>
      <div className="strat-sect">
        <div className="strat-lbl">
          <span>{t('STRATEGY_PANEL_SECTION_SET')}</span>
          {entitled && <span className="strat-cap">Edit · Save as</span>}
        </div>
        <select className="strat-sel" data-testid="strategy-set-select" value={setId} disabled={!loaded} aria-label={t('STRATEGY_PANEL_SECTION_SET')} onChange={e => applySet(e.target.value)}>
          {STRATEGY_SETS.filter(s => s.id === AUTO_SET_ID).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          {STRATEGIES.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
          {STRATEGY_SETS.filter(s => s.id === CUSTOM_SET_ID).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {pickedStrategy && <StrategyCallBox def={pickedStrategy} state={strategyState} />}
      </div>

      <div className="strat-sect">
        <div className="strat-lbl">
          <span>{t('STRATEGY_PANEL_SECTION_INDICATORS')}</span>
          {/* Pro/trial: how many are on, no "of N" - there is no cap. Free: the one-at-a-time rule. */}
          {loaded && (
            entitled
              ? <span className="strat-count">{t('STRATEGY_PANEL_ON_COUNT', { n: used })}</span>
              : <span className="strat-count">{t('STRATEGY_PANEL_FREE_LIMIT')}</span>
          )}
        </div>

        {/* Pro note vs Free note, from the artboard. The Pro line is now TRUE (the read receives the
            selected indicators' values, #1631/#2161). */}
        {loaded && (
          <p className="strat-ind-note">
            {entitled
              ? t('STRATEGY_PANEL_NOTE_PRO')
              : t('STRATEGY_PANEL_NOTE_FREE')}
          </p>
        )}

        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="status" aria-live="polite">
            <span className="sr-only">Loading your saved strategy…</span>
            {[0, 1, 2].map(i => <SkeletonBar key={i} height={40} radius={8} style={{ opacity: 1 - i * 0.18 }} />)}
          </div>
        )}

        {status === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }} role="alert">
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>Couldn&apos;t load your saved indicators.</span>
            <button
              onClick={handleRetry} disabled={retrying}
              style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 4, padding: '2px 8px', cursor: retrying ? 'default' : 'pointer', opacity: retrying ? 0.6 : 1 }}
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {loaded && (
          <div className="strat-ind-grid">
            {SELECTABLE_INDICATORS.map(entry => {
              const on = selected.includes(entry.id);
              const pos = selected.indexOf(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`strat-ind-chip${on ? ' on' : ''}`}
                  aria-pressed={on}
                  data-testid={`strategy-indicator-${entry.id}`}
                  onClick={() => toggle(entry)}
                >
                  <span className="strat-ind-box" aria-hidden="true">
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>
                    )}
                  </span>
                  <span className="strat-ind-text">
                    <span className="strat-ind-name">{on && selected.length > 1 && <span className="strat-n" aria-hidden="true">{pos + 1}</span>}{entry.label}</span>
                    {entry.blurbKey && <span className="strat-ind-desc">{t(entry.blurbKey)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* FREE ONLY: the persistent upgrade callout, present even with nothing selected (it is an
            invitation, not a limit warning). Pro never sees it - Pro has every indicator already. */}
        {loaded && !entitled && (
          <div className="strat-callout" role="note">
            <span>{t('STRATEGY_PANEL_PRO_CALLOUT')}</span>
            <Link href="/upgrade" className="strat-callout-link" data-testid="strategy-pro-callout">{t('STRATEGY_PANEL_PRO_CALLOUT_LINK')}</Link>
          </div>
        )}

        {isAuto && (
          <div className="strat-auto">{t('STRATEGY_PANEL_AUTO_NOTE')}</div>
        )}

        {focusedEntry && focusedEntry.paramSchema.length > 0 && (
          <div className="strat-params">
            <div className="strat-params-h">{focusedEntry.label}</div>
            {focusedEntry.paramSchema.map(spec => (
              <ParamRow
                key={spec.key}
                spec={spec}
                value={paramsFor(focusedEntry)[spec.key]}
                readOnly={!entitled}
                onChange={v => onParamsChange({ ...params, [focusedEntry.id]: { ...paramsFor(focusedEntry), [spec.key]: v } })}
              />
            ))}
            {!entitled && <div className="strat-ro">Defaults on free · editable on Pro</div>}
            {entitled && <div className="strat-ro">{t('STRATEGY_PANEL_PARAMS_VERDICT_NOTE')}</div>}
          </div>
        )}
      </div>

      {/* CHART LAYERS: drawn on the chart on every plan, never using an indicator slot. */}
      {loaded && (
        <div className="strat-sect">
          <div className="strat-lbl"><span>{t('STRATEGY_PANEL_SECTION_LAYERS')}</span></div>
          <p className="strat-ind-note">{t('STRATEGY_PANEL_LAYERS_NOTE')}</p>
          <div className="strat-layers">
            <LayerRow name={t('STRATEGY_PANEL_LAYER_EMA')} status={t('STRATEGY_PANEL_LAYER_ALWAYS_ON')} />
            <LayerRow name={t('STRATEGY_PANEL_LAYER_RSI')} status={t('STRATEGY_PANEL_LAYER_ALWAYS_ON')} />
            <LayerRow name={t('STRATEGY_PANEL_LAYER_GEX')} status={t('STRATEGY_PANEL_LAYER_ALWAYS_ON_BTC')} />
            <LayerSwitch
              name={t('STRATEGY_PANEL_LAYER_SR')}
              on={layer('SR') === 'on' || layer('SR') === 'always'}
              unavailable={layer('SR') === 'none'}
              onToggle={() => onOverlayToggle?.('SR')}
            />
            <LayerSwitch
              name={t('STRATEGY_PANEL_LAYER_LIQ')}
              on={layer('LIQ_CLUSTERS') === 'on' || layer('LIQ_CLUSTERS') === 'always'}
              unavailable={layer('LIQ_CLUSTERS') === 'none'}
              onToggle={() => onOverlayToggle?.('LIQ_CLUSTERS')}
            />
          </div>
        </div>
      )}
      </>
      )}

      <div className="strat-sect">
        <div className="strat-lbl"><span>{t('STRATEGY_PANEL_SECTION_RUN')}</span></div>
        <div className="strat-actions">
          <button type="button" className="strat-btn pri" disabled={running} onClick={() => onRun('quick', selected)}>QUICK</button>
          <button type="button" className="strat-btn" disabled={running} onClick={() => onRun('deep', selected)}>DEEP</button>
          <button type="button" className="strat-btn" onClick={() => onRun('ask', selected)}>ASK AI</button>
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
