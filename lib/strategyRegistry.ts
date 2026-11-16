/* The indicator registry for #930's strategy panel.
 *
 * SEEDED FROM THE APPROVED LAYOUT, NOT FROM klinecharts. The artifact draws 21
 * chips in five groups and that list is the spec; what each one is BUILT from is
 * a separate question, which is what `source` and `basis` record.
 *
 * WHY `source` MATTERS MORE THAN IT LOOKS. Three populations end up on the same
 * chart with nothing in common but that:
 *
 *   overlay   8 registerOverlay calls in components/KLineProChart.tsx
 *   builtin   27 shipped by klinecharts, enumerated from dist/index.esm.js
 *   new       neither - computed here, or derived from a builtin's figures
 *
 * `basis` IS THE HONESTY FIELD, and measurement says it is needed exactly twice.
 * klinecharts' DMI renders FOUR figures - pdi, mdi, adx, adxr - so an entry
 * labelled ADX that renders DMI shows three lines the user did not ask for. KDJ
 * renders k, d and j where "stochastic" conventionally means %K and %D. Every
 * other builtin is honest under its own name: CR, DMA, EMV, MTM, OBV, PSY, ROC,
 * TRIX and VR each pair their line with a moving average of it, which is how
 * those are conventionally drawn, and BIAS, EMA, MA, RSI and WR render one
 * figure per period in calcParams. So `basis` is two rows, not a general class.
 *
 * `pane` IS ABOUT THE Y-AXIS FOLD, NOT LAYOUT. klinecharts folds every
 * indicator's values into its pane's auto Y-range unconditionally. A long EMA
 * far from the current price cluster dragged the candle axis ~11x wider than the
 * visible range, measured live on PEPE/BONK 15m - which is why the EMA ribbon is
 * drawn as four overlays rather than as an indicator, recorded at
 * KLineProChart.tsx:997. Anything on `candle` carrying values far from price has
 * to be an overlay, and this field is where that is said rather than in a comment
 * one file away.
 *
 * NOT DECLARED HERE: what an indicator RENDERS. klinecharts' VOL declares figures
 * ma1/ma2/ma3 - the moving averages only - and draws the volume bars itself. A
 * field claiming to enumerate what appears on screen would be wrong for VOL on
 * day one.
 */

/** The five groups the approved layout draws, in its order. Not six: an earlier
 *  proposal had `structure` and `liquidity` separately and the drawing collapses
 *  both into Levels. */
import type { LabelKey } from './labelKeys.ts';

