/* The EMA checklist rows' hover titles, as label keys (#1185).
 *
 * Each row of the checklist carries an English `detail` sentence. That sentence is what the AI
 * prompt is built from (components/EMASignal.tsx, app/(main)/arena/page.tsx), so it stays English
 * and is not touched. The same sentence was also the row's hover title whenever the row cannot be
 * explained (no coin, still loading, locked), which showed English to every reader.
 *
 * These helpers pick the label key (and its numbers) that says the same thing in the reader's
 * language. They mirror the branches that build `detail` in lib/useEMAStrategy.ts, one key per
 * sentence; the English default of each key equals the sentence the engine writes.
 *
 * No React, no fetch: pure functions over the numbers the hook already holds, so a test can drive
 * every branch.
 */
import type { LabelKey } from './labelKeys.ts';
import { coinHasFundingSource } from './fundingDetail.ts';

export interface DetailRef {
  detailKey: LabelKey;
  detailVars?: Record<string, string | number>;
}

type Fmt = (n: number) => string;

export function sma200Ref(a: {
  have200D: boolean; above200D: boolean; counterTrend: boolean;
  cur: string; priceD: number; sma200: number | null; fmt: Fmt;
}): DetailRef {
  if (!a.have200D) return { detailKey: 'EMA_ROW_SMA200_NO_DATA' };
  const vars = { price: `${a.cur}${a.fmt(a.priceD)}`, sma: `${a.cur}${a.sma200 !== null ? a.fmt(a.sma200) : '-'}` };
  if (a.above200D) return { detailKey: a.counterTrend ? 'EMA_ROW_SMA200_ABOVE_VS_SHORT' : 'EMA_ROW_SMA200_ABOVE_LONGS', detailVars: vars };
  return { detailKey: a.counterTrend ? 'EMA_ROW_SMA200_BELOW_VS_LONG' : 'EMA_ROW_SMA200_BELOW_SHORTS', detailVars: vars };
}

export function ribbonRef(a: { ribbonBull: boolean; ribbonBear: boolean; ema9: number; ema20: number; ema50: number; fmt: Fmt }): DetailRef {
  if (!a.ribbonBull && !a.ribbonBear) return { detailKey: 'EMA_ROW_RIBBON_TANGLED' };
  return {
    detailKey: a.ribbonBull ? 'EMA_ROW_RIBBON_BULL' : 'EMA_ROW_RIBBON_BEAR',
    detailVars: { e9: a.fmt(a.ema9), e20: a.fmt(a.ema20), e50: a.fmt(a.ema50) },
  };
}

export function crossRef(a: { judgeLong: boolean; ema9: number; ema20: number; fmt: Fmt }): DetailRef {
  const detailVars = { e9: a.fmt(a.ema9), e20: a.fmt(a.ema20) };
  if (a.judgeLong) return { detailKey: a.ema9 > a.ema20 ? 'EMA_ROW_CROSS_BULL_YES' : 'EMA_ROW_CROSS_BULL_WAIT', detailVars };
  return { detailKey: a.ema9 < a.ema20 ? 'EMA_ROW_CROSS_BEAR_YES' : 'EMA_ROW_CROSS_BEAR_WAIT', detailVars };
}

export function closeRef(a: { judgeLong: boolean; price: number; ema50: number; cur: string; fmt: Fmt }): DetailRef {
  const detailVars = { close: `${a.cur}${a.fmt(a.price)}`, e50: `${a.cur}${a.fmt(a.ema50)}` };
  if (a.judgeLong) return { detailKey: a.price > a.ema50 ? 'EMA_ROW_CLOSE_LONG_YES' : 'EMA_ROW_CLOSE_LONG_WAIT', detailVars };
  return { detailKey: a.price < a.ema50 ? 'EMA_ROW_CLOSE_SHORT_YES' : 'EMA_ROW_CLOSE_SHORT_WAIT', detailVars };
}

export function zoneRef(inValueZone: boolean): DetailRef {
  return { detailKey: inValueZone ? 'EMA_ROW_ZONE_IN' : 'EMA_ROW_ZONE_OUT' };
}

/** Mirrors fundingDetail() in lib/fundingDetail.ts, state for state. */
export function fundingRef(coin: string, fundingRate: number | null, fundingOK: boolean | null, feedGraceOver: boolean): DetailRef {
  if (fundingRate != null) {
    return { detailKey: fundingOK ? 'EMA_ROW_FUNDING_SAFE' : 'EMA_ROW_FUNDING_EXCESSIVE', detailVars: { pct: (fundingRate * 100).toFixed(4) } };
  }
  if (!coinHasFundingSource(coin)) return { detailKey: 'EMA_ROW_FUNDING_UNAVAILABLE' };
  return { detailKey: feedGraceOver ? 'EMA_ROW_FUNDING_UNAVAILABLE' : 'EMA_ROW_FUNDING_LOADING' };
}

