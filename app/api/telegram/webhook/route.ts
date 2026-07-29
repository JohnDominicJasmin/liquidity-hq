import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true });

  // Telegram echoes this header on every webhook call when a secret_token was
  // set via setWebhook - verifying it stops anyone who finds this URL from
  // POSTing fake updates that make the bot DM arbitrary chat_ids on our behalf.
  // Fails CLOSED when the secret is unset, matching lib/cronAuth.ts. It used
  // to skip verification entirely in that case and fall back to a rate limit,
  // which meant one missing env var quietly turned this into an open endpoint
  // anyone could POST fake Telegram updates to - and nothing would look wrong.
  // The secret is set on prod and dev (see docs/INFRASTRUCTURE.md), so this
  // changes nothing in normal operation; it only removes the silent open
  // state after a bad deploy or a rebuilt environment.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[telegram/webhook] TELEGRAM_WEBHOOK_SECRET unset - refusing all updates');
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  // Constant-time compare on attacker-influenced input, same as checkCronAuth.
  const a = Buffer.from(provided);
  const b = Buffer.from(webhookSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Kept even with a verified secret: a leaked secret should still not allow
  // unbounded /start welcome-DM traffic through the bot.
  if (!rateLimit(`telegram-webhook:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false }, { status: 429 });
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
