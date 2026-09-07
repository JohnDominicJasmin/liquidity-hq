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
    id: 'SMA', label: 'SMA', group: 'trend', source: 'builtin', pane: 'candle',
    paramSchema: [period('length', 'Length', 12), period('weight', 'Weight', 2, 1, 10)],
    // id is correctly 'SMA' - klinecharts does ship an indicator by that
    // name (unlike ADX/STOCH, this is not a basis mismatch). The surprise is
    // one level deeper: what klinecharts' 'SMA' actually COMPUTES is not a
    // rolling mean - it's a recursive SMA(N,M) formula, verified against the
    // compiled source (node_modules/klinecharts/dist/index.esm.js,
    // simpleMovingAverage.calc). This file separately has a real rolling
    // mean (strategyCore.ts's smaArr, used for the 200D core gate) that a
    // reader could easily assume this chip shares. It does not. See
    // smaNMArr's doc in strategyCore.ts for the formula and the reasoning.
    // Found while wiring #985's SMA condition; not relabelled here since
    // that's design's call, not a wiring one.
    note: "klinecharts' SMA is SMA(N,M), recursive - not the rolling mean smaArr "
        + 'computes elsewhere in this codebase for the 200D gate. See the '
        + 'comment above and smaNMArr in strategyCore.ts.',
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
    id: 'SAR', label: 'PSAR', group: 'trend', source: 'builtin', pane: 'candle',
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
    paramSchema: [period('length', 'Length', 14)],
    note: 'calcParams [14], not the builtin 3-line [6,12,24] default - 14 is the '
        + 'period marketStore uses everywhere else (rsi14/rsi1h/rsi4h/rsiDaily).',
  },
  {
    id: 'MACD', label: 'MACD', group: 'momentum', source: 'builtin', pane: 'own',
    paramSchema: [period('fast', 'Fast', 12), period('slow', 'Slow', 26), period('signal', 'Signal', 9)],
    note: "MACD's fast line (period 12) is SMA(12,2), the exact same recursive formula "
        + "and period as this registry's own SMA entry at its default - selecting both is "
        + 'one signal doubled, not two independent ones (#1007). See macdArr in '
        + 'strategyCore.ts.',
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
    id: 'BOLL', label: 'Bollinger', group: 'volatility', source: 'builtin', pane: 'candle',
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
export const LIMITS = { pro: 3, free: 1 } as const;

export function indicatorLimit(entitled: boolean): number {
  return entitled ? LIMITS.pro : LIMITS.free;
}

export function byGroup(group: Group): readonly IndicatorEntry[] {
  return INDICATORS.filter(i => i.group === group);
}

export function findIndicator(id: string): IndicatorEntry | undefined {
  return INDICATORS.find(i => i.id === id);
}

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
  { id: 'liquidity_sweep', label: 'Liquidity Sweep', indicators: ['EMA_RIBBON', 'LIQ_CLUSTERS'] },
  /* SAR rather than ADX: a preset may only name indicators that actually
     draw, or choosing it selects a chip that then explains it cannot
     render - which is a worse first experience than a preset that works.
     ADX goes back in when it is implemented; the test below enforces it. */
  { id: 'trend_follow',    label: 'Trend Follow',    indicators: ['EMA_RIBBON', 'SAR'] },
  { id: 'mean_reversion',  label: 'Mean Reversion',  indicators: ['RSI', 'BOLL'] },
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
 *  the names klinecharts actually ships. */
export function canRender(entry: IndicatorEntry): boolean {
  return entry.source !== 'new';
}
