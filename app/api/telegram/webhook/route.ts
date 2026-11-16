import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

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

  /* A malformed body is not a reason for a 500: Telegram redelivers on any non-2xx. */
  let update: TgUpdate;
  try { update = await req.json() as TgUpdate; } catch { return NextResponse.json({ ok: true }); }

  /* NEVER ANSWER A REDELIVERY WITH AN ERROR (PM audit C4). The code used to be burned and then the reply sent with no guard; a timeout threw,
     Telegram redelivered, and the second pass told a successfully linked user the link had "expired". Every send below is guarded and the
     route always answers 200. */
  try {
    if (update.callback_query) await handleConfirm(token, update.callback_query);
    else if (update.message?.chat) await handleMessage(token, update.message);
  } catch (e) {
    console.error('[telegram/webhook] handler failed', e instanceof Error ? e.message : 'unknown');
  }
  return NextResponse.json({ ok: true });
}

type TgChat = { id: number; type?: string; first_name?: string; username?: string };
type TgUpdate = {
  message?: { chat: TgChat; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: TgChat; message_id: number } };
};

const tgCall = (token: string, method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "mi***@gmail.com": enough for the account's owner to recognise it, not enough to identify it to anyone else. */
function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return 'a LiquidityHQ account';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

async function handleMessage(token: string, message: NonNullable<TgUpdate['message']>) {
  const chat = message.chat;
  const text = (message.text ?? '').trim();
  const say = (reply: string, extra: Record<string, unknown> = {}) =>
    tgCall(token, 'sendMessage', { chat_id: chat.id, parse_mode: 'HTML', text: reply, ...extra });

  /* /stop UNLINKS THIS CHAT FROM WHATEVER ACCOUNT HOLDS IT (PM audit C3). A chat that was linked to someone else's account by a forwarded link
     had no way out except to ask that account's owner. Only the chat itself can say /stop, and it only ever clears its own id. */
  if (/^\/stop(@\w+)?$/i.test(text)) {
    await getSupabaseAdmin().from(T.user_settings)
      .update({ telegram_chat_id: null, updated_at: new Date().toISOString() })
      .eq('telegram_chat_id', String(chat.id));
    await say('Disconnected. This chat will not receive LiquidityHQ alerts. Open Alerts in the app and press Connect Telegram to link it again.');
    return;
  }

  if (!/^\/start(@\w+)?(\s|$)/i.test(text)) return;

  // `/start CODE` is the account-linking path. This is the ONLY way a telegram_chat_id gets written: the value comes from Telegram's own
  // update for a chat the sender demonstrably controls, never from a client that could name someone else's. See migration 20260807j.
  /* "/start@LiquidityHQ_bot CODE" is how a command arrives from a group or a menu: the @bot suffix is dropped before the code is read (PM audit C9). */
  const code = text.replace(/^\/start(@\w+)?/i, '').trim().toUpperCase();
  /* Only a private chat is linked: a group id would send one account's alerts to everyone in the group. */
  if (code && chat.type && chat.type !== 'private') {
    await say('Open a private chat with this bot to connect your account.');
    return;
  }
  if (!code) {
    await say(
      `👋 Welcome to <b>LiquidityHQ</b>!\n\n` +
      `To connect this chat, open Alerts in the app and press Connect Telegram. ` +
      `It gives you a link that finishes the setup.`);
    return;
  }

  /* THE LINK NO LONGER BINDS BY ITSELF (PM audit C3). The deep link is shareable, so whoever tapped Start used to have their chat bound to
     the account that generated it - a link forwarded to a stranger linked the stranger's chat to someone else's account, with a reply that
     said "your account". Now the code is only LOOKED UP here (not spent); the chat is told which account it would join and must press
     Confirm. Same message for wrong, expired and used, so this cannot probe which codes exist. */
  const admin = getSupabaseAdmin();
  const { data: row } = await admin.from(T.telegram_link_codes)
    .select('user_id')
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!row?.user_id) {
    await say('⚠️ That link has expired or was already used. Press Connect Telegram in the app for a new one.');
    return;
  }
  let email: string | null = null;
  try { email = (await admin.auth.admin.getUserById(row.user_id)).data.user?.email ?? null; } catch { /* name it generically */ }
  await say(
    `Connect this chat to <b>${esc(maskEmail(email))}</b>?\n\n` +
    `Only confirm if that is your LiquidityHQ account. If someone else sent you this link, ignore it. ` +
    `You can send /stop at any time to disconnect.`,
    { reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `link:${code}` }]] } },
  );
}

async function handleConfirm(token: string, cb: NonNullable<TgUpdate['callback_query']>) {
  const chat = cb.message?.chat;
  const answer = (text?: string) => tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) });
  const finish = (reply: string) => chat
    ? tgCall(token, 'sendMessage', { chat_id: chat.id, parse_mode: 'HTML', text: reply })
    : Promise.resolve(undefined);
  if (!chat || !cb.data?.startsWith('link:')) { await answer(); return; }

  const code = cb.data.slice('link:'.length).toUpperCase();
  const admin = getSupabaseAdmin();

  // Claim atomically: used_at goes non-null only once, so a code that leaks after redemption is inert, and two racing taps cannot both bind.
  // Expiry is checked in the same statement.
  const { data: claimed } = await admin.from(T.telegram_link_codes)
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();

  if (!claimed?.user_id) {
    // A redelivered or double-tapped Confirm lands here too. If this chat is already linked, say so instead of "expired".
    const { data: linked } = await admin.from(T.user_settings).select('user_id').eq('telegram_chat_id', String(chat.id)).limit(1);
    await answer();
    await finish(linked && linked.length > 0
      ? '✅ Connected. Alerts for your LiquidityHQ account will arrive here.'
      : '⚠️ That link has expired or was already used. Press Connect Telegram in the app for a new one.');
    return;
  }

  const { error } = await admin.from(T.user_settings).upsert(
    { user_id: claimed.user_id, telegram_chat_id: String(chat.id), updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) {
    // Do not leave the user with a burned code and no link: put the code back so Confirm can be pressed again.
    await admin.from(T.telegram_link_codes).update({ used_at: null }).eq('code', code);
    await answer('Could not finish connecting. Try again.');
    await finish('⚠️ Could not finish connecting. Press Confirm again, or start again from the app.');
    return;
  }
  await answer('Connected');
  await finish('✅ Connected. Alerts for your LiquidityHQ account will arrive here. Send /stop to disconnect.');
}
