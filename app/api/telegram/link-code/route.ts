import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/rateLimit';
import { T } from '@/lib/tables';
import { makeLinkCode } from '@/lib/telegramLinkCode';

export const dynamic = 'force-dynamic';

// Issues a one-time code the user sends to the bot to prove they control a
// Telegram chat. See supabase/migrations/20260807j for why this exists: the
// chat ID used to be accepted from a client PATCH, so anyone could point their
// alerts at a stranger's phone. Code generation lives in lib/telegramLinkCode.ts.
const TTL_MS = 10 * 60_000;

// Resolved from Telegram rather than read from an env var. TELEGRAM_BOT_USERNAME
// is not set on any environment, so requiring it would have meant the one-tap
// deep link silently never appeared and every user fell back to typing a code -
// a config step nobody would know was missing. getMe already returns it, and
// the token is right here. Cached for the process lifetime because a bot's
// username effectively never changes, and this sits on a user-facing click.
let cachedUsername: string | null = null;
async function getBotUsername(): Promise<string> {
  if (cachedUsername !== null) return cachedUsername;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return (cachedUsername = '');
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: 'no-store', signal: AbortSignal.timeout(7_000),
    });
    const d = await r.json() as { ok: boolean; result?: { username?: string } };
    // Don't cache a failure - a transient Telegram blip should not disable the
    // deep link until the next deploy.
    if (!d.ok || !d.result?.username) return '';
    return (cachedUsername = d.result.username);
  } catch {
    return '';
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: auth } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  ).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Per-user, not per-IP: the expensive thing to protect is the codes table,
  // and the caller is always authenticated here.
  if (!rateLimit(`tg-link-code:${auth.user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const botUsername = await getBotUsername();

  try {
    const admin = getSupabaseAdmin();

    // Burn any outstanding codes first, so "get a new code" cannot leave
    // several live at once - each extra live code is another chance for one to
    // leak and still work.
    await admin.from(T.telegram_link_codes)
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .is('used_at', null);

    const code = makeLinkCode();
    const { error } = await admin.from(T.telegram_link_codes).insert({
      code,
      user_id: auth.user.id,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    });
    if (error) return apiError('telegram/link-code', error);

    return NextResponse.json({
      code,
      expires_in_seconds: TTL_MS / 1000,
      // Deep link so the common path is one tap and no typing. Null when the
      // bot username isn't configured - the UI then shows the code and asks
      // the user to send it manually, which works identically.
      deep_link: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
    });
  } catch (e) {
    return apiError('telegram/link-code', e);
  }
}

// Disconnect. /api/settings no longer accepts telegram_chat_id at all, so
// without this there would be no way to unlink a chat once connected - the
// user would be stuck receiving alerts with no off switch, which is the same
// complaint the hijack itself caused.
//
// Safe to expose: it only ever clears the CALLER's own row, and clearing is
// not a privileged action - worst case someone stops their own alerts.
export async function DELETE(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: auth } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  ).auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from(T.user_settings)
      .update({ telegram_chat_id: '', updated_at: new Date().toISOString() })
      .eq('user_id', auth.user.id);
    if (error) return apiError('telegram/link-code', error);
    // Also burn any outstanding codes, so disconnecting cannot be undone by a
    // code that was still in flight.
    await admin.from(T.telegram_link_codes)
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .is('used_at', null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError('telegram/link-code', e);
  }
}
