import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/telegram/setup-webhook
// Registers the webhook URL with Telegram. Call this once after deploy.
// Protected by CRON_SECRET — this mutates where Telegram sends bot updates,
// so it must not be triggerable by an arbitrary caller (or Host-header spoof).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret');
    if (auth !== cronSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'No TELEGRAM_BOT_TOKEN configured' }, { status: 500 });

  // Never trust the request's Host header for the URL we register with Telegram —
  // an attacker could spoof it and redirect all future bot updates to their own server.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const webhookUrl = `${base.replace(/\/$/, '')}/api/telegram/webhook`;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Check current webhook first
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json() as { ok: boolean; result?: { url?: string } };
  const currentUrl = info.result?.url ?? '';

  if (currentUrl === webhookUrl) {
    return NextResponse.json({ ok: true, already_set: true, webhook_url: webhookUrl });
  }

  const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, ...(webhookSecret ? { secret_token: webhookSecret } : {}) }),
  });
  const setData = await setRes.json();

  return NextResponse.json({ ok: setData.ok, webhook_url: webhookUrl, result: setData });
}
