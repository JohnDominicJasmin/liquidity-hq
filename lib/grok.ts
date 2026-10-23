import { getAuthToken } from './supabase.ts';
import { nextResetLocalTime } from './resetTime.ts';
import { wilderRsiSeries } from './rsi.ts';
import { priceText } from './numberFormat.ts';

export interface GrokUsageInfo {
  deep_used:     number; deep_limit:     number;
  quick_used:    number; quick_limit:    number;
  chat_used:     number; chat_limit:     number;
  search_used:   number; search_limit:   number;
  briefing_used: number; briefing_limit: number;
  // Shared daily budget across all 11 one-shot AI tools (thesis check, pine
  // script, SMC snapshot, on-chain, ...). Pro-only - a 0 limit means this tier
  // has no pool (free is capped per tool instead), and the UI hides the ring.
  // Optional because a cached/in-flight response from before this field
  // existed would otherwise render NaN.
  tool_pool_used?:  number;
  tool_pool_limit?: number;
}

/** Client-side proxy call - routes through /api/grok (key stays server-side, rate-limited).
 *  getAuthToken(), not a raw getSession() - #1168. This backs Arena's QUICK/DEEP/ASK AI
 *  buttons, and the caller's own `finally` (which resets the loading spinner) never runs
 *  until this call settles - an unbounded getSession() here hung the button forever on a
 *  degraded auth backend, on the single most-used action in the app. */
export async function callGrokViaProxy(
  prompt: string,
  tf: string,
  session: string,
  type: 'quick' | 'deep',
  /** The coin the read is about (a coin id, e.g. 'xrp'). The server refuses Quick and Deep on a coin outside BTC/ETH/SOL for an account that
   *  has not paid (#1596); it cannot read the coin out of the prompt, so it is sent beside it. */
  coin?: string
): Promise<{ result: CombinedResult; usage: GrokUsageInfo | null }> {
  const token = await getAuthToken();

  const res = await fetch('/api/grok', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt, tf, session, type, coin }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string; usage?: GrokUsageInfo };
    // The Pro gate (#1263) answers 403 { error: 'PRO_REQUIRED', message } with the code in
    // `error`, not `code`. Passed on as a code so the caller can show its own labelled locked
    // state - used as the message it reached Arena's banner as the raw text "PRO_REQUIRED".
    if (res.status === 403 && err.error === 'PRO_REQUIRED') {
      throw Object.assign(new Error('PRO_REQUIRED'), { code: 'PRO_REQUIRED', usage: err.usage });
    }
    // #1596: refused because the coin is Pro-only for this account. Passed on as a code so the page shows its labelled line, not raw text.
    if (res.status === 403 && err.code === 'COIN_LOCKED') {
      throw Object.assign(new Error('COIN_LOCKED'), { code: 'COIN_LOCKED', usage: err.usage });
    }
    const msg = err.code === 'RATE_LIMIT'
      ? `${err.error ?? 'Rate limit reached.'} Resets at ${nextResetLocalTime()}.`
      : err.error ?? 'Grok proxy error';
    throw Object.assign(new Error(msg), { code: err.code, usage: err.usage });
  }

  /* The answer is checked here, once, because every reader downstream (the page's raid alert, the result card, the history, the saved
     signal) reads fields straight off `result`. A 200 whose body is `{}`, not JSON, or a result without a signal used to come back as
     `{ result: undefined }` and surface as the raw text "Cannot read properties of undefined (reading 'raidSetup')" (#1583). The real
     route cannot produce that (parseCombinedResponse always returns every field), so this guards a proxy, a cache, a stale deploy or a
     stub. A missing signal or confidence is REFUSED rather than defaulted: "unknown" must not be shown as FLAT or 0%. */
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  const b = (typeof body === 'object' && body !== null ? body : {}) as { result?: unknown; usage?: unknown };
  const result = normalizeCombinedResult(b.result, tf, session);
  if (!result) throw Object.assign(new Error(GROK_EMPTY_ANSWER_MESSAGE), { code: 'BAD_ANSWER' });
  return { result, usage: normalizeGrokUsage(b.usage) };
}

const USAGE_KEYS = ['deep_used', 'deep_limit', 'quick_used', 'quick_limit', 'chat_used', 'chat_limit', 'search_used', 'search_limit', 'briefing_used', 'briefing_limit'] as const;

/** The usage the page shows in its chips, or null. A partial object would put `undefined` into the counters (NaN, "undefined of undefined"), and
 *  null is the value every consumer already handles ("unknown" shows nothing rather than a false 0). */
export function normalizeGrokUsage(raw: unknown): GrokUsageInfo | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  for (const k of USAGE_KEYS) if (typeof u[k] !== 'number' || !Number.isFinite(u[k] as number)) return null;
  return raw as GrokUsageInfo;
}

/** Shown when the AI endpoint answered 200 but with nothing usable. Plain, no jargon, says what to do. */
export const GROK_EMPTY_ANSWER_MESSAGE = 'The AI read came back empty. Try again in a moment.';

/** #1651 item 3: shown when the answer named no verdict we can read, even after one retry. Never replaced by a default FLAT ("Wait"). */
export const GROK_UNREADABLE_ANSWER_MESSAGE = 'The AI answer did not give a clear verdict, so it is not shown. Try again in a moment.';

/** The SIGNAL and CONFIDENCE lines, shared by parseVerdict and parseCombinedResponse so the two can never read an answer differently.
 *  `\*{0,2}` after the colon: "**SIGNAL:** BEARISH" (bold label, value outside it) left "**" between the colon and the value after the
 *  line-edge strip, missed the match and was read as FLAT at 0% (#1651 item 3, found by its probe). */
const SIGNAL_LINE = /SIGNAL:\*{0,2}\s*(LEAN BULLISH|LEAN BEARISH|BULLISH|BEARISH|FLAT)/i;
const CONFIDENCE_LINE = /CONFIDENCE:\*{0,2}\s*(\d+)/i;

/** #1651 item 3: the verdict read STRICTLY - one of the five signals and a whole-number confidence 0-100 - or null. parseCombinedResponse
 *  reads the same two lines but falls back to FLAT and 0 when they are missing, so an answer the model wrote in the wrong shape used to be
 *  shown as a confident-looking "Wait". The route asks once more when this is null, then refuses. Same normalisation and patterns as
 *  parseCombinedResponse, so every answer that parsed before still parses. */
export function parseVerdict(text: string): { signal: CombinedResult['signal']; confidence: number } | null {
  const clean = text.split('\n').map(l => l.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '')).join('\n');
  const signal = clean.match(SIGNAL_LINE)?.[1]?.toUpperCase();
  const conf = clean.match(CONFIDENCE_LINE)?.[1];
  if (!signal || conf == null) return null;
  const confidence = parseInt(conf, 10);
  return confidence <= 100 ? { signal: signal as CombinedResult['signal'], confidence } : null;
}

/** #1651 item 3: the one retry. It asks the model to restate the verdict its OWN answer reached - not to analyse again, so it needs no
 *  search and no market data - and to say UNREADABLE rather than invent one. The answer is cut to 8,000 characters (a Deep answer is
 *  bounded at 2,000 output tokens, well inside that). */
export function buildVerdictRepairPrompt(answer: string): string {
  return [
    'Below is a market analysis. Restate the verdict it reaches in exactly two lines and nothing else:',
    'SIGNAL: one of BULLISH, LEAN BULLISH, FLAT, LEAN BEARISH, BEARISH',
    'CONFIDENCE: a whole number from 0 to 100',
    'Use only what the analysis itself concludes. Do not analyse the market again. If the analysis reaches no verdict, reply with the single word UNREADABLE.',
    '',
    '--- ANALYSIS ---',
    answer.slice(0, 8000),
  ].join('\n');
}

const SIGNALS: ReadonlyArray<CombinedResult['signal']> = ['BULLISH', 'LEAN BULLISH', 'FLAT', 'LEAN BEARISH', 'BEARISH'];
const strOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** A complete CombinedResult from whatever the endpoint sent, or null when it is not an answer at all. Missing LISTS and TEXT become empty
 *  (nothing to show is a true statement); a missing or invalid `signal` or `confidence` is NOT filled in (that would present an unknown
 *  as a real verdict), so the result is refused. */
