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
    '=== DERIVATIVES / POSITIONING ===',
    `Funding rate: ${ctx.fundingRate}`,
    `Open Interest: ${ctx.openInterest}`,
    '',
    '=== MACRO ===',
    `US Oil (CL=F): ${ctx.oilPrice}`,
    `US 10Y Bond Yield: ${ctx.bonds10y}`,
    `BTC Dominance: ${ctx.btcDominance}`,
    `Fear & Greed: ${ctx.fearGreed}`,
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
    'Use your live X and web search to find RIGHT NOW:',
    '1. Any posts from @realDonaldTrump or @WhiteHouse mentioning Bitcoin, crypto, tariffs, the Fed, or interest rates.',
    '2. Any SEC, CFTC, Treasury, or Federal Reserve statements or rulings on crypto from the last 48h.',
    '3. Latest BTC and ETH spot ETF flow updates (IBIT, FBTC, ARKB, BITB, ETHA, FETH, EZET).',
    '4. Any executive orders, Congressional crypto bills, or US regulatory announcements.',
    '5. Any major exchange news (Binance, Coinbase, Bybit hacks, listings, delistings, regulatory actions).',
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
  const sigMatch   = text.match(/SIGNAL:\s*(LONG|SHORT|FLAT)/i);
  const confMatch  = text.match(/CONFIDENCE:\s*(\d+)/i);
  const entryMatch = text.match(/ENTRY_ZONE:\s*([^\n]+)/i);
  const reasonMatch = text.match(/REASONING:\s*([\s\S]+)/i);
  if (sigMatch)   result.signal     = sigMatch[1].toUpperCase() as GrokResult['signal'];
  if (confMatch)  result.confidence = parseInt(confMatch[1]);
  if (entryMatch) result.entry      = entryMatch[1].trim();
  if (reasonMatch) result.reasoning = reasonMatch[1].trim();
  return result;
}

export async function callGrok(apiKey: string, prompt: string): Promise<GrokResult> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-4.3',
      max_tokens: 1500,
      search_parameters: {
        mode: 'on',
        sources: [
          { type: 'x' },
          { type: 'news' },
          { type: 'web' },
        ],
        return_citations: false,
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Grok API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseResponse(text);
}
