import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'Bot not configured' }, { status: 500 });

  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=20&allowed_updates=%5B%22message%22%5D`,
    { cache: 'no-store' }
  );

  const data = await res.json() as {
    ok: boolean;
    result?: Array<{
      update_id: number;
      message?: { chat: { id: number; first_name?: string; username?: string }; text?: string };
    }>;
  };

  if (!data.ok || !data.result?.length) {
    return NextResponse.json({
      ok: false,
      error: 'No messages found. Open the bot and send /start first, then try again.',
    });
  }

  const withMsg = data.result.filter(u => u.message?.chat?.id);
  if (!withMsg.length) {
    return NextResponse.json({
      ok: false,
      error: 'No messages found. Open the bot and send /start first, then try again.',
    });
  }

  const latest = withMsg[withMsg.length - 1];
  const chatId = String(latest.message!.chat.id);
  const name = latest.message!.chat.first_name ?? latest.message!.chat.username ?? '';

  return NextResponse.json({ ok: true, chat_id: chatId, name });
}
