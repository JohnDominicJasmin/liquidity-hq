import { NextRequest, NextResponse } from 'next/server';
import { createClient, isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { apiError } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ configured: false });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    // Legacy check: env-var only
    return NextResponse.json({ configured: !!(botToken && process.env.TELEGRAM_CHAT_ID) });
  }

  // QA, #1499: every failure below used to answer 200 `{configured:false}`, so a backend
  // fault told a user with Telegram linked that it was "Not configured". `configured` is
  // now only ever an answer that was actually read; anything else is a non-2xx, which
  // /settings shows as "Couldn't check".
  try {
    const userToken = authHeader.replace('Bearer ', '');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${userToken}` } } }
    );

    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (!user) {
      // The auth server REJECTED the token (expired, malformed, signed out): 401, as every
      // other per-user route here answers. It could not be asked at all (unreachable,
      // timed out, 5xx): that is our failure, not the caller's.
      const rejected = !authError
        || isAuthSessionMissingError(authError)
        || (isAuthApiError(authError) && authError.status >= 400 && authError.status < 500 && authError.status !== 429);
      if (!rejected) return apiError('telegram/status', authError, 502);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await sb
      .from(T.user_settings)
      .select('telegram_chat_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return apiError('telegram/status', new Error(`user_settings read failed: ${error.message}`), 502);

    const chatId = data?.telegram_chat_id?.trim() ?? '';
    return NextResponse.json({ configured: chatId.length > 0 });
  } catch (e) {
    return apiError('telegram/status', e, 502);
  }
}