export function normalizeCombinedResult(raw: unknown, tf: string, session: string): CombinedResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.signal !== 'string' || !SIGNALS.includes(r.signal as CombinedResult['signal'])) return null;
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) return null;
  const levels = Array.isArray(r.levels)
    ? (r.levels as unknown[]).filter((l): l is CombinedResult['levels'][number] => {
        const x = l as Record<string, unknown> | null;
        return !!x && typeof x.price === 'number' && Number.isFinite(x.price) && typeof x.label === 'string' && (x.type === 'support' || x.type === 'resistance');
      })
    : [];
  const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  const bias = r.bias === 'BULLISH' || r.bias === 'BEARISH' || r.bias === 'NEUTRAL' ? r.bias : null;
  const raidSetup = r.raidSetup === 'SHORT SQUEEZE' || r.raidSetup === 'LONG FLUSH' ? r.raidSetup : null;
  const c = r.counted as Record<string, unknown> | null | undefined;
  const counted = c && typeof c === 'object' && Number.isInteger(c.bullish) && Number.isInteger(c.bearish)
    ? { bullish: c.bullish as number, bearish: c.bearish as number } : null;
  /* #1631 A+D: carried only when the answer has them. A result from before them (a cache, a stub) has none, and "absent" is the true
     reading - an invented empty list would claim the server checked something it never saw. */
  const extra: Pick<CombinedResult, 'citations' | 'counted' | 'checks'> = {};
  if ('citations' in r) extra.citations = strings(r.citations).filter((u) => /^https?:\/\//.test(u)).slice(0, 10);
  if ('counted' in r) extra.counted = counted;
  if ('checks' in r) extra.checks = strings(r.checks);
  return {
    signal: r.signal as CombinedResult['signal'],
    confidence: Math.max(0, Math.min(100, r.confidence)),
    levels,
    chartAnalysis: strOrEmpty(r.chartAnalysis),
    patterns: strings(r.patterns),
    reasoning: strOrEmpty(r.reasoning),
    catalysts: strings(r.catalysts),
    waitFor: strOrNull(r.waitFor),
    bias,
    raidSetup,
    raidTarget: strOrNull(r.raidTarget),
    raidTrigger: strOrNull(r.raidTrigger),
    ...extra,
    analyzedAt: typeof r.analyzedAt === 'number' && Number.isFinite(r.analyzedAt) ? r.analyzedAt : Date.now(),
    tf: typeof r.tf === 'string' && r.tf ? r.tf : tf,
    session: typeof r.session === 'string' && r.session ? r.session : session,
  };
}

/** Fetch today's usage without running an analysis - call on page mount.
 *  getAuthToken(), not a raw getSession() - #1165/#1166 bounded it. This is
 *  mounted root-wide (GrokUsageProvider, in AppShell) for every signed-in
 *  visitor on every route, so an unbounded call here hangs the whole app,
 *  not just this feature. A timed-out token already falls through the same
 *  `if (!token) return null` path below as a genuinely missing one - the
 *  provider already renders nothing rather than a false "0 used" for a
 *  null usage (see GrokUsageProvider.tsx and every consumer's `if (!usage)`
 *  guard), so there is no silent-empty-quota risk here the way there was
 *  for loadPriceAlerts. */
export async function fetchGrokUsage(): Promise<GrokUsageInfo | null> {
  const token = await getAuthToken();
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
  bonds10y: string;   // US 10Y Treasury yield, nominal (#1631 C)
  real10y: string;    // US 10Y TIPS real yield, FRED DFII10 (#311)
  /* spot ETF net flows by US trading day, newest first, e.g. "2026-10-20 +$23.2M | 2026-10-19 +$526.7M" or "unavailable" (#1631 A) */
  etfFlows: string;
  ethEtfFlows: string;
  /* upcoming events */
  upcomingEvents: string;
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
  /* liquidation cascade */
  cascadeLine: string;
  /* whale net flow (last 1h, selected coin) */
  whaleFlow: string;
  /* liquidation clusters */
  liqLevels: string;
  /* BTC dominance trend */
  btcDomTrend: string;
  /* where capital sits between BTC and the alt complex - see lib/sectorRotation.ts */
  sectorRotation: string;
  /* latest market-structure break from price alone - see lib/priceAction.ts */
  structureBreak: string;
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
  /* Setup Scanner - squeeze risk score for selected coin */
  setupScan: string;
  /* Distribution score - big players taking profit into strength */
  distribution: string;
  /* OI 1h change from OI Spike Scanner */
  oi1hChange: string;
  /* Market Structure (4H BOS/CHoCH) */
  marketStructure: string;
  /* Absorption Detector (15M) */
  absorptionScore: string;
  /* Yen carry trade risk */
  yenWatch: string;
  /* Perps vs spot - is the move real buying or leverage (#340) */
  perpSpot: string;
  /* EMA Ribbon Strategy (Triple EMA 9/20/50, 4H) */
  emaStrategy: string;
  /* Anti-chop filters - ATR(14) buffer + EMA50 slope + EMA9/20 spread */
  emaATR:      string;
  ema50Slope:  string;
  /* WaveTrend (Cipher B) confirming layer - cross-from-extreme or divergence */
  waveTrend:   string;
}

export interface GrokResult {
  signal: 'BULLISH' | 'LEAN BULLISH' | 'FLAT' | 'LEAN BEARISH' | 'BEARISH';
  confidence: number;
  reasoning: string;
}

