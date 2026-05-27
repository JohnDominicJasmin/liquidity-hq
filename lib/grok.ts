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
  /* cumulative volume delta */
  cvd: string;
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
}

export interface GrokResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  entry: string;
  reasoning: string;
}

export function buildPrompt(ctx: GrokContext): string {
  return [
    `You are GROK — an elite crypto derivatives trader and macro analyst. Your job is to synthesize ALL available data and output a high-conviction directional call for ${ctx.coin}.`,
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
    `CVD (last 200 trades):  ${ctx.cvd}`,
    `Fibonacci nearest level:  ${ctx.fibNearest}`,
    `Volume Profile POC/VAH/VAL:  ${ctx.pocLine}`,
    '',
    '=== DERIVATIVES / POSITIONING ===',
    `Funding rate: ${ctx.fundingRate}`,
    `Open Interest: ${ctx.openInterest}`,
    '',
    '=== DERIVATIVES — EXTENDED ===',
    `Basis (perp premium vs spot):  ${ctx.basis}`,
    `Squeeze score:  ${ctx.squeezeScore}`,
    '',
    '=== OPTIONS MARKET (DERIBIT) ===',
    `BTC Put/Call Ratio:  ${ctx.pcRatio}`,
    `BTC Max Pain Strike:  ${ctx.maxPain}`,
    '(Max pain = price where max option value is destroyed at expiry — acts as magnet)',
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
    '=== LIVE NEWS FEED (last 6 alerts — Finnhub WS + CryptoPanic) ===',
    ctx.news,
    '',
    '=== BTC + ETH SPOT ETF FLOWS ===',
    ctx.etfFlows,
    '(Positive net flow = institutional inflows = demand. Negative = outflows = distribution/de-risking.)',
    '',
    '=== SESSION ===',
    `Current session: ${ctx.session}`,
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
    'Synthesize ALL data above as an elite trader would. Consider:',
    '1. TECHNICALS: RSI overbought/oversold, price above/below MA20, volume confirmation',
    '2. DERIVATIVES: Funding rate direction bias, OI changes, long/short imbalance',
    '3. MACRO: Oil price direction (risk-on/off signal), bond yields (rising = risk-off), BTC dominance',
    '4. ETF FLOWS: Net inflows = institutional accumulation (bullish). Net outflows = distribution (bearish). Large flows can drive 3–8% moves.',
    '5. NEWS & SOCIAL: Fed/FOMC statements, SEC rulings, inflation prints (CPI/PPI), geopolitical risk',
    '6. TRUMP/WHITE HOUSE: Presidential posts or executive orders about crypto cause immediate 5–15% swings. Rate policy signals affect risk appetite.',
    '7. SENTIMENT: Fear & Greed extreme readings as contrarian signals',
    '8. SESSION: NY session (high liquidity) vs Asia/London',
    '9. FIBONACCI: Price approaching a key fib level (61.8%, 38.2%) is a high-probability reversal/bounce zone.',
    '10. ORDER FLOW (CVD): Positive CVD = net buying = confirms longs. Negative = selling pressure. Divergence from price is a trap signal.',
    '11. OPTIONS (DERIBIT): P/C ratio > 1.2 = bearish positioning. Max pain acts as a price magnet especially near expiry. Positive basis = healthy bull market.',
    '12. ORDER BOOK: Large bid walls = support. Large ask walls = resistance. Price often hunts walls before reversing.',
    '13. STABLECOIN FLOWS: Growing USDT+USDC supply = dry powder entering market = bullish medium-term. Shrinking = cashing out.',
    '14. EXCHANGE FLOWS: BTC flowing INTO exchanges = sell pressure incoming. Flowing OUT = accumulation/hodling.',
    '',
    'Output in EXACTLY this format — no extra text before or after:',
    'SIGNAL: [LONG or SHORT or FLAT]',
    'CONFIDENCE: [0-100]',
    'ENTRY_ZONE: [specific price level or range]',
    'REASONING:',
    '[2-4 sentence analysis citing the specific signals that drove your decision. Name which technicals, macro factors, and news items matter most right now.]',
  ].join('\n');
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
