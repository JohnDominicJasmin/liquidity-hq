import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!rateLimit(`telegram-bot-info:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, username: null, first_name: null, webhook_ok: true });

  const [meRes, webhookRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
  ]);

  const me          = await meRes.json() as { ok: boolean; result?: { username?: string; first_name?: string } };
  const webhookInfo = await webhookRes.json() as { ok: boolean; result?: { url?: string } };

  // READ-ONLY on purpose. This used to call setWebhook whenever the registered
  // URL did not match its own, which made an unauthenticated GET - one that
  // fires on every /alerts page load - able to repoint where Telegram delivers
  // bot updates.
  //
  // Dev and prod share one bot (LiquidityHQ_bot) and Telegram allows exactly
  // one webhook per bot, so that turned every visit to dev's /alerts into a
  // silent hijack of prod's webhook. Real users' /start would then land on dev,
  // where their prod link code does not exist, and connecting would fail with
  // "That link has expired or was already used" until somebody happened to
  // load prod's /alerts and flip it back. Outbound alerts kept working, so
  // nothing looked broken. Confirmed live on 2026-08-03 by calling this route
  // against prod then dev and watching the webhook follow the second call.
  //
  // Registration belongs to /api/telegram/setup-webhook, which is gated behind
  // CRON_SECRET precisely because it "mutates where Telegram sends bot updates".
  // Duplicating it here without the gate defeated that. Now this route only
  // REPORTS the mismatch; the UI surfaces webhook_ok: false and the fix is a
  // deliberate call to the secured route.
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const isLocal = !appUrl || appUrl.includes('localhost') || appUrl.includes('127.0.0.1');

  // Local has no publicly reachable URL to register, so a mismatch there is
  // expected rather than a fault - keep reporting OK as before.
  let webhookOk = true;

  if (!isLocal) {
    const expectedUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const currentUrl  = webhookInfo.result?.url ?? '';
    webhookOk = currentUrl === expectedUrl;
  }

  return NextResponse.json({
    ok: me.ok,
    username:    me.result?.username    ?? null,
    first_name:  me.result?.first_name  ?? null,
    webhook_ok:  webhookOk,
  });
}