export function buildPrompt(ctx: GrokContext): string {
  /* #1631 B: BTC's option market (Deribit P/C, max pain, GEX) and the Coinbase BTC premium are BTC's own data. They were handed to every
     coin - with "WEIGHT GEX HEAVILY" - and a Pro XRP Deep read rested its "bearish regime" on BTC's premium. Only a BTC read gets them now. */
  const isBtc = /^BTC\b/i.test(ctx.coin);
  const btcOnly = (lines: string[]): string[] => (isBtc ? lines : []);
  return [
    `You are LiquidityAI - an elite crypto derivatives trader and macro analyst. Your job is to synthesize ALL available data and output a high-conviction directional call for ${ctx.coin}.`,
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
    `EMA Ribbon Strategy: ${ctx.emaStrategy}`,
    '(VERDICT KEY - LONG_SETUP: bullish ribbon 9>20>50 + daily above 200 SMA + price pulled back to 20 EMA value zone = high-probability long entry. SHORT_SETUP: reverse = high-probability short entry. TRENDING_LONG/BEARISH: ribbon aligned but price not yet in entry zone - directional bias, wait for pullback to value zone. FREEZE: ribbon is tangled (EMAs not stacked) or price broke through 50 EMA against trend = no clear bias, avoid new positions.)',
    /* #1631 D: the ribbon rules feed the ONE tier table (SIGNAL DECISION GUIDE) instead of defining tiers of their own. "Upgrade to
       BULLISH with 2 more signals" here, "3+ exhaustion signals + reversal candle" there, and GEX's "fade breakouts" were three
       definitions, and runs resolved them differently. */
    'EMA RIBBON - how it feeds the SIGNAL DECISION GUIDE below (the guide is the only place tiers are defined):',
    '  • LONG_SETUP → one bullish signal (+20 to the bullish case) AND a BULLISH trigger: price pulled back into the value zone. With 2+ other bullish signals the count reaches 3 → BULLISH.',
    '  • SHORT_SETUP → one bearish signal (+20 to the bearish case) AND a BEARISH trigger. With 2+ other bearish signals → BEARISH.',
    '  • TRENDING_LONG → one bullish signal (+10), NOT a trigger - price is not at the entry zone, so on its own it cannot make BULLISH.',
    '  • TRENDING_SHORT → one bearish signal (+10), NOT a trigger - on its own it cannot make BEARISH.',
    '  • FREEZE → subtract 15 from confidence. Ribbon is in consolidation. Prefer FLAT unless one side counts 4+ signals.',
    `EMA50 Slope (last 5 bars): ${ctx.ema50Slope}`,
    `ATR(14) buffer: ${ctx.emaATR}`,
    '(Anti-chop filters - ALL THREE must pass before treating any EMA signal as valid:',
    '  1. Slope: EMA50 must be sloping in the signal direction ≥ 0.1% over 5 bars. FLAT slope = ranging market = ignore the cross, call FREEZE.',
    '  2. ATR buffer: price must close beyond EMA50 by ≥ 35% of ATR(14). A 1-tick graze of EMA50 is noise. If the buffer is not cleared, the confirmation is rejected - do NOT call BULLISH/BEARISH on marginal EMA50 touches.',
    '  3. Ribbon spread: EMA9 and EMA20 must be ≥ 0.3% of price apart at signal confirmation. Tangled EMAs (tight spread) = chop = no signal. If the ribbon is visually overlapping, the cross is noise - do NOT call BULLISH/BEARISH, call FREEZE.)',
    `WaveTrend (Cipher B momentum): ${ctx.waveTrend}`,
    '(WaveTrend is a confirming layer, NOT a 4th mandatory anti-chop filter - it checks for a bullish/bearish divergence or a cross-from-oversold/overbought agreeing with the EMA signal direction. If it confirms, add +5 confidence. If it does not confirm, do not downgrade automatically - just note the momentum oscillator has not caught up yet.)',
    `Market Structure (4H): ${ctx.marketStructure}`,
    `Latest structure break (price action only): ${ctx.structureBreak}`,
    '(BOS = price took out the prior swing in the direction it was already going: continuation. CHoCH = it took one out AGAINST the prevailing swing structure: the first hint the trend may be turning. This is derived from swing highs and lows alone - it is INDEPENDENT of the EMA ribbon signal above, so when the two disagree, say so rather than resolving it silently. A break on above-average volume carries more weight than one that drifted through on light volume.)',
    '(BOS = Break of Structure = trend continuation in the same direction. CHoCH = Change of Character = structural reversal signal. A bearish CHoCH means the 4H trend just flipped bearish - strong bias filter against longs. A bullish CHoCH = trend just flipped bullish.)',
    `RSI (14, 1h):  ${ctx.rsi1h}`,
    `RSI (14, 4h):  ${ctx.rsi4h}`,
    `RSI (14, 1D):  ${ctx.rsiDaily}`,
    `CVD (last 200 trades):  ${ctx.cvd}`,
    `CVD Divergence:  ${ctx.cvdDivergence}`,
    `Absorption Detector (15M):  ${ctx.absorptionScore}`,
    '(Absorption = high volume + small candle bodies → big player absorbing orders. ACCUM = buyers absorbing sells, price should fall but holds → hidden accumulation. DISTRIB = sellers absorbing buys, price should rise but stalls → hidden distribution. Strong + CVD confirm + 1H confirm = high conviction.)',
    `Fibonacci nearest level:  ${ctx.fibNearest}`,
    `Volume Profile POC/VAH/VAL:  ${ctx.pocLine}`,
    `VWAP (15m, 100 candles):  ${ctx.vwap}`,
    `Taker Buy/Sell ratio (last 5h):  ${ctx.takerRatio}`,
    '',
    '=== DERIVATIVES / POSITIONING ===',
    `Funding rate (Binance, single): ${ctx.fundingRate}`,
    `Cross-exchange funding (Binance | Bybit | Avg): ${ctx.crossExchangeFunding}`,
    '(Divergence between exchanges = different trader bases are positioned differently = potential flow imbalance or arb. Extreme positive = longs overcrowded = flush risk. Extreme negative = shorts overcrowded = squeeze risk.)',
    `Open Interest: ${ctx.openInterest}`,
    `OI 1h Change: ${ctx.oi1hChange}`,
    `OI Trend vs Price (over the last 60 minutes, same window for OI and price):  ${ctx.oiTrend}`,
    '',
    '=== DERIVATIVES - EXTENDED ===',
    /* PRICE premium. Distinct from the ACTIVITY line in the MACRO block below,
       which is a volume ratio - both were called "perp vs spot" until #340 and
       a model handed both can reasonably contradict itself between them. */
    `Perp basis - PRICE premium of perps over spot: ${ctx.basis}`,
    `Squeeze score:  ${ctx.squeezeScore}`,
    `Setup Scanner: ${ctx.setupScan}`,
    '(Setup Scanner score 0-100: measures how overcrowded longs or shorts are. High Long Liq Risk = too many longs, whales incentivised to dump. High Short Squeeze = too many shorts, whales incentivised to pump.)',
    `Distribution score: ${ctx.distribution}`,
    '(Distribution score 0-100: how strongly flow says big players are taking profit INTO strength - CVD sellers into strength, open interest unwinding out of a rally, top traders leaning out of longs, retail still paying positive funding. Only computed after a 24h run-up. ≥70 = active distribution: strong caution on new longs, favour trailing stops / partial exits. 45-69 = early signs.)',
    '',
    ...btcOnly([
      '=== OPTIONS MARKET (DERIBIT) ===',
      `BTC Put/Call Ratio:  ${ctx.pcRatio}`,
      `BTC Max Pain Strike:  ${ctx.maxPain}`,
      '(Max pain = price where max option value is destroyed at expiry - acts as magnet)',
      `BTC Gamma Exposure (GEX):  ${ctx.btcGex}`,
      '(Positive GEX = dealers LONG gamma = buy dips/sell rips = price pins near large strikes. Negative GEX = dealers SHORT gamma = moves amplified = trending conditions. Zero-gamma flip level is key - crossing it changes dealer hedging direction.)',
      /* #1631 D: GEX says HOW price moves, not WHERE. Check 2 had a run read long gamma as "mean-reversion higher". It now decides one
         thing the tier table can use - whether a breakout counts - and never a direction. */
      'GEX SETS THE REGIME FOR BTC, NEVER THE DIRECTION: in LONG gamma, dealers suppress volatility so the market ranges - a breakout or BOS is expected to fade and counts as 0 signals, while the pullback triggers (LONG_SETUP / SHORT_SETUP) and fades at range extremes count normally (the max-pain pull is a tiebreaker near expiry only). In SHORT gamma, dealers amplify moves - breakouts are real and count as 1 signal each. Never write "mean-reversion higher" or "mean-reversion lower": GEX alone gives no direction. A conflict between GEX and another rule is settled by the PRECEDENCE list in the SIGNAL DECISION GUIDE.',
      '',
      '=== COINBASE PREMIUM INDEX ===',
      `CB Premium (Coinbase BTC/USD − exchange BTC/USDT converted to USD):  ${ctx.cbPremium}`,
      '(Positive premium = US buyers paying above Binance = institutional demand = bullish. Negative = US selling = bearish.)',
      '',
    ]),
    ...(isBtc ? [] : [`(BTC's options data, GEX and the Coinbase BTC premium are BTC's own market and are not given for ${ctx.coin}. Do not judge ${ctx.coin} by them.)`, '']),
    '=== ORDER BOOK LIQUIDITY ===',
    ctx.orderWalls,
    '',
    '=== MACRO ===',
    `US Oil (CL=F): ${ctx.oilPrice}`,
    `US 10Y Treasury yield (nominal): ${ctx.bonds10y}`,
    `US 10Y TIPS (real) yield (FRED DFII10): ${ctx.real10y}`,
    `DXY (US Dollar Index): ${ctx.dxyLine}`,
    `USD/JPY (Yen Carry Trade): ${ctx.yenWatch}`,
    /* Deliberately the SAME sentence the dashboard card shows. One vocabulary
       across every surface - if the model phrases this differently from the
       card, a user reading both sees two facts where there is one.
       Labelled ACTIVITY to keep it distinct from the basis line above, which is
       a price premium. They measure different things and can point opposite
       ways at the same moment. */
    `Perp vs spot ACTIVITY - trading volume, not price: ${ctx.perpSpot}`,
    `S&P 500: ${ctx.spxLine}`,
    `Gold (XAU/USD): ${ctx.goldLine}`,
    `BTC Dominance (trend): ${ctx.btcDomTrend}`,
    `Fear & Greed: ${ctx.fearGreed}`,
    '',
    '=== SECTOR ROTATION (BTC vs alts) ===',
    `${ctx.sectorRotation}`,
    '(Alts are a money-flow game: capital rotating into BTC drains the alt complex regardless of how clean an individual alt setup looks, and that headwind matters most in a bear market. Treat "capital rotating INTO BTC" as a real reason to downgrade conviction on an alt long even when its own technicals are constructive - and the reverse for alt longs during alt season. Volume/open-interest share shows whether a move has real participation behind it or is a thin bounce.)',
    '',
    '=== EXCHANGE & ON-CHAIN FLOWS ===',
    `BTC exchange net flow (24h):  ${ctx.exchangeNetFlow}`,
    `USDT+USDC stablecoin supply:  ${ctx.stablecoinFlow}`,
    `Liquidation cascade (last 4h): ${ctx.cascadeLine}`,
    '(A liquidation cascade = chain reaction of forced liquidations - often precedes exhaustion reversal OR continuation depending on direction. LONG cascade = over-leveraged longs flushed = potential bottom forming. SHORT cascade = shorts squeezed = potential top forming.)',
    `Whale net flow (last 1h, ${ctx.coin}): ${ctx.whaleFlow}`,
    '(Net whale buying = institutional accumulation signal. Net whale selling = distribution / risk-off. Large single trades >$1M often precede directional moves within 15–30min.)',
    '',
    // RETAIL SENTIMENT (Google Trends) removed 2026-07-31. Google blocks the
    // unofficial endpoint - confirmed failing from Render and locally - so the
    // value was permanently the 'AI will search' fallback, never a number.
    // That fallback only means something in Deep mode, which has web_search;
    // Quick mode has no tools, so it was a standing instruction the model
    // could not act on, spending tokens to say nothing. Restore alongside a
    // source that actually answers, not as a search prompt.
    /* THE #637 CAVEAT IS GONE BECAUSE THE DATA CHANGED, NOT BECAUSE IT STOPPED
       MATTERING. This header used to read "BTC LIQUIDATION CLUSTERS (BTC-wide,
       not the analysed coin)", because ctx.liqLevels came from
       store.btcLiqLevels and carried bare prices with no coin in them - an
       analysis of SOL was handed BTC's levels with nothing marking whose they
       were, and a model asked for a per-coin read weaves those in rather than
       rejecting them. The source is now LiqFeed's buckets, which carry `coin`
       and are filtered to the analysed one before they get here (#814), so the
       header can finally name the coin instead of warning about it.

       Worth keeping the old sentence's reasoning: every sibling field in this
       prompt names its scope - "CB Premium (Coinbase BTC - Binance BTC)",
       "BTC exchange net flow", "BTC Put/Call Ratio". A section that does not
       is the one a model will misattribute.

       REALIZED IS IN THE HEADER AND HAS TO STAY THERE. These are liquidations
       that ALREADY happened - price memory, fuel spent. Coinglass sold
       PREDICTED levels, where open positions WOULD blow up, which reads as a
       forward magnet. A model handed "liquidation clusters" with no qualifier
       reasons about them as the second kind, and it will do so confidently.
       The owner ruled the wording for the chart overlay on #766; it matters
       more here, because nothing in a prompt is visible to check afterwards. */
    `=== REALIZED LIQUIDATION CLUSTERS (${ctx.coin}, last 24h - where liquidations ALREADY happened, not predicted levels) ===`,
    ctx.liqLevels,
    '',
    '=== MACRO EVENTS - RELEASED (LAST 24H) + UPCOMING (48H) ===',
    '(CRITICAL: Any central bank decision - FOMC, BOJ, ECB, BOE - or tier-1 data released in the last 24h MUST anchor your macro bias. Do not let 1–2 weak technical signals override a confirmed Fed hold/hike or BOJ policy shift. For BOJ specifically: a rate hike = JPY strengthens = global carry trade unwind = risk-off across all assets including crypto. Use the Deep Research mode or the news feed to confirm current BOJ stance if not shown here.)',
    ctx.upcomingEvents || 'No events in window',
    '',
    '=== LIVE NEWS FEED (up to 15 alerts, newest first: UTC time, age and source on each line) ===',
    ctx.news,
    '',
    /* BACK SINCE #1631 A, with dates. Removed 2026-07-31 because SoSoValue answered from neither host and the line was permanently
       'AI will search live'. The authenticated API has answered since #175, and check 2 found Deep missing a +$526.7M day because the
       prompt carried no flows at all. A missing reading says "unavailable" - never a search instruction. */
    '=== SPOT ETF NET FLOWS (SoSoValue, by US trading day, newest first) ===',
    `BTC spot ETFs: ${ctx.etfFlows}`,
    `ETH spot ETFs: ${ctx.ethEtfFlows}`,
    '(A flow is a catalyst for the day it is dated, not for today unless today is that day - always say its date.)',
    '',
    '=== SESSION ===',
    `Current session: ${ctx.session}`,
    '',
    '=== MOMENTUM REGIME FILTER - READ THIS BEFORE FORMING ANY BIAS ===',
    'Classify the current regime FIRST. Oscillators (RSI, CVD divergence) only matter INSIDE a regime - they do NOT override it.',
    '',
    'BEARISH MOMENTUM REGIME - present if 3 or more of these are true:',
    `  • 24h change worse than −8% → ${ctx.change24h}`,
    `  • Price below EMA9 AND EMA9 below SMA200 (check chart section below)`,
    `  • OI Trend is strong_down or weak_down → ${ctx.oiTrend}`,
    `  • Long/Short ratio > 1.8:1 → ${ctx.longShortRatio}`,
    `  • Taker sell > 55% → ${ctx.takerRatio}`,
    // #1631 B (PM audit): BTC's Coinbase premium is BTC's own market - fenced here too, or an XRP prompt says "not given for XRP" and then
    // counts it toward a bearish regime twenty lines later.
    ...btcOnly([`  • Negative CB premium → ${ctx.cbPremium}`]),
    `  • Price below VWAP → ${ctx.vwap}`,
    '',
    'IF IN BEARISH MOMENTUM REGIME:',
    '  • RSI oversold (< 30) = STRONG DOWNSIDE MOMENTUM - NOT a buy signal alone. Combine with exhaustion checklist.',
    '  • CVD bullish divergence during selloff = absorption signal. Still require reversal candle confirmation before calling BULLISH.',
    '  • Fibonacci support + 3+ exhaustion signals = a BULLISH case even in a bearish regime, once the reversal-candle trigger prints (SIGNAL DECISION GUIDE).',
    '  • Long/Short ratio > 1.8:1 during selloff = overleveraged longs at FLUSH RISK = one bearish signal, not a bullish one.',
    '  • The tier comes from the SIGNAL DECISION GUIDE below; this regime decides which checklist feeds the count. A bullish tier here needs the reversal-candle trigger.',
    '  • "Falling knife" rule: Never buy an asset down >8% in 24h and still accelerating lower - but 3+ exhaustion signals at key support overrides this.',
    '',
    'BULLISH MOMENTUM REGIME - present if 3 or more of these are true:',
    `  • 24h change better than +8% → ${ctx.change24h}`,
    `  • Price above EMA9 AND EMA9 above SMA200`,
    `  • OI Trend is strong_up → ${ctx.oiTrend}`,
    `  • Long/Short ratio < 0.8:1 (crowded shorts = squeeze risk)`,
    `  • Taker buy > 55% → ${ctx.takerRatio}`,
    '',
    'IF IN BULLISH MOMENTUM REGIME:',
    '  • RSI overbought (> 70) = STRONG UPSIDE MOMENTUM - not automatically a sell signal in a trending move.',
    '  • Short/Long ratio < 0.5:1 = overleveraged shorts at SQUEEZE RISK = one bullish signal.',
    '',
    'NEUTRAL REGIME: No clear momentum. Apply all signals equally.',
    '',
    '=== PULLBACK EXHAUSTION vs FALLING KNIFE CHECKLIST (Required in BEARISH REGIME) ===',
    'You MUST determine whether selling is EXHAUSTING or CONTINUING before choosing BULLISH/BEARISH/FLAT.',
    'Count how many of each apply using the candle data, volume, and derivatives provided:',
    '',
    'EXHAUSTION SIGNALS - selling may be ending, reversal likely forming:',
    '  ✓ Volume on the LAST 3 candles is LOWER than the 3 candles before them (V field in candle data)',
    '  ✓ Long/Short ratio has DROPPED below 1.3:1 - overleveraged longs have been flushed, reset complete',
    `  ✓ Funding rate turned NEUTRAL or NEGATIVE - overcrowded longs cleared → ${ctx.crossExchangeFunding}`,
    `  ✓ Taker sell ratio DECLINING toward 50% on recent candles → ${ctx.takerRatio}`,
    `  ✓ OI trend = weak_down or flat (long exits nearly complete, not new shorts) → ${ctx.oiTrend}`,
    '  ✓ Price printed a WICK / HAMMER candle at a key support (visible in candle OHLC: Low much lower than Close)',
    '  ✓ CVD bullish divergence + volume declining together (absorption AND fewer sellers)',
    '  ✓ Price held at a MAJOR FIB level (61.8%, 78.6%) for 2+ candles without breaking',
    '',
    '  Each EXHAUSTION signal counts as one bullish signal in the SIGNAL DECISION GUIDE: 2 → LEAN BULLISH at most, 3+ with a reversal candle at support → BULLISH.',
    '  5+ EXHAUSTION signals → strong reversal case: higher confidence, same tier rules.',
    '',
    'CONTINUATION SIGNALS - selling is still in progress:',
    '  ✗ Volume INCREASING on down candles (new sellers entering, not exhaustion)',
    '  ✗ Long/Short ratio still ABOVE 1.5:1 - longs not flushed yet, more pain ahead',
    '  ✗ Funding rate still POSITIVE - longs still paying, flush incomplete',
    '  ✗ Taker sell ratio sustained ABOVE 60% - sellers fully in control',
    '  ✗ OI trend = strong_down - new shorts entering, directional conviction lower',
    '  ✗ Clean lower lows with NO wicks - no absorption at support, just selling',
    '  ✗ Price accelerating below key EMAs or supports without any pause candle',
    '',
    '  Each CONTINUATION signal counts as one bearish signal in the SIGNAL DECISION GUIDE: 2 → LEAN BEARISH at most, 3+ with a breakdown candle through support → BEARISH.',
    '  5+ CONTINUATION signals → strong continuation case: higher confidence, same tier rules.',
    '',
    '=== LIVE SEARCH TASK ===',
    `Search RIGHT NOW for WHY ${ctx.coin} and crypto markets are moving today. Use web_search and x_search for:`,
    `1. Search "bitcoin price today why" and "crypto market news ${new Date().toISOString().slice(0,10)}" - find the ACTUAL catalyst behind today's price action.`,
    '2. War, conflict, sanctions, or geopolitical events in last 24h - search "war news crypto", "US strikes", "Russia Ukraine", "Middle East" on X and web.',
    '3. Any posts from @realDonaldTrump or @WhiteHouse on Bitcoin, crypto, tariffs, Fed, or interest rates.',
    '4. Fed, FOMC, CPI, PPI, Treasury statements from last 48h. Search "Fed crypto" and "interest rates".',
    '5. BTC and ETH spot ETF flows NEWER than the dated SPOT ETF section above (IBIT, FBTC, ARKB, BITB, ETHA, FETH, EZET).',
    '6. Any SEC, CFTC, or Congressional crypto bills or rulings.',
    '7. Any major exchange news (Binance, Coinbase, Bybit hacks, large liquidations, whale moves).',
    '8. Search X for "BTC" and "crypto" right now - what are traders saying is driving the move?',
    /* #1631 A: check 2's Deep runs named catalysts with no source and presented 16 h and 52 h old events as live, and one said "no
       catalysts" without evidence of having looked. Every catalyst now carries where and when it came from. */
    'Every catalyst you take from these searches needs its source and its UTC publication time from the search result itself - never from memory. Do not write that there are no catalysts unless you ran these searches and found none; then write "- None found (searched: <what you searched>)".',
    '',
    '=== YOUR ANALYSIS TASK ===',
    'STEP 1: Apply the MOMENTUM REGIME FILTER above to classify the regime (Bearish / Bullish / Neutral).',
    'STEP 2: Synthesize ALL data within that regime context. Do NOT let oscillators override the regime.',
    '',
    '1. TECHNICALS - REGIME-AWARE:',
    '   • In BEARISH REGIME: RSI oversold = strong downside momentum. EMA9 < SMA200 = bearish structure. Do NOT use oversold RSI as a buy trigger.',
    '   • In BULLISH REGIME: RSI overbought = strong upside momentum. EMA9 > SMA200 = bullish structure.',
    '   • Price vs MA20, EMA cross, volume confirmation still apply for timing entries.',
    '2. DERIVATIVES: Funding rate direction bias, OI trend vs price, long/short imbalance.',
    '   • Long/Short ratio > 1.8:1 during a DECLINE = crowded longs at flush risk = BEARISH signal, not bullish.',
    '   • Long/Short ratio < 0.6:1 during a RALLY = crowded shorts at squeeze risk = BULLISH signal.',
    '3. MACRO: Oil price direction (risk-on/off signal), bond yields (rising = risk-off), BTC dominance.',
    '4. ETF FLOWS: use the dated SPOT ETF section - net inflows = institutional accumulation (bullish), net outflows = distribution (bearish); large flows can drive 3–8% moves. Say the date of any flow you cite.',
    '5. NEWS & SOCIAL: Fed/FOMC statements, SEC rulings, inflation prints (CPI/PPI), geopolitical risk.',
    '6. TRUMP/WHITE HOUSE: Presidential posts or executive orders about crypto cause immediate 5–15% swings. Rate policy signals affect risk appetite.',
    '7. SENTIMENT: Fear & Greed extreme readings as contrarian signals - BUT only in NEUTRAL regime. In Bearish regime, extreme fear can persist.',
    '8. SESSION: NY session (high liquidity) vs Asia/London.',
    '9. FIBONACCI: In NEUTRAL regime, fib levels (61.8%, 38.2%) are high-probability reversal zones. In BEARISH REGIME, fib supports are likely to fail - treat them as pause zones only.',
    '10. ORDER FLOW (CVD): Positive CVD = net buying. Negative = selling pressure. In BEARISH REGIME, CVD bullish divergence is often a temporary absorption trap - require price confirmation before treating as reversal.',
    ...btcOnly(['11. OPTIONS (DERIBIT): P/C ratio > 1.2 = bearish positioning. Max pain acts as price magnet near expiry. Positive basis = healthy bull market.']),
    /* Added with #340. Rule 11 gives a bullish reading for positive basis, and
       the activity line can say "leverage-led" at the same instant - both true,
       measuring different things. Without this the model can assert both in one
       answer and the user cannot tell which the app believes. */
    '11b. PERP BASIS vs PERP ACTIVITY are DIFFERENT and may disagree. Basis is the PRICE premium of perps over spot. Activity is how much perp trading VOLUME there is against spot, measured against its own normal for that coin. Positive basis with normal activity = healthy demand for leverage. Positive basis with elevated activity = the move is leverage-led and unwinds faster. If they conflict, say so explicitly rather than choosing one silently.',
    ...btcOnly(['12. GEX (GAMMA EXPOSURE, BTC): the volatility regime, never a direction - apply it as the GEX block above says (a breakout counts 0 in long gamma, 1 in short gamma). A zero-gamma flip crossing is a regime shift: say so.']),
    '13. ORDER BOOK: Large bid walls = support. Large ask walls = resistance. Price often hunts walls before reversing.',
    '14. STABLECOIN FLOWS: judge by the 7d/30d change given, never by the level. Growing USDT+USDC supply = dry powder entering = bullish medium-term. Shrinking = capital leaving - never call a shrinking or unknown supply dry powder.',
    '15. EXCHANGE FLOWS: BTC flowing INTO exchanges = sell pressure. Flowing OUT = accumulation.',
    ...btcOnly(['16. COINBASE PREMIUM: CB premium > +$30 = US institutions buying aggressively (strong bullish). Negative = US selling/risk-off.']),
    '17. VWAP: Price above VWAP = institutions paying up (bullish). Price below VWAP = distributing (bearish).',
    '18. OI TREND: OI↑+Price↑ = real trend with conviction. OI↑+Price↓ = new short conviction. OI↓+Price↑ = short covering only (weak). OI↓+Price↓ = long exits (panic).',
    '19. TAKER RATIO: Taker buy >65% = aggressive buyers = real demand (bullish). Taker sell >65% = sellers dumping into bids = distribution/panic (bearish).',
    '',
    /* #1631 D: the ONE place tiers are defined. The ribbon, the regime checklists, GEX and the chart section used to define tiers of their
       own (and the chart section a second table), so the same data produced LEAN in one run and BULLISH in the next. The COUNTED line in
       the output lets applyResultChecks hold the answer to this table. */
    '=== SIGNAL DECISION GUIDE - the ONLY tier definitions; every other rule feeds it ===',
    'Count signals FIRST, each one once, from the data above (the exhaustion / continuation checklists, the EMA ribbon, structure breaks, order flow, derivatives, macro). Then pick the tier:',
    '',
    'BEARISH:      3+ bearish signals, more than the bullish count, AND a trigger - SHORT_SETUP (pullback into the value zone) or a breakdown candle through support after 3+ continuation signals.',
    'LEAN BEARISH: 2+ bearish signals and more than the bullish count (or a bearish regime with 1+), but no trigger yet. State what would trigger BEARISH.',
    'FLAT:         neither side qualifies for a LEAN - the counts are tied, or the leading side has fewer than 2 and there is no regime. No directional edge.',
    'LEAN BULLISH: 2+ bullish signals and more than the bearish count (or a bullish regime with 1+), but no trigger yet. State what would trigger BULLISH.',
    'BULLISH:      3+ bullish signals, more than the bearish count, AND a trigger - LONG_SETUP (pullback into the value zone) or a reversal candle at support after 3+ exhaustion signals.',
    '',
    'PRECEDENCE when rules point different ways - apply them in this order and name the one that decided:',
    '  1. The momentum regime (the filter above).',
    '  2. The signal count and the tier table above.',
    '  3. Caps: TRENDING_LONG / TRENDING_SHORT are not triggers; FREEZE prefers FLAT unless one side has 4+; for BTC, the GEX regime decides whether a breakout counts.',
    '  4. Confidence only, never the tier or the direction: perps vs spot, session, WaveTrend, FREEZE -15.',
    'If your count meets a tier and you output a lower one, say which rule above held it back.',
    '',
    /* #340, Option B, chosen by the owner from worked examples: a signal at
       8/10 confidence that is futures-led becomes 6/10. On this 0-100 scale
       that is -20. The spot-led mirror is half, +10.
       Phrased as a confidence adjustment rather than a direction rule because
       futures-led means the evidence behind the read is weaker, NOT that the
       trade is the other way - the same reason the Confluence side uses a
       penalty rather than a directional vote. */
    'PERPS VS SPOT WEIGHTING - adjusts confidence only, NEVER the direction:',
    '  - Futures-led (perp activity elevated vs its own normal): subtract 20 from confidence. The move is driven by leverage rather than by people buying the coin, so it unwinds faster. Do NOT flip the signal direction for this.',
    '  - Spot-led (perp activity unusually quiet): add 10 to confidence. More of the move is real buying.',
    '  - Could not be measured: do NOT adjust confidence, and SAY in your reasoning that the perps-vs-spot check was unavailable for this coin. A number quietly left unchanged reads as though the check passed.',
    'SESSION WEIGHTING - session timing adjusts confidence only, NOT the signal tier:',
    '  • NY / London: standard confidence, all tiers available.',
    '  • Pre-NY / Asia: subtract 10 from confidence. LEAN BEARISH and LEAN BULLISH are fully valid.',
    '  "Pre-NY session" is NEVER a standalone reason for FLAT - reduce confidence, not tier.',
    '',
    /* #1631 item 1: the third line used to read "NEVER output FLAT just because you are uncertain - own the direction when signals
       support it." It was written when FLAT was being used as a dodge, and the anti-dodge half is kept. The absolute is dropped,
       because it now fights two things that did not exist when it was added: the guardrail injected into every system prompt, which
       forbids claiming certainty the model does not have, and item 2's parser, which refuses an unreadable verdict rather than
       defaulting it - so "no edge" is a state the system can represent and act on. An absolute NEVER pressures a direction out of a
       read whose honest answer is that there isn't one. */
    'FLAT is NOT the safe default - when one side leads with 2+ signals, the SIGNAL DECISION GUIDE gives a LEAN.',
    'FLAT means: no directional edge at all. Not "risky session" or "cautious".',
    'Do not use FLAT as a dodge for a session you dislike or a chart you find awkward - if the signals support a direction, take it.',
    'But when there genuinely is no edge, FLAT is the correct answer and saying so is not a failure.',
    '',
    'Output in EXACTLY this format - no extra text before or after:',
    'SIGNAL: [BULLISH or BEARISH or FLAT]',
    'CONFIDENCE: [0-100]',
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

export function calcSMA(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out[i] = sum / period;
  }
  return out;
}

/** Wilder RSI series with null where undefined - the app's one RSI (lib/rsi.ts, #1626 C). Pass CLOSED candles. */
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  return wilderRsiSeries(closes, period).map(v => (Number.isFinite(v) ? v : null));
}

