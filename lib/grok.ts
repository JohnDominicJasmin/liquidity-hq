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
}

export interface GrokResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;
  entry: string;
  reasoning: string;
}

export function buildPrompt(ctx: GrokContext): string {
  return [
    `You are GROK — an elite crypto news trader. Your only job is to read the latest market news and decide the most probable price direction for ${ctx.coin}.`,
    '',
    '=== CURRENT PRICE ===',
    `Coin: ${ctx.coin}`,
    `Price: ${ctx.price}`,
    `24h Change: ${ctx.change24h}`,
    '',
    '=== LATEST MARKET NEWS ===',
    ctx.news,
    '',
    '=== YOUR TASK ===',
    `Based purely on the news above:`,
    `1. What is the market narrative right now?`,
    `2. Is sentiment bullish, bearish, or neutral for ${ctx.coin}?`,
    `3. What is the most probable next price move?`,
    '',
    'Output in EXACTLY this format:',
    'SIGNAL: [LONG or SHORT or FLAT]',
    'CONFIDENCE: [0-100]',
    'ENTRY_ZONE: [price level or range]',
    'REASONING:',
    '[Your news-based analysis. Be specific about which headlines drove your decision.]',
  ].join('\n');
}

export function parseResponse(text: string): GrokResult {
  const result: GrokResult = { signal: 'FLAT', confidence: 0, entry: '—', reasoning: text };
  const sigMatch = text.match(/SIGNAL:\s*(LONG|SHORT|FLAT)/i);
  const confMatch = text.match(/CONFIDENCE:\s*(\d+)/i);
  const entryMatch = text.match(/ENTRY_ZONE:\s*([^\n]+)/i);
  const reasonMatch = text.match(/REASONING:\s*([\s\S]+)/i);
  if (sigMatch) result.signal = sigMatch[1].toUpperCase() as GrokResult['signal'];
  if (confMatch) result.confidence = parseInt(confMatch[1]);
  if (entryMatch) result.entry = entryMatch[1].trim();
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
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Grok API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseResponse(text);
}
