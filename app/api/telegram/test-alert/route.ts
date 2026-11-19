import { NextRequest, NextResponse } from 'next/server';
import { T } from '@/lib/tables';
import { hasProFeatures } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rateLimit';
import { getUserCompat } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { localizeTelegram, tgLocaleOf } from '@/lib/telegramI18n';
import { tgLabelsFor } from '@/lib/telegramLabels';
import { bearerToken } from '@/lib/bearerToken';

export const dynamic = 'force-dynamic';

/* "Send test alert" on /alerts: ONE short message to the caller's OWN linked chat, so they can see what an alert looks like where it
   lands. Same gates as telegram/test, in the same order (auth before anything about this server is revealed), plus a tighter limit:
   3 per 10 minutes per user. Never falls back to a global chat - not linked is a 409. Answers { ok, sent }. */
const LIMIT = 3;
const WINDOW_MS = 10 * 60_000;

function stampIn(timeZone: string | null): string {
  const d = new Date();
  if (timeZone) {
    try { return d.toLocaleString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); } catch { /* bad zone: UTC below */ }
  }
  return d.toLocaleString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
}

export async function POST(req: NextRequest) {
  const userToken = bearerToken(req.headers);
  if (!userToken) return NextResponse.json({ ok: false, sent: false, error: 'Sign in required' }, { status: 401 });
  const { data: { user } } = await getUserCompat(userToken);
  if (!user) return NextResponse.json({ ok: false, sent: false, error: 'Sign in required' }, { status: 401 });

  if (!rateLimit(`telegram-test-alert:${user.id}`, LIMIT, WINDOW_MS)) {
    return NextResponse.json({ ok: false, sent: false, error: 'RATE_LIMITED' }, { status: 429 });
  }

  if (!(await hasProFeatures(userToken, user.id))) {
    return NextResponse.json({ ok: false, sent: false, error: 'PRO_REQUIRED' }, { status: 403 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ ok: false, sent: false, error: 'Bot not configured on server' }, { status: 503 });

  const { data: row } = await userClient(userToken)
    .from(T.user_settings)
    .select('telegram_chat_id, timezone, language')
    .eq('user_id', user.id)
    .maybeSingle();
  const chatId = (row?.telegram_chat_id as string | null | undefined)?.trim() || null;
  if (!chatId) return NextResponse.json({ ok: false, sent: false, error: 'Telegram is not connected' }, { status: 409 });

  const lang = tgLocaleOf(row?.language as string | null | undefined);
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        parse_mode: 'HTML',
        // In the reader's saved language (#1651); English when none or when the labels cannot be read.
        text: localizeTelegram(
          `🔔 <b>Test alert</b>\n\n` +
          `This is a test from LiquidityHQ. Your alerts arrive in this chat.\n\n` +
          `<i>⏰ ${stampIn((row?.timezone as string | null | undefined) ?? null)}</i>`,
          lang, await tgLabelsFor(lang)),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!data?.ok) return NextResponse.json({ ok: false, sent: false, error: data?.description ?? `HTTP ${res.status}` }, { status: 502 });
  } catch {
    return NextResponse.json({ ok: false, sent: false, error: 'Telegram did not answer' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true });
}
