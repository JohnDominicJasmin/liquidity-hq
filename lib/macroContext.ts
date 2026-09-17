// Pure functions for the macro-context AI prompt, extracted from
// app/api/macro-context/route.ts so QA's unit tests can import them directly
// - a Next.js route file can't be `import`ed by `node --test` (TypeScript
// parameter properties and route-only exports aren't valid outside the
// framework's own build step). No behavior change from the extraction.

export interface MacroMetric { price: number; chg: number }

export function pctChange(price: number, prev: number) {
  return ((price - prev) / prev) * 100;
}

// #1309 item 11: takes each metric as `MacroMetric | null` (null = that
// feed's fetch failed) rather than always-present numbers. Only the
// available ones get a line in the prompt - a missing feed is named as
// unavailable instead of a fabricated number, and the model is told
// explicitly not to guess at it. Before this, a fetch failure silently fell
// back to a hardcoded stand-in (DXY 103.5, VIX 18, Gold 2350, Oil 78, 10Y
// 4.3) that was fed to the AI as if it were live data.
export function buildMacroPrompt(d: {
  dxy: MacroMetric | null; vix: MacroMetric | null; gold: MacroMetric | null;
  oil: MacroMetric | null; tnx: MacroMetric | null; goldOilRatio: number | null;
}): string {
  const fmt = (n: number, dec = 2) => n.toFixed(dec);
  const chgStr = (c: number) => (c >= 0 ? '+' : '') + c.toFixed(2) + '%';

  const lines: string[] = [];
  const unavailable: string[] = [];
  if (d.dxy) lines.push(`DXY (US Dollar Index): ${fmt(d.dxy.price)} (${chgStr(d.dxy.chg)} today)`); else unavailable.push('DXY');
  if (d.vix) lines.push(`VIX (Fear Index):       ${fmt(d.vix.price)} (${chgStr(d.vix.chg)} today)`); else unavailable.push('VIX');
  if (d.gold) lines.push(`Gold (XAU/USD):         $${fmt(d.gold.price, 0)} (${chgStr(d.gold.chg)} today)`); else unavailable.push('Gold');
  if (d.oil) lines.push(`WTI Oil:                $${fmt(d.oil.price, 1)} (${chgStr(d.oil.chg)} today)`); else unavailable.push('WTI Oil');
  if (d.tnx) lines.push(`10Y Treasury Yield:     ${fmt(d.tnx.price, 2)}% (${chgStr(d.tnx.chg)} today)`); else unavailable.push('10Y Treasury Yield');
  if (d.goldOilRatio != null) lines.push(`Gold/Oil Ratio:         ${fmt(d.goldOilRatio, 1)}x`);

  return [
    'You are a macro strategist specializing in crypto market correlations. Analyze the following macro indicators and classify the current macro backdrop for crypto traders.',
    '',
    '=== CURRENT MACRO DATA (live) ===',
    ...lines,
    ...(unavailable.length
      ? ['', `UNAVAILABLE (could not be fetched - do not assume a value or invent one for these): ${unavailable.join(', ')}.`]
      : []),
    '',
    '=== CLASSIFICATION TASKS ===',
    '',
    '1. MACRO_SIGNAL - Classify the CURRENT macro backdrop as exactly one of: RISK_ON, RISK_OFF, or NEUTRAL.',
    '   Base this on the composite picture: DXY direction, VIX level, gold vs oil behavior.',
    '   Format: "RISK_ON" or "RISK_OFF" or "NEUTRAL" - nothing else on this line.',
    '',
    '2. MACRO_ANALYSIS - In 3-4 sentences, explain WHY you classified it that way. What is each indicator telling you?',
    '   Which indicators are conflicting? What is the dominant narrative?',
    '',
    '3. CRYPTO_IMPLICATIONS - What does this macro backdrop mean specifically for BTC and crypto?',
    '   - Expected BTC behavior in this macro regime',
    '   - Key correlation to watch (DXY strength, VIX spike, etc.)',
    '   - Position sizing implication (increase, hold, reduce exposure?)',
    '',
    '4. WATCH_LEVEL - One specific macro level or threshold that would CHANGE the regime classification if crossed.',
    '',
    'Output using EXACTLY these headers:',
    'MACRO_SIGNAL:',
    '[RISK_ON or RISK_OFF or NEUTRAL]',
    'MACRO_ANALYSIS:',
    '[3-4 sentences]',
    'CRYPTO_IMPLICATIONS:',
    '[bullet points]',
    'WATCH_LEVEL:',
    '[one specific level/threshold]',
  ].join('\n');
}
