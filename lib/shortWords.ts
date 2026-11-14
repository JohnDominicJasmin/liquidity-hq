import type { LabelKey } from '@/lib/labelKeys';
import type { FundingBand } from '@/lib/marketStore';

/* THE SHORT ENGLISH WORDS THE DASHBOARD COMPUTED IN ENGLISH (#1651, PM). classifyFunding, computeSqueezeScore,
   alternative.me's Fear & Greed classification and lib/patterns.ts all return English strings that other code
   (colour classes, regexes, the Telegram sender, the AI prompt) keys off, so they stay English in the store.
   What a visitor READS goes through here: map the English word to a label key at the render site, and fall
   back to the English word for anything not listed, so a new pattern name never renders blank. */

type T = (key: LabelKey) => string;

export const FUNDING_BAND_KEY: Record<FundingBand, LabelKey> = {
  heavyPos: 'FUNDING_BAND_HEAVY_POS', mildPos: 'FUNDING_BAND_MILD_POS', neutral: 'FUNDING_BAND_NEUTRAL',
  mildNeg: 'FUNDING_BAND_MILD_NEG', heavyNeg: 'FUNDING_BAND_HEAVY_NEG',
};

const FNG_KEY: Record<string, LabelKey> = {
  'extreme fear': 'FNG_WORD_EXTREME_FEAR', 'fear': 'FNG_WORD_FEAR', 'neutral': 'FNG_WORD_NEUTRAL',
  'greed': 'FNG_WORD_GREED', 'extreme greed': 'FNG_WORD_EXTREME_GREED',
};
const SETUP_KEY: Record<string, LabelKey> = {
  'Balanced': 'SETUP_WORD_BALANCED', 'Short squeeze ↑': 'SETUP_WORD_SQUEEZE', 'Long liquidation risk ↓': 'SETUP_WORD_FLUSH',
};
const PATTERN_KEY: Record<string, LabelKey> = {
  'Double top': 'PATTERN_DOUBLE_TOP', 'Double bottom': 'PATTERN_DOUBLE_BOTTOM',
  'Bull flag': 'PATTERN_BULL_FLAG', 'Bear flag': 'PATTERN_BEAR_FLAG',
  'Higher highs + higher lows': 'PATTERN_UPTREND', 'Lower highs + lower lows': 'PATTERN_DOWNTREND',
  'Bearish engulfing': 'PATTERN_BEARISH_ENGULFING', 'Bullish engulfing': 'PATTERN_BULLISH_ENGULFING',
  'Shooting star': 'PATTERN_SHOOTING_STAR', 'Hammer': 'PATTERN_HAMMER', 'Hanging man': 'PATTERN_HANGING_MAN',
  'Inverted hammer': 'PATTERN_INVERTED_HAMMER', 'Doji': 'PATTERN_DOJI', 'Tight consolidation': 'PATTERN_TIGHT_CONSOLIDATION',
};

export const fundingWord = (t: T, band: FundingBand): string => t(FUNDING_BAND_KEY[band]);
export const fngWord = (t: T, label: string | null | undefined): string => {
  const k = label ? FNG_KEY[label.trim().toLowerCase()] : undefined;
  return k ? t(k) : (label || '');
};
export const setupWord = (t: T, label: string): string => { const k = SETUP_KEY[label]; return k ? t(k) : label; };
/** `name` is the pattern as the sidebar and coin card show it (first pattern, text before any "(" removed). */
export const patternWord = (t: T, name: string | undefined | null): string => {
  if (!name) return '';
  const k = PATTERN_KEY[name]; return k ? t(k) : name;
};