// ── Combined chart + market prompt ────────────────────────────────────────

export interface ChartData {
  tf: string;
  ema9: number | null;
  sma200: number | null;
  rsi: number | null;
  recent20: string;
  hi: number;
  lo: number;
  lastClose: number;
  detectedPatterns?: string; // algorithmically pre-detected basic patterns as context for Grok
}

export interface CombinedResult {
  signal: 'BULLISH' | 'LEAN BULLISH' | 'FLAT' | 'LEAN BEARISH' | 'BEARISH';
  confidence: number;
  levels: { price: number; label: string; type: 'support' | 'resistance' }[];
  chartAnalysis: string;
  patterns: string[];   // detected chart patterns (e.g. "Bear flag", "H&S", etc.)
  reasoning: string;
  catalysts: string[];
  waitFor: string | null;  // FLAT only: what to watch before entering
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;  // FLAT only: directional lean
  raidSetup: 'SHORT SQUEEZE' | 'LONG FLUSH' | null;  // liquidity raid potential
  raidTarget: string | null;   // price level / range where liquidations cluster
  raidTrigger: string | null;  // one-line confirmation signal
  /* The three below are always set by the server since #1631 A+D, and absent on a result from before them. */
  /** #1631 A: the web/X sources Deep's search returned (url_citation annotations + the citations list). Empty for Quick. */
  citations?: string[];
  /** #1631 D: the signals the model says it counted per side (its COUNTED line), or null when it gave none. */
  counted?: { bullish: number; bearish: number } | null;
  /** #1631 D: what applyResultChecks changed or could not check, in plain words. Not shown in the UI. */
  checks?: string[];
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
    // #1631 B: prices with the decimals their size needs. toFixed(0) printed XRP's $2.31 as "$1" on every line here.
    `Timeframe: ${chart.tf}  |  Last Close: ${priceText(chart.lastClose)}`,
    `Range (visible 80 candles): High ${priceText(chart.hi)} / Low ${priceText(chart.lo)}`,
    `EMA 9:   ${chart.ema9   != null ? priceText(chart.ema9)   : '-'}`,
    `SMA 200: ${chart.sma200 != null ? priceText(chart.sma200) : '-'}`,
    `RSI(14): ${chart.rsi    != null ? chart.rsi.toFixed(1) + (chart.rsi >= 70 ? ' (Overbought)' : chart.rsi <= 30 ? ' (Oversold)' : ' (Neutral)') : '-'}`,
    `EMA/SMA cross: ${chart.ema9 != null && chart.sma200 != null ? (chart.ema9 > chart.sma200 ? 'EMA 9 ABOVE SMA 200 - bullish structure (one bullish signal)' : 'EMA 9 BELOW SMA 200 - bearish structure (one bearish signal); a bullish tier still needs the reversal-candle trigger') : '-'}`,
    `Price vs SMA200: ${chart.sma200 != null ? (chart.lastClose > chart.sma200 ? `ABOVE SMA200 (${priceText(chart.sma200)}) - bullish` : `BELOW SMA200 (${priceText(chart.sma200)}) - bearish, do not call BULLISH without the reversal-candle trigger (SIGNAL DECISION GUIDE)`) : '-'}`,
    // #1631 C: says what is sent. Arena slices the last 15 (the field is still called recent20); the label claimed 20.
    `Last 15 candles (OHLC): ${chart.recent20}`,
    chart.detectedPatterns ? `Pre-detected basic patterns: ${chart.detectedPatterns}` : '',
    '',
    'Cross-reference the candle key levels with order book walls, liquidation clusters, and derivatives data above.',
    '',
    `=== TECHNICALS vs MACRO WEIGHTING (${chart.tf} timeframe) ===`,
    chart.tf === '1m'
      ? 'WEIGHTING: Technicals 97% | Macro 3% - 1-minute scalp. Macro is near-irrelevant for tick-level price action. Only factor: if a major CB decision or geopolitical shock occurred <30min ago, widen your stop - do not fight the immediate reaction.'
      : chart.tf === '5m'
        ? 'WEIGHTING: Technicals 95% | Macro 5% - 5-minute scalp. Technicals dominate. Macro only matters as a risk filter: avoid new entries within 15min before a scheduled tier-1 release.'
        : chart.tf === '15m'
          ? 'WEIGHTING: Technicals 90% | Macro 10% - 15-minute intraday. Technicals drive the call. Macro sets the session background: if a tier-1 event (FOMC, NFP, CPI) was released <3h ago, treat macro weight as 20% while the data reaction is still playing out.'
          : chart.tf === '30m'
            ? 'WEIGHTING: Technicals 85% | Macro 15% - 30-minute intraday. Macro sets the session bias direction; technicals determine the entry. If a major event printed in the last 6h, elevate macro to 25% - price is still digesting the move.'
            : chart.tf === '1h'
              ? 'WEIGHTING: Technicals 75% | Macro 25% - 1-hour. Technicals lead but macro context must align. If macro and technicals conflict, lean with macro for the bias and use a tighter confirmation trigger from technicals before entering.'
              : chart.tf === '4h'
                ? 'WEIGHTING: Technicals 55% | Macro 45% - 4-hour swing. Macro is a near-equal co-driver. Fed stance, DXY direction, BOJ carry risk, and geopolitical regime each carry real weight at this timeframe. Do not call a 4h BULLISH against a hawkish macro backdrop without 3+ strong technical confirmations.'
                : 'WEIGHTING: Technicals 50% | Macro 50% - daily timeframe. Equal weight. Central bank stance, DXY trend, BOJ policy, geopolitical risk, and ETF flows are as important as chart structure. A daily technical setup that contradicts the macro regime requires exceptional confirmation to act on.',
    'REMINDER: Apply the MOMENTUM REGIME FILTER above before deciding direction. In a confirmed bearish regime a bullish tier needs the reversal-candle trigger - oscillators alone never override the regime.',
    '',
    // #1631 D: confidence bands only. This used to be a second tier table that disagreed with the SIGNAL DECISION GUIDE.
    '=== CONFIDENCE BANDS (the tiers are defined only in the SIGNAL DECISION GUIDE above) ===',
    'LEAN BEARISH / LEAN BULLISH: 55–75% confidence. FLAT: 65–85% confidence.',
    'LEAN / FLAT REASONING must say: exactly which signals were counted, what price level triggers the upgrade to BEARISH or BULLISH.',
    '',
    'CRITICAL: Output ONLY these exact lines, no markdown, no bold (**), no extra text:',
    'SIGNAL: [BEARISH or LEAN BEARISH or FLAT or LEAN BULLISH or BULLISH]',
    'BIAS_LEAN: [Required ONLY when SIGNAL is FLAT - write BULLISH, BEARISH, or NEUTRAL to show your lean. Write N/A for all other signals.]',
    'CONFIDENCE: [0-100]',
    // #1631 D: the count the tier rests on, in a fixed shape so the server can check the tier against it.
    'COUNTED: bullish [n] ([the bullish signals you counted, comma separated]) | bearish [n] ([the bearish signals you counted])',
    // #1631 B: with no cluster data both XRP runs still invented a "long flush" target. No data, no raid.
    ...(/^\s*Not available/i.test(ctx.liqLevels ?? '') ? ['(No liquidation cluster data is available for this coin, so a raid cannot be judged: write RAID_SETUP: NONE, RAID_TARGET: N/A, RAID_TRIGGER: N/A.)'] : []),
    'RAID_SETUP: [Analyze the liquidation clusters, long/short crowding, funding rate, and order walls to determine IF a liquidity raid is likely. Output one of: SHORT SQUEEZE (shorts overcrowded + upside liquidation cluster reachable) | LONG FLUSH (longs overcrowded + downside liquidation cluster reachable) | NONE. A raid is likely when: one side is heavily crowded AND there is a visible liquidation cluster within 2-5% of current price AND funding confirms the crowding direction.]',
    'RAID_TARGET: [The specific price level or range where the liquidation cluster sits - this is where price would hunt before reversing. Format: "$X.XX" or "$X.XX – $X.XX". Write N/A if RAID_SETUP is NONE.]',
    'RAID_TRIGGER: [One sentence: the specific price action, volume, or candle pattern that would CONFIRM the raid is starting. E.g. "Break and hold above $2.05 on the 15m with volume spike triggers short liquidation cascade." Write N/A if RAID_SETUP is NONE.]',
    'LEVELS:',
    '- [price]: [label] | [support or resistance]',
    '- [price]: [label] | [support or resistance]',
    '- [price]: [label] | [support or resistance]',
    /* #1631 A (and audit item 6): one line per catalyst, "claim | source | UTC time (age)". Quick has no search, and its old template
       demanded catalysts "RIGHT NOW" with an empty news feed - an invitation to invent one. Lines without a source and a date are dropped
       by the parser; "None ..." means none. */
    '(CATALYSTS: only from the dated data in this prompt - news feed, released events, ETF flows - or a search result returned in THIS answer, never from memory. Older than 6h: say its age and whether price has since reversed (compare the candles). If there is none, write exactly "- None in input".)',
    'CATALYSTS:',
    '- [claim] | [source] | [YYYY-MM-DD HH:MM UTC (age)]',
    '- [second catalyst, same format, if any]',
    '- [third catalyst, same format, if any]',
    'CHART_ANALYSIS: [1-2 sentences on candles and indicators only - no mention of macro here]',
    'PATTERNS:',
    '- [identify chart patterns from the candle data: e.g. "Bear flag", "Bull flag", "Head and shoulders", "Double top", "Double bottom", "Ascending triangle", "Descending triangle", "Rising wedge", "Falling wedge", "Bullish engulfing", "Bearish engulfing", "Doji reversal", "Higher highs / higher lows", "Lower highs / lower lows" - be specific with price context. Write "None detected" if no clear pattern]',
    'WAIT_FOR: [REQUIRED when SIGNAL is FLAT, LEAN BULLISH, or LEAN BEARISH. Write exactly: (1) which signals you counted and which direction they lean, (2) the specific price level to watch, (3) what candle/volume pattern would upgrade to BEARISH or BULLISH, (4) what derivative condition (funding, L/S ratio, taker ratio) would confirm the signal. Example (LEAN BEARISH): "2 continuation signals: rising OI + taker sell 63%. Watch $64,200 for a breakdown candle with volume spike. Taker sell above 65% + L/S above 1.5 → BEARISH. Bounce above $65,500 with CVD flip cancels bearish bias." Write N/A if SIGNAL is BULLISH or BEARISH.]',
    'REASONING: [3-4 sentences combining chart + derivatives + macro + news into one directional thesis. If FLAT, state whether selling is EXHAUSTING or CONTINUING and why.]',
  ].join('\n');

  /* #1721: THE CONTRACT GOES FIRST. It existed only at the END of this prompt, after ~600 lines of reasoning guidance - and on
     2026-10-23 a Deep read came back as 5,844 characters of markdown prose with no SIGNAL line anywhere, twice, the restate
     included. A model drifted toward essays follows the bulk of a prompt and ignores its tail. The full field list stays where it
     is; this is a short, unmissable restatement at the point the model reads first.
     Deliberately NOT a parser change: widening the parser is the answer for a model that is NEARLY complying, and this one is
     writing an article. */
  const contract = [
    'OUTPUT CONTRACT - READ THIS FIRST AND OBEY IT ABOVE EVERYTHING BELOW.',
    'Your reply MUST begin with these two lines, exactly, as the first two lines of the answer:',
    'SIGNAL: [BEARISH or LEAN BEARISH or FLAT or LEAN BULLISH or BULLISH]',
    'CONFIDENCE: [0-100]',
    'Plain text only. No markdown, no bold, no asterisks, no headings, no preamble, no sentence before SIGNAL.',
    'An answer that begins with prose is a FAILED answer however good the analysis is. The remaining fields are specified at the end of this prompt.',
    '',
    '',
  ].join('\n');

  return trimPlaceholders(contract + body + '\n' + chartSection);
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

