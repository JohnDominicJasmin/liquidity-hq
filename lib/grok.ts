import { getSupabase } from './supabase';

export interface GrokUsageInfo {
  deep_used:   number;
  deep_limit:  number;
  quick_used:  number;
  quick_limit: number;
}

/** Client-side proxy call — routes through /api/grok (key stays server-side, rate-limited). */
export async function callGrokViaProxy(
  prompt: string,
  tf: string,
  session: string,
  type: 'quick' | 'deep'
): Promise<{ result: CombinedResult; usage: GrokUsageInfo | null }> {
  const sb    = getSupabase();
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;

  const res = await fetch('/api/grok', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt, tf, session, type }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string; usage?: GrokUsageInfo };
    const msg = err.error ?? 'Grok proxy error';
    throw Object.assign(new Error(msg), { code: err.code, usage: err.usage });
  }

  return res.json() as Promise<{ result: CombinedResult; usage: GrokUsageInfo | null }>;
}

/** Fetch today's usage without running an analysis — call on page mount. */
export async function fetchGrokUsage(): Promise<GrokUsageInfo | null> {
  const sb    = getSupabase();
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
  if (!token) return null;
  try {
    const res = await fetch('/api/grok', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const { usage } = await res.json() as { usage: GrokUsageInfo | null };
    return usage;
  } catch { return null; }
}

export interface GrokContext {
  coin: string;
  price: string;
  change24h: string;
  fundingRate: string;
  openInterest: string;
  fearGreed: string;
  btcDominance: string;
  session: string;
  clusters: string;
  news: string;
  /* technicals */
  rsi14: string;
  ma20: string;
  priceVsMA: string;
  volRatio: string;
  longShortRatio: string;
  /* macro */
  oilPrice: string;
  bonds10y: string;
  /* upcoming events */
  upcomingEvents: string;
  /* ETF flows */
  etfFlows: string;
  /* multi-timeframe RSI */
  rsi1h: string;
  rsi4h: string;
  rsiDaily: string;
  /* cumulative volume delta */
  cvd: string;
  cvdDivergence: string; // 'Bullish divergence', 'Bearish divergence', or 'None'
  /* basis (perp premium vs spot) */
  basis: string;
  /* fibonacci nearest level */
  fibNearest: string;
  /* order book walls */
  orderWalls: string;
  /* Bollinger Squeeze score */
  squeezeScore: string;
  /* Deribit options */
  pcRatio: string;
  maxPain: string;
  /* Gamma Exposure (GEX) */
  btcGex: string;
  /* exchange & on-chain flows */
  exchangeNetFlow: string;
  stablecoinFlow: string;
  /* retail sentiment */
  googleTrends: string;
  /* liquidation clusters */
  liqLevels: string;
  /* BTC dominance trend */
  btcDomTrend: string;
  /* volume profile */
  pocLine: string;
  /* macro correlations */
  dxyLine: string;
  spxLine: string;
  goldLine: string;
  /* Taker Buy/Sell aggression ratio */
  takerRatio: string;
  /* Coinbase Premium Index */
  cbPremium: string;
  /* VWAP vs current price */
  vwap: string;
  /* OI Trend vs Price divergence */
  oiTrend: string;
  /* cross-exchange funding rate comparison */
  crossExchangeFunding: string;
}

export interface GrokResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  entry: string;
  reasoning: string;
}