export const GROUPS = ['trend', 'momentum', 'volatility', 'flow', 'levels'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<Group, string> = {
  trend: 'Trend',
  momentum: 'Momentum',
  volatility: 'Volatility',
  flow: 'Volume & flow',
  levels: 'Levels',
};

export type Source = 'overlay' | 'builtin' | 'new';

export type ParamSpec =
  | { kind: 'int';   key: string; label: string; min: number; max: number; step?: number; default: number }
  | { kind: 'float'; key: string; label: string; min: number; max: number; step: number;  default: number }
  | { kind: 'enum';  key: string; label: string; options: readonly string[];              default: string }
  | { kind: 'bool';  key: string; label: string;                                          default: boolean };

export interface IndicatorEntry {
  /** Stable key. For a builtin this is the klinecharts name. */
  id: string;
  /** What the chip reads. Uppercased by CSS, so written here in natural case. */
  label: string;
  /** One plain line under the chip name (#1263 panel redesign), for a trader who does not know the
   *  indicator by name. Selectable indicators carry it; overlays and the not-yet-wired entries do
   *  not need it (overlays live in the CHART LAYERS section, the rest are hidden). */
  blurbKey?: LabelKey;
  group: Group;
  source: Source;
  /** Own pane, or drawn over the candles. See the Y-axis note above. */
  pane: 'candle' | 'own';
  paramSchema: readonly ParamSpec[];
  /** Required when the displayed name is not what is computed. Two entries. */
  basis?: string;
  /** Why this row is shaped the way it is, when that is not obvious. */
  note?: string;
}

const period = (key: string, label: string, def: number, min = 2, max = 400): ParamSpec =>
  ({ kind: 'int', key, label, min, max, default: def });

export const INDICATORS: readonly IndicatorEntry[] = [
  /* -- Trend ------------------------------------------------------------- */
  {
    id: 'EMA_RIBBON', label: 'EMA ribbon', group: 'trend', source: 'overlay', pane: 'candle',
    paramSchema: [period('fast', 'Fast', 21), period('slow', 'Slow', 55)],
    note: 'Four emaRibbonLine overlays, NOT klinecharts EMA. Moving it onto the '
        + 'indicator pipeline reinstates the axis bug at KLineProChart.tsx:997.',
  },
  {
    id: 'SMA', label: 'SMA', blurbKey: 'STRATEGY_BLURB_SMA', group: 'trend', source: 'builtin', pane: 'candle',
    paramSchema: [period('length', 'Length', 12), period('weight', 'Weight', 2, 1, 10)],
    // id is correctly 'SMA' - klinecharts does ship an indicator by that
    // name (unlike ADX/STOCH, this is not a basis mismatch). What klinecharts'
    // 'SMA' actually COMPUTES for the CHART LINE is still not a rolling mean
    // - it's a recursive SMA(N,M) formula, verified against the compiled
    // source (node_modules/klinecharts/dist/index.esm.js,
    // simpleMovingAverage.calc), and at this entry's own default (length 12,
    // weight 2) that formula is algebraically identical to EMA(12) - see
    // smaNMArr's doc in strategyCore.ts. #1016's panel wiring still draws
    // that exact line when this chip is selected; nothing here changes it.
    //
    // #1007 - THE GATING CONDITION IS DIFFERENT FROM THE LINE, DELIBERATELY.
    // The original #985 gap 1 wiring pointed the verdict-gating condition at
    // the same SMA(12,2)=EMA(12) value the chart draws, which meant
    // selecting SMA duplicated an input the ribbon already runs on - and
    // once MACD shipped (fast line also EMA(12)), a trader selecting both
    // believed they added two signals while adding one. The owner ruled:
    // make it genuinely different rather than relabel the collision. There
    // is no (N,M) at which smaNMArr becomes a true rolling mean - it is
    // EMA-family at every M - so useEMAStrategy.ts's gating now calls
    // smaArr(cl4, 12) (the real rolling mean already in this file, used for
    // the 200D core gate) instead. The cost: what gates the verdict and what
    // the chart draws for this one chip are no longer the same computation -
    // named in the checklist row's own label ("rolling mean"), not hidden.
    note: "klinecharts' SMA line is still SMA(N,M), recursive (=EMA(12) at the "
        + 'default) - but as of #1007 the verdict-gating condition uses a genuine '
        + 'rolling mean (smaArr) instead, specifically so it stops duplicating the '
        + "ribbon/MACD's EMA(12). The chart line and the gating condition are "
        + 'deliberately different computations for this one chip. See '
        + 'useEMAStrategy.ts and smaNMArr/smaArr in strategyCore.ts.',
  },
  {
    id: 'SUPERTREND', label: 'Supertrend', group: 'trend', source: 'new', pane: 'candle',
    paramSchema: [
      period('atr', 'ATR', 10),
      { kind: 'float', key: 'mult', label: 'Multiplier', min: 0.5, max: 10, step: 0.1, default: 3 },
    ],
    note: 'klinecharts ships no Supertrend. Computed here from ATR.',
  },
  {
    id: 'ICHIMOKU', label: 'Ichimoku', group: 'trend', source: 'new', pane: 'candle',
    paramSchema: [period('conversion', 'Conversion', 9), period('base', 'Base', 26), period('span', 'Span B', 52)],
    note: 'Not a klinecharts builtin.',
  },
  {
    id: 'SAR', label: 'Parabolic SAR', blurbKey: 'STRATEGY_BLURB_SAR', group: 'trend', source: 'builtin', pane: 'candle',
    paramSchema: [
      { kind: 'float', key: 'start', label: 'Start', min: 0.001, max: 1, step: 0.001, default: 0.02 },
      { kind: 'float', key: 'step',  label: 'Step',  min: 0.001, max: 1, step: 0.001, default: 0.02 },
      { kind: 'float', key: 'max',   label: 'Max',   min: 0.01,  max: 1, step: 0.01,  default: 0.2 },
    ],
  },
  {
    id: 'ADX', label: 'ADX', group: 'trend', source: 'new', basis: 'DMI', pane: 'own',
    paramSchema: [period('length', 'Length', 14), period('smooth', 'Smoothing', 6)],
    note: "klinecharts' DMI renders pdi, mdi, adx AND adxr. Registered with a "
        + 'custom figure list so the chip that says ADX draws ADX.',
  },

  /* -- Momentum ---------------------------------------------------------- */
  {
    id: 'RSI', label: 'RSI', group: 'momentum', source: 'builtin', pane: 'own',
    // No settings: the chart's one RSI pane is always on at 14 (DEFAULT_PANE_INDICATORS below), and the verdict's RSI condition reads the same 14.
    // A Length here used to configure a SECOND pane (owner, 2026-10-08: one RSI pane per user). Saved RSI params are simply never read.
    paramSchema: [],
    note: 'The chart always draws one RSI-14 pane (calcParams [14], not the builtin 3-line [6,12,24] default - 14 is the '
        + 'period marketStore uses everywhere else: rsi14/rsi1h/rsi4h/rsiDaily). Selecting this chip draws nothing extra: it only adds RSI to the verdict.',
  },
  {
    id: 'MACD', label: 'MACD', blurbKey: 'STRATEGY_BLURB_MACD', group: 'momentum', source: 'builtin', pane: 'own',
    paramSchema: [period('fast', 'Fast', 12), period('slow', 'Slow', 26), period('signal', 'Signal', 9)],
    // #1007 resolved the GATING half of this collision (SMA's verdict
    // condition no longer uses SMA(12,2)=EMA(12) - see the SMA entry above).
    // The CHART LINE half is unchanged and still real: MACD's fast line is
    // still SMA(12,2), the same recursive formula and period SMA's chip
    // still draws by default, since klinecharts' own MACD/SMA math is fixed
    // and #1007 only touched the gating condition, not what either
    // indicator renders. A trader selecting both chips still sees two
    // panels agree on the same underlying EMA(12) line - visual overlap,
    // not a verdict-doubling one any more.
    note: "MACD's fast line (period 12) is still SMA(12,2) - the same recursive formula "
        + "and period the SMA chip still draws by default. As of #1007 this is a chart-line "
        + 'overlap only, not a verdict one - the two conditions gate on different things '
        + '(SMA on a genuine rolling mean, MACD on DIF vs DEA). See macdArr in '
        + 'strategyCore.ts and the SMA entry above.',
  },
  {
    id: 'STOCH', label: 'Stoch', group: 'momentum', source: 'new', basis: 'KDJ', pane: 'own',
    paramSchema: [period('length', 'Length', 9), period('k', 'K', 3), period('d', 'D', 3)],
    note: "klinecharts' KDJ renders k, d AND j. Stochastic conventionally means "
        + 'K and D, so this drops the J figure rather than mislabelling three lines.',
  },
  {
    id: 'MFI', label: 'MFI', group: 'momentum', source: 'new', pane: 'own',
    paramSchema: [period('length', 'Length', 14)],
    note: 'Not a klinecharts builtin - EMV and VR are the nearest and neither is MFI.',
  },
  {
    id: 'DIVERGENCE', label: 'Divergence', group: 'momentum', source: 'new', pane: 'candle',
    paramSchema: [period('lookback', 'Lookback', 60, 10, 500)],
    note: 'Price/CVD and price/RSI divergence. marketStore already computes '
        + 'cvdDivergence; this is the chart rendering of it.',
  },

  /* -- Volatility -------------------------------------------------------- */
  {
    id: 'BOLL', label: 'Bollinger Bands', blurbKey: 'STRATEGY_BLURB_BOLL', group: 'volatility', source: 'builtin', pane: 'candle',
    paramSchema: [
      period('length', 'Length', 20),
      { kind: 'float', key: 'mult', label: 'Std dev', min: 0.5, max: 5, step: 0.1, default: 2 },
    ],
  },
  {
    id: 'ATR', label: 'ATR', group: 'volatility', source: 'new', pane: 'own',
    paramSchema: [period('length', 'Length', 14)],
    note: 'No ATR builtin. Already computed for Supertrend and the backtest engine.',
  },
  {
    id: 'KELTNER', label: 'Keltner', group: 'volatility', source: 'new', pane: 'candle',
    paramSchema: [
      period('length', 'Length', 20),
      { kind: 'float', key: 'mult', label: 'ATR mult', min: 0.5, max: 5, step: 0.1, default: 2 },
    ],
  },

  /* -- Volume & flow ----------------------------------------------------- */
  {
    id: 'VWAP', label: 'VWAP', group: 'flow', source: 'new', pane: 'candle',
    paramSchema: [{ kind: 'enum', key: 'anchor', label: 'Anchor', options: ['session', 'day', 'week'], default: 'session' }],
    note: 'marketStore already carries vwap per coin; this draws it.',
  },
  {
    id: 'RVOL', label: 'RVOL', group: 'flow', source: 'new', pane: 'own',
    paramSchema: [period('length', 'Baseline', 30)],
    note: 'Relative volume against a rolling baseline. volRatio exists in CoinData.',
  },
  {
    id: 'ABSORPTION', label: 'Absorption', group: 'flow', source: 'new', pane: 'candle',
    paramSchema: [period('lookback', 'Lookback', 20, 5, 200)],
    note: 'Pro. components/AbsorptionDetector.tsx already computes this.',
  },
  {
    id: 'CVD', label: 'CVD', group: 'flow', source: 'new', pane: 'own',
    paramSchema: [],
    note: 'Cumulative volume delta. CoinData.cvd is already populated.',
  },

  /* -- Levels ------------------------------------------------------------ */
  {
    id: 'LIQ_CLUSTERS', label: 'Liq clusters', group: 'levels', source: 'overlay', pane: 'candle',
    paramSchema: [period('top', 'Show top', 8, 1, 50)],
    note: 'liqClusterLine overlay, already registered.',
  },
  {
    id: 'SR', label: 'S/R', group: 'levels', source: 'overlay', pane: 'candle',
    paramSchema: [period('top', 'Show top', 6, 1, 50)],
    note: 'srLevelLine overlay, already registered.',
  },
  {
    id: 'GEX', label: 'GEX', group: 'levels', source: 'overlay', pane: 'candle',
    paramSchema: [period('top', 'Show top', 6, 1, 50)],
    note: 'gexLevelLine overlay, already registered.',
  },
];

/** How many indicators a tier may combine.
 *
 *  ONE DIMENSION, NOT TWO. An earlier draft carried a timeframe limit as well,
 *  taken from the reference product. It is withdrawn from v1 deliberately: a
 *  second timeframe means the read CONSIDERS two timeframes at once, which
 *  changes what the scorer does rather than what the panel shows, and bolting
 *  that onto a layout change is how #853 reached two reverts. Multi-timeframe
 *  is its own issue once this panel exists.
 *
 *  Free gets one rather than none so the control is usable rather than a locked
 *  card - the read still runs, it just cannot combine. */
/* PRO (AND TRIAL) ARE UNLIMITED SINCE #1263, owner-approved: Pro turns on every indicator together,
 * with no counter. The cap now applies only to Free (one at a time, tap-to-swap). The data says so
 * in ONE place - `pro: Infinity` - rather than leaving `pro: 3` with a comment explaining it is no
 * longer the cap, which is the "true on one axis, stale on the other" trap. `Infinity` is the honest
 * encoding of "no cap": `used >= Infinity` is always false, so an entitled account is never at the
 * limit and the panel shows "{n} on" rather than "n of m used".
 *
 * NOTE TO QA: `indicatorLimit(true)` and `LIMITS.pro` are now Infinity, not 3 - the assertions that
 * pinned either to 3 (strategyRegistry.test.mts, strategyChipsOneSource.test.mts) need re-deriving. */
export const LIMITS = { pro: Infinity, free: 1 } as const;

export function indicatorLimit(entitled: boolean): number {
  return entitled ? LIMITS.pro : LIMITS.free;
}

/* CHART OVERLAYS vs INDICATORS (owner, 2026-10-07: "the indicator is on the chart but it's not selected in the selectors").
   Four entries are `source: 'overlay'`: the EMA ribbon, S/R, liquidation clusters and GEX. The chart draws them from its own
   data, not from the saved selection, so they were always on and the chip could never say so. They are layers, not indicators:
   they do not use one of the plan's indicator slots (Free 1, Pro 3), and the cap counts only the entries that do. */
export function isOverlayId(id: string): boolean {
  return findIndicator(id)?.source === 'overlay';
}
/** The ids in a selection that use an indicator slot (everything except the chart overlays). */
export function slottedIds(ids: readonly string[]): readonly string[] {
  return ids.filter(id => !isOverlayId(id));
}

/* What each overlay chip shows, derived from the SAME values the chart draws from, so the two cannot drift:
     always - drawn whatever the user does (the EMA ribbon; GEX where its levels exist)
     on/off - has a toggle (the chart toolbar's S/R and Liq buttons); the chip and the toolbar are one switch
     none   - not drawn for this coin (GEX off BTC, Liq with no clusters), so the chip says so and does nothing */
export type OverlayState = 'always' | 'on' | 'off' | 'none';
export type OverlayId = 'EMA_RIBBON' | 'SR' | 'LIQ_CLUSTERS' | 'GEX';
export function overlayStates(i: { showSR: boolean; showLiq: boolean; hasLiq: boolean; hasGex: boolean }): Record<OverlayId, OverlayState> {
  return {
    EMA_RIBBON: 'always',
    SR: i.showSR ? 'on' : 'off',
    LIQ_CLUSTERS: !i.hasLiq ? 'none' : i.showLiq ? 'on' : 'off',
    GEX: i.hasGex ? 'always' : 'none',
  };
}

/* WHAT THE STRATEGY PANEL CALLS THE VIEWER (owner, 2026-10-07: a visitor with no account was shown "FREE"). A signed-out visitor has
   no plan, so the panel must not name one. They can still pick indicators up to the Free cap (1; the selection is not saved),
   so the count stays and only the plan name goes. While auth or the subscription read is unsettled, nothing is claimed. */
export function strategyPlanLabel(i: { signedIn: boolean; authLoading: boolean; entitlementStatus: 'entitled' | 'not_entitled' | 'unknown' }): { head: string; countPrefix: string; plan: 'pro' | 'free' | 'signed_out' | 'unknown' } {
  if (i.authLoading) return { head: '···', countPrefix: '', plan: 'unknown' };
  if (!i.signedIn) return { head: 'SIGNED OUT', countPrefix: '', plan: 'signed_out' };
  if (i.entitlementStatus === 'entitled') return { head: 'PRO', countPrefix: 'PRO · ', plan: 'pro' };
  if (i.entitlementStatus === 'unknown') return { head: '···', countPrefix: '', plan: 'unknown' };
  return { head: 'FREE', countPrefix: 'FREE · ', plan: 'free' };
}

export function byGroup(group: Group): readonly IndicatorEntry[] {
  return INDICATORS.filter(i => i.group === group);
}

export function findIndicator(id: string): IndicatorEntry | undefined {
  return INDICATORS.find(i => i.id === id);
}

/** Builtins whose pane the chart ALWAYS draws (KLineProChart creates the RSI-14 pane on init). Selecting their chip must not draw a
 *  second pane: owner, 2026-10-08, "one RSI pane per user, always". The chip stays a real choice because it also puts RSI in the
 *  verdict (lib/useEMAStrategy.ts), but the chart sync skips these ids. VOL is also a default pane but has no chip. */
export const DEFAULT_PANE_INDICATORS: ReadonlySet<string> = new Set(['RSI']);

/** Default parameter values for an entry, straight from its schema. */
export function defaultParams(entry: IndicatorEntry): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of entry.paramSchema) out[p.key] = p.default;
  return out;
}

