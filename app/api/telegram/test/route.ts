import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  let chatId: string | null = null;

  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const userToken = authHeader.replace('Bearer ', '');
    const sb = makeSb(userToken);
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data } = await sb
        .from('user_settings')
        .select('telegram_chat_id')
        .eq('user_id', user.id)
        .maybeSingle();
      chatId = data?.telegram_chat_id?.trim() || null;
    }
  }

  // Fallback to global env var (legacy)
  if (!chatId) chatId = process.env.TELEGRAM_CHAT_ID ?? null;

  if (!chatId) {
    return NextResponse.json({ ok: false, error: 'No Chat ID configured. Connect Telegram first.' });
  }

  const now = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit',
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
        `• Whale trades, OI spikes, rapid moves\n` +
        `• Price level alerts & daily 7am summary\n\n` +
        `<i>⏰ ${now} PHT</i>`,
    }),
  });

  const data = await res.json();
  if (!data.ok) return NextResponse.json({ ok: false, error: data.description });
  return NextResponse.json({ ok: true });
}