export function buildPrompt(ctx: GrokContext): string {
  return [
    `You are LiquidityAI — an elite crypto derivatives trader and macro analyst. Your job is to synthesize ALL available data and output a high-conviction directional call for ${ctx.coin}.`,
    '',
    '=== PRICE ACTION ===',
    `Coin: ${ctx.coin}  |  Price: ${ctx.price}  |  24h Change: ${ctx.change24h}`,
    '',
    '=== TECHNICALS ===',
    `RSI (14, 15m): ${ctx.rsi14}`,
    `MA20 (15m): ${ctx.ma20}  |  Price vs MA20: ${ctx.priceVsMA}`,
    `Volume ratio (current/avg): ${ctx.volRatio}`,
    `Long/Short ratio: ${ctx.longShortRatio}`,
    '',
    '=== TECHNICALS (MULTI-TIMEFRAME) ===',
    `RSI (14, 1h):  ${ctx.rsi1h}`,
    `RSI (14, 4h):  ${ctx.rsi4h}`,
    `RSI (14, 1D):  ${ctx.rsiDaily}`,
    `CVD (last 200 trades):  ${ctx.cvd}`,
    `CVD Divergence:  ${ctx.cvdDivergence}`,
    `Fibonacci nearest level:  ${ctx.fibNearest}`,
    `Volume Profile POC/VAH/VAL:  ${ctx.pocLine}`,
    `VWAP (15m, 100 candles):  ${ctx.vwap}`,
    `Taker Buy/Sell ratio (last 5h):  ${ctx.takerRatio}`,
    '',
    '=== DERIVATIVES / POSITIONING ===',
    `Funding rate (Binance, single): ${ctx.fundingRate}`,
    `Cross-exchange funding (Binance | Bybit | OKX | Avg): ${ctx.crossExchangeFunding}`,
    '(Divergence between exchanges = different trader bases are positioned differently = potential flow imbalance or arb. Extreme positive = longs overcrowded = flush risk. Extreme negative = shorts overcrowded = squeeze risk.)',
    `Open Interest: ${ctx.openInterest}`,
    `OI Trend vs Price:  ${ctx.oiTrend}`,
    '',
    '=== DERIVATIVES — EXTENDED ===',
    `Basis (perp premium vs spot):  ${ctx.basis}`,
    `Squeeze score:  ${ctx.squeezeScore}`,
    '',
    '=== OPTIONS MARKET (DERIBIT) ===',
    `BTC Put/Call Ratio:  ${ctx.pcRatio}`,
    `BTC Max Pain Strike:  ${ctx.maxPain}`,
    '(Max pain = price where max option value is destroyed at expiry — acts as magnet)',
    `BTC Gamma Exposure (GEX):  ${ctx.btcGex}`,
    '(Positive GEX = dealers LONG gamma = buy dips/sell rips = price pins near large strikes. Negative GEX = dealers SHORT gamma = moves amplified = trending conditions. Zero-gamma flip level is key — crossing it changes dealer hedging direction.)',
    '',
    '=== COINBASE PREMIUM INDEX ===',
    `CB Premium (Coinbase BTC − Binance BTC):  ${ctx.cbPremium}`,
    '(Positive premium = US buyers paying above Binance = institutional demand = bullish. Negative = US selling = bearish.)',
    '',
    '=== ORDER BOOK LIQUIDITY ===',
    ctx.orderWalls,
    '',
    '=== MACRO ===',
    `US Oil (CL=F): ${ctx.oilPrice}`,
    `US 10Y Bond Yield: ${ctx.bonds10y}`,
    `DXY (US Dollar Index): ${ctx.dxyLine}`,
    `S&P 500: ${ctx.spxLine}`,
    `Gold (XAU/USD): ${ctx.goldLine}`,
    `BTC Dominance (trend): ${ctx.btcDomTrend}`,
    `Fear & Greed: ${ctx.fearGreed}`,
    '',
    '=== EXCHANGE & ON-CHAIN FLOWS ===',
    `BTC exchange net flow (24h):  ${ctx.exchangeNetFlow}`,
    `USDT+USDC stablecoin supply:  ${ctx.stablecoinFlow}`,
    '',
    '=== RETAIL SENTIMENT ===',
    `Google Trends 'Bitcoin' (7d):  ${ctx.googleTrends}`,
    '',
    '=== LIQUIDATION CLUSTERS ===',
    ctx.liqLevels,
    '',
    '=== UPCOMING ECONOMIC EVENTS ===',
    ctx.upcomingEvents || 'None in next 24h',
    '',
    '=== LIVE NEWS FEED (last 6 alerts — Finnhub + RSS) ===',
    ctx.news,
    '',
    '=== BTC + ETH SPOT ETF FLOWS ===',
    ctx.etfFlows,
    '(Positive net flow = institutional inflows = demand. Negative = outflows = distribution/de-risking.)',
    '',
    '=== SESSION ===',
    `Current session: ${ctx.session}`,
    '',
    '=== MOMENTUM REGIME FILTER — READ THIS BEFORE FORMING ANY BIAS ===',
    'Classify the current regime FIRST. Oscillators (RSI, CVD divergence) only matter INSIDE a regime — they do NOT override it.',
    '',
    'BEARISH MOMENTUM REGIME — present if 3 or more of these are true:',
    `  • 24h change worse than −8% → ${ctx.change24h}`,
    `  • Price below EMA9 AND EMA9 below EMA200 (check chart section below)`,
    `  • OI Trend is strong_down or weak_down → ${ctx.oiTrend}`,
    `  • Long/Short ratio > 1.8:1 → ${ctx.longShortRatio}`,
    `  • Taker sell > 55% → ${ctx.takerRatio}`,
    `  • Negative CB premium → ${ctx.cbPremium}`,
    `  • Price below VWAP → ${ctx.vwap}`,
    '',
    'IF IN BEARISH MOMENTUM REGIME:',
    '  • RSI oversold (< 30) = STRONG DOWNSIDE MOMENTUM — NOT a buy signal. It means sellers are dominant.',
    '  • CVD bullish divergence = absorption trap in a downtrend, NOT reversal confirmation.',
    '  • Fibonacci support / oversold RSI = possible brief pause ONLY — not reversal without a clear catalyst.',
    '  • Long/Short ratio > 1.8:1 during a selloff = overleveraged longs at FLUSH RISK = BEARISH, not bullish.',
    '  • DEFAULT to SHORT or FLAT. Only call LONG if you find a specific hard reversal catalyst (Trump tweet, Fed pivot, major news event).',
    '  • "Falling knife" rule: Never buy an asset that is down >8% in 24h and accelerating lower unless the catalyst for the move has been fully reversed.',
    '',
    'BULLISH MOMENTUM REGIME — present if 3 or more of these are true:',
    `  • 24h change better than +8% → ${ctx.change24h}`,
    `  • Price above EMA9 AND EMA9 above EMA200`,
    `  • OI Trend is strong_up → ${ctx.oiTrend}`,
    `  • Long/Short ratio < 0.8:1 (crowded shorts = squeeze risk)`,
    `  • Taker buy > 55% → ${ctx.takerRatio}`,
    '',
    'IF IN BULLISH MOMENTUM REGIME:',
    '  • RSI overbought (> 70) = STRONG UPSIDE MOMENTUM — not automatically a sell signal in a trending move.',
    '  • Short/Long ratio < 0.5:1 = overleveraged shorts at SQUEEZE RISK = BULLISH.',
    '',
    'NEUTRAL REGIME: No clear momentum. Apply all signals equally.',
    '',
    '=== LIVE SEARCH TASK ===',
    `Search RIGHT NOW for WHY ${ctx.coin} and crypto markets are moving today. Use web_search and x_search for:`,
    `1. Search "bitcoin price today why" and "crypto market news ${new Date().toISOString().slice(0,10)}" — find the ACTUAL catalyst behind today's price action.`,
    '2. War, conflict, sanctions, or geopolitical events in last 24h — search "war news crypto", "US strikes", "Russia Ukraine", "Middle East" on X and web.',
    '3. Any posts from @realDonaldTrump or @WhiteHouse on Bitcoin, crypto, tariffs, Fed, or interest rates.',
    '4. Fed, FOMC, CPI, PPI, Treasury statements from last 48h. Search "Fed crypto" and "interest rates".',
    '5. Latest BTC and ETH spot ETF flow updates (IBIT, FBTC, ARKB, BITB, ETHA, FETH, EZET).',
    '6. Any SEC, CFTC, or Congressional crypto bills or rulings.',
    '7. Any major exchange news (Binance, Coinbase, Bybit hacks, large liquidations, whale moves).',
    '8. Search X for "BTC" and "crypto" right now — what are traders saying is driving the move?',
    '',
    '=== YOUR ANALYSIS TASK ===',
    'STEP 1: Apply the MOMENTUM REGIME FILTER above to classify the regime (Bearish / Bullish / Neutral).',
    'STEP 2: Synthesize ALL data within that regime context. Do NOT let oscillators override the regime.',
    '',
    '1. TECHNICALS — REGIME-AWARE:',
    '   • In BEARISH REGIME: RSI oversold = strong downside momentum. EMA9 < EMA200 = bearish structure. Do NOT use oversold RSI as a buy trigger.',
    '   • In BULLISH REGIME: RSI overbought = strong upside momentum. EMA9 > EMA200 = bullish structure.',
    '   • Price vs MA20, EMA cross, volume confirmation still apply for timing entries.',
    '2. DERIVATIVES: Funding rate direction bias, OI trend vs price, long/short imbalance.',
    '   • Long/Short ratio > 1.8:1 during a DECLINE = crowded longs at flush risk = BEARISH signal, not bullish.',
    '   • Long/Short ratio < 0.6:1 during a RALLY = crowded shorts at squeeze risk = BULLISH signal.',
    '3. MACRO: Oil price direction (risk-on/off signal), bond yields (rising = risk-off), BTC dominance.',
    '4. ETF FLOWS: Net inflows = institutional accumulation (bullish). Net outflows = distribution (bearish). Large flows can drive 3–8% moves.',
    '5. NEWS & SOCIAL: Fed/FOMC statements, SEC rulings, inflation prints (CPI/PPI), geopolitical risk.',
    '6. TRUMP/WHITE HOUSE: Presidential posts or executive orders about crypto cause immediate 5–15% swings. Rate policy signals affect risk appetite.',
    '7. SENTIMENT: Fear & Greed extreme readings as contrarian signals — BUT only in NEUTRAL regime. In Bearish regime, extreme fear can persist.',
    '8. SESSION: NY session (high liquidity) vs Asia/London.',
    '9. FIBONACCI: In NEUTRAL regime, fib levels (61.8%, 38.2%) are high-probability reversal zones. In BEARISH REGIME, fib supports are likely to fail — treat them as pause zones only.',
    '10. ORDER FLOW (CVD): Positive CVD = net buying. Negative = selling pressure. In BEARISH REGIME, CVD bullish divergence is often a temporary absorption trap — require price confirmation before treating as reversal.',
    '11. OPTIONS (DERIBIT): P/C ratio > 1.2 = bearish positioning. Max pain acts as price magnet near expiry. Positive basis = healthy bull market.',
    '12. GEX (GAMMA EXPOSURE): Positive net GEX = dealers LONG gamma = range-bound/mean-reverting. Negative net GEX = moves amplified = trending/explosive volatility. Zero-gamma flip level crossing = regime shift.',
    '13. ORDER BOOK: Large bid walls = support. Large ask walls = resistance. Price often hunts walls before reversing.',
    '14. STABLECOIN FLOWS: Growing USDT+USDC supply = dry powder entering = bullish medium-term. Shrinking = cashing out.',
    '15. EXCHANGE FLOWS: BTC flowing INTO exchanges = sell pressure. Flowing OUT = accumulation.',
    '16. COINBASE PREMIUM: CB premium > +$30 = US institutions buying aggressively (strong bullish). Negative = US selling/risk-off.',
    '17. VWAP: Price above VWAP = institutions paying up (bullish). Price below VWAP = distributing (bearish).',
    '18. OI TREND: OI↑+Price↑ = real trend with conviction. OI↑+Price↓ = new short conviction. OI↓+Price↑ = short covering only (weak). OI↓+Price↓ = long exits (panic).',
    '19. TAKER RATIO: Taker buy >65% = aggressive buyers = real demand (bullish). Taker sell >65% = sellers dumping into bids = distribution/panic (bearish).',
    '',
    'Output in EXACTLY this format — no extra text before or after:',
    'SIGNAL: [LONG or SHORT or FLAT]',
    'CONFIDENCE: [0-100]',
    'ENTRY_ZONE: [specific price level or range]',
    'REASONING:',
    '[2-4 sentence analysis citing the specific signals that drove your decision. Name which technicals, macro factors, and news items matter most right now.]',
  ].join('\n');
}