/** Per-indicator adapters from this registry's params shape to klinecharts'
 *  `calcParams` array, for the entries that need a conversion beyond schema
 *  order. Keyed by `entry.id` so adding an eighth wired indicator later
 *  touches one new case here, not a shared conditional. Currently one row:
 *
 *  klinecharts divides PSAR's three params by 100 internally
 *  (`stopAndReverse.calc`: `startAf = params[0] / 100`, `step = params[1] /
 *  100`, `maxAf = params[2] / 100` - verified against the compiled source,
 *  #1007). This registry's displayed/edited values (0.02/0.02/0.2) are true
 *  units, matching what a trader reading "Start 0.02" expects them to mean -
 *  so this multiplies back up before the values reach `createIndicator` or
 *  `overrideIndicator`. Left silent here would mean the first parameter edit
 *  a trader makes to PSAR runs it 100x too slow: a trail that hugs price and
 *  never flips, reading as a calm market rather than a bug (#1008). */
const CALC_PARAM_ADAPTERS: Partial<Record<string, (raw: number[]) => number[]>> = {
  SAR: raw => raw.map(v => v * 100),
};

/** Converts this entry's edited (or default) params into the `calcParams`
 *  array klinecharts' `createIndicator`/`overrideIndicator` expect, in the
 *  order `paramSchema` declares - see #1008 (Pro parameter edits reaching
 *  nothing) and the wiring plan on that issue. Only meaningful for a
 *  `source: 'builtin'` entry; harmless to call on anything else since it just
 *  reads `paramSchema`, which may be empty. */
