import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { hasProFeatures } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

function makeSb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ ok: false, error: 'Bot not configured on server' });

  // Previously an anonymous caller (no Authorization header at all) fell
  // through to the global TELEGRAM_CHAT_ID env var below with no auth check
  // and no rate limit - anyone could spam the owner's real Telegram chat on
  // demand. Auth is now mandatory before any send can happen.
  const authHeader = req.headers.get('Authorization');
  const userToken = authHeader?.replace('Bearer ', '');
  if (!userToken) return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });

  const sb = makeSb(userToken);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in required' }, { status: 401 });

  if (!rateLimit(`telegram-test:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Telegram alerts are Pro-only - don't send a reassuring "connected!"
  // message to a free user whose real alerts will never arrive.
  // Uses hasProFeatures, not getUserRole: a trial user has role='free' but IS
  // entitled to Pro features, and the old `role !== 'pro'` check locked them
  // out of testing a connection the alert cron would then happily deliver to.
  // Also returns a real 403 - it used to answer 200 with an error body, so any
  // caller checking res.ok read the rejection as success.
  if (!(await hasProFeatures(userToken, user.id))) {
    return NextResponse.json(
      { ok: false, error: 'PRO_REQUIRED', message: 'Telegram alerts are a Pro feature.' },
      { status: 403 },
    );
  }

  const { data: settingsData } = await sb
    .from(T.user_settings)
    .select('telegram_chat_id')
    .eq('user_id', user.id)
    .maybeSingle();
  // Fallback to global env var (legacy) - only reachable now by an
  // authenticated, rate-limited Pro user, not an anonymous caller.
  const chatId = settingsData?.telegram_chat_id?.trim() || process.env.TELEGRAM_CHAT_ID || null;

  if (!chatId) {
    return NextResponse.json({ ok: false, error: 'No Chat ID configured. Connect Telegram first.' });
  }

  const now = new Date().toLocaleString('en-GB', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
    day: 'numeric', month: 'short',
  });

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `✅ <b>LiquidityHQ connected!</b>\n\n` +
        `Telegram alerts are working. You'll receive push alerts for:\n` +
        `• Funding rate extremes (longs / shorts overcrowded)\n` +
        `• RSI overbought / oversold (1H)\n` +
        `• Whale trades, open interest spikes, rapid moves\n` +
        `• Price level alerts & daily 7am summary\n\n` +
        `<i>⏰ ${now} UTC</i>`,
    }),
  });

  const data = await res.json();
  if (!data.ok) return NextResponse.json({ ok: false, error: data.description });
  return NextResponse.json({ ok: true });
}
