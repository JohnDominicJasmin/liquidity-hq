import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

type BotInfo = { ok: boolean; username: string | null; first_name: string | null; webhook_ok: boolean };

/* R4 (#1640): a Telegram call that timed out, failed to connect or answered something that is not JSON used to throw out of GET as a 500,
   intermittently, on /alerts loads. Every failure now answers the same 503 shape as a host with no bot token, and the page says the
   Telegram status is unavailable instead of saying nothing.

   webhook_ok stays true on a failure for the reason given below for the missing token: the page turns webhook_ok: false into "the bot is
   not responding" - a claim about the webhook that a failed read cannot support. The username is kept when getMe answered and only the
   webhook read failed, so the "Open @bot" link still works.

   Both calls run on every /alerts load, so the answer is cached in this process: 5 minutes when it succeeded, 1 minute when it failed (a
   Telegram outage then costs one 7 s wait a minute, not one per page load). */
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;
let cached: { at: number; ttl: number; info: BotInfo } | null = null;

async function telegram(token: string, method: 'getMe' | 'getWebhookInfo'): Promise<{ ok: boolean; result?: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
    const body = await res.json() as { ok?: unknown; result?: Record<string, unknown> } | null;
    if (body?.ok === true) return { ok: true, result: body.result };
    console.error(`[telegram/bot-info] ${method} answered ${res.status} without ok: true`);
    return null;
  } catch (e) {
    // The error's name only: a fetch error can carry the request URL, and this one has the bot token in it.
    console.error(`[telegram/bot-info] ${method} failed:`, e instanceof Error ? e.name : 'unknown');
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`telegram-bot-info:${getClientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Public on purpose - /alerts calls this before sign-in - so this stays
  // unauthenticated. It only gains a status: `ok: false` with 200 read as
  // success to anything checking res.ok.
  //
  // The BODY is deliberately unchanged, webhook_ok: true included. The UI
  // surfaces webhook_ok: false as a warning banner, and an environment with no
  // bot has no webhook to be wrong about - flipping it would raise a fault
  // where there is none.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { ok: false, username: null, first_name: null, webhook_ok: true },
      { status: 503 },
    );
  }

  if (cached && Date.now() - cached.at < cached.ttl) {
    return NextResponse.json(cached.info, { status: cached.info.ok ? 200 : 503 });
  }

  const [me, webhookInfo] = await Promise.all([telegram(token, 'getMe'), telegram(token, 'getWebhookInfo')]);
  const username  = typeof me?.result?.username === 'string' ? me.result.username : null;
  const firstName = typeof me?.result?.first_name === 'string' ? me.result.first_name : null;

  if (!me || !webhookInfo) {
    const info: BotInfo = { ok: false, username, first_name: firstName, webhook_ok: true };
    cached = { at: Date.now(), ttl: FAIL_TTL_MS, info };
    return NextResponse.json(info, { status: 503 });
  }

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
    const currentUrl  = typeof webhookInfo.result?.url === 'string' ? webhookInfo.result.url : '';
    webhookOk = currentUrl === expectedUrl;
  }

  const info: BotInfo = { ok: true, username, first_name: firstName, webhook_ok: webhookOk };
  cached = { at: Date.now(), ttl: OK_TTL_MS, info };
  return NextResponse.json(info);
}