export function toCalcParams(
  entry: IndicatorEntry,
  params?: Record<string, string | number | boolean>,
): number[] {
  const p = params ?? defaultParams(entry);
  const raw = entry.paramSchema.map(spec => {
    const v = p[spec.key] ?? spec.default;
    return typeof v === 'number' ? v : Number(v);
  });
  return CALC_PARAM_ADAPTERS[entry.id]?.(raw) ?? raw;
}

/* The strategy sets offered by the dropdown.
 *
 * `auto` IS FIRST AND IS THE DEFAULT, and it is a real state rather than an
 * empty one: no chips selected, no params box, counter at 0. The owner's reason
 * is that not every trader has their own strategy, so the read choosing for
 * itself has to be the thing that happens when you do nothing.
 *
 * Selecting any chip switches the set to `custom` on its own - a user should not
 * have to change the dropdown before they are allowed to touch a chip. */
export interface StrategySet {
  id: string;
  label: string;
  indicators: readonly string[];
}

export const AUTO_SET_ID = 'auto';
export const CUSTOM_SET_ID = 'custom';

export const STRATEGY_SETS: readonly StrategySet[] = [
  { id: AUTO_SET_ID, label: 'Let the read choose', indicators: [] },
  /* THE THREE OLD PRESETS (Liquidity Sweep, Trend Follow, Mean Reversion) ARE REMOVED (owner decision 2026-11-14, option A: one strategy menu). The seven strategies in lib/strategies sit
     between these two entries in the panel's dropdown. A user whose saved chips matched an old preset keeps those chips and the menu shows Custom: the menu's value is derived from the saved
     strategy id and the chips, so nothing they saved is lost or rewritten. */
  { id: CUSTOM_SET_ID,     label: 'Custom',          indicators: [] },
];

