import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true });

  const update = await req.json() as {
    message?: {
      chat: { id: number; first_name?: string; username?: string };
      text?: string;
    };
  };

  const chat = update.message?.chat;
  const text = update.message?.text ?? '';

  if (!chat) return NextResponse.json({ ok: true });

  if (text.startsWith('/start')) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat.id,
        parse_mode: 'HTML',
        text:
          `👋 Welcome to <b>LiquidityHQ</b>!\n\n` +
          `Your Telegram Chat ID is:\n` +
          `<code>${chat.id}</code>\n\n` +
          `Copy the number above and paste it into the LiquidityHQ app to start receiving alerts.`,
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
