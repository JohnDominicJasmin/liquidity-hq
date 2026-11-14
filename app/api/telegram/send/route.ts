import { NextRequest, NextResponse } from 'next/server';
import { persistentRateLimit } from '@/lib/persistentRateLimit';
import { readCappedText } from '@/lib/requestBody';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getUserCompat } from '@/lib/authUser';
import { hasProFeatures } from '@/lib/entitlements';
import { userClient } from '@/lib/supabase-user';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/* SIGNED-IN, PRO, TO THE CALLER'S OWN CHAT (security audit #1413, S5, PM decision 2026-11-14).
 *
 * This route used to have no auth and posted to ONE global chat (TELEGRAM_CHAT_ID, the owner's own), guarded only by an in-memory per-IP limit: any visitor's browser could spam
 * it, and the owner's chat received every visitor's dashboard alerts. Now:
 *   - a signed-in session is required (401), and Telegram alerts are a Pro feature like the rest of them (403, trial counts as Pro via hasProFeatures);
 *   - the message goes to the CALLER'S OWN linked chat, read from their own settings row. There is no fallback to a global chat: not linked is 409, never someone else's chat;
 *   - the body is `{ message }` and nothing else (a chat_id, parse_mode or any other key is refused), at most 4 KB read and 1000 characters long;
 *   - the limits are persistent (shared by every instance, survive a restart): 10 a minute and 100 an hour PER USER;
 *   - the message is sent with parse_mode HTML, so every `<` and `>` is escaped and only <b> and <i> are put back (one caller embeds short AI-generated fields).
 * Telegram's own error text is never echoed to the caller. */
const MAX_MESSAGE_LEN = 1000;
const MAX_BODY_BYTES = 4_096;
const ALLOWED_TAGS = ['b', '/b', 'i', '/i'];

function sanitizeTelegramHtml(raw: string): string {
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/&lt;(\/?\w+)&gt;/g, (whole, tag) =>
    ALLOWED_TAGS.includes(tag) ? `<${tag}>` : whole);
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const userToken = authHeader?.replace(/^Bearer\s+/i, '');
  if (!userToken) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const { data: { user } } = await getUserCompat(userToken);
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  if (!(await persistentRateLimit(`telegram-send:user:${user.id}`, 10, 60_000))
      || !(await persistentRateLimit(`telegram-send:user-hour:${user.id}`, 100, 3_600_000))) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  if (!(await hasProFeatures(userToken, user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Telegram alerts are a Pro feature.' }, { status: 403 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: 'Telegram is not configured on this server' }, { status: 503 });
  if (!(await isFeatureEnabled('telegram'))) {
    return NextResponse.json({ error: 'Telegram alerts are temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  const text = await readCappedText(req, MAX_BODY_BYTES);
  if (text === null) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  // Strict shape: an object with exactly one key, `message`, a string. Anything else is refused rather than ignored.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'message') return NextResponse.json({ error: 'Only message is accepted' }, { status: 400 });
  const message = (parsed as { message: unknown }).message;
  if (typeof message !== 'string' || !message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 });
  if (message.length > MAX_MESSAGE_LEN) return NextResponse.json({ error: 'message too long' }, { status: 400 });

  // The caller's OWN chat, through their own session (row level security), never a global one.
  const { data: settings } = await userClient(userToken)
    .from(T.user_settings)
    .select('telegram_chat_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const chatId = settings?.telegram_chat_id?.trim();
  if (!chatId) return NextResponse.json({ error: 'No Chat ID configured. Connect Telegram first.' }, { status: 409 });

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: sanitizeTelegramHtml(message), parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean } | null;
  if (!data?.ok) return NextResponse.json({ error: 'Telegram send failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
