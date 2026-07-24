import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

// GET /api/telegram/setup-webhook
// Registers the webhook URL with Telegram. Call this once after deploy.
// Protected by CRON_SECRET - this mutates where Telegram sends bot updates,
// so it must not be triggerable by an arbitrary caller (or Host-header spoof).
export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'No TELEGRAM_BOT_TOKEN configured' }, { status: 500 });

  // Never trust the request's Host header for the URL we register with Telegram -
  // an attacker could spoof it and redirect all future bot updates to their own server.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const webhookUrl = `${base.replace(/\/$/, '')}/api/telegram/webhook`;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Check current webhook first
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json() as { ok: boolean; result?: { url?: string } };
  const currentUrl = info.result?.url ?? '';

  // Skipping when the URL already matches is an optimization that also skips
  // applying a newly-configured secret_token (getWebhookInfo doesn't expose
  // whether a secret is set). Pass ?force=1 to re-register unconditionally -
  // needed after setting TELEGRAM_WEBHOOK_SECRET on an already-registered URL.
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!force && currentUrl === webhookUrl) {
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