// ── Indicator helpers (used by readMarket in Arena) ───────────────────────

export function calcEMA(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period) return out;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < n; i++) { ema = closes[i] * k + ema * (1 - k); out[i] = ema; }
  return out;
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return out;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0); losses.push(d < 0 ? -d : 0);
  }
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const rsi = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out[period] = rsi(ag, al);
  for (let i = period; i < n - 1; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    out[i + 1] = rsi(ag, al);
  }
  return out;
}

// ── Combined chart + market prompt ────────────────────────────────────────

export interface ChartData {
  tf: string;
  ema9: number | null;
  ema200: number | null;
  rsi: number | null;
  recent20: string;
  hi: number;
  lo: number;
  lastClose: number;
  detectedPatterns?: string; // algorithmically pre-detected basic patterns as context for Grok
}

export interface CombinedResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  entryLow: number | null;
  entryHigh: number | null;
  tp: number | null;
  sl: number | null;
  levels: { price: number; label: string; type: 'support' | 'resistance' }[];
  chartAnalysis: string;
  patterns: string[];   // detected chart patterns (e.g. "Bear flag", "H&S", etc.)
  reasoning: string;
  catalysts: string[];
  analyzedAt: number;
  tf: string;
  session: string;
}

export function buildCombinedPrompt(ctx: GrokContext, chart: ChartData): string {
  const base = buildPrompt(ctx);
  // Inject chart section + replace output format
  const splitAt = base.indexOf('Output in EXACTLY this format');
  const body = splitAt > -1 ? base.slice(0, splitAt) : base;

  const chartSection = [
    '=== CHART DATA (CANDLES + INDICATORS) ===',
    `Timeframe: ${chart.tf}  |  Last Close: $${chart.lastClose.toFixed(0)}`,
    `Range (visible 80 candles): High $${chart.hi.toFixed(0)} / Low $${chart.lo.toFixed(0)}`,
    `EMA 9:   ${chart.ema9   != null ? '$' + chart.ema9.toFixed(0)   : '—'}`,
    `EMA 200: ${chart.ema200 != null ? '$' + chart.ema200.toFixed(0) : '—'}`,
    `RSI(14): ${chart.rsi    != null ? chart.rsi.toFixed(1) + (chart.rsi >= 70 ? ' (Overbought)' : chart.rsi <= 30 ? ' (Oversold)' : ' (Neutral)') : '—'}`,
    `EMA cross: ${chart.ema9 != null && chart.ema200 != null ? (chart.ema9 > chart.ema200 ? 'EMA 9 ABOVE EMA 200 — bullish structure' : 'EMA 9 BELOW EMA 200 — BEARISH STRUCTURE (default to SHORT/FLAT)') : '—'}`,
    `Price vs EMA200: ${chart.ema200 != null ? (chart.lastClose > chart.ema200 ? `ABOVE EMA200 ($${chart.ema200.toFixed(2)}) — bullish` : `BELOW EMA200 ($${chart.ema200.toFixed(2)}) — bearish, do not call LONG without reversal catalyst`) : '—'}`,
    `Last 20 candles (OHLC): ${chart.recent20}`,
    chart.detectedPatterns ? `Pre-detected basic patterns: ${chart.detectedPatterns}` : '',
    '',
    'Cross-reference the candle key levels with order book walls, liquidation clusters, and derivatives data above.',
    'REMINDER: Apply the MOMENTUM REGIME FILTER above before deciding direction. If bearish regime is confirmed, SHORT or FLAT is the default — do not override with oscillators alone.',
    '',
    'CRITICAL: Output ONLY these exact lines, no markdown, no bold (**), no extra text:',
    'SIGNAL: [LONG or SHORT or FLAT]',
    'CONFIDENCE: [0-100]',
    'ENTRY_LOW: [number]',
    'ENTRY_HIGH: [number]',
    'TAKE_PROFIT: [number]',
    'STOP_LOSS: [number]',
    'LEVELS:',
    '- [price]: [label] | [support or resistance]',
    '- [price]: [label] | [support or resistance]',
    '- [price]: [label] | [support or resistance]',
    'CATALYSTS:',
    '- [war/geopolitical event, Trump announcement, Fed action, ETF flow, or major news driving price RIGHT NOW]',
    '- [second catalyst — must be specific, not generic]',
    '- [third catalyst if relevant]',
    'CHART_ANALYSIS: [1-2 sentences on candles and indicators only — no mention of macro here]',
    'PATTERNS:',
    '- [identify chart patterns from the candle data: e.g. "Bear flag", "Bull flag", "Head and shoulders", "Double top", "Double bottom", "Ascending triangle", "Descending triangle", "Rising wedge", "Falling wedge", "Bullish engulfing", "Bearish engulfing", "Doji reversal", "Higher highs / higher lows", "Lower highs / lower lows" — be specific with price context. Write "None detected" if no clear pattern]',
    'REASONING: [3-4 sentences combining chart + derivatives + macro + news into one directional thesis]',
  ].join('\n');

  return trimPlaceholders(body + '\n' + chartSection);
}

