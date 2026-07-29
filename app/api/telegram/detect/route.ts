import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// KNOWN LIMITATION, kept deliberately: this reads the most recent message sent
// to the SHARED bot, so it cannot tell whose message it is. If two people
// connect at the same moment, one can be handed the other's chat ID - and then
// their private alerts get delivered to the wrong phone. It is also why this
// route must never be anonymous: without the check below, anyone could poll it
// and harvest the chat ID, first name and username of each user as they
// connected.
//
// It only does anything at all when the Telegram webhook is NOT registered -
// with a webhook set, getUpdates returns 409 and this short-circuits to the
// /start instruction below. The /start reply already tells each user their own
// chat ID, which is the safe path and the one to keep; this route is a
// fallback for the un-webhooked case and is a good candidate for deletion.
export async function GET(req: NextRequest) {
  if (!rateLimit(`telegram-detect:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  const authToken = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!authToken) return NextResponse.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  const { data: auth } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${authToken}` } } },
  ).auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: 'Sign in required.' }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'Bot not configured' }, { status: 500 });

  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=20&allowed_updates=%5B%22message%22%5D`,
    { cache: 'no-store' }
  );

  const data = await res.json() as {
    ok: boolean;
    error_code?: number;
    description?: string;
    result?: Array<{
      update_id: number;
      message?: { chat: { id: number; first_name?: string; username?: string }; text?: string };
    }>;
  };

  // Webhook mode active - getUpdates conflicts with it
  if (!data.ok && data.error_code === 409) {
    return NextResponse.json({
      ok: false,
      error: 'Send /start to the bot - it will reply with your Chat ID directly.',
    });
  }

  if (!data.ok || !data.result?.length) {
    return NextResponse.json({
      ok: false,
      error: 'No messages found. Send /start to the bot first, then try again.',
    });
  }

  const withMsg = data.result.filter(u => u.message?.chat?.id);
  if (!withMsg.length) {
    return NextResponse.json({
      ok: false,
      error: 'No messages found. Send /start to the bot first, then try again.',
    });
  }

  const latest = withMsg[withMsg.length - 1];
  const chatId = String(latest.message!.chat.id);
  const name = latest.message!.chat.first_name ?? latest.message!.chat.username ?? '';

  return NextResponse.json({ ok: true, chat_id: chatId, name });
}
