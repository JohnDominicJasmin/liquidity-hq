import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// This route has no auth gate - the app itself calls it unauthenticated for
// dashboard-triggered alerts (CVD divergence, liquidation cascades, etc.), and
// TELEGRAM_CHAT_ID is a single global destination (the owner's own chat), not
// per-user. Without a rate limit + length cap, anyone who finds this URL could
// use it as a free spam relay into that chat.
const MAX_MESSAGE_LEN = 1000;

export async function POST(req: NextRequest) {
  if (!rateLimit(`telegram-send:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json(
      { error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in environment' },
      { status: 503 },
    );
  }

  let body: { message: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: 'message too long' }, { status: 400 });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: body.message,
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.description }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