/** A one-line description of a selection, for a Grok prompt.
 *
 *  WHY A HELPER RATHER THAN INLINE JOINING. Three consumers need this sentence
 *  - QUICK, DEEP and ASK AI - and they build their prompts in different files.
 *  Three copies would drift, and a prompt that drifts is a change to what the
 *  model is told that nothing tests.
 *
 *  Returns null for an empty selection rather than an empty string, so a caller
 *  cannot accidentally append "the trader is watching: " with nothing after it.
 *  The empty case is "let the read choose", which means saying nothing extra. */
export function describeSelection(ids: readonly string[]): string | null {
  if (!ids.length) return null;
  const names = ids
    .map(id => findIndicator(id))
    .filter((e): e is IndicatorEntry => Boolean(e))
    /* #1263: an indicator that cannot draw must not be NAMED TO THE MODEL either. This is the one
       path by which a dead id still reached the AI: the chip has refused the click since 3a46aae2
       (PM/DevOps's #967 ruling), but a `strategy_selection` row written BEFORE that is read straight
       out of the account and described here, so the prompt would say "the trader has chosen to weigh
       ADX" with no ADX value anywhere in the context. The model is then invited to reason from a
       number it was never given - an absent input presented as a deliberate choice.

       Latent rather than live: 0 production rows carry any of the twelve, measured 2026-11-08. Filtered
       anyway, because the cost is one line and the alternative is that it stays true until someone
       writes such a row by hand. A selection of ONLY dead ids returns null, so the carrier sentence is
       omitted rather than emitted empty. */
    .filter(canRender)
    /* THE `basis` BRANCH IS UNREACHABLE AS OF THIS FILTER, and is kept rather than deleted. Both
       entries that carry a basis - ADX (DMI) and STOCH (KDJ) - are `source: 'new'`, so canRender
       excludes them and no surviving entry has one. Keeping it means the label is already right the
       day either is implemented; deleting it would quietly drop the distinction and whoever ships ADX
       would have to rediscover that its displayed name is not what is computed. Recorded because an
       unreachable branch that reads as live is the thing this file's own comments keep warning about
       - see __tests__/strategyRegistry, whose derived-entry cell uses ADX and therefore now has no
       real fixture. */
    .map(e => (e.basis ? `${e.label} (from ${e.basis})` : e.label));
  if (!names.length) return null;
  return names.join(', ');
}

