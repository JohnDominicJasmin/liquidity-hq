import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ configured: false });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    // Legacy check: env-var only
    return NextResponse.json({ configured: !!(botToken && process.env.TELEGRAM_CHAT_ID) });
  }

  const userToken = authHeader.replace('Bearer ', '');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } }
  );

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ configured: false });

  const { data } = await sb
    .from(T.user_settings)
    .select('telegram_chat_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const chatId = data?.telegram_chat_id?.trim() ?? '';
  return NextResponse.json({ configured: chatId.length > 0 });
}
