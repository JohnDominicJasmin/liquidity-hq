import { NextRequest, NextResponse } from 'next/server';
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { apiError } from '@/lib/apiError';
import { userClient } from '@/lib/supabase-user';
import { getPlanSnapshot } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ configured: false });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    /* The legacy answer here was whether the OWNER's env chat id is set, to anyone without a session (PM audit C10). The only caller (Settings) always sends the header. */
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  // QA, #1499: every failure below used to answer 200 `{configured:false}`, so a backend
  // fault told a user with Telegram linked that it was "Not configured". `configured` is
  // now only ever an answer that was actually read; anything else is a non-2xx, which
  // /settings shows as "Couldn't check".
  try {
    const userToken = authHeader.replace('Bearer ', '');
    const sb = userClient(userToken);

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
    const configured = chatId.length > 0;
    /* A LAPSED PRO STILL HAS ITS CHAT LINKED, but Telegram alerts are Pro only and nothing is sent. `paused` is true only when the plan was READ and is not entitled; an unreadable plan leaves it out (we say nothing we do not know). */
    let paused: boolean | undefined;
    if (configured) {
      const plan = await getPlanSnapshot(userToken, user.id);
      if (plan.status === 'not_entitled') paused = true;
    }
    return NextResponse.json(paused ? { configured, paused } : { configured });
  } catch (e) {
    return apiError('telegram/status', e, 502);
  }
}
