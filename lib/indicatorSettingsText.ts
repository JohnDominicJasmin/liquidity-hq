/* THE TRADER'S RSI AND EMA SETTINGS, AS ONE LINE FOR THE AI CHAT AND THE BRIEFING (#1651, owner sweep 2026-11-18).
 *
 * The Arena read already words its indicator readings with the trader's own settings (lib/useEMAStrategy.ts selectedReadings). The chat and the
 * briefing did not receive them, so they described RSI against 70 / 30 while the trader's chart drew other lines. These are the same saved values
 * (settings.strategy_params, keys RSI and EMA_RIBBON), clamped exactly as the chart and useEMAStrategy clamp them. Only settings that differ from
 * the defaults are named; all defaults gives undefined, so the prompt does not change for a trader who never touched them. */

type Params = Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>> | null | undefined;

function pi(p: Params, id: string, key: string, def: number, lo: number, hi: number): number {
  const v = p?.[id]?.[key];
  // A saved null, empty string or boolean is "not set", not 0 (Number(null) === 0 would clamp to the minimum and report "RSI length 2"; QA R5b).
  if (v == null || v === '' || typeof v === 'boolean') return def;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n))) : def;
}

/** The trader's RSI pane settings: length (default 14) and the overbought / oversold lines (70 / 30). */
export function rsiSettings(p: Params): { length: number; overbought: number; oversold: number } {
  return { length: pi(p, 'RSI', 'length', 14, 2, 100), overbought: pi(p, 'RSI', 'overbought', 70, 50, 95), oversold: pi(p, 'RSI', 'oversold', 30, 5, 50) };
}

/** "RSI length 21, overbought line 75, oversold line 25; EMA ribbon 8 / 21 / 55 / 200", naming only what differs from the defaults. */
export function describeIndicatorSettings(p: Params): string | undefined {
  const parts: string[] = [];
  const r = rsiSettings(p);
  if (r.length !== 14 || r.overbought !== 70 || r.oversold !== 30) {
    parts.push(`RSI length ${r.length}, overbought line ${r.overbought}, oversold line ${r.oversold}`);
  }
  const ema = [pi(p, 'EMA_RIBBON', 'e1', 9, 2, 400), pi(p, 'EMA_RIBBON', 'e2', 20, 2, 400), pi(p, 'EMA_RIBBON', 'e3', 50, 2, 400), pi(p, 'EMA_RIBBON', 'e4', 200, 2, 400)];
  if (ema.join(',') !== '9,20,50,200') parts.push(`EMA ribbon ${ema.join(' / ')}`);
  return parts.length ? parts.join('; ') : undefined;
}

/* THE EXACT SHAPE describeIndicatorSettings produces. The chat context arrives from the browser, so the server keeps the field only when it is this
   shape (lib/chatPrompt.ts parseChatContext); any other text is dropped and never reaches the system prompt (QA R7b). */
const RSI_PART = 'RSI length \\d{1,3}, overbought line \\d{2}, oversold line \\d{1,2}';
const EMA_PART = 'EMA ribbon \\d{1,3} / \\d{1,3} / \\d{1,3} / \\d{1,3}';
export const INDICATOR_SETTINGS_SHAPE = new RegExp(`^(?:${RSI_PART}(?:; ${EMA_PART})?|${EMA_PART})$`);

/** The instruction that goes with it: the RSI values in the data are RSI(14), so only the lines change how they are described. */
export const INDICATOR_SETTINGS_RULE =
  "The RSI values in this data are RSI(14). Describe overbought / oversold by the trader's own lines above, not 70 / 30. The trader's EMA lengths are their chart lines; no values are given for them here.";
