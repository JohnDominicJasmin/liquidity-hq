import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET /api/telegram/setup-webhook
// Registers the webhook URL with Telegram. Call this once after deploy.
export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'No TELEGRAM_BOT_TOKEN configured' }, { status: 500 });

  const host = req.headers.get('host') ?? '';
  const proto = host.includes('localhost') ? 'http' : 'https';
  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;

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
    body: JSON.stringify({ url: webhookUrl }),
  });
  const setData = await setRes.json();

  return NextResponse.json({ ok: setData.ok, webhook_url: webhookUrl, result: setData });
}