/** Whether selecting this entry actually draws anything on the chart today.
 *
 *  A `builtin` is handed to klinecharts' `createIndicator`; an `overlay` is
 *  already drawn from its own prop. A `new` entry has no calculation yet, so
 *  selecting it would accept the click and do nothing.
 *
 *  THIS EXISTS TO BE SHOWN, NOT TO SILENTLY FILTER. The 21 chips in 5 groups
 *  are the approved design and the list stays whole - what changes is that the
 *  twelve which cannot draw say so, in the accessible name as well as visually.
 *  A chip that accepts a click and does nothing is the same silent-failure shape
 *  as a check that cannot fail, and it would be sitting on the owner's own
 *  screen.
 *
 *  Derived from `source` rather than stored as its own flag: a flag can disagree
 *  with reality, and __tests__/strategyRegistry pins the source split against
 *  the names klinecharts actually ships.
 *
 *  TOTAL OVER `Source` RATHER THAN `!== 'new'` (#1263). A negated comparison silently answers `true`
 *  for a source nobody has considered: add a fourth kind and every caller treats it as renderable
 *  without a word from the compiler. A Record over the union makes the omission a build error
 *  instead, which is the same reason the pattern maps were made total. The values are the whole
 *  decision and they are one line each, so the next person adding a source has to answer the
 *  question rather than inherit an answer. */
