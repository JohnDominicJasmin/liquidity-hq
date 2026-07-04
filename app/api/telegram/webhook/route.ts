import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true });

  // Telegram echoes this header on every webhook call when a secret_token was
  // set via setWebhook — verifying it stops anyone who finds this URL from
  // POSTing fake updates that make the bot DM arbitrary chat_ids on our behalf.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided = req.headers.get('x-telegram-bot-api-secret-token');
    if (provided !== webhookSecret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

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
