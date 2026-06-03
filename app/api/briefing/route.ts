import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

const SYSTEM = `You are a concise pre-session market briefing assistant for a solo retail crypto futures trader (PHT timezone, Asia/Manila).

Write exactly 3 short paragraphs:
1. Overall market conditions and sentiment right now
2. The single best setup or biggest risk to watch this session
3. One concrete action: what to do, what to avoid, what price level matters

Rules:
- Plain language, direct and opinionated
- No bullet points, no headers, no hedging
- Max 60 words per paragraph
- If nothing stands out, say so plainly`;

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API key not configured' }, { status: 503 });
  }

  let context: string;
  try {
    ({ context } = await req.json() as { context: string });
    if (!context?.trim()) throw new Error('empty');
  } catch {
    return NextResponse.json({ error: 'context required' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4.3',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: context },
        ],
        max_tokens: 350,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: txt }, { status: res.status });
    }

    const data = await res.json();
    const briefing = (data.choices?.[0]?.message?.content ?? '').trim();
    return NextResponse.json({ briefing });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