const SOURCE_RENDERS: Record<Source, boolean> = {
  builtin: true,   // handed to klinecharts' createIndicator
  overlay: true,   // already drawn from its own prop
  new: false,      // no calculation exists yet
};

export function canRender(entry: IndicatorEntry): boolean {
  return SOURCE_RENDERS[entry.source];
}

/* THE SELECTABLE INDICATORS (#1263): the builtins that draw AND are not the always-on RSI pane -
 * SMA, PSAR, MACD, Bollinger. RSI is a chart layer now, not a selectable chip, so it is excluded
 * here even though it is a `builtin`. The panel renders this array; the page filters a saved
 * selection to these ids so a stale RSI (or a since-removed id) from an old saved set neither counts,
 * labels, nor reaches the read's non-empty weighting branch.
 *
 * DEFINED HERE, AFTER canRender AND SOURCE_RENDERS, NOT beside slottedIds above. It calls canRender,
 * whose body reads the `const SOURCE_RENDERS`; placed earlier, this module-level initializer ran
 * while SOURCE_RENDERS was still in its temporal dead zone and threw a ReferenceError at import -
 * which tsc does not see but the test suite caught at once. Function hoisting makes canRender
 * callable early; it does not initialize the const its body reads. */
export const SELECTABLE_INDICATORS: readonly IndicatorEntry[] =
  INDICATORS.filter(e => e.source === 'builtin' && canRender(e) && e.id !== 'RSI');
export const SELECTABLE_INDICATOR_IDS: ReadonlySet<string> = new Set(SELECTABLE_INDICATORS.map(e => e.id));

/** Keep only the ids this panel can actually offer as selectable indicators (drops a stale RSI or a
 *  removed id from an old saved selection). Order preserved. */
export function selectableIds(ids: readonly string[]): readonly string[] {
  return ids.filter(id => SELECTABLE_INDICATOR_IDS.has(id));
}
