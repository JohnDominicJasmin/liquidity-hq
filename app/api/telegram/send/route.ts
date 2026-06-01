import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