// Strip markdown bold/italic formatting Grok sometimes injects
function stripMd(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

/** Remove placeholder lines that tell Grok to search for data it already searches for.
 *  e.g. "Google Trends: Grok will search" → removed (LIVE SEARCH TASK already covers it)
 *  Also collapses any triple-blank-lines left behind. */
function trimPlaceholders(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.includes('Grok will search'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Match a field label that Grok may wrap in **bold**
function fieldRx(name: string): RegExp {
  return new RegExp('\\*{0,2}' + name + '\\*{0,2}:\\s*', 'i');
}

export function parseCombinedResponse(text: string, tf: string, session: string): CombinedResult {
  // Normalise: strip leading ** from every line so field detection works
  const clean = text.split('\n').map(l => l.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '')).join('\n');

  const pn = (s?: string): number | null => { const v = parseFloat((s ?? '').replace(/[,$]/g, '')); return isNaN(v) || v <= 0 ? null : v; };

  const signal     = (clean.match(/SIGNAL:\s*(LONG|SHORT|FLAT)/i)?.[1]?.toUpperCase() ?? 'FLAT') as CombinedResult['signal'];
  const confidence = parseInt(clean.match(/CONFIDENCE:\s*(\d+)/i)?.[1] ?? '0');
  const entryLow   = pn(clean.match(/ENTRY_LOW:\s*([\d,.]+)/i)?.[1]);
  const entryHigh  = pn(clean.match(/ENTRY_HIGH:\s*([\d,.]+)/i)?.[1]);
  const tp         = pn(clean.match(/TAKE_PROFIT:\s*([\d,.]+)/i)?.[1]);
  const sl         = pn(clean.match(/STOP_LOSS:\s*([\d,.]+)/i)?.[1]);

  const levels: CombinedResult['levels'] = [];
  const levSect = clean.match(/LEVELS:\s*\n([\s\S]*?)(?=CATALYSTS:|CHART_ANALYSIS:|REASONING:|$)/i)?.[1] ?? '';
  for (const line of levSect.split('\n')) {
    const m = line.match(/-\s*\$?([\d,.]+):\s*([^|]+)\|\s*(support|resistance)/i);
    if (m) { const p = pn(m[1]); if (p) levels.push({ price: p, label: m[2].trim(), type: m[3].toLowerCase() as 'support'|'resistance' }); }
  }

  const catalysts: string[] = [];
  const catSect = clean.match(/CATALYSTS:\s*\n([\s\S]*?)(?=CHART_ANALYSIS:|REASONING:|$)/i)?.[1] ?? '';
  for (const line of catSect.split('\n')) {
    const m = line.match(/^-\s*(.+)/);
    if (m) { const c = stripMd(m[1]); if (c) catalysts.push(c); }
  }

  // CHART_ANALYSIS — stop at PATTERNS or REASONING
  const chartAnalysis = stripMd(
    clean.match(/CHART_ANALYSIS:\s*([\s\S]*?)(?=\n\*{0,2}PATTERNS\*{0,2}:|\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? ''
  );

  // PATTERNS — list of detected chart patterns
  const patterns: string[] = [];
  const patSect = clean.match(/PATTERNS:\s*\n([\s\S]*?)(?=\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? '';
  for (const line of patSect.split('\n')) {
    const m = line.match(/^-\s*(.+)/);
    if (m) {
      const p = stripMd(m[1]);
      if (p && p.toLowerCase() !== 'none detected' && p.toLowerCase() !== 'none') patterns.push(p);
    }
  }

  // REASONING — handle **REASONING:** pattern
  const reasoning = stripMd(
    clean.match(/\*{0,2}REASONING\*{0,2}:\s*([\s\S]+)/i)?.[1] ?? ''
  );

  return { signal, confidence, entryLow, entryHigh, tp, sl, levels, catalysts, chartAnalysis, patterns, reasoning, analyzedAt: Date.now(), tf, session };
}

/* ── Quick prompt — strips the LIVE SEARCH TASK block (no web search needed) ── */
export function buildQuickPrompt(ctx: GrokContext, chart: ChartData): string {
  const full = buildCombinedPrompt(ctx, chart);
  const s = full.indexOf('\n=== LIVE SEARCH TASK ===');
  const e = full.indexOf('\n=== YOUR ANALYSIS TASK ===');
  if (s !== -1 && e !== -1) return full.slice(0, s) + full.slice(e);
  return full;
}

/* ── Quick call — /v1/chat/completions, no search tools, ~$0.003 ── */
export async function callGrokQuick(apiKey: string, prompt: string, tf: string, session: string): Promise<CombinedResult> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Grok API error: ${res.status} — ${(errJson as { error?: string })?.error ?? res.statusText}`);
  }
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return parseCombinedResponse(text, tf, session);
}

export async function callGrokCombined(apiKey: string, prompt: string, tf: string, session: string): Promise<CombinedResult> {
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      input: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Grok API error: ${res.status} — ${(errJson as {error?: string})?.error ?? res.statusText}`);
  }
  const data = await res.json();
  const msgItem = data.output?.find((o: { type: string }) => o.type === 'message');
  const text: string = msgItem?.content?.[0]?.text ?? '';
  return parseCombinedResponse(text, tf, session);
}

export function parseResponse(text: string): GrokResult {
  const result: GrokResult = { signal: 'FLAT', confidence: 0, entry: '—', reasoning: text };
  const sigMatch    = text.match(/SIGNAL:\s*(LONG|SHORT|FLAT)/i);
  const confMatch   = text.match(/CONFIDENCE:\s*(\d+)/i);
  const entryMatch  = text.match(/ENTRY_ZONE:\s*([^\n]+)/i);
  const reasonMatch = text.match(/REASONING:\s*([\s\S]+)/i);
  if (sigMatch)    result.signal     = sigMatch[1].toUpperCase() as GrokResult['signal'];
  if (confMatch)   result.confidence = parseInt(confMatch[1]);
  if (entryMatch)  result.entry      = entryMatch[1].trim();
  if (reasonMatch) result.reasoning  = reasonMatch[1].trim();
  return result;
}

export async function callGrok(apiKey: string, prompt: string): Promise<GrokResult> {
  // xAI Responses API — search_parameters deprecated, use tools array
  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-4.3',
      input: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search' },
        { type: 'x_search' },
      ],
    }),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Grok API error: ${res.status} — ${errJson?.error ?? res.statusText}`);
  }
  const data = await res.json();
  // Response format: data.output[] — find the message item, grab first text content
  const msgItem = data.output?.find((o: { type: string }) => o.type === 'message');
  const text: string = msgItem?.content?.[0]?.text ?? '';
  return parseResponse(text);
}