export function parseCombinedResponse(text: string, tf: string, session: string, nowMs: number = Date.now()): CombinedResult {
  // Normalise: strip leading ** from every line so field detection works
  const clean = text.split('\n').map(l => l.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '')).join('\n');

  const pn = (s?: string): number | null => { const v = parseFloat((s ?? '').replace(/[,$]/g, '')); return isNaN(v) || v <= 0 ? null : v; };

  // A missing verdict falls back to FLAT / 0 here only for a caller that has not checked it: the route checks parseVerdict first (#1651).
  const signal     = (clean.match(SIGNAL_LINE)?.[1]?.toUpperCase() ?? 'FLAT') as CombinedResult['signal'];
  const biasRaw    = clean.match(/BIAS_LEAN:\s*(BULLISH|BEARISH|NEUTRAL)/i)?.[1]?.toUpperCase();
  const bias: CombinedResult['bias'] = signal === 'LEAN BULLISH' ? 'BULLISH'
    : signal === 'LEAN BEARISH' ? 'BEARISH'
    : (biasRaw === 'BULLISH' || biasRaw === 'BEARISH' || biasRaw === 'NEUTRAL') ? biasRaw as CombinedResult['bias']
    : null;
  const confidence = parseInt(clean.match(CONFIDENCE_LINE)?.[1] ?? '0');

  const levels: CombinedResult['levels'] = [];
  const levSect = clean.match(/LEVELS:\s*\n([\s\S]*?)(?=CATALYSTS:|CHART_ANALYSIS:|REASONING:|$)/i)?.[1] ?? '';
  for (const line of levSect.split('\n')) {
    const m = line.match(/-\s*\$?([\d,.]+):\s*([^|]+)\|\s*(support|resistance)/i);
    if (m) { const p = pn(m[1]); if (p) levels.push({ price: p, label: m[2].trim(), type: m[3].toLowerCase() as 'support'|'resistance' }); }
  }

  /* #1631 A: a catalyst is "claim | source | UTC date (age)". A line without a source and a date is dropped rather than shown: both
     Deep runs in check 2 presented 16 h and 52 h old events as live, uncited, and nothing on screen could tell them apart from a real
     one. "None in input" / "None found" is the model saying so, and like "None detected" in PATTERNS it is not listed as a catalyst. */
  const catalysts: string[] = [];
  const catSect = clean.match(/CATALYSTS:\s*\n([\s\S]*?)(?=CHART_ANALYSIS:|REASONING:|$)/i)?.[1] ?? '';
  for (const line of catSect.split('\n')) {
    const m = line.match(/^-\s*(.+)/);
    if (!m) continue;
    const c = formatCatalyst(stripMd(m[1]), nowMs);
    if (c) catalysts.push(c);
  }

  // #1631 D: the counts the tier check in applyResultChecks needs.
  const counted = parseCounted(clean);

  // CHART_ANALYSIS - stop at PATTERNS or WAIT_FOR or REASONING
  const chartAnalysis = stripMd(
    clean.match(/CHART_ANALYSIS:\s*([\s\S]*?)(?=\n\*{0,2}PATTERNS\*{0,2}:|\n\*{0,2}WAIT_FOR\*{0,2}:|\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? ''
  );

  // PATTERNS - list of detected chart patterns
  const patterns: string[] = [];
  const patSect = clean.match(/PATTERNS:\s*\n([\s\S]*?)(?=\n\*{0,2}WAIT_FOR\*{0,2}:|\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? '';
  for (const line of patSect.split('\n')) {
    const m = line.match(/^-\s*(.+)/);
    if (m) {
      const p = stripMd(m[1]);
      if (p && p.toLowerCase() !== 'none detected' && p.toLowerCase() !== 'none') patterns.push(p);
    }
  }

  // WAIT_FOR - actionable watch conditions when signal is FLAT
  const waitForRaw = stripMd(
    clean.match(/\*{0,2}WAIT_FOR\*{0,2}:\s*([\s\S]*?)(?=\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? ''
  );
  const waitFor = (waitForRaw && waitForRaw.toLowerCase() !== 'n/a' && waitForRaw.trim().length > 5)
    ? waitForRaw.trim()
    : null;

  // WAIT_FOR stops at RAID_SETUP
  const waitForRaw2 = stripMd(
    clean.match(/\*{0,2}WAIT_FOR\*{0,2}:\s*([\s\S]*?)(?=\n\*{0,2}RAID_SETUP\*{0,2}:|\n\*{0,2}REASONING\*{0,2}:|$)/i)?.[1] ?? ''
  );
  const waitForFinal = (waitForRaw2 && waitForRaw2.toLowerCase() !== 'n/a' && waitForRaw2.trim().length > 5)
    ? waitForRaw2.trim() : waitFor;

  // RAID fields
  const raidRaw    = clean.match(/RAID_SETUP:\s*(SHORT SQUEEZE|LONG FLUSH|NONE)/i)?.[1]?.toUpperCase();
  const raidSetup  = raidRaw === 'SHORT SQUEEZE' ? 'SHORT SQUEEZE' : raidRaw === 'LONG FLUSH' ? 'LONG FLUSH' : null;
  const raidTargetRaw  = stripMd(clean.match(/RAID_TARGET:\s*([^\n]+)/i)?.[1] ?? '');
  const raidTarget = (raidTargetRaw && !/^n\/a$/i.test(raidTargetRaw.trim())) ? raidTargetRaw.trim() : null;
  const raidTriggerRaw = stripMd(clean.match(/RAID_TRIGGER:\s*([^\n]+)/i)?.[1] ?? '');
  const raidTrigger = (raidTriggerRaw && !/^n\/a$/i.test(raidTriggerRaw.trim())) ? raidTriggerRaw.trim() : null;

  // REASONING - handle **REASONING:** pattern
  const reasoning = stripMd(
    clean.match(/\*{0,2}REASONING\*{0,2}:\s*([\s\S]+)/i)?.[1] ?? ''
  );

  return { signal, confidence, bias, levels, catalysts, chartAnalysis, patterns, waitFor: waitForFinal ?? waitFor, raidSetup: raidSetup as CombinedResult['raidSetup'], raidTarget, raidTrigger, reasoning, citations: [], counted, checks: [], analyzedAt: Date.now(), tf, session };
}

/** A date or an age somewhere in the last part of a catalyst: 2026-10-20, 2026-10-19T14:00Z, Oct 20, 16h ago, 3 days ago. The date is not
 *  required to end on a word boundary, so an ISO time straight after it ("T14:00Z", PM's audit of #1668) still counts. */
const CATALYST_WHEN = /\b(20\d\d-\d\d-\d\d(?!\d)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\d+\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)\s+ago\b)/i;

/** A "source" that names no source: the model's own memory, or nothing. */
const NOT_A_SOURCE = /^(memory|from memory|model|the model|ai|grok|training( data)?|none|unknown|n\/?a|-)$/i;

/** #1631 D: the COUNTED line in any order or separator, bold or not ("bullish 3 (...) | bearish 1", "Bearish: 1, Bullish: 3").
 *  null when there is no COUNTED line, it does not give both numbers, or it gives one side two different numbers.
 *
 *  Each count is read only where its side STARTS a segment, with the parenthesised signal lists removed first. PM's re-audit of #1668:
 *  reading the first "bearish N" anywhere took "bullish 3 (reclaimed bearish 4h breaker) | bearish 1" as 3 v 4, and the tier check then
 *  turned a correct BULLISH into LEAN BEARISH. A signal's own name ("bearish 4h breaker", "bullish 1h FVG") is not a count. */
export function parseCounted(text: string): { bullish: number; bearish: number } | null {
  const line = text.split('\n').map((l) => l.replace(/\*+/g, '').trim()).find((l) => /^COUNTED\s*:/i.test(l));
  if (!line) return null;
  let body = line.replace(/^COUNTED\s*:/i, '');
  for (let prev = ''; prev !== body;) { prev = body; body = body.replace(/\([^()]*\)/g, ' '); }
  const segments = body.split(/[|,;]/).map((s) => s.trim());
  const n = (side: 'bullish' | 'bearish') => {
    const found = new Set<number>();
    for (const s of segments) {
      const m = s.match(new RegExp(`^${side}\\b\\s*[:=]?\\s*(\\d+)`, 'i'));
      if (m) found.add(parseInt(m[1], 10));
    }
    return found.size === 1 ? [...found][0] : null;
  };
  const bullish = n('bullish'), bearish = n('bearish');
  return bullish == null || bearish == null ? null : { bullish, bearish };
}

/** "claim | source | when" -> "claim - source, when"; null for a "None ..." line or one without a source and a date. */
/** The UTC date and time at the start of a catalyst's "when": `2026-10-22 03:51 UTC` or `2026-10-22T03:51Z`. Milliseconds, or null. */
function catalystTimeMs(when: string): number | null {
  const m = when.match(/(20\d\d-\d\d-\d\d)[T ](\d\d):(\d\d)/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** How old, in words: minutes under the hour, hours under two days, then days. */
function ageText(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m old`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

/* #1651 (QA, 2026-10-22): the AGE is computed HERE from the timestamp, and whatever the model wrote is discarded.
 *
 * A Deep read at 10:55:38 UTC cited "2026-10-22 03:51 UTC (age ~18h)". The timestamp was correct; the article was 7.1 hours old. The age
 * was invented and wrong by eleven hours. That instance overstated staleness, which is the harmless direction - the same mechanism can
 * say "age ~2h" over a day-old story, which reads as breaking news, and that is the direction a trader acts on.
 *
 * Nothing validated it, and it is arithmetic we can do ourselves from a timestamp already on the line. A prompt rule was the other option
 * and was rejected: an instruction can be drifted from, subtraction cannot. If the timestamp cannot be parsed the line keeps its stamp and
 * carries NO age - an age we cannot derive is one we cannot stand behind. A stamp in the future is the model's error, so it gets no age
 * either, and the stamp stays visible so a reader can see what was claimed. */
function formatCatalyst(raw: string, nowMs: number): string | null {
  if (!raw || /^none\b/i.test(raw)) return null;
  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const when = parts[parts.length - 1];
  if (!CATALYST_WHEN.test(when)) return null;
  const source = parts[parts.length - 2];
  // PM's audit of #1668: a date in the source slot, or "memory" as the source, is not a source.
  if (CATALYST_WHEN.test(source) || NOT_A_SOURCE.test(source)) return null;
  const claim = parts.slice(0, -2).join(' | ');
  const stamp = when.replace(/\s*\((?:[^()]*\b(?:ago|old|age)\b[^()]*)\)\s*$/i, '').trim();
  const ts = catalystTimeMs(stamp);
  const withAge = ts !== null && ts <= nowMs + 5 * 60_000 ? `${stamp} (${ageText(nowMs - ts)})` : stamp;
  return `${claim} - ${source}, ${withAge}`;
}

/** The perps-vs-spot reading's "could not be measured" sentence (lib/perpSpot.ts), as it reaches the prompt. */
const SPOT_UNAVAILABLE = 'Spot data unavailable for this coin';

type Tier = CombinedResult['signal'];

/** Whether the SIGNAL DECISION GUIDE allows `tier` for these counts. The parser cannot see a trigger or the regime, so a full tier needs only
 *  its count (3+ and more than the other side) and a LEAN needs 1+ and more than the other side (the guide's "or a regime with 1+"). */
function tierAllowed(tier: Tier, c: { bullish: number; bearish: number }): boolean {
  if (tier === 'BULLISH') return c.bullish >= 3 && c.bullish > c.bearish;
  if (tier === 'BEARISH') return c.bearish >= 3 && c.bearish > c.bullish;
  if (tier === 'LEAN BULLISH') return c.bullish >= 1 && c.bullish > c.bearish;
  if (tier === 'LEAN BEARISH') return c.bearish >= 1 && c.bearish > c.bullish;
  return true; // FLAT is never "more" than the count says
}

/** The tier the count itself gives, short of a full tier (no trigger is visible to the parser): a tie is FLAT, else LEAN of the side ahead. */
function tierFromCounts(c: { bullish: number; bearish: number }): Tier {
  if (c.bullish === c.bearish) return 'FLAT';
  return c.bullish > c.bearish ? 'LEAN BULLISH' : 'LEAN BEARISH';
}

/** #1631 D: the rules the prompt states that the answer can be checked against, applied after parsing, on the server (it has the prompt).
 *  - The tier must be one the SIGNAL DECISION GUIDE allows for the model's own COUNTED line. One it does not allow is replaced by the tier
 *    the count gives (PM's audit of #1668: it used to fall back to the same side's LEAN, so BULLISH on 0 vs 5 became LEAN BULLISH 75),
 *    confidence capped at 75, with one sentence saying why. A full tier with no readable COUNTED line cannot be checked, so it is shown
 *    as its LEAN, never presented as checked.
 *  - With no liquidation cluster data a raid cannot be judged (#1631 B): any raid the model wrote anyway is dropped.
 *  - A perps-vs-spot check that could not be measured must be SAID (the prompt requires it); when the reasoning does not, it is added.
 *  Everything changed is listed in `checks`. */
export function applyResultChecks(result: CombinedResult, prompt: string): CombinedResult {
  const r: CombinedResult & { checks: string[] } = { ...result, checks: [...(result.checks ?? [])] };

  const said = r.signal;
  const note = (s: string) => { r.reasoning = `${r.reasoning}${r.reasoning ? ' ' : ''}${s}`; };
  const show = (tier: Tier) => {
    r.signal = tier;
    r.bias = tier === 'LEAN BULLISH' ? 'BULLISH' : tier === 'LEAN BEARISH' ? 'BEARISH'
      : r.counted && r.counted.bullish !== r.counted.bearish ? (r.counted.bullish > r.counted.bearish ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
    r.confidence = Math.min(r.confidence, 75);
  };
  if (!r.counted) {
    if (said === 'BULLISH' || said === 'BEARISH') {
      const lean: Tier = said === 'BULLISH' ? 'LEAN BULLISH' : 'LEAN BEARISH';
      r.checks.push(`${said} shown as ${lean}: no readable COUNTED line, so the tier could not be checked`);
      note(`(Shown as ${lean}: the answer did not state its signal count, so ${said} could not be checked.)`);
      show(lean);
    } else if (said !== 'FLAT') {
      r.checks.push(`${said} not checked: no readable COUNTED line`);
    }
  } else if (!tierAllowed(said, r.counted)) {
    const tier = tierFromCounts(r.counted);
    r.checks.push(`${said} shown as ${tier}: ${r.counted.bullish} bullish vs ${r.counted.bearish} bearish counted`);
    note(`(Shown as ${tier}: ${r.counted.bullish} bullish against ${r.counted.bearish} bearish signals were counted, which does not support ${said}.)`);
    show(tier);
  }

  if (/=== REALIZED LIQUIDATION CLUSTERS[^\n]*===\s*\n\s*Not available/.test(prompt) && (r.raidSetup || r.raidTarget || r.raidTrigger)) {
    r.checks.push('raid dropped: no liquidation cluster data');
    r.raidSetup = null; r.raidTarget = null; r.raidTrigger = null;
  }

  // PM's audit of #1668: any "spot" ("BTC spot ETF inflows") used to count as the disclosure. It must name the perps-vs-spot check.
  if (prompt.includes(SPOT_UNAVAILABLE) && !/perps?[\s-]*(vs\.?|versus|against)[\s-]*spot|spot[\s-]*(data|volume|activity|led|reading)|futures[\s-]*led/i.test(r.reasoning)) {
    r.checks.push('perps-vs-spot disclosure added');
    r.reasoning = `${r.reasoning}${r.reasoning ? ' ' : ''}The perps-vs-spot check was unavailable for this coin, so confidence was not adjusted for it.`;
  }

  return r;
}

/* ── Quick prompt - strips the LIVE SEARCH TASK block (no web search needed) ── */
export function buildQuickPrompt(ctx: GrokContext, chart: ChartData): string {
  const full = buildCombinedPrompt(ctx, chart);
  const s = full.indexOf('\n=== LIVE SEARCH TASK ===');
  const e = full.indexOf('\n=== YOUR ANALYSIS TASK ===');
  if (s !== -1 && e !== -1) return full.slice(0, s) + full.slice(e);
  return full;
}

/* callGrokQuick / callGrokCombined / callGrok and their parseResponse helper
   used to live here. All four were dead - nothing in the app has called them
   since the AI routes moved to doing their own xAI requests, and each one held
   its own copy of the request shape, so they were three more places to forget
   when the API changed.

   Removing them also settles a boundary problem: this module is imported by
   client components (Arena, KLineProChart, UsageRings, GrokUsageProvider), so
   the xAI health hook could not live here - lib/apiHealth pulls in
   supabase-admin, which must never reach a client bundle. The live call sites
   are all server routes and now go through lib/xai.ts instead. */