export function oiDetailRef(oiPct: number | null | undefined, oiOK: boolean | null): DetailRef {
  if (oiPct == null) return { detailKey: 'EMA_ROW_OI_UNAVAILABLE' };
  return { detailKey: oiOK ? 'EMA_ROW_OI_OK' : 'EMA_ROW_OI_DROP', detailVars: { pct: `${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}` } };
}

export function volumeRef(volma20: number, lastVol: number): DetailRef {
  if (!(volma20 > 0)) return { detailKey: 'EMA_ROW_VOL_UNAVAILABLE' };
  return {
    detailKey: 'EMA_ROW_VOL',
    detailVars: { vol: (lastVol / 1e6).toFixed(2), ma: (volma20 / 1e6).toFixed(2), pct: (lastVol / volma20 * 100).toFixed(0) },
  };
}

export type IndicatorRowKind = 'RSI' | 'SMA' | 'BOLL' | 'PSAR' | 'MACD';

const IND_KEYS: Record<IndicatorRowKind, { name: string; bullYes: LabelKey; bullNo: LabelKey; bearYes: LabelKey; bearNo: LabelKey; noAlign: LabelKey }> = {
  RSI:  { name: 'RSI',       bullYes: 'EMA_ROW_RSI_BULL_YES',  bullNo: 'EMA_ROW_RSI_BULL_NO',  bearYes: 'EMA_ROW_RSI_BEAR_YES',  bearNo: 'EMA_ROW_RSI_BEAR_NO',  noAlign: 'EMA_ROW_RSI_NOALIGN' },
  SMA:  { name: 'SMA',       bullYes: 'EMA_ROW_SMA_BULL_YES',  bullNo: 'EMA_ROW_SMA_BULL_NO',  bearYes: 'EMA_ROW_SMA_BEAR_YES',  bearNo: 'EMA_ROW_SMA_BEAR_NO',  noAlign: 'EMA_ROW_SMA_NOALIGN' },
  BOLL: { name: 'Bollinger', bullYes: 'EMA_ROW_BOLL_BULL_YES', bullNo: 'EMA_ROW_BOLL_BULL_NO', bearYes: 'EMA_ROW_BOLL_BEAR_YES', bearNo: 'EMA_ROW_BOLL_BEAR_NO', noAlign: 'EMA_ROW_BOLL_NOALIGN' },
  PSAR: { name: 'PSAR',      bullYes: 'EMA_ROW_PSAR_BULL_YES', bullNo: 'EMA_ROW_PSAR_BULL_NO', bearYes: 'EMA_ROW_PSAR_BEAR_YES', bearNo: 'EMA_ROW_PSAR_BEAR_NO', noAlign: 'EMA_ROW_PSAR_NOALIGN' },
  MACD: { name: 'MACD',      bullYes: 'EMA_ROW_MACD_BULL_YES', bullNo: 'EMA_ROW_MACD_BULL_NO', bearYes: 'EMA_ROW_MACD_BEAR_YES', bearNo: 'EMA_ROW_MACD_BEAR_NO', noAlign: 'EMA_ROW_MACD_NOALIGN' },
};

/**
 * The advisory indicator rows (RSI, SMA, Bollinger, PSAR, MACD) all read the same way: unavailable,
 * or a value plus whether it agrees with the ribbon. `bullAgrees` / `bearAgrees` are the indicator's
 * own agreement test for each ribbon direction, evaluated by the caller.
 */
export function indicatorRef(kind: IndicatorRowKind, a: {
  valid: boolean; ribbonBull: boolean; ribbonBear: boolean;
  bullAgrees: boolean; bearAgrees: boolean; vars: Record<string, string | number>;
}): DetailRef {
  const k = IND_KEYS[kind];
  if (!a.valid) return { detailKey: 'EMA_ROW_IND_UNAVAILABLE', detailVars: { name: k.name } };
  if (a.ribbonBull) return { detailKey: a.bullAgrees ? k.bullYes : k.bullNo, detailVars: a.vars };
  if (a.ribbonBear) return { detailKey: a.bearAgrees ? k.bearYes : k.bearNo, detailVars: a.vars };
  return { detailKey: k.noAlign, detailVars: a.vars };
}
